/**
 * Type definitions for the skill system — task classification, skill triggering,
 * confidence scoring, and SADD/TDD enhancement types.
 */

// ============================================================
// Task Classification (existing + enhanced)
// ============================================================

export type TaskType = 'testing' | 'refactoring' | 'documentation' | 'debugging' | 'coding';
export type TaskDomain = 'frontend' | 'backend' | 'database' | 'api' | 'testing' | 'general';
export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface TaskIntent {
  type: TaskType;
  domain: TaskDomain;
  complexity: TaskComplexity;
  keywords: string[];
}

export type DecompositionStrategy = 'single' | 'fan-out' | 'pipeline' | 'hierarchical' | 'blackboard';

export interface ImportChain {
  from: string;
  to: string;
  depth: number;
}

export interface FileDependency {
  sourceFiles: string[];
  testFiles: string[];
  importChains: ImportChain[];
  couplingScore: number;
}

export interface TaskAnalysis extends TaskIntent {
  decompositionStrategy: DecompositionStrategy;
  tddRecommended: boolean;
  estimatedSubtasks: number;
  dependencyGraph: FileDependency;
  riskScore: number;
  frontendBackendSplit: boolean;
}

// ============================================================
// Skill Triggering
// ============================================================

export interface TriggerRule {
  id: string;
  name: string;
  pattern: string;
  skillIds: string[];
  priority: number;
  enabled: boolean;
  category: 'keyword' | 'domain' | 'complexity' | 'sadd' | 'tdd';
}

export interface TriggerMatch {
  rule: TriggerRule;
  match: string;
  confidence: number;
}

// ============================================================
// Confidence Scoring
// ============================================================

export interface ConfidenceSignals {
  semanticSimilarity: number;
  taskMatch: number;
  contextMatch: number;
  triggerConfidence: number;
  modelPerformance: number;
  userPreference: number;
  historicalUsage: number;
  decompositionAccuracy?: number;
  testCoverage?: number;
  tddSuccessRate?: number;
}

export interface ConfidenceResult {
  confidence: number;
  signals: ConfidenceSignals;
  level: 'very-low' | 'low' | 'medium' | 'high' | 'very-high';
  reasoning: string;
}

export interface ProjectContext {
  projectType: string;
  hasTests: boolean;
  hasDocumentation: boolean;
}

export interface ModelSkillInfo {
  supported: boolean;
  performanceScore: number;
}

export interface ScorerState {
  signalWeights: Array<[string, number]>;
  historicalUsage: Array<[string, number]>;
  userPreferences: Array<[string, number]>;
}

// ============================================================
// Task Decomposition (Phase 2)
// ============================================================

export interface TddScope {
  testType: 'unit' | 'integration' | 'component' | 'e2e';
  testFramework: string;
  testPatterns: string[];
  edgeCases: string[];
}

export interface DecomposedTask {
  id: string;
  title: string;
  description: string;
  domain: 'frontend' | 'backend' | 'database' | 'api' | 'shared';
  dependencies: string[];
  files: string[];
  testFiles: string[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
  tddScope: TddScope;
}

export interface DecompositionPlan {
  strategy: DecompositionStrategy;
  tasks: DecomposedTask[];
  executionOrder: string[][];
  totalEstimatedComplexity: number;
  conflictRisk: 'low' | 'medium' | 'high';
}

export interface ConflictResolution {
  type: 'file-overlap' | 'dependency-cycle' | 'api-mismatch';
  affectedFiles: string[];
  involvedAgents: string[];
  resolution: 'sequential' | 'merge' | 'reassign';
  resolvedBy: 'orchestrator' | 'human';
}

// ============================================================
// TDD Orchestration (Phase 3)
// ============================================================

export interface TddPhase {
  name: 'red' | 'green' | 'refactor' | 'coverage';
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  testFile?: string;
  testContent?: string;
  implementationFile?: string;
  implementationContent?: string;
  testOutput?: string;
  iterations: number;
}

export interface TddOrchestrationState {
  taskId: string;
  phases: TddPhase[];
  currentPhase: number;
  totalTests: number;
  passingTests: number;
  failingTests: number;
  coveragePercent?: number;
  testFramework: string;
  domain: 'frontend' | 'backend' | 'database' | 'api' | 'shared';
}

// ============================================================
// Agent Communication (Phase 4)
// ============================================================

export interface AgentMessage {
  from: string;
  to: string;
  type: 'status' | 'dependency' | 'conflict' | 'handoff' | 'question';
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface AgentStatus {
  agentId: string;
  taskId: string;
  phase: 'test-generation' | 'red-verification' | 'implementation' | 'review' | 'complete';
  progress: number;
  filesModified: string[];
  testsWritten: number;
  testsPassing: number;
  blockers: string[];
}

// ============================================================
// Feedback Loop (Phase 5)
// ============================================================

export interface SaddMetrics {
  taskId: string;
  decompositionStrategy: string;
  numSubtasks: number;
  numSubagents: number;
  totalDuration: number;
  testPassRate: number;
  reviewIterations: number;
  decompositionAccuracy: number;
  conflictCount: number;
  humanInterventions: number;
  success: boolean;
}

export interface TddMetrics {
  taskId: string;
  domain: string;
  testsGenerated: number;
  testsPassedFirstRun: number;
  redGreenRefactorCycles: number;
  finalCoverage: number;
  bugsFoundPostTdd: number;
  success: boolean;
}

export interface StrategyRefinement {
  pattern: string;
  currentStrategy: string;
  suggestedStrategy: string;
  confidence: number;
  evidence: number;
}

// ============================================================
// Extended SubagentActivity (UI)
// ============================================================

export interface SubagentActivity {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'pending';
  output?: string;
  progress?: number;
  tddPhase?: 'red' | 'green' | 'refactor' | 'coverage';
  testsWritten?: number;
  testsPassing?: number;
  dependencies?: string[];
  domain?: 'frontend' | 'backend' | 'database' | 'api' | 'shared';
}
