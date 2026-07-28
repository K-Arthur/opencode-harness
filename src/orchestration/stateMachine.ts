/**
 * Formal orchestration state machine with explicit states and valid transitions.
 *
 * Defines workflow-level and stage-level states with a single authoritative
 * transition function. All transitions are idempotent, session-scoped, and
 * safe against duplicate or late events.
 */

// ─── Workflow States ───────────────────────────────────────────────────────

export type WorkflowState =
  | "created"
  | "classifying"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed"
  | "completed_with_warnings"
  | "recovering";

// ─── Stage States ──────────────────────────────────────────────────────────

export type StageState =
  | "pending"
  | "blocked"
  | "ready"
  | "starting"
  | "running"
  | "streaming"
  | "waiting_for_tool"
  | "waiting_for_approval"
  | "retrying"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "interrupted"
  | "unresolved";

// ─── Transition Maps ───────────────────────────────────────────────────────

const WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  created: ["classifying", "running", "cancelled"],
  classifying: ["running", "cancelled", "failed"],
  running: ["waiting_for_approval", "paused", "cancelling", "failed", "completed", "completed_with_warnings", "recovering"],
  waiting_for_approval: ["running", "paused", "cancelling", "cancelled", "failed"],
  paused: ["running", "cancelling", "cancelled", "failed"],
  cancelling: ["cancelled", "failed", "recovering"],
  cancelled: [],
  failed: [],
  completed: [],
  completed_with_warnings: [],
  recovering: ["running", "failed", "cancelled"],
};

const STAGE_TRANSITIONS: Record<StageState, StageState[]> = {
  pending: ["blocked", "ready", "skipped", "cancelled"],
  blocked: ["ready", "skipped", "cancelled"],
  ready: ["starting", "skipped", "cancelled"],
  starting: ["running", "failed", "cancelled"],
  running: ["streaming", "waiting_for_tool", "waiting_for_approval", "succeeded", "failed", "cancelled", "interrupted"],
  streaming: ["waiting_for_tool", "waiting_for_approval", "retrying", "succeeded", "failed", "cancelled", "interrupted"],
  waiting_for_tool: ["streaming", "succeeded", "failed", "cancelled", "interrupted"],
  waiting_for_approval: ["running", "succeeded", "retrying", "paused", "failed", "cancelled"],
  retrying: ["starting", "running", "failed", "cancelled", "succeeded"],
  paused: ["ready", "starting", "cancelled", "running"],
  succeeded: [],
  failed: ["retrying", "skipped"],
  cancelled: [],
  skipped: [],
  interrupted: ["pending", "ready", "retrying", "succeeded", "failed", "cancelled"],
  unresolved: ["pending", "retrying", "skipped", "cancelled", "failed"],
};

// ─── Workflow Transition Logic ─────────────────────────────────────────────

export function transitionWorkflow(
  current: WorkflowState,
  target: WorkflowState,
): WorkflowState {
  const allowed = WORKFLOW_TRANSITIONS[current];
  if (!allowed) return current;
  if (allowed.includes(target)) return target;
  return current;
}

// ─── Stage Transition Logic ────────────────────────────────────────────────

export function transitionStage(
  current: StageState,
  target: StageState,
): StageState {
  const allowed = STAGE_TRANSITIONS[current];
  if (!allowed) return current;
  if (allowed.includes(target)) return target;
  return current;
}

// ─── State Guards ──────────────────────────────────────────────────────────

export function isWorkflowTerminal(state: WorkflowState): boolean {
  return ["cancelled", "failed", "completed", "completed_with_warnings"].includes(state);
}

export function isWorkflowActive(state: WorkflowState): boolean {
  return !isWorkflowTerminal(state) && state !== "recovering";
}

export function isStageTerminal(state: StageState): boolean {
  return ["succeeded", "failed", "cancelled", "skipped"].includes(state);
}

export function isStageActive(state: StageState): boolean {
  return ["starting", "running", "streaming", "waiting_for_tool", "waiting_for_approval", "retrying"].includes(state);
}

// ─── Error Classification ──────────────────────────────────────────────────

export type StateErrorCategory = "transient" | "terminal" | "stale" | "unknown";

export function classifyStateError(error: string): StateErrorCategory {
  const lower = error.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("rate limit") || lower.includes("429") || lower.includes("503") || lower.includes("network") || lower.includes("econnrefused") || lower.includes("econnreset")) {
    return "transient";
  }
  if (lower.includes("auth") || lower.includes("quota") || lower.includes("forbidden") || lower.includes("invalid") || lower.includes("context overflow") || lower.includes("content filter")) {
    return "terminal";
  }
  if (lower.includes("stale") || lower.includes("obsolete") || lower.includes("expired") || lower.includes("not found in transcript") || lower.includes("not found")) {
    return "stale";
  }
  return "unknown";
}

// ─── Snapshot ──────────────────────────────────────────────────────────────

export interface StageSnapshot {
  stageId: string;
  state: StageState;
  role: string;
  model: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  tokensUsed?: number;
  estimatedCost?: number;
  error?: string;
  retryCount: number;
  attemptHistory: StageAttempt[];
}

export interface StageAttempt {
  model: string;
  startedAt: number;
  completedAt?: number;
  state: StageState;
  tokensUsed?: number;
  error?: string;
}

export interface WorkflowSnapshot {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  state: WorkflowState;
  stages: StageSnapshot[];
  currentStageId?: string;
  startedAt: number;
  completedAt?: number;
  totalTokensUsed: number;
  totalEstimatedCost: number;
  retryCount: number;
  repairLoopCount: number;
  costProfileId: string;
  error?: string;
}

// ─── State Machine Instance ────────────────────────────────────────────────

export class WorkflowStateMachine {
  private state: WorkflowState = "created";
  private stageStates = new Map<string, StageState>();
  private stageSnapshots = new Map<string, StageSnapshot>();

  constructor(
    private readonly runId: string,
    private readonly workflowId: string,
    private readonly workflowVersion: number = 1,
    private readonly costProfileId: string = "balanced",
  ) {}

  getState(): WorkflowState { return this.state; }

  getStageState(stageId: string): StageState {
    return this.stageStates.get(stageId) ?? "pending";
  }

  getStageSnapshot(stageId: string): StageSnapshot | undefined {
    return this.stageSnapshots.get(stageId);
  }

  getAllStages(): StageSnapshot[] {
    return Array.from(this.stageSnapshots.values());
  }

  transition(target: WorkflowState): boolean {
    const next = transitionWorkflow(this.state, target);
    if (next === this.state) return false;
    this.state = next;
    return true;
  }

  transitionStage(stageId: string, target: StageState, meta?: Partial<StageSnapshot>): boolean {
    const current = this.getStageState(stageId);
    const next = transitionStage(current, target);
    if (next === current) return false;

    this.stageStates.set(stageId, next);

    let snap = this.stageSnapshots.get(stageId);
    if (!snap) {
      snap = {
        stageId,
        state: next,
        role: meta?.role ?? "",
        model: meta?.model ?? "",
        retryCount: 0,
        attemptHistory: [],
      };
    } else {
      snap = { ...snap, state: next };
    }

    if (meta) {
      if (meta.role !== undefined) snap.role = meta.role;
      if (meta.model !== undefined) snap.model = meta.model;
      if (meta.startedAt !== undefined) snap.startedAt = meta.startedAt;
      if (meta.completedAt !== undefined) snap.completedAt = meta.completedAt;
      if (meta.durationMs !== undefined) snap.durationMs = meta.durationMs;
      if (meta.tokensUsed !== undefined) snap.tokensUsed = (snap.tokensUsed ?? 0) + meta.tokensUsed;
      if (meta.estimatedCost !== undefined) snap.estimatedCost = (snap.estimatedCost ?? 0) + meta.estimatedCost;
      if (meta.error !== undefined) snap.error = meta.error;
      if (meta.retryCount !== undefined) snap.retryCount = meta.retryCount;
    }

    if (target === "retrying" || target === "starting" && snap.retryCount > 0) {
      snap.attemptHistory.push({
        model: snap.model,
        startedAt: meta?.startedAt ?? Date.now(),
        state: target,
      });
    }

    this.stageSnapshots.set(stageId, snap);
    return true;
  }

  recordAttempt(stageId: string, model: string): void {
    const snap = this.stageSnapshots.get(stageId);
    if (!snap) return;
    snap.attemptHistory.push({
      model,
      startedAt: Date.now(),
      state: "starting",
    });
    this.stageSnapshots.set(stageId, snap);
  }

  snapshot(overrides?: Partial<WorkflowSnapshot>): WorkflowSnapshot {
    return {
      runId: this.runId,
      workflowId: this.workflowId,
      workflowVersion: this.workflowVersion,
      state: this.state,
      stages: Array.from(this.stageSnapshots.values()),
      currentStageId: undefined,
      startedAt: Date.now(),
      totalTokensUsed: 0,
      totalEstimatedCost: 0,
      retryCount: 0,
      repairLoopCount: 0,
      costProfileId: this.costProfileId,
      ...overrides,
    };
  }

  toJSON(): WorkflowSnapshot {
    return this.snapshot();
  }
}
