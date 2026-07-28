import type { StageState, WorkflowState } from "./stateMachine";

export const WORKFLOW_SNAPSHOT_SCHEMA_VERSION = 1;

// ─── Persistence Identity ──────────────────────────────────────────────────

export interface PersistenceIdentity {
  runId: string;
  sessionId: string;
  workspaceIdentity: string;
  workflowId: string;
  workflowVersion: number;
}

// ─── File Baseline ─────────────────────────────────────────────────────────

export interface PersistedFileBaseline {
  uri: string;
  exists: boolean;
  documentVersion?: number;
  modifiedTimestamp?: number;
  fileSize?: number;
  contentHash?: string;
  gitBlobSha?: string;
  baselineRevision: string;
}

// ─── Provider Reservation Summary ─────────────────────────────────────────

export interface PersistedProviderReservationSummary {
  providerId: string;
  modelId: string;
  permitAcquired: boolean;
  acquiredAt?: number;
  releasedAt?: number;
  slotCount: number;
}

// ─── Stage Attempt ─────────────────────────────────────────────────────────

export interface PersistedStageAttempt {
  model: string;
  startedAt: number;
  completedAt?: number;
  state: StageState;
  tokensUsed?: number;
  estimatedCost?: number;
  error?: string;
}

// ─── Stage Snapshot ────────────────────────────────────────────────────────

export interface PersistedStageSnapshot {
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
  attemptCount: number;
  skipRequested?: boolean;
  modelOverride?: string;
  attemptHistory: PersistedStageAttempt[];
}

// ─── Plan Approval ─────────────────────────────────────────────────────────

export interface PersistedPlanChange {
  file: string;
  action: "create" | "modify" | "delete" | "refactor";
  summary: string;
  risk: "low" | "medium" | "high";
}

export interface ApprovedPlanSnapshot {
  revision: number;
  approvedAt: number;
  approvedBy: "user" | "policy";
  goals: string[];
  proposedChanges: PersistedPlanChange[];
  filesAffected: string[];
  testingStrategy: string;
  editedPlan?: string;
}

export interface PendingApprovalSnapshot {
  approvalId: string;
  stageId: string;
  requestedAt: number;
  expiresAt: number;
  planRevision: number;
}

export interface PersistedHandoffReference {
  stageId: string;
  stageIndex: number;
  summary: string;
  sizeBytes: number;
}

// ─── Budget Controller ────────────────────────────────────────────────────

export interface PersistedCostBudget {
  runId: string;
  totalTokensUsed: number;
  totalEstimatedCost: number;
  confirmedCost?: number;
  tokenCap: number;
  costCap: number;
  stageCaps: Record<string, { tokenCap: number; costCap: number }>;
  exceeded: boolean;
  pausedDueToBudget: boolean;
  userIncreasedBudget: boolean;
}

// ─── Repair Policy State ──────────────────────────────────────────────────

export interface PersistedRepairState {
  repairPasses: number;
  maxRepairPasses: number;
  blockedFindingIds: string[];
  noProgressCount: number;
  stoppedEarly: boolean;
}

// ─── Workflow Run Status ──────────────────────────────────────────────────

export type WorkflowRunStatus =
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
  | "recovering"
  | "interrupted";

export type WorkflowRecoveryState =
  | "none"
  | "pending_user_review"
  | "pending_user_confirmation"
  | "partially_recovered"
  | "fully_recovered"
  | "unrecoverable";

// ─── Main Snapshot ─────────────────────────────────────────────────────────

export interface WorkflowSnapshot {
  schemaVersion: number;

  runId: string;
  sessionId: string;
  workspaceIdentity: string;
  workflowId: string;
  workflowVersion: number;

  status: WorkflowRunStatus;
  revision: number;

  createdAt: number;
  updatedAt: number;
  completedAt?: number;

  currentStageIds: string[];
  stages: PersistedStageSnapshot[];

  approvedPlan?: ApprovedPlanSnapshot;
  handoffs: PersistedHandoffReference[];

  budget: PersistedCostBudget;
  repairState: PersistedRepairState;

  pendingApproval?: PendingApprovalSnapshot;

  fileBaselines: PersistedFileBaseline[];
  providerReservations: PersistedProviderReservationSummary[];

  compactionGeneration?: number;
  recoveryState?: WorkflowRecoveryState;

  error?: string;
  userRequestSummary: string;
  gitInitialState?: PersistedGitState;
}

// ─── Git State ─────────────────────────────────────────────────────────────

export interface PersistedGitState {
  branch: string;
  headSha: string;
  isDirty: boolean;
  dirtyFiles: string[];
  hasConflicts: boolean;
  hasUnresolvedMerge: boolean;
  recordedAt: number;
  baselineMark: string;
}

// ─── Snapshot Builder ──────────────────────────────────────────────────────

export function createEmptySnapshot(
  identity: PersistenceIdentity,
): WorkflowSnapshot {
  const now = Date.now();
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
    ...identity,
    status: "created",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    currentStageIds: [],
    stages: [],
    handoffs: [],
    budget: {
      runId: identity.runId,
      totalTokensUsed: 0,
      totalEstimatedCost: 0,
      tokenCap: Number.MAX_SAFE_INTEGER,
      costCap: Number.MAX_SAFE_INTEGER,
      stageCaps: {},
      exceeded: false,
      pausedDueToBudget: false,
      userIncreasedBudget: false,
    },
    repairState: {
      repairPasses: 0,
      maxRepairPasses: 3,
      blockedFindingIds: [],
      noProgressCount: 0,
      stoppedEarly: false,
    },
    fileBaselines: [],
    providerReservations: [],
    userRequestSummary: "",
  };
}

// ─── Migration ─────────────────────────────────────────────────────────────

const SNAPSHOT_MIGRATORS: Record<number, (snap: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateSnapshot(raw: Record<string, unknown>): WorkflowSnapshot {
  let version = (raw.schemaVersion as number) ?? 0;
  let data = { ...raw };

  while (version < WORKFLOW_SNAPSHOT_SCHEMA_VERSION) {
    const next = version + 1;
    const migrator = SNAPSHOT_MIGRATORS[next];
    if (migrator) {
      data = migrator(data);
    }
    version = next;
  }

  return data as unknown as WorkflowSnapshot;
}

// ─── Serialization ─────────────────────────────────────────────────────────

export function serializeSnapshot(snapshot: WorkflowSnapshot): string {
  return JSON.stringify(snapshot);
}

export function deserializeSnapshot(json: string): WorkflowSnapshot | null {
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return null;
    return migrateSnapshot(raw as Record<string, unknown>);
  } catch {
    return null;
  }
}
