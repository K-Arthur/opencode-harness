/**
 * TaskClassifier — Classifies user messages into task intents using keyword
 * matching, domain detection, and complexity analysis.
 *
 * Enhanced with structural analysis (Phase 1) that uses jCodemunch dependency
 * graphs and coupling metrics to produce TaskAnalysis with decomposition
 * strategy recommendations.
 */

import {
  TaskType,
  TaskDomain,
  TaskComplexity,
  TaskIntent,
  TaskAnalysis,
  DecompositionStrategy,
  FileDependency,
} from './types';
import { STOPWORDS } from './stopwords';

class TaskClassifier {
  private keywordPatterns: Map<TaskType, string[]> = new Map();
  private domainPatterns: Map<TaskDomain, string[]> = new Map();
  // Explicit priority order — tested before checking map insertion order
  private readonly typePriority: TaskType[] = ['testing', 'refactoring', 'documentation', 'debugging', 'coding'];

  constructor() {
    this.initializePatterns();
  }

  /**
   * Classify a user message into task intent
   */
  classify(userMessage: string): TaskIntent {
    const lowerMessage = userMessage.toLowerCase();

    const type = this.detectType(lowerMessage);
    const domain = this.detectDomain(lowerMessage);
    const complexity = this.detectComplexity(lowerMessage);
    const keywords = this.extractKeywords(lowerMessage);

    return { type, domain, complexity, keywords };
  }

  /**
   * Enhanced classification with structural analysis.
   * Combines keyword classification with dependency graph analysis
   * to produce a full TaskAnalysis with decomposition strategy.
   */
  async analyzeWithStructure(
    userMessage: string,
    repo: string,
  ): Promise<TaskAnalysis> {
    const base = this.classify(userMessage);

    // Structural analysis via jCodemunch (lazy — only when repo is available)
    const dependencyGraph = await this.buildDependencyGraph(base, repo);
    const couplingScore = await this.calculateCoupling(dependencyGraph, repo);
    const spansDomains = this.detectCrossDomain(userMessage.toLowerCase());

    return {
      ...base,
      decompositionStrategy: this.selectStrategy(base, couplingScore, spansDomains),
      tddRecommended: this.shouldApplyTdd(base),
      estimatedSubtasks: this.estimateSubtasks(base, dependencyGraph),
      dependencyGraph,
      riskScore: this.calculateRisk(base, couplingScore),
      frontendBackendSplit: spansDomains,
    };
  }

  /**
   * Match a keyword against a message using word boundaries for single tokens
   * to avoid substring false-positives (e.g. 'ui' inside 'build').
   * Multi-word phrases like 'http client' still use substring matching.
   */
  private matchesKeyword(message: string, keyword: string): boolean {
    if (keyword.includes(' ')) return message.includes(keyword);
    // Escape special regex characters in keyword to prevent regex injection
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedKeyword}\\b`).test(message);
  }

  /**
   * Detect task type from message content
   */
  private detectType(message: string): TaskType {
    // Use explicit priority so 'testing' beats 'debugging' for ambiguous messages
    for (const type of this.typePriority) {
      const keywords = this.keywordPatterns.get(type) ?? [];
      if (keywords.some(k => this.matchesKeyword(message, k))) {
        return type;
      }
    }
    return 'coding';
  }

  // Explicit domain priority — more specific domains checked before broader ones
  private readonly domainPriority: TaskDomain[] = ['testing', 'api', 'database', 'frontend', 'backend'];

  /**
   * Detect domain from message content
   */
  private detectDomain(message: string): TaskDomain {
    for (const domain of this.domainPriority) {
      const keywords = this.domainPatterns.get(domain) ?? [];
      if (keywords.some(k => this.matchesKeyword(message, k))) {
        return domain;
      }
    }
    return 'general';
  }

  /**
   * Detect complexity from message length and keywords
   */
  private detectComplexity(message: string): TaskComplexity {
    const complexityKeywords = ['multiple', 'complex', 'comprehensive', 'extensive', 'entire'];
    const simpleKeywords = ['quick', 'simple', 'basic', 'minor', 'small'];

    // Check for complexity indicators
    for (const keyword of complexityKeywords) {
      if (message.includes(keyword)) {
        return 'complex';
      }
    }

    for (const keyword of simpleKeywords) {
      if (message.includes(keyword)) {
        return 'simple';
      }
    }

    // Heuristic based on message length
    if (message.length > 200) {
      return 'complex';
    } else if (message.length > 100) {
      return 'medium';
    }

    return 'simple';
  }

  /**
   * Extract keywords from message for matching
   */
  private extractKeywords(text: string): string[] {
    return text
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOPWORDS.has(word))
      .slice(0, 10);
  }

  /**
   * Initialize keyword patterns for classification
   */
  private initializePatterns(): void {
    // Task type patterns
    this.keywordPatterns.set('debugging', [
      'bug', 'error', 'fix', 'debug', 'issue', 'problem', 'broken', 'crash',
      'exception', 'fail', 'failure', 'wrong', 'incorrect', 'not working'
    ]);

    this.keywordPatterns.set('testing', [
      'test', 'spec', 'unit test', 'integration test', 'test case', 'coverage',
      'mock', 'stub', 'assert', 'verify', 'validate'
    ]);

    this.keywordPatterns.set('refactoring', [
      'refactor', 'clean', 'optimize', 'improve', 'restructure', 'reorganize',
      'simplify', 'reduce complexity', 'code quality'
    ]);

    this.keywordPatterns.set('documentation', [
      'document', 'readme', 'comment', 'docstring', 'explain', 'describe',
      'documentation', 'guide', 'tutorial'
    ]);

    this.keywordPatterns.set('coding', [
      'create', 'build', 'implement', 'develop', 'write', 'add', 'feature',
      'function', 'component', 'class', 'module', 'code'
    ]);

    // Domain patterns
    this.domainPatterns.set('frontend', [
      'react', 'vue', 'angular', 'component', 'ui', 'interface', 'frontend',
      'css', 'html', 'javascript', 'typescript', 'jsx', 'tsx', 'view', 'template'
    ]);

    this.domainPatterns.set('backend', [
      'api', 'endpoint', 'server', 'backend', 'service', 'controller', 'handler',
      'route', 'middleware', 'request', 'response'
    ]);

    this.domainPatterns.set('database', [
      'database', 'db', 'sql', 'query', 'schema', 'migration', 'model',
      'repository', 'orm', 'sequelize', 'prisma', 'typeorm'
    ]);

    this.domainPatterns.set('api', [
      'api', 'rest', 'graphql', 'endpoint', 'http', 'request', 'response',
      'client', 'fetch', 'axios', 'http client'
    ]);

    this.domainPatterns.set('testing', [
      'test', 'spec', 'unit test', 'integration test', 'e2e', 'testing',
      'jest', 'mocha', 'cypress', 'playwright', 'vitest'
    ]);
  }

  // ============================================================
  // Structural Analysis Methods (Phase 1 Enhancement)
  // ============================================================

  /**
   * Build a dependency graph for the files likely affected by this task.
   * Uses keyword-domain mapping to identify candidate files, then queries
   * jCodemunch for actual dependency relationships.
   */
  private async buildDependencyGraph(
    intent: TaskIntent,
    repo: string,
  ): Promise<FileDependency> {
    // Map domain to likely source directories
    const domainDirs = this.getDomainDirectories(intent.domain);

    // In production, this calls jCodemunch get_file_tree and get_dependency_graph
    // For Phase 1, we build a lightweight graph from keyword analysis
    const sourceFiles = this.estimateAffectedFiles(intent, domainDirs);

    return {
      sourceFiles,
      testFiles: sourceFiles.map(f => this.deriveTestPath(f)),
      importChains: [],
      couplingScore: 0, // Calculated separately
    };
  }

  /**
   * Calculate coupling score for the affected files.
   * Higher coupling = more interconnected = higher risk.
   */
  private async calculateCoupling(
    dependencyGraph: FileDependency,
    repo: string,
  ): Promise<number> {
    if (dependencyGraph.sourceFiles.length <= 1) return 0;

    // In production, calls jCodemunch get_coupling_metrics for each file
    // For Phase 1, estimate based on file count and type
    const fileCount = dependencyGraph.sourceFiles.length;
    const hasMixedTypes = this.hasMixedFileTypes(dependencyGraph.sourceFiles);

    // Heuristic: more files + mixed types = higher coupling
    return Math.min((fileCount * 0.1) + (hasMixedTypes ? 0.3 : 0), 1);
  }

  /**
   * Detect if the task spans both frontend and backend domains.
   */
  private detectCrossDomain(input: string | TaskIntent): boolean {
    const message = typeof input === 'string'
      ? input
      : input.keywords.join(' ').toLowerCase();
    const hasFrontend = this.domainPatterns.get('frontend')!.some(k => message.includes(k));
    const hasBackend = this.domainPatterns.get('backend')!.some(k => message.includes(k));
    const hasApi = this.domainPatterns.get('api')!.some(k => message.includes(k));

    return (hasFrontend && hasBackend) || (hasFrontend && hasApi);
  }

  /**
   * Select the optimal decomposition strategy based on task characteristics.
   *
   * Decision matrix (from design document):
   * - simple + any → single
   * - medium + independent files → fan-out
   * - medium + frontend+backend → hierarchical
   * - complex + any → hierarchical
   */
  private selectStrategy(
    intent: TaskIntent,
    couplingScore: number,
    spansDomains: boolean,
  ): DecompositionStrategy {
    // Cross-domain tasks always need coordination, regardless of apparent complexity
    if (spansDomains) {
      return 'hierarchical';
    }

    if (intent.complexity === 'simple') {
      return 'single';
    }

    if (intent.complexity === 'complex') {
      return 'hierarchical';
    }

    // Medium complexity
    if (couplingScore < 0.3) {
      return 'fan-out';
    }

    return 'pipeline';
  }

  /**
   * Determine if TDD should be applied for this task.
   * TDD is recommended for all coding tasks except documentation.
   */
  private shouldApplyTdd(intent: TaskIntent): boolean {
    if (intent.type === 'documentation') return false;
    if (intent.type === 'testing') return false; // Already a testing task
    return true; // coding, debugging, refactoring all benefit from TDD
  }

  /**
   * Estimate the number of subtasks if this task were decomposed.
   */
  private estimateSubtasks(
    intent: TaskIntent,
    dependencyGraph: FileDependency,
  ): number {
    if (intent.complexity === 'simple') return 1;

    const fileCount = dependencyGraph.sourceFiles.length;
    const domainCount = this.detectCrossDomain(intent) ? 2 : 1;

    if (intent.complexity === 'complex') {
      return Math.max(fileCount, domainCount * 2);
    }

    return Math.max(fileCount, domainCount);
  }

  /**
   * Calculate risk score (0-1) for failure without TDD.
   * Higher risk = more important to apply TDD.
   */
  private calculateRisk(
    intent: TaskIntent,
    couplingScore: number,
  ): number {
    let risk = 0;

    // Complexity contributes to risk
    if (intent.complexity === 'complex') risk += 0.4;
    else if (intent.complexity === 'medium') risk += 0.2;

    // Coupling contributes to risk
    risk += couplingScore * 0.3;

    // Cross-domain tasks are riskier
    if (this.detectCrossDomain(intent)) risk += 0.2;

    // Coding tasks without tests are riskiest
    if (intent.type === 'coding') risk += 0.1;

    return Math.min(risk, 1);
  }

  // --- Private helpers ---

  private getDomainDirectories(domain: TaskDomain): string[] {
    const dirs: Record<TaskDomain, string[]> = {
      frontend: ['src/chat/webview', 'src/chat/webview/css'],
      backend: ['src/chat/handlers', 'src/session', 'src/mcp'],
      database: ['src/checkpoint', 'src/session'],
      api: ['src/chat/handlers', 'src/mcp'],
      testing: ['tests', 'src/**/*.test.ts'],
      general: ['src'],
    };
    return (dirs[domain] as string[] | undefined) ?? dirs.general;
  }

  private estimateAffectedFiles(
    intent: TaskIntent,
    domainDirs: string[],
  ): string[] {
    // Heuristic: estimate based on complexity and domain
    const baseCount = intent.complexity === 'complex' ? 5
      : intent.complexity === 'medium' ? 3
      : 1;

    // Generate placeholder file paths (real implementation queries jCodemunch)
    return domainDirs.slice(0, baseCount).map((dir, i) =>
      `${dir}/file${i > 0 ? i : ''}.ts`,
    );
  }

  private hasMixedFileTypes(files: string[]): boolean {
    const extensions = new Set(files.map(f => f.split('.').pop()));
    return extensions.size > 2;
  }

  private deriveTestPath(sourcePath: string): string {
    return sourcePath.replace(/\.tsx?$/, '.test.ts');
  }
}

export { TaskClassifier };
export type { TaskType, TaskDomain, TaskComplexity, TaskIntent };
