/**
 * Core types for the AI Development Methodology Enhancement system.
 *
 * These types define the data structures used by the methodology orchestrator,
 * task classifier, cascade router, prompt engine, and quality gates.
 */

// ─── Task Classification ───────────────────────────────────────────────────

export type TaskType =
  | 'generate'
  | 'explain'
  | 'refactor'
  | 'debug'
  | 'review'
  | 'architect'
  | 'document'
  | 'test'
  | 'ui-from-image'
  | 'quick-fix';

export interface TaskComplexity {
  /** Sequential reasoning steps needed (0.0-1.0) */
  depth: number;
  /** Number of domains/skills involved (0.0-1.0) */
  width: number;
  /** How unclear the requirements are (0.0-1.0) */
  ambiguity: number;
  /** Estimated number of files affected (0.0-1.0) */
  fileScope: number;
}

export interface TaskModality {
  needsVision: boolean;
  needsDiagram: boolean;
  needsCodeExec: boolean;
}

export interface TaskConstraints {
  speedPreferred: boolean;
  qualityPreferred: boolean;
  budgetLimit?: number;
}

export interface TaskClassification {
  type: TaskType;
  complexity: TaskComplexity;
  modalities: TaskModality;
  constraints: TaskConstraints;
  /** Raw signals used for classification (for debugging) */
  signals: {
    queryLength: number;
    hasCodeSnippet: boolean;
    hasFilePath: boolean;
    hasAmbiguityMarkers: boolean;
    hasImageAttachment: boolean;
    subQuestionCount: number;
  };
}

// ─── Methodology ────────────────────────────────────────────────────────────

export type MethodologyId =
  | 'direct-execution'
  | 'spec-first'
  | 'spec-anchored'
  | 'bmad-lite'
  | 'bmad-full'
  | 'supervisor-workers'
  | 'cascade-review'
  | 'multimodal-pipeline'
  | 'quick-flow'
  | 'research-hypothesis';

export type PromptStrategy =
  | 'direct'
  | 'hierarchical-cot'
  | 'plan-then-execute'
  | 'iterative-refinement'
  | 'multi-agent-debate'
  | 'cross-modal'
  | 'schema-first'
  | 'few-shot-strong'
  | 'conversational-decompose';

export type ExecutionPattern = 'sequential' | 'parallel' | 'hybrid';

export interface MethodologyRule {
  when: {
    taskTypes?: TaskType[];
    minComplexity?: number;
    maxComplexity?: number;
    needsVision?: boolean;
    minFileScope?: number;
    maxFileScope?: number;
  };
  methodology: MethodologyId;
  recommendedTier: ModelTier;
  promptStrategy: PromptStrategy;
  executionPattern: ExecutionPattern;
}

export interface MethodologySelection {
  methodology: MethodologyId;
  promptStrategy: PromptStrategy;
  executionPattern: ExecutionPattern;
  recommendedTier: ModelTier;
  confidence: number;
  matchedRule: MethodologyRule | null;
}

// ─── Model Profiling ────────────────────────────────────────────────────────

export type ModelTier = 'S' | 'A' | 'B' | 'C';

export interface ModelCapabilities {
  reasoning: number;
  coding: number;
  knowledge: number;
  instructionFollowing: number;
  toolUse: number;
  vision: number;
  contextUtilization: number;
}

export interface ModelPerformance {
  contextWindow: number;
  ttft: number;
  tokensPerSecond: number;
  costPerInputToken: number;
  costPerOutputToken: number;
}

export interface TaskPerformance {
  successRate: number;
  avgQuality: number;
  avgTokens: number;
  sampleSize: number;
}

export interface ModelProfile {
  id: string;
  provider: string;
  name: string;
  tier: ModelTier;
  capabilities: ModelCapabilities;
  performance: ModelPerformance;
  taskPerformance: Partial<Record<TaskType, TaskPerformance>>;
  lastUpdated: Date;
  source: 'benchmark' | 'empirical' | 'hybrid';
}

// ─── Cascade Routing ────────────────────────────────────────────────────────

export interface CascadeRouterConfig {
  qualityThresholds: Partial<Record<TaskType, number>>;
  maxEscalations: number;
  maxTokensPerRequest: number;
  maxCostPerRequest: number;
  fallbackChain: string[];
}

export interface RouterResult {
  model: string;
  response: string;
  quality: number;
  escalations: number;
  cost: number;
  tokens: number;
  warning?: string;
}

// ─── Quality Evaluation ─────────────────────────────────────────────────────

export interface CodeQualityMetrics {
  compiles: boolean;
  testsPass: boolean;
  complexityOk: boolean;
  noDuplication: boolean;
  importsValid: boolean;
}

export interface QualityMetrics {
  schemaCompliance: boolean;
  completeness: number;
  specificity: number;
  codeMetrics?: CodeQualityMetrics;
  modelConfidence?: number;
  consistencyScore: number;
}

// ─── Prompt Engineering ─────────────────────────────────────────────────────

export interface PromptTemplate {
  systemPrompt: string;
  userPromptTemplate: string;
  schema?: Record<string, unknown>;
  fewShotExamples?: Array<{ input: string; output: string }>;
  maxTokens: number;
  temperature: number;
}

export interface ContextItem {
  content: string;
  tokenCount: number;
  type: 'file' | 'diagnostic' | 'git' | 'workspace' | 'user';
  relevanceScore: number;
  source: string;
}

export interface OptimizedContext {
  items: ContextItem[];
  totalTokens: number;
  edgePlacement: 'beginning' | 'end' | 'both';
}

// ─── Schema Validation ──────────────────────────────────────────────────────

export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: number;
}

// ─── Quality Gates ──────────────────────────────────────────────────────────

export type GateSeverity = 'block' | 'warn' | 'info';

export interface GateResult {
  passed: boolean;
  failures?: string[];
  details?: unknown;
}

export interface QualityGate {
  name: string;
  check: (diff: CodeDiff) => Promise<GateResult>;
  severity: GateSeverity;
}

export interface CodeDiff {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
  newContent: string;
  oldContent: string;
  imports: string[];
}

// ─── Audit Trail ────────────────────────────────────────────────────────────

export type ErrorClass =
  | 'routing'
  | 'model'
  | 'validation'
  | 'execution'
  | 'quality'
  | 'protocol'
  | 'context'
  | 'multimodal';

export interface ClassifiedError {
  class: ErrorClass;
  message: string;
  recoverable: boolean;
  recoveryAction?: string;
  userMessage: string;
}

export interface AuditEntry {
  traceId: string;
  timestamp: Date;
  intent: string;
  methodology: MethodologyId;
  model: string;
  planHash: string;
  status: 'success' | 'error' | 'degraded';
  quality: number;
  cost: number;
  tokens: number;
  duration: number;
  escalations: number;
  error?: ClassifiedError;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface MethodologyConfig {
  enabled: boolean;
  defaultMethodology: MethodologyId;
  modelTiers: {
    S: string[];
    A: string[];
    B: string[];
    C: string[];
  };
  cascade: {
    enabled: boolean;
    maxEscalations: number;
    qualityThresholds: Partial<Record<TaskType, number>>;
  };
  prompting: {
    defaultStrategy: PromptStrategy;
    maxRefinementPasses: number;
    contextBudget: number;
  };
  qualityGates: {
    enabled: boolean;
    gates: {
      importValidation: boolean;
      diffSize: boolean;
      duplication: boolean;
      complexityCeiling: boolean;
      aiSpecificLinting: boolean;
    };
  };
  protocols: {
    mcp: { enabled: boolean; servers: string[] };
    a2a: { enabled: boolean; agents: string[] };
    agui: { enabled: boolean };
  };
  multimodal: {
    enabled: boolean;
    tieredAnalysis: boolean;
    maxImageSize: number;
  };
  refactoring: {
    enabled: boolean;
    autoSuggest: boolean;
    complexityThreshold: number;
    duplicationThreshold: number;
  };
}

// ─── Default Configuration ──────────────────────────────────────────────────

export const DEFAULT_CONFIG: MethodologyConfig = {
  enabled: true,
  defaultMethodology: 'spec-first',
  modelTiers: {
    S: ['anthropic/claude-opus-4-7', 'openai/gpt-5.2', 'google/gemini-3-pro'],
    A: ['anthropic/claude-sonnet-4-6', 'google/gemini-3.1-pro', 'openai/gpt-5.1-codex'],
    B: ['anthropic/claude-haiku-4-5', 'google/gemini-3-flash', 'openai/gpt-5.4-mini'],
    C: [],
  },
  cascade: {
    enabled: true,
    maxEscalations: 2,
    qualityThresholds: {
      generate: 0.7,
      review: 0.8,
      debug: 0.75,
      architect: 0.85,
      'quick-fix': 0.6,
    },
  },
  prompting: {
    defaultStrategy: 'hierarchical-cot',
    maxRefinementPasses: 3,
    contextBudget: 8000,
  },
  qualityGates: {
    enabled: true,
    gates: {
      importValidation: true,
      diffSize: true,
      duplication: true,
      complexityCeiling: true,
      aiSpecificLinting: true,
    },
  },
  protocols: {
    mcp: { enabled: true, servers: [] },
    a2a: { enabled: false, agents: [] },
    agui: { enabled: false },
  },
  multimodal: {
    enabled: true,
    tieredAnalysis: true,
    maxImageSize: 10 * 1024 * 1024, // 10MB
  },
  refactoring: {
    enabled: true,
    autoSuggest: true,
    complexityThreshold: 10,
    duplicationThreshold: 15,
  },
};
