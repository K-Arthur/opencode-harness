/**
 * Orchestration types for the configurable adaptive multi-model orchestration mode.
 *
 * Defines pipeline stages, workflow definitions, typed handoff contracts,
 * cost profiles, and pipeline state for the Orchestrated session mode.
 * Builds on the existing methodology types and model routing infrastructure.
 */

import type { AgentRole } from "./modelRouting";

// ─── Pipeline Stages ──────────────────────────────────────────────────────

export type PipelineStageId =
  | "classify"
  | "explore"
  | "retrieve_context"
  | "plan"
  | "plan_review"
  | "implement"
  | "test_execute"
  | "review_code"
  | "review_security"
  | "review_accessibility"
  | "review_performance"
  | "fix"
  | "visual_analyse"
  | "synthesise"
  | "compact_context"
  | "research"
  | "brainstorm"
  | "document";

export const PIPELINE_STAGE_LABELS: Record<PipelineStageId, string> = {
  classify: "Classifying request",
  explore: "Exploring repository",
  retrieve_context: "Gathering context",
  plan: "Planning approach",
  plan_review: "Reviewing plan",
  implement: "Implementing changes",
  test_execute: "Running tests",
  review_code: "Reviewing code",
  review_security: "Reviewing security",
  review_accessibility: "Reviewing accessibility",
  review_performance: "Reviewing performance",
  fix: "Applying fixes",
  visual_analyse: "Analysing visuals",
  synthesise: "Preparing response",
  compact_context: "Compacting context",
  research: "Researching",
  brainstorm: "Brainstorming",
  document: "Writing documentation",
};

export type StageCategory = "read" | "write" | "analyse" | "verify" | "synthesise";

export const STAGE_CATEGORIES: Record<PipelineStageId, StageCategory> = {
  classify: "analyse",
  explore: "read",
  retrieve_context: "read",
  plan: "analyse",
  plan_review: "verify",
  implement: "write",
  test_execute: "verify",
  review_code: "verify",
  review_security: "verify",
  review_accessibility: "verify",
  review_performance: "verify",
  fix: "write",
  visual_analyse: "analyse",
  synthesise: "synthesise",
  compact_context: "analyse",
  research: "read",
  brainstorm: "analyse",
  document: "write",
};

// ─── Task Taxonomy ────────────────────────────────────────────────────────

export type OrchestratedTaskType =
  | "explore"
  | "retrieve_context"
  | "plan"
  | "implement"
  | "refactor"
  | "debug"
  | "generate_tests"
  | "analyse_failures"
  | "review_code"
  | "review_architecture"
  | "review_security"
  | "review_accessibility"
  | "review_performance"
  | "document"
  | "brainstorm"
  | "research"
  | "analyse_image"
  | "analyse_ui_screenshot"
  | "synthesise_response"
  | "compact_context"
  | "resolve_conflicts";

export interface CompositeTask {
  primary: OrchestratedTaskType;
  subTasks: OrchestratedTaskType[];
  /** Whether this is a composite (multi-step) task */
  isComposite: boolean;
}

// ─── Workflow Definitions ─────────────────────────────────────────────────

export interface StageDefinition {
  id: PipelineStageId;
  role: AgentRole;
  /** Whether this stage requires vision capability */
  needsVision?: boolean;
  /** Whether this stage may read files/tools */
  readOnly?: boolean;
  /** Whether this stage may write files */
  writeAllowed?: boolean;
  /** Model preference for this stage */
  preferredModel?: string;
  /** Fallback chain of model IDs */
  fallbackChain?: string[];
  /** Maximum iterations (review loops) */
  maxIterations?: number;
  /** Token budget for this stage */
  tokenBudget?: number;
  /** Timeout in ms */
  timeoutMs?: number;
  /** Prerequisites — stages that must complete first */
  dependsOn?: PipelineStageId[];
  /** Whether this stage may run in parallel with siblings */
  parallel?: boolean;
  /** Conditions to skip this stage */
  skipWhen?: StageSkipCondition;
  /** Reasoning effort level */
  reasoningEffort?: "low" | "medium" | "high" | "auto";
  /** Tool permissions for this stage */
  toolPermissions?: string[];
}

export interface StageSkipCondition {
  /** Skip when primary task type matches this */
  whenTaskType?: OrchestratedTaskType[];
  /** Skip when no images are attached */
  whenNoImages?: boolean;
  /** Skip when request is below this complexity threshold (0-1) */
  whenComplexityBelow?: number;
  /** Skip when request is a quick/trivial request */
  whenQuickRequest?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  /** Ordered stages */
  stages: StageDefinition[];
  /** Cost profile to use */
  costProfileId: string;
  /** Context policy */
  contextPolicy: ContextPolicy;
  /** Max repair loops across all stages */
  maxRepairLoops: number;
  /** Whether to run read-only stages in parallel */
  parallelReads: boolean;
  /** Whether to ask user before implementation */
  requirePlanApproval: boolean;
  /** Whether review is mandatory */
  requireReview: boolean;
  /** Max total tokens across all stages */
  maxTotalTokens: number;
  /** Max total estimated cost */
  maxTotalCost: number;
}

export interface ContextPolicy {
  /** Pass full context (vs. only relevant excerpts) */
  passFullContext: boolean;
  /** Deduplicate context items across stages */
  deduplicate: boolean;
  /** Summarize completed stages before passing to next */
  summarizeCompleted: boolean;
  /** Cache exploration results */
  cacheExploration: boolean;
  /** Compaction threshold % before auto-compact */
  compactionThreshold: number;
}

// ─── Typed Handoff Contracts ──────────────────────────────────────────────

export interface ExplorationResult {
  relevantFiles: string[];
  relevantSymbols: string[];
  architectureSummary: string;
  suspectedChangePoints: string[];
  testsDiscovered: string[];
  constraints: string[];
  openQuestions: string[];
  confidence: number;
  cachedAt?: number;
}

export interface PlanResult {
  goals: string[];
  proposedChanges: Array<{
    file: string;
    action: "create" | "modify" | "delete" | "refactor";
    summary: string;
    risk: "low" | "medium" | "high";
  }>;
  filesAffected: string[];
  risks: string[];
  testingStrategy: string;
  rollbackStrategy: string;
  estimatedDifficulty: number;
}

export interface PlanReviewResult {
  approved: boolean;
  issues: Array<{
    severity: "blocking" | "minor" | "suggestion";
    description: string;
    file?: string;
  }>;
  revisedPlan?: PlanResult;
}

export interface VisualAnalysisResult {
  findings: Array<{
    component: string;
    issue: string;
    severity: "critical" | "major" | "minor";
    cssProperties?: Array<{ property: string; current: string; expected: string }>;
    evidence?: string;
  }>;
  summary: string;
  confidence: number;
  containsText?: boolean;
  textReadabilityIssues?: string[];
}

export interface ReviewResult {
  severity: "blocking" | "warning" | "info";
  file: string;
  symbol?: string;
  evidence: string;
  recommendedFix: string;
  blocksCompletion: boolean;
}

export interface SecurityReviewResult {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file: string;
  vulnerabilityType: string;
  evidence: string;
  cweReference?: string;
  recommendedFix: string;
  blocksCompletion: boolean;
}

export interface TestResult {
  passed: boolean;
  testFile: string;
  testCount: number;
  passedCount: number;
  failedCount: number;
  failures: string[];
  coverageImpact?: string;
}

export interface ImplementationResult {
  filesChanged: string[];
  filesCreated: string[];
  filesDeleted: string[];
  summary: string;
  testResults?: TestResult[];
}

export interface ResearchResult {
  findings: string[];
  sources?: string[];
  confidence: number;
  openQuestions: string[];
}

export type StageHandoff =
  | { stage: "classify"; output: { taskType: OrchestratedTaskType; composite: CompositeTask; complexity: number } }
  | { stage: "explore"; output: ExplorationResult }
  | { stage: "retrieve_context"; output: { relevantContext: string[] } }
  | { stage: "plan"; output: PlanResult }
  | { stage: "plan_review"; output: PlanReviewResult }
  | { stage: "implement"; output: ImplementationResult }
  | { stage: "test_execute"; output: TestResult }
  | { stage: "review_code"; output: ReviewResult[] }
  | { stage: "review_security"; output: SecurityReviewResult[] }
  | { stage: "review_accessibility"; output: ReviewResult[] }
  | { stage: "review_performance"; output: ReviewResult[] }
  | { stage: "fix"; output: ImplementationResult }
  | { stage: "visual_analyse"; output: VisualAnalysisResult }
  | { stage: "synthesise"; output: { response: string } }
  | { stage: "research"; output: ResearchResult }
  | { stage: "document"; output: { filesCreated: string[] } }
  | { stage: "compact_context"; output: { compacted: boolean; tokensSaved: number } }
  | { stage: "brainstorm"; output: { ideas: string[] } };

// ─── Cost Profiles ────────────────────────────────────────────────────────

export interface CostProfile {
  id: string;
  name: string;
  description: string;
  /** Maximum estimated cost per request in USD (0 = no limit) */
  maxCostPerRequest: number;
  /** Maximum total tokens across all stages */
  maxTokensPerRequest: number;
  /** Maximum orchestration stages */
  maxStages: number;
  /** Maximum repair/retry loops */
  maxRepairLoops: number;
  /** Whether parallel agents are allowed */
  parallelAgents: boolean;
  /** Whether automatic escalation to stronger model is allowed */
  autoEscalation: boolean;
  /** Whether expensive models require user confirmation */
  confirmExpensive: boolean;
  /** Whether model fallback is automatic */
  autoFallback: boolean;
  /** Preferred context compaction model */
  compactionModel?: string;
  /** Preferred final synthesis model */
  synthesisModel?: string;
  /** Token budget for each stage category */
  stageCategoryBudget?: Partial<Record<StageCategory, number>>;
  /** Whether to use the cheapest model that meets capability threshold */
  preferCheapestAdequate: boolean;
}

export const COST_PROFILES: Record<string, CostProfile> = {
  economy: {
    id: "economy",
    name: "Economy",
    description: "Minimize cost — use efficient models, limit stages and loops",
    maxCostPerRequest: 0.5,
    maxTokensPerRequest: 50000,
    maxStages: 6,
    maxRepairLoops: 1,
    parallelAgents: false,
    autoEscalation: false,
    confirmExpensive: true,
    autoFallback: true,
    preferCheapestAdequate: true,
    stageCategoryBudget: { read: 5000, analyse: 10000, write: 25000, verify: 5000, synthesise: 5000 },
  },
  balanced: {
    id: "balanced",
    name: "Balanced",
    description: "Good balance of cost, quality, and speed",
    maxCostPerRequest: 2.0,
    maxTokensPerRequest: 100000,
    maxStages: 10,
    maxRepairLoops: 2,
    parallelAgents: true,
    autoEscalation: true,
    confirmExpensive: false,
    autoFallback: true,
    preferCheapestAdequate: false,
    stageCategoryBudget: { read: 10000, analyse: 20000, write: 50000, verify: 10000, synthesise: 10000 },
  },
  quality: {
    id: "quality",
    name: "Quality",
    description: "Maximum quality — use strongest models, full pipeline",
    maxCostPerRequest: 10.0,
    maxTokensPerRequest: 200000,
    maxStages: 14,
    maxRepairLoops: 3,
    parallelAgents: true,
    autoEscalation: true,
    confirmExpensive: false,
    autoFallback: true,
    preferCheapestAdequate: false,
    stageCategoryBudget: { read: 20000, analyse: 40000, write: 100000, verify: 20000, synthesise: 20000 },
  },
};

export type CostProfileId = keyof typeof COST_PROFILES;

// ─── Pipeline State ───────────────────────────────────────────────────────

export type PipelineStageStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";

export interface PipelineStageSnapshot {
  stageId: PipelineStageId;
  status: PipelineStageStatus;
  model: string;
  role: AgentRole;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  tokensUsed?: number;
  estimatedCost?: number;
  error?: string;
  retryCount: number;
}

export interface PipelineState {
  sessionId: string;
  workflowId: string;
  costProfileId: string;
  stages: PipelineStageSnapshot[];
  currentStageIndex: number;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  totalTokensUsed: number;
  totalEstimatedCost: number;
  retryCount: number;
  repairLoopCount: number;
  error?: string;
}

// ─── Configuration Schema ─────────────────────────────────────────────────

export interface OrchestratedConfig {
  /** Whether orchestrated mode is enabled */
  enabled: boolean;
  /** Selected workflow ID */
  workflowId: string;
  /** Cost profile ID */
  costProfile: CostProfileId;
  /** Model assigned to each agent role (overrides) */
  roleModels: Partial<Record<AgentRole, string>>;
  /** Fallback chain per role */
  fallbackModels: Partial<Record<AgentRole, string[]>>;
  /** Reasoning effort per role */
  reasoningEffort: Partial<Record<AgentRole, "low" | "medium" | "high" | "auto">>;
  /** Vision model override */
  visionModel?: string;
  /** Review model override */
  reviewModel?: string;
  /** Final synthesis model override */
  synthesisModel?: string;
  /** Whether to require plan approval */
  requirePlanApproval: boolean;
  /** Whether parallel reads are allowed */
  parallelReads: boolean;
  /** Custom prompt templates (partial overrides) */
  customTemplates?: Partial<Record<AgentRole, string>>;
  /** Custom workflow stages (extends/overrides default) */
  customStages?: Partial<StageDefinition>[];
  /** Maximum repair loops */
  maxRepairLoops: number;
  /** Whether expensive model escalation requires confirmation */
  confirmExpensive: boolean;
  /** Privacy: allowed providers for remote model execution */
  allowedProviders?: string[];
  /** Privacy: blocked providers */
  blockedProviders?: string[];
}

export const DEFAULT_ORCHESTRATED_CONFIG: OrchestratedConfig = {
  enabled: true,
  workflowId: "standard",
  costProfile: "balanced",
  roleModels: {},
  fallbackModels: {},
  reasoningEffort: {
    planning: "high",
    implementation: "medium",
    review: "medium",
    debugging: "high",
    visualReview: "low",
  },
  requirePlanApproval: false,
  parallelReads: true,
  maxRepairLoops: 2,
  confirmExpensive: false,
};

// ─── Presets ──────────────────────────────────────────────────────────────

export interface OrchestratedPreset {
  id: string;
  name: string;
  description: string;
  config: OrchestratedConfig;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PRESETS: OrchestratedPreset[] = [
  {
    id: "default",
    name: "Default",
    description: "Balanced orchestration with role-specific models",
    config: { ...DEFAULT_ORCHESTRATED_CONFIG },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "economy",
    name: "Economy",
    description: "Cost-optimized orchestration — uses tier B/C models for reads/verification",
    config: {
      ...DEFAULT_ORCHESTRATED_CONFIG,
      costProfile: "economy",
      maxRepairLoops: 1,
      confirmExpensive: true,
      reasoningEffort: { planning: "medium", implementation: "low", review: "low", debugging: "medium", visualReview: "low" },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "thorough",
    name: "Thorough",
    description: "Maximum quality — full pipeline with review passes and secure synthesis",
    config: {
      ...DEFAULT_ORCHESTRATED_CONFIG,
      costProfile: "quality",
      requirePlanApproval: true,
      maxRepairLoops: 3,
      reasoningEffort: { planning: "high", implementation: "high", review: "high", debugging: "high", visualReview: "medium" },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];
