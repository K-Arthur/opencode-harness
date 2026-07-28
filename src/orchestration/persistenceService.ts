import * as vscode from "vscode";
import {
  type WorkflowSnapshot,
  type WorkflowRunStatus,
  type PersistenceIdentity,
  type WorkflowRecoveryState,
  WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
  createEmptySnapshot,
  migrateSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
} from "./workflowSnapshot";
import { log } from "../utils/outputChannel";

// ─── Storage Keys ──────────────────────────────────────────────────────────

const WORKSPACE_STORAGE_PREFIX = "opencode.workflow.";
const WORKSPACE_INDEX_KEY = "opencode.workflow.index";
const GLOBAL_PRESET_KEY = "opencode.orchestration.presets";
const GLOBAL_MODEL_ROLES_KEY = "opencode.orchestration.modelRoles";

const MAX_TERMINAL_SUMMARIES = 20;
const PERSIST_COALESCE_MS = 500;

// ─── Persistence Service ───────────────────────────────────────────────────

export class WorkflowPersistenceService {
  private workspaceState: vscode.Memento;
  private globalState: vscode.Memento;
  private workspaceIdentity: string;
  private persistQueue = new Map<string, { snapshot: WorkflowSnapshot; timer: ReturnType<typeof setTimeout> | null }>();
  private activeWorkflowIds = new Set<string>();

  constructor(
    workspaceState: vscode.Memento,
    globalState: vscode.Memento,
    workspaceIdentity?: string,
  ) {
    this.workspaceState = workspaceState;
    this.globalState = globalState;
    this.workspaceIdentity = workspaceIdentity ?? "default";
  }

  // ─── Identity ────────────────────────────────────────────────────────

  setWorkspaceIdentity(identity: string): void {
    this.workspaceIdentity = identity;
  }

  // ─── Save ────────────────────────────────────────────────────────────

  /**
   * Persist a workflow snapshot to workspaceState.
   * Coalesces writes: repeated calls within PERSIST_COALESCE_MS
   * will be batched into a single write.
   */
  persistSnapshot(snapshot: WorkflowSnapshot, immediate = false): void {
    if (!this.isActiveSession(snapshot.sessionId)) return;

    const existing = this.persistQueue.get(snapshot.sessionId);
    if (existing) {
      existing.snapshot = snapshot;
      if (existing.timer && !immediate) return;
      if (existing.timer) clearTimeout(existing.timer);
    } else {
      this.persistQueue.set(snapshot.sessionId, { snapshot, timer: null });
    }

    if (immediate) {
      this.flushSingle(snapshot);
    } else {
      const timer = setTimeout(() => this.flushSingle(snapshot), PERSIST_COALESCE_MS);
      const entry = this.persistQueue.get(snapshot.sessionId);
      if (entry) entry.timer = timer;
    }
  }

  private flushSingle(snapshot: WorkflowSnapshot): void {
    const key = this.keyForSession(snapshot.sessionId);
    try {
      const serialized = serializeSnapshot(snapshot);
      this.workspaceState.update(key, serialized);

      // Update index
      const index = this.getWorkflowIndex();
      index[snapshot.sessionId] = {
        runId: snapshot.runId,
        status: snapshot.status,
        workflowId: snapshot.workflowId,
        updatedAt: snapshot.updatedAt,
        revision: snapshot.revision,
      };
      this.workspaceState.update(WORKSPACE_INDEX_KEY, index);
    } catch (err) {
      log.error(`[persistence] Failed to persist snapshot for ${snapshot.sessionId}:`, err);
    }

    // Clean coalesce entry
    this.persistQueue.delete(snapshot.sessionId);
  }

  // ─── Immediate persistence for terminal/approval transitions ────────

  persistTerminal(snapshot: WorkflowSnapshot): void {
    this.flushSingle(snapshot);
    // For terminal states, also store a summary
    if (this.isTerminalStatus(snapshot.status) && snapshot.revision > 0) {
      this.storeTerminalSummary(snapshot);
    }
  }

  // ─── Load ────────────────────────────────────────────────────────────

  /**
   * Load a persisted snapshot by session ID.
   */
  loadSnapshot(sessionId: string): WorkflowSnapshot | null {
    const key = this.keyForSession(sessionId);
    const raw = this.workspaceState.get<string>(key);
    if (!raw) return null;

    try {
      const snapshot = deserializeSnapshot(raw);
      if (!snapshot) return null;

      // Validate workspace identity
      if (snapshot.workspaceIdentity && snapshot.workspaceIdentity !== this.workspaceIdentity) {
        log.warn(`[persistence] Snapshot ${sessionId} has mismatched workspace identity`);
        return null;
      }

      return snapshot;
    } catch (err) {
      log.error(`[persistence] Failed to deserialize snapshot for ${sessionId}:`, err);
      return null;
    }
  }

  /**
   * Load all non-terminal (active) workflows.
   * Used on extension activation to restore running pipelines.
   */
  loadActiveWorkflows(): WorkflowSnapshot[] {
    const index = this.getWorkflowIndex();
    const active: WorkflowSnapshot[] = [];

    for (const [sessionId, entry] of Object.entries(index)) {
      if (!this.isTerminalStatus(entry.status)) {
        const snapshot = this.loadSnapshot(sessionId);
        if (snapshot) {
          snapshot.recoveryState = "pending_user_review";
          active.push(snapshot);
        }
      }
    }

    return active;
  }

  /**
   * Load all workflow summaries (terminal + active).
   */
  loadAllSummaries(): WorkflowIndexEntry[] {
    const index = this.getWorkflowIndex();
    return Object.entries(index)
      .map(([sessionId, entry]) => ({ sessionId, ...entry }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ─── Delete ──────────────────────────────────────────────────────────

  removeSnapshot(sessionId: string): void {
    const key = this.keyForSession(sessionId);
    this.workspaceState.update(key, undefined);

    const index = this.getWorkflowIndex();
    delete index[sessionId];
    this.workspaceState.update(WORKSPACE_INDEX_KEY, index);

    this.activeWorkflowIds.delete(sessionId);
    this.persistQueue.delete(sessionId);
  }

  // ─── Session Tracking ───────────────────────────────────────────────

  registerActiveSession(sessionId: string): void {
    this.activeWorkflowIds.add(sessionId);
  }

  unregisterActiveSession(sessionId: string): void {
    this.activeWorkflowIds.delete(sessionId);
  }

  isActiveSession(sessionId: string): boolean {
    return this.activeWorkflowIds.has(sessionId);
  }

  // ─── Terminal Summaries ──────────────────────────────────────────────

  /**
   * Store a compact terminal summary for history display.
   * Bounded to prevent unbounded workspaceState growth.
   */
  private storeTerminalSummary(snapshot: WorkflowSnapshot): void {
    const summaries = this.getTerminalSummaries();
    summaries.unshift({
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      workflowId: snapshot.workflowId,
      status: snapshot.status,
      completedAt: snapshot.completedAt ?? Date.now(),
      totalTokensUsed: snapshot.budget.totalTokensUsed,
      totalEstimatedCost: snapshot.budget.totalEstimatedCost,
      stageCount: snapshot.stages.length,
      userRequestSummary: snapshot.userRequestSummary,
    });

    // Bounded retention
    while (summaries.length > MAX_TERMINAL_SUMMARIES) {
      const removed = summaries.pop();
      if (removed) {
        this.removeSnapshot(removed.sessionId);
      }
    }

    this.workspaceState.update(this.keyForTerminalSummaries(), summaries);
  }

  getTerminalSummaries(): TerminalSummary[] {
    const raw = this.workspaceState.get<TerminalSummary[]>(this.keyForTerminalSummaries());
    return raw ?? [];
  }

  // ─── Global Workspace Settings ───────────────────────────────────────

  /**
   * Store user-configured orchestration presets (global — survives workspace changes).
   */
  setUserPresets(presets: Record<string, unknown>[]): void {
    void this.globalState.update(GLOBAL_PRESET_KEY, presets);
  }

  getUserPresets(): Record<string, unknown>[] {
    return this.globalState.get<Record<string, unknown>[]>(GLOBAL_PRESET_KEY, []);
  }

  /**
   * Store default model-role mappings (global).
   */
  setDefaultModelRoles(roles: Record<string, string>): void {
    void this.globalState.update(GLOBAL_MODEL_ROLES_KEY, roles);
  }

  getDefaultModelRoles(): Record<string, string> {
    return this.globalState.get<Record<string, string>>(GLOBAL_MODEL_ROLES_KEY, {});
  }

  // ─── Garbage Collection ─────────────────────────────────────────────

  /**
   * Clean up orphaned snapshots that are not in the index.
   */
  gc(): number {
    const index = this.getWorkflowIndex();
    const indexedKeys = new Set(Object.keys(index));
    let removed = 0;

    // Scan workspace state for workflow keys
    const keys = this.workspaceState.keys();
    for (const key of keys) {
      if (key.startsWith(WORKSPACE_STORAGE_PREFIX)) {
        const sessionId = key.slice(WORKSPACE_STORAGE_PREFIX.length);
        if (!indexedKeys.has(sessionId) && !this.activeWorkflowIds.has(sessionId)) {
          this.workspaceState.update(key, undefined);
          removed++;
        }
      }
    }

    return removed;
  }

  // ─── Key Helpers ─────────────────────────────────────────────────────

  private keyForSession(sessionId: string): string {
    return `${WORKSPACE_STORAGE_PREFIX}${sessionId}`;
  }

  private keyForTerminalSummaries(): string {
    return `${WORKSPACE_STORAGE_PREFIX}terminal.${this.workspaceIdentity}`;
  }

  private getWorkflowIndex(): Record<string, WorkflowIndexEntry> {
    return this.workspaceState.get<Record<string, WorkflowIndexEntry>>(WORKSPACE_INDEX_KEY, {});
  }

  private isTerminalStatus(status: WorkflowRunStatus): boolean {
    return ["completed", "completed_with_warnings", "failed", "cancelled"].includes(status);
  }

  getActiveWorkflowCount(): number {
    return this.activeWorkflowIds.size;
  }

  hasActiveWorkflow(sessionId: string): boolean {
    return this.activeWorkflowIds.has(sessionId);
  }

  clearAllActive(): void {
    for (const sessionId of this.activeWorkflowIds) {
      this.removeSnapshot(sessionId);
    }
    this.activeWorkflowIds.clear();
  }
}

// ─── Index Types ───────────────────────────────────────────────────────────

export interface WorkflowIndexEntry {
  runId: string;
  status: WorkflowRunStatus;
  workflowId: string;
  updatedAt: number;
  revision: number;
}

export interface TerminalSummary {
  runId: string;
  sessionId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  completedAt: number;
  totalTokensUsed: number;
  totalEstimatedCost: number;
  stageCount: number;
  userRequestSummary: string;
}
