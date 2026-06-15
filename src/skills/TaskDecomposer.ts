/**
 * TaskDecomposer — Breaks complex tasks into dependency-aware subtasks
 * using jCodemunch dependency graphs and coupling metrics.
 *
 * Phase 2: Integrates with jCodemunch get_dependency_graph, get_coupling_metrics,
 * and get_file_tree to produce structured DecompositionPlan objects.
 *
 * Phase 3: Optional spec context. When a `Spec` is provided, the decomposer
 * injects one task per `verificationCriteria` entry (test scaffolding work)
 * and one task per `taskBreakdown` entry (spec-defined sub-area), letting
 * a spec act as a first-class decomposition input alongside the analysis.
 */

import {
  TaskAnalysis,
  TaskDomain,
  DecomposedTask,
  DecompositionPlan,
  DecompositionStrategy,
  ConflictResolution,
  FileDependency,
  TddScope,
} from './types';

/**
 * Spec context. Loosely typed to avoid a hard dependency on
 * methodology/SpecService; matches the shape produced by SpecService
 * (outcomes, scope, constraints, decisions, taskBreakdown,
 * verificationCriteria).
 */
export interface SpecContext {
  id: string
  outcomes: readonly string[]
  scope: { inScope: readonly string[]; outOfScope: readonly string[] }
  constraints: readonly string[]
  decisions: Readonly<Record<string, string>>
  taskBreakdown: ReadonlyArray<{ id: string; title: string; description?: string }>
  verificationCriteria: ReadonlyArray<{ id: string; description: string; type: 'unit-test' | 'integration-test' | 'manual' | 'metric' }>
}

export interface SpecTaskBreakdownItem {
  id: string
  title: string
  description?: string
}

export interface SpecVerificationCriterion {
  id: string
  description: string
  type: 'unit-test' | 'integration-test' | 'manual' | 'metric'
}

interface JCodemunchDependencyGraph {
  imports: string[];
  importers: string[];
}

interface JCodemunchCouplingMetrics {
  ca: number; // afferent coupling (dependents)
  ce: number; // efferent coupling (dependencies)
  instability: number; // ce / (ca + ce)
}

interface JCodemunchFileTree {
  files: Array<{
    path: string;
    type: 'file' | 'directory';
  }>;
}

class TaskDecomposer {
  private jCodemunchClient: JCodemunchClient | null = null;

  constructor(client?: JCodemunchClient) {
    this.jCodemunchClient = client ?? null;
  }

  /**
   * Decompose a task analysis into a structured plan with subtasks,
   * execution order, and conflict resolution strategies.
   */
  async decompose(
    analysis: TaskAnalysis,
    repo: string,
    spec?: SpecContext,
  ): Promise<DecompositionPlan> {
    const tasks = await this.generateTasks(analysis, repo, spec);
    const executionOrder = this.computeExecutionOrder(tasks);
    const conflicts = await this.detectConflicts(tasks, repo);

    return {
      strategy: analysis.decompositionStrategy,
      tasks,
      executionOrder,
      totalEstimatedComplexity: this.calculateTotalComplexity(tasks),
      conflictRisk: this.assessConflictRisk(conflicts),
    };
  }

  /**
   * Generate decomposed tasks based on the analysis and repository structure.
   */
  private async generateTasks(
    analysis: TaskAnalysis,
    repo: string,
    spec?: SpecContext,
  ): Promise<DecomposedTask[]> {
    const tasks: DecomposedTask[] = [];

    // Cross-domain tasks need separate frontend/backend subtasks
    if (analysis.frontendBackendSplit) {
      tasks.push(
        await this.createDomainTask(analysis, 'frontend', repo, spec),
        await this.createDomainTask(analysis, 'backend', repo, spec),
      );
    } else {
      tasks.push(
        await this.createDomainTask(analysis, this.mapDomain(analysis.domain), repo, spec),
      );
    }

    // Add database tasks if database domain is involved
    if (analysis.domain === 'database' || this.involvesDatabase(analysis)) {
      tasks.push(
        await this.createDomainTask(analysis, 'database', repo, spec),
      );
    }

    // Add API tasks if API domain is involved
    if (analysis.domain === 'api' || this.involvesApi(analysis)) {
      tasks.push(
        await this.createDomainTask(analysis, 'api', repo, spec),
      );
    }

    // Add spec-derived tasks: each verification criterion becomes a test
    // task; each taskBreakdown item becomes a domain-agnostic task.
    if (spec) {
      for (const verification of spec.verificationCriteria) {
        tasks.push(this.createSpecVerificationTask(verification, repo, spec));
      }
      for (const item of spec.taskBreakdown) {
        tasks.push(this.createSpecTaskBreakdownItem(item, repo, spec));
      }
    }

    // Deduplicate by domain
    return this.deduplicateTasks(tasks);
  }

  /**
   * Create a domain-specific subtask with real file discovery.
   */
  private async createDomainTask(
    analysis: TaskAnalysis,
    domain: DecomposedTask['domain'],
    repo: string,
    spec?: SpecContext,
  ): Promise<DecomposedTask> {
    const files = await this.discoverFilesForDomain(domain, repo, analysis);
    const testFiles = await this.discoverTestFiles(files, repo);
    const tddScope = this.determineTddScope(analysis, domain);

    return {
      id: `task-${domain}-${Date.now()}`,
      title: this.generateTaskTitle(analysis, domain, spec),
      description: this.generateTaskDescription(analysis, domain),
      domain,
      dependencies: this.determineDependencies(domain, analysis),
      files,
      testFiles,
      estimatedComplexity: analysis.complexity,
      tddScope,
    };
  }

  /**
   * Discover files for a specific domain using jCodemunch file tree.
   */
  private async discoverFilesForDomain(
    domain: DecomposedTask['domain'],
    repo: string,
    analysis: TaskAnalysis,
  ): Promise<string[]> {
    if (!this.jCodemunchClient) {
      return this.fallbackFileDiscovery(domain, analysis);
    }

    try {
      const dir = this.getDomainDirectory(domain);
      const tree = await this.jCodemunchClient.getFileTree(repo, dir);
      return tree.files
        .filter(f => f.type === 'file' && this.isSourceFile(f.path))
        .map(f => f.path)
        .slice(0, this.maxFilesForComplexity(analysis.complexity));
    } catch {
      return this.fallbackFileDiscovery(domain, analysis);
    }
  }

  /**
   * Discover test files corresponding to source files.
   */
  private async discoverTestFiles(
    sourceFiles: string[],
    repo: string,
  ): Promise<string[]> {
    if (!this.jCodemunchClient) {
      return sourceFiles.map(f => this.deriveTestPath(f));
    }

    const testFiles: string[] = [];
    for (const source of sourceFiles) {
      try {
        const graph = await this.jCodemunchClient.getDependencyGraph(
          repo,
          source,
          { direction: 'imports' },
        );
        const tests = graph.imports.filter(f => this.isTestFile(f));
        testFiles.push(...tests);
      } catch {
        testFiles.push(this.deriveTestPath(source));
      }
    }

    return [...new Set(testFiles)];
  }

  /**
   * Determine the appropriate TDD scope for a domain task.
   */
  private determineTddScope(
    analysis: TaskAnalysis,
    domain: DecomposedTask['domain'],
  ): TddScope {
    const scopeMap: Record<typeof domain, TddScope> = {
      frontend: {
        testType: 'component',
        testFramework: this.detectTestFramework(['vitest', 'jest']),
        testPatterns: ['render', 'click', 'snapshot'],
        edgeCases: ['empty state', 'loading state', 'error state'],
      },
      backend: {
        testType: 'unit',
        testFramework: this.detectTestFramework(['jest', 'vitest']),
        testPatterns: ['input/output', 'error handling', 'boundary conditions'],
        edgeCases: ['null input', 'empty array', 'max size'],
      },
      database: {
        testType: 'integration',
        testFramework: this.detectTestFramework(['jest', 'vitest']),
        testPatterns: ['crud operations', 'transactions', 'migrations'],
        edgeCases: ['constraint violations', 'null fields', 'duplicate keys'],
      },
      api: {
        testType: 'integration',
        testFramework: this.detectTestFramework(['jest', 'vitest']),
        testPatterns: ['request/response', 'status codes', 'validation'],
        edgeCases: ['malformed input', 'auth failure', 'rate limiting'],
      },
      shared: {
        testType: 'unit',
        testFramework: this.detectTestFramework(['jest', 'vitest']),
        testPatterns: ['pure functions', 'type validation', 'utilities'],
        edgeCases: ['edge values', 'type coercion', 'undefined behavior'],
      },
    };

    return scopeMap[domain];
  }

  /**
   * Compute execution order based on task dependencies.
   * Returns array of batches — tasks in same batch can run in parallel.
   */
  private computeExecutionOrder(tasks: DecomposedTask[]): string[][] {
    const dependencyMap = new Map<string, string[]>();
    for (const task of tasks) {
      dependencyMap.set(task.id, task.dependencies);
    }

    const batches: string[][] = [];
    const scheduled = new Set<string>();
    const remaining = new Set(tasks.map(t => t.id));

    while (remaining.size > 0) {
      // Find tasks whose dependencies are all scheduled
      const ready: string[] = [];
      for (const id of remaining) {
        const deps = dependencyMap.get(id) ?? [];
        if (deps.every(d => scheduled.has(d) || d === '')) {
          ready.push(id);
        }
      }

      if (ready.length === 0) {
        // Cycle detected — schedule remaining together
        batches.push([...remaining]);
        break;
      }

      batches.push(ready);
      for (const id of ready) {
        scheduled.add(id);
        remaining.delete(id);
      }
    }

    return batches;
  }

  /**
   * Detect conflicts between tasks (file overlap, dependency cycles, API mismatches).
   */
  private async detectConflicts(
    tasks: DecomposedTask[],
    repo: string,
  ): Promise<ConflictResolution[]> {
    const conflicts: ConflictResolution[] = [];

    // File overlap detection
    const fileToTasks = new Map<string, string[]>();
    for (const task of tasks) {
      for (const file of [...task.files, ...task.testFiles]) {
        const existing = fileToTasks.get(file) ?? [];
        existing.push(task.id);
        fileToTasks.set(file, existing);
      }
    }

    for (const [file, taskIds] of fileToTasks) {
      if (taskIds.length > 1) {
        conflicts.push({
          type: 'file-overlap',
          affectedFiles: [file],
          involvedAgents: taskIds,
          resolution: 'sequential',
          resolvedBy: 'orchestrator',
        });
      }
    }

    // Dependency cycle detection
    const cycles = this.detectDependencyCycles(tasks);
    for (const cycle of cycles) {
      conflicts.push({
        type: 'dependency-cycle',
        affectedFiles: [],
        involvedAgents: cycle,
        resolution: 'sequential',
        resolvedBy: 'orchestrator',
      });
    }

    return conflicts;
  }

  /**
   * Detect circular dependencies between tasks.
   */
  private detectDependencyCycles(tasks: DecomposedTask[]): string[][] {
    const graph = new Map<string, string[]>();
    for (const task of tasks) {
      graph.set(task.id, task.dependencies.filter(d => d !== ''));
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string, path: string[]) => {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      for (const dep of graph.get(node) ?? []) {
        dfs(dep, [...path]);
      }

      inStack.delete(node);
    };

    for (const task of tasks) {
      dfs(task.id, []);
    }

    return cycles;
  }

  /**
   * Determine dependencies for a domain task.
   */
  private determineDependencies(
    domain: DecomposedTask['domain'],
    analysis: TaskAnalysis,
  ): string[] {
    // Database tasks have no dependencies (foundation layer)
    if (domain === 'database') return [];

    // API tasks depend on database tasks if database is involved
    if (domain === 'api' && this.involvesDatabase(analysis)) {
      return [`task-database-${Date.now()}`];
    }

    // Backend tasks depend on database and API tasks
    if (domain === 'backend') {
      const deps: string[] = [];
      if (this.involvesDatabase(analysis)) {
        deps.push(`task-database-${Date.now()}`);
      }
      if (this.involvesApi(analysis)) {
        deps.push(`task-api-${Date.now()}`);
      }
      return deps;
    }

    // Frontend tasks depend on backend/API tasks
    if (domain === 'frontend') {
      const deps: string[] = [];
      if (analysis.frontendBackendSplit) {
        deps.push(`task-backend-${Date.now()}`);
      }
      if (this.involvesApi(analysis)) {
        deps.push(`task-api-${Date.now()}`);
      }
      return deps;
    }

    return [];
  }

  /**
   * Assess overall conflict risk from detected conflicts.
   */
  private assessConflictRisk(
    conflicts: ConflictResolution[],
  ): 'low' | 'medium' | 'high' {
    if (conflicts.length === 0) return 'low';
    if (conflicts.some(c => c.type === 'dependency-cycle')) return 'high';
    if (conflicts.length > 2) return 'high';
    return 'medium';
  }

  /**
   * Calculate total estimated complexity across all tasks.
   */
  private calculateTotalComplexity(tasks: DecomposedTask[]): number {
    const complexityValues = { simple: 1, medium: 3, complex: 5 };
    return tasks.reduce(
      (sum, task) => sum + complexityValues[task.estimatedComplexity],
      0,
    );
  }

  /**
   * Deduplicate tasks by domain, keeping the most comprehensive one.
   */
  private deduplicateTasks(tasks: DecomposedTask[]): DecomposedTask[] {
    const byDomain = new Map<string, DecomposedTask>();
    for (const task of tasks) {
      const existing = byDomain.get(task.domain);
      if (!existing || task.files.length > existing.files.length) {
        byDomain.set(task.domain, task);
      }
    }
    return [...byDomain.values()];
  }

  // --- Domain detection helpers ---

  private involvesDatabase(analysis: TaskAnalysis): boolean {
    return (
      analysis.domain === 'database' ||
      analysis.keywords.some(k =>
        ['database', 'db', 'sql', 'query', 'schema', 'migration', 'model', 'orm', 'prisma'].includes(k),
      )
    );
  }

  private involvesApi(analysis: TaskAnalysis): boolean {
    return (
      analysis.domain === 'api' ||
      analysis.keywords.some(k =>
        ['api', 'rest', 'graphql', 'endpoint', 'http', 'route', 'controller'].includes(k),
      )
    );
  }

  /**
   * Map TaskDomain to DecomposedTask domain.
   * TaskDomain includes 'testing' and 'general' which need mapping.
   */
  private mapDomain(domain: TaskDomain): DecomposedTask['domain'] {
    const mapping: Record<TaskDomain, DecomposedTask['domain']> = {
      frontend: 'frontend',
      backend: 'backend',
      database: 'database',
      api: 'api',
      testing: 'shared',
      general: 'shared',
    };
    return mapping[domain];
  }

  // --- File discovery helpers ---

  private getDomainDirectory(domain: DecomposedTask['domain']): string {
    const dirs: Record<typeof domain, string> = {
      frontend: 'src/',
      backend: 'src/',
      database: 'src/',
      api: 'src/',
      shared: 'src/',
    };
    return dirs[domain];
  }

  private isSourceFile(path: string): boolean {
    return /\.(ts|tsx|js|jsx|py|java|go|rs|rb)$/i.test(path);
  }

  private isTestFile(path: string): boolean {
    return /\.(test|spec|_test|_spec)\.(ts|tsx|js|jsx|py)$/i.test(path);
  }

  private deriveTestPath(sourcePath: string): string {
    return sourcePath.replace(/\.tsx?$/, '.test.ts');
  }

  private maxFilesForComplexity(complexity: string): number {
    switch (complexity) {
      case 'simple': return 2;
      case 'medium': return 5;
      case 'complex': return 10;
      default: return 3;
    }
  }

  private fallbackFileDiscovery(
    domain: DecomposedTask['domain'],
    analysis: TaskAnalysis,
  ): string[] {
    const baseCount = this.maxFilesForComplexity(analysis.complexity);
    const dir = this.getDomainDirectory(domain);
    return Array.from({ length: baseCount }, (_, i) =>
      `${dir}${domain}/file${i > 0 ? i : ''}.ts`,
    );
  }

  // --- Task metadata helpers ---

  private generateTaskTitle(
    analysis: TaskAnalysis,
    domain: DecomposedTask['domain'],
    spec?: SpecContext,
  ): string {
    // Spec-aware override: prefer an in-scope item that names the
    // domain over the analysis-driven default title.
    if (spec) {
      const match = spec.scope.inScope.find((s) => s.toLowerCase().includes(domain))
      if (match) return match
    }
    const typeLabels: Record<string, string> = {
      coding: 'Implement',
      debugging: 'Fix',
      refactoring: 'Refactor',
      testing: 'Test',
      documentation: 'Document',
    };

    const domainLabels: Record<string, string> = {
      frontend: 'UI',
      backend: 'Service',
      database: 'Data Layer',
      api: 'API',
      shared: 'Shared',
    };

    return `${typeLabels[analysis.type] ?? 'Build'} ${domainLabels[domain] ?? domain}`;
  }

  private generateTaskDescription(
    analysis: TaskAnalysis,
    domain: DecomposedTask['domain'],
  ): string {
    return `${analysis.type} task for ${domain} domain. Keywords: ${analysis.keywords.join(', ')}.`;
  }

  private detectTestFramework(candidates: string[]): string {
    // In production, scan package.json for test framework dependencies
    return candidates[0] ?? 'jest';
  }

  // ────────────────────────────────────────────────────────────────────
  // Spec-aware task generation (Phase 3 of the SADD/TDD integration)
  // ────────────────────────────────────────────────────────────────────

  /**
   * One task per spec verification criterion. The task's TDD scope is
   * derived from the criterion's type:
   *   - 'unit-test' / 'integration-test'  → testType 'unit' / 'integration'
   *   - 'metric' / 'manual'                → testType 'component' (placeholder)
   */
  private createSpecVerificationTask(
    criterion: SpecVerificationCriterion,
    repo: string,
    spec: SpecContext,
  ): DecomposedTask {
    const testType: TddScope['testType'] =
      criterion.type === 'unit-test' ? 'unit'
      : criterion.type === 'integration-test' ? 'integration'
      : 'component'
    return {
      id: `spec-verify-${criterion.id}-${Date.now()}`,
      title: `Verify: ${criterion.description}`,
      description: `Spec ${spec.id} verification criterion (${criterion.type}).`,
      domain: 'shared',
      dependencies: [],
      files: [],
      testFiles: [],
      estimatedComplexity: 'simple',
      tddScope: {
        testType,
        testFramework: 'jest',
        testPatterns: [`${criterion.id} passes`, `${criterion.id} returns expected value`],
        edgeCases: criterion.type === 'unit-test' ? ['null input', 'empty input'] : [],
      },
    }
  }

  /**
   * One task per spec taskBreakdown item. These are spec-defined
   * sub-areas and may or may not overlap with the analysis-derived
   * domain tasks — the final `deduplicateTasks` pass folds
   * overlapping titles.
   */
  private createSpecTaskBreakdownItem(
    item: SpecTaskBreakdownItem,
    repo: string,
    spec: SpecContext,
  ): DecomposedTask {
    return {
      id: `spec-item-${item.id}-${Date.now()}`,
      title: item.title,
      description: item.description ?? `Spec ${spec.id} task breakdown item.`,
      domain: 'shared',
      dependencies: [],
      files: [],
      testFiles: [],
      estimatedComplexity: 'medium',
      tddScope: {
        testType: 'component',
        testFramework: 'jest',
        testPatterns: [],
        edgeCases: [],
      },
    }
  }
}

/**
 * jCodemunch client interface for dependency analysis.
 * Implemented by the extension's jCodemunch MCP integration.
 */
interface JCodemunchClient {
  getFileTree(
    repo: string,
    pathPrefix?: string,
  ): Promise<JCodemunchFileTree>;

  getDependencyGraph(
    repo: string,
    file: string,
    options?: { direction?: 'imports' | 'importers' | 'both'; depth?: number },
  ): Promise<JCodemunchDependencyGraph>;

  getCouplingMetrics(
    repo: string,
    file: string,
  ): Promise<JCodemunchCouplingMetrics>;
}

export { TaskDecomposer };
export type { JCodemunchClient, JCodemunchDependencyGraph, JCodemunchCouplingMetrics };
