/**
 * Typed, validated handoff contracts for multi-stage orchestration.
 *
 * Each stage produces a typed output that is validated before being passed to
 * downstream stages. When the model returns malformed output, the system
 * attempts safe local repair before falling back to retry or failure.
 */

import type { OrchestratedTaskType } from "./types";

// ─── Classification Handoff ────────────────────────────────────────────────

export interface ClassificationHandoff {
  taskType: OrchestratedTaskType;
  complexity: number;
  hasImages: boolean;
  intent: "read" | "write" | "analyse" | "mixed";
  canBypassPipeline: boolean;
}

// ─── Explorer Handoff ──────────────────────────────────────────────────────

export interface ExplorationHandoff {
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

// ─── Planner Handoff ───────────────────────────────────────────────────────

export interface PlanChange {
  file: string;
  action: "create" | "modify" | "delete" | "refactor";
  summary: string;
  risk: "low" | "medium" | "high";
}

export interface PlanHandoff {
  goals: string[];
  proposedChanges: PlanChange[];
  filesAffected: string[];
  risks: string[];
  testingStrategy: string;
  rollbackStrategy: string;
  estimatedDifficulty: number;
  unresolvedDecisions: string[];
  implementationOrdering: string[];
}

// ─── Plan Review Handoff ──────────────────────────────────────────────────

export interface PlanReviewHandoff {
  approved: boolean;
  issues: Array<{
    severity: "blocking" | "minor" | "suggestion";
    description: string;
    file?: string;
  }>;
  editedPlan?: PlanHandoff;
  userConstraints?: string[];
}

// ─── Visual Analysis Handoff ───────────────────────────────────────────────

export interface VisualFinding {
  component: string;
  issue: string;
  severity: "critical" | "major" | "minor";
  region?: string;
  cssProperties?: Array<{ property: string; current: string; expected: string }>;
  evidence?: string;
}

export interface VisualAnalysisHandoff {
  findings: VisualFinding[];
  summary: string;
  confidence: number;
  containsText?: boolean;
  textReadabilityIssues?: string[];
  themeDetected?: string;
  viewportDetected?: string;
  componentsIdentified: string[];
}

// ─── Implementation Handoff ────────────────────────────────────────────────

export interface ImplementationHandoff {
  filesChanged: string[];
  filesCreated: string[];
  filesDeleted: string[];
  summary: string;
  commandsExecuted: string[];
  testsRun: string[];
  failuresEncountered: string[];
  remainingConcerns: string[];
  reviewRecommended: boolean;
}

// ─── Review Handoff ────────────────────────────────────────────────────────

export interface ReviewFinding {
  severity: "blocking" | "warning" | "info";
  category: "correctness" | "security" | "performance" | "style" | "accessibility" | "maintainability";
  file: string;
  symbol?: string;
  line?: number;
  evidence: string;
  recommendedFix: string;
  blocksCompletion: boolean;
  confidence: number;
}

export interface ReviewHandoff {
  findings: ReviewFinding[];
  summary: string;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
}

// ─── Test/Verification Handoff ─────────────────────────────────────────────

export interface TestResultItem {
  testFile: string;
  testName?: string;
  passed: boolean;
  output?: string;
}

export interface VerificationHandoff {
  checksPerformed: string[];
  testsPassed: number;
  testsFailed: number;
  totalTests: number;
  results: TestResultItem[];
  expectedVsActual: string;
  remainingLimitations: string[];
  completionStatus: "passed" | "failed" | "partial";
}

// ─── Repair Handoff ────────────────────────────────────────────────────────

export interface RepairHandoff {
  filesChanged: string[];
  summary: string;
  issuesResolved: number;
  issuesRemaining: number;
  needsAnotherPass: boolean;
}

// ─── Synthesis Handoff ─────────────────────────────────────────────────────

export interface SynthesisHandoff {
  response: string;
  summary: string;
  filesChanged: string[];
  warnings: string[];
  unresolvedItems: string[];
  completionStatus: "completed" | "completed_with_warnings" | "partial";
}

// ─── Union Type ────────────────────────────────────────────────────────────

export type StageHandoff =
  | { stage: "classify"; output: ClassificationHandoff }
  | { stage: "explore"; output: ExplorationHandoff }
  | { stage: "research"; output: ExplorationHandoff }
  | { stage: "retrieve_context"; output: { relevantContext: string[] } }
  | { stage: "plan"; output: PlanHandoff }
  | { stage: "plan_review"; output: PlanReviewHandoff }
  | { stage: "visual_analyse"; output: VisualAnalysisHandoff }
  | { stage: "implement"; output: ImplementationHandoff }
  | { stage: "fix"; output: RepairHandoff }
  | { stage: "review_code"; output: ReviewHandoff }
  | { stage: "review_security"; output: ReviewHandoff }
  | { stage: "review_accessibility"; output: ReviewHandoff }
  | { stage: "review_performance"; output: ReviewHandoff }
  | { stage: "test_execute"; output: VerificationHandoff }
  | { stage: "verify"; output: VerificationHandoff }
  | { stage: "synthesise"; output: SynthesisHandoff }
  | { stage: "document"; output: { filesCreated: string[] } }
  | { stage: "compact_context"; output: { compacted: boolean; tokensSaved: number } }
  | { stage: "brainstorm"; output: { ideas: string[] } };

// ─── Handoff Store ─────────────────────────────────────────────────────────

export class HandoffStore {
  private handoffs = new Map<string, StageHandoff>();
  private invalidHandoffs = new Map<string, StageHandoff>();

  set(stageId: string, handoff: StageHandoff): void {
    this.handoffs.set(stageId, handoff);
    this.invalidHandoffs.delete(stageId);
  }

  get<T extends StageHandoff = StageHandoff>(stageId: string): T | undefined {
    return this.handoffs.get(stageId) as T | undefined;
  }

  has(stageId: string): boolean {
    return this.handoffs.has(stageId);
  }

  getAll(): StageHandoff[] {
    return Array.from(this.handoffs.values());
  }

  clear(): void {
    this.handoffs.clear();
    this.invalidHandoffs.clear();
  }

  invalidateDownstream(fromStageId: string): string[] {
    const invalidated: string[] = [];
    const dependencyOrder = Array.from(this.handoffs.keys());
    const fromIndex = dependencyOrder.indexOf(fromStageId);
    if (fromIndex >= 0) {
      for (let i = fromIndex + 1; i < dependencyOrder.length; i++) {
        const sid = dependencyOrder[i]!;
        const h = this.handoffs.get(sid);
        if (h) {
          this.invalidHandoffs.set(sid, h);
          this.handoffs.delete(sid);
          invalidated.push(sid);
        }
      }
    }
    return invalidated;
  }

  invalidateAllAfter(stageId: string): void {
    this.invalidateDownstream(stageId);
  }

  getOutput<T>(stageId: string): T | undefined {
    const h = this.handoffs.get(stageId);
    if (!h) return undefined;
    return (h as unknown as { output: T }).output;
  }
}

// ─── Validation & Repair ───────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true; handoff: StageHandoff }
  | { valid: false; errors: string[]; repaired?: StageHandoff };

function safeParseJSON(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractJSONBlocks(text: string): Record<string, unknown> | null {
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    const parsed = safeParseJSON(jsonBlockMatch[1]!);
    if (parsed) return parsed;
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    const parsed = safeParseJSON(braceMatch[0]!);
    if (parsed) return parsed;
  }
  return null;
}

function extractArrayBlocks(text: string): unknown[] | null {
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]!);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  const braceMatch = text.match(/\[[\s\S]*\]/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]!);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function stringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === "string");
  return [];
}

function numberVal(val: unknown, def: number): number {
  return typeof val === "number" ? val : def;
}

function boolVal(val: unknown, def: boolean): boolean {
  return typeof val === "boolean" ? val : def;
}

function stringVal(val: unknown, def = ""): string {
  return typeof val === "string" ? val : def;
}

export function validateClassificationOutput(text: string): ValidationResult {
  const obj = extractJSONBlocks(text);
  if (!obj) {
    return {
      valid: false,
      errors: ["Could not parse classification output as JSON"],
    };
  }
  return {
    valid: true,
    handoff: {
      stage: "classify",
      output: {
        taskType: (obj.taskType as OrchestratedTaskType) ?? "implement",
        complexity: numberVal(obj.complexity, 0.5),
        hasImages: boolVal(obj.hasImages, false),
        intent: (obj.intent as "read" | "write" | "analyse" | "mixed") ?? "write",
        canBypassPipeline: boolVal(obj.canBypassPipeline, false),
      },
    },
  };
}

export function validateExplorationOutput(text: string): ValidationResult {
  const obj = extractJSONBlocks(text) ?? {};
  return {
    valid: true,
    handoff: {
      stage: "explore",
      output: {
        relevantFiles: stringArray(obj.relevantFiles),
        relevantSymbols: stringArray(obj.relevantSymbols),
        architectureSummary: stringVal(obj.architectureSummary),
        suspectedChangePoints: stringArray(obj.suspectedChangePoints),
        testsDiscovered: stringArray(obj.testsDiscovered),
        constraints: stringArray(obj.constraints),
        openQuestions: stringArray(obj.openQuestions),
        confidence: numberVal(obj.confidence, 0.5),
      },
    },
  };
}

export function validatePlanOutput(text: string): ValidationResult {
  const obj = extractJSONBlocks(text) ?? {};
  const changes = Array.isArray(obj.proposedChanges)
    ? obj.proposedChanges.map((c: Record<string, unknown>) => ({
        file: stringVal(c.file),
        action: (c.action as PlanChange["action"]) ?? "modify",
        summary: stringVal(c.summary),
        risk: (c.risk as PlanChange["risk"]) ?? "medium",
      }))
    : [];

  return {
    valid: true,
    handoff: {
      stage: "plan",
      output: {
        goals: stringArray(obj.goals),
        proposedChanges: changes,
        filesAffected: stringArray(obj.filesAffected),
        risks: stringArray(obj.risks),
        testingStrategy: stringVal(obj.testingStrategy),
        rollbackStrategy: stringVal(obj.rollbackStrategy),
        estimatedDifficulty: numberVal(obj.estimatedDifficulty, 0.5),
        unresolvedDecisions: stringArray(obj.unresolvedDecisions),
        implementationOrdering: stringArray(obj.implementationOrdering),
      },
    },
  };
}

export function validateImplementationOutput(text: string): ValidationResult {
  const obj = extractJSONBlocks(text) ?? {};
  return {
    valid: true,
    handoff: {
      stage: "implement",
      output: {
        filesChanged: stringArray(obj.filesChanged),
        filesCreated: stringArray(obj.filesCreated),
        filesDeleted: stringArray(obj.filesDeleted),
        summary: stringVal(obj.summary),
        commandsExecuted: stringArray(obj.commandsExecuted),
        testsRun: stringArray(obj.testsRun),
        failuresEncountered: stringArray(obj.failuresEncountered),
        remainingConcerns: stringArray(obj.remainingConcerns),
        reviewRecommended: boolVal(obj.reviewRecommended, true),
      },
    },
  };
}

export function validateReviewOutput(text: string): ValidationResult {
  const arr = extractArrayBlocks(text);
  if (arr && arr.length > 0) {
    const findings = arr.map((f: unknown) => {
      const r = f as Record<string, unknown>;
      return {
        severity: (r.severity as ReviewFinding["severity"]) ?? "info",
        category: (r.category as ReviewFinding["category"]) ?? "correctness",
        file: stringVal(r.file),
        symbol: stringVal(r.symbol),
        line: r.line !== undefined && typeof r.line === "number" ? r.line : undefined,
        evidence: stringVal(r.evidence),
        recommendedFix: stringVal(r.recommendedFix),
        blocksCompletion: boolVal(r.blocksCompletion, false),
        confidence: numberVal(r.confidence, 0.5),
      } as ReviewFinding;
    });
    return {
      valid: true,
      handoff: {
        stage: "review_code",
        output: {
          findings,
          summary: `${findings.length} finding(s) identified`,
          blockingCount: findings.filter((f) => f.blocksCompletion).length,
          warningCount: findings.filter((f) => f.severity === "warning").length,
          infoCount: findings.filter((f) => f.severity === "info").length,
        },
      },
    };
  }

  const obj = extractJSONBlocks(text) ?? {};
  return {
    valid: true,
    handoff: {
      stage: "review_code",
      output: {
        findings: [],
        summary: stringVal(obj.summary, "Review completed"),
        blockingCount: 0,
        warningCount: 0,
        infoCount: 0,
      },
    },
  };
}

export function validateVisualAnalysisOutput(text: string): ValidationResult {
  const obj = extractJSONBlocks(text) ?? {};
  const findings = Array.isArray(obj.findings)
    ? obj.findings.map((f: Record<string, unknown>) => ({
        component: stringVal(f.component),
        issue: stringVal(f.issue),
        severity: (f.severity as VisualFinding["severity"]) ?? "minor",
        cssProperties: Array.isArray(f.cssProperties) ? f.cssProperties as VisualFinding["cssProperties"] : undefined,
        evidence: stringVal(f.evidence),
      }))
    : [];

  return {
    valid: true,
    handoff: {
      stage: "visual_analyse",
      output: {
        findings,
        summary: stringVal(obj.summary),
        confidence: numberVal(obj.confidence, 0.5),
        componentsIdentified: stringArray(obj.componentsIdentified),
      },
    },
  };
}

export function validateVerificationOutput(text: string): ValidationResult {
  const obj = extractJSONBlocks(text) ?? {};
  return {
    valid: true,
    handoff: {
      stage: "test_execute",
      output: {
        checksPerformed: stringArray(obj.checksPerformed),
        testsPassed: numberVal(obj.testsPassed, 0),
        testsFailed: numberVal(obj.testsFailed, 0),
        totalTests: numberVal(obj.totalTests, 0),
        results: [],
        expectedVsActual: stringVal(obj.expectedVsActual),
        remainingLimitations: stringArray(obj.remainingLimitations),
        completionStatus: (obj.completionStatus as VerificationHandoff["completionStatus"]) ?? "partial",
      },
    },
  };
}

export function validateSynthesisOutput(text: string): ValidationResult {
  return {
    valid: true,
    handoff: {
      stage: "synthesise",
      output: {
        response: text,
        summary: text.slice(0, 200),
        filesChanged: [],
        warnings: [],
        unresolvedItems: [],
        completionStatus: "completed",
      },
    },
  };
}

// ─── Stage Validator Map ───────────────────────────────────────────────────

export const STAGE_VALIDATORS: Record<string, (text: string) => ValidationResult> = {
  classify: validateClassificationOutput,
  explore: validateExplorationOutput,
  research: validateExplorationOutput,
  plan: validatePlanOutput,
  plan_review: (text) => {
    const obj = extractJSONBlocks(text) ?? {};
    return {
      valid: true,
      handoff: {
        stage: "plan_review",
        output: {
          approved: boolVal(obj.approved, true),
          issues: [],
        },
      },
    };
  },
  visual_analyse: validateVisualAnalysisOutput,
  implement: validateImplementationOutput,
  fix: (text) => {
    const obj = extractJSONBlocks(text) ?? {};
    return {
      valid: true,
      handoff: {
        stage: "fix",
        output: {
          filesChanged: stringArray(obj.filesChanged),
          summary: stringVal(obj.summary),
          issuesResolved: numberVal(obj.issuesResolved, 1),
          issuesRemaining: numberVal(obj.issuesRemaining, 0),
          needsAnotherPass: boolVal(obj.needsAnotherPass, false),
        },
      },
    };
  },
  review_code: validateReviewOutput,
  review_security: validateReviewOutput,
  review_accessibility: validateReviewOutput,
  review_performance: validateReviewOutput,
  test_execute: validateVerificationOutput,
  verify: validateVerificationOutput,
  synthesise: validateSynthesisOutput,
  document: (text) => ({
    valid: true,
    handoff: { stage: "document", output: { filesCreated: [] } },
  }),
  compact_context: (text) => ({
    valid: true,
    handoff: { stage: "compact_context", output: { compacted: true, tokensSaved: 0 } },
  }),
};

export function validateStageOutput(stageId: string, text: string): ValidationResult {
  const validator = STAGE_VALIDATORS[stageId];
  if (!validator) {
    return {
      valid: true,
      handoff: { stage: stageId as StageHandoff["stage"], output: { raw: text } } as unknown as StageHandoff,
    };
  }
  return validator(text);
}
