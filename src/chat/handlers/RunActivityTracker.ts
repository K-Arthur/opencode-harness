import type {
  AgentRunPhase,
  AgentRunState,
  ErrorKind,
  Recoverability,
  RunErrorState,
  RunProgressEvent,
  StartRunInput,
  SubagentActivityInput,
  SubagentRunState,
  ToolActivityInput,
  ToolExecutionState,
} from "./runActivityTypes"

type MutableRunState = Omit<AgentRunState, "tools" | "subagents"> & {
  tools: Map<string, ToolExecutionState>
  subagents: Map<string, SubagentRunState>
}

const TERMINAL_PHASES = new Set<AgentRunPhase>(["completed", "failed", "cancelled", "interrupted"])
const TERMINAL_SUBAGENT_STATUSES = new Set<SubagentRunState["status"]>(["completed", "failed", "cancelled"])

function normalizeToolStatus(status: ToolActivityInput["status"]): ToolExecutionState["status"] {
  if (status === "error") return "failed"
  if (status === "result") return "completed"
  return status
}

// Host-side status normalizer. Unknown / non-canonical values default to
// "unknown" (NOT "running") so the tracker does not treat unparseable events
// as active liveness. The webview's reconciler will then transition dropped
// subagents to "completed" when the server stops reporting. See
// subagentReconciler.ts. The legacy behavior of returning "running" on any
// unknown input caused subagents to be stuck "Running" forever when the server
// sent a status string the host did not recognize.
function normalizeSubagentStatus(status: SubagentActivityInput["status"]): SubagentRunState["status"] {
  if (status === "pending") return "queued"
  if (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unknown"
  ) {
    return status
  }
  return "unknown"
}

function activeToolCount(tools: Map<string, ToolExecutionState>): number {
  let count = 0
  for (const tool of tools.values()) {
    if (tool.status === "pending" || tool.status === "running") count++
  }
  return count
}

// Counts subagents whose status is plausibly still in progress.
// NOTE: "unknown" is intentionally NOT counted as active. The previous
// implementation did, which kept the spinner alive indefinitely when the
// tracker received an unparseable status from the server. With "unknown"
// excluded, an unparseable status shows "Unknown" in the UI and the
// reconciler (or final snapshot completion) can finalize the run.
function activeSubagentCount(subagents: Map<string, SubagentRunState>): number {
  let count = 0
  for (const subagent of subagents.values()) {
    if (
      subagent.status === "queued" ||
      subagent.status === "running" ||
      subagent.status === "waiting"
    ) {
      count++
    }
  }
  return count
}

function buildRunId(input: StartRunInput, now: number): string {
  const base = (input.cliSessionId || input.tabId).replace(/[^A-Za-z0-9_-]/g, "_")
  return input.runId || `run-${base}-${now.toString(36)}`
}

export class RunActivityTracker {
  private runs = new Map<string, MutableRunState>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  startRun(input: StartRunInput): AgentRunState {
    const at = this.now()
    const run: MutableRunState = {
      runId: buildRunId(input, at),
      tabId: input.tabId,
      cliSessionId: input.cliSessionId,
      messageId: input.messageId,
      phase: "waiting_for_activity",
      startedAt: at,
      acceptedAt: at,
      lastActivityAt: at,
      activeToolCount: 0,
      activeSubagentCount: 0,
      statusLabel: "Waiting for activity",
      tools: new Map(),
      subagents: new Map(),
      partialOutputPreserved: false,
    }
    this.runs.set(input.tabId, run)
    return this.snapshot(run)
  }

  getSnapshot(tabId: string): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    return run ? this.snapshot(run) : undefined
  }

  recordActivity(tabId: string, event: RunProgressEvent): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run || TERMINAL_PHASES.has(run.phase)) return run ? this.snapshot(run) : undefined
    const at = event.at ?? this.now()
    if (event.kind === "prompt_accepted") {
      run.acceptedAt = at
      run.lastActivityAt = at
      run.statusLabel = event.label || "Waiting"
      this.recompute(run)
      return this.snapshot(run)
    }
    this.markOpenCodeActivity(run, at)
    if (event.kind === "text") {
      run.firstVisibleTextAt ??= at
      run.lastVisibleTextAt = at
      run.statusLabel = "Streaming"
    } else if (event.kind === "thinking") {
      run.statusLabel = event.label || "Thinking"
    } else if (event.kind === "permission") {
      run.statusLabel = event.label || "Awaiting permission"
    } else if (event.kind === "retry") {
      run.statusLabel = event.label || "Retrying"
    } else if (event.kind === "step") {
      run.statusLabel = event.label || "Starting step"
    } else if (event.kind === "compaction") {
      run.statusLabel = event.label || "Compacting"
    } else if (event.kind === "transport") {
      run.statusLabel = event.label || "Connected"
    } else if (event.label) {
      run.statusLabel = event.label
    }
    this.recompute(run)
    return this.snapshot(run)
  }

  recordTool(tabId: string, input: ToolActivityInput): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run || TERMINAL_PHASES.has(run.phase)) return run ? this.snapshot(run) : undefined
    const at = this.now()
    this.markOpenCodeActivity(run, at)
    const status = normalizeToolStatus(input.status)
    const existing = run.tools.get(input.id)
    const tool: ToolExecutionState = {
      id: input.id,
      name: input.name || existing?.name || "tool",
      status,
      startedAt: existing?.startedAt ?? at,
      updatedAt: at,
      completedAt: status === "completed" || status === "failed" || status === "unresolved" ? at : existing?.completedAt,
      input: input.input ?? existing?.input,
      result: input.result ?? existing?.result,
      error: input.error ?? existing?.error,
    }
    run.tools.set(input.id, tool)
    if (status === "failed") {
      run.lastError = this.errorState("tool_failed", "tool", input.error || `${tool.name} failed`, at, "continue_from_partial")
    } else if (status === "unresolved") {
      run.lastError = this.errorState("tool_unresolved", "tool", input.error || `${tool.name} did not report completion`, at, "refresh_from_server")
    }
    this.recompute(run)
    return this.snapshot(run)
  }

  recordSubagent(tabId: string, input: SubagentActivityInput): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run || TERMINAL_PHASES.has(run.phase)) return run ? this.snapshot(run) : undefined
    const at = this.now()
    this.markOpenCodeActivity(run, at)
    const status = normalizeSubagentStatus(input.status)
    const existing = run.subagents.get(input.id)
    // Do NOT overwrite a terminal subagent status with a non-terminal one.
    // This prevents late-arriving "running" events from reverting a completed/failed/cancelled subagent.
    if (existing && TERMINAL_SUBAGENT_STATUSES.has(existing.status) && !TERMINAL_SUBAGENT_STATUSES.has(status)) {
      return this.snapshot(run)
    }
    const subagent: SubagentRunState = {
      id: input.id,
      agentName: input.agentName || existing?.agentName || "subagent",
      status,
      startedAt: existing?.startedAt ?? at,
      updatedAt: at,
      completedAt: status === "completed" || status === "failed" || status === "cancelled" ? at : existing?.completedAt,
      currentActivity: input.currentActivity ?? existing?.currentActivity,
      inputPrompt: input.inputPrompt ?? existing?.inputPrompt,
      childSessionId: input.childSessionId ?? existing?.childSessionId,
      toolCount: existing?.toolCount ?? 0,
      unreadActivityCount: (existing?.unreadActivityCount ?? 0) + 1,
      error: input.error ?? existing?.error,
    }
    run.subagents.set(input.id, subagent)
    if (status === "failed") {
      run.lastError = this.errorState("subagent_failed", "subagent", input.error || `${subagent.agentName} failed`, at, "continue_from_partial")
    }
    this.recompute(run)
    return this.snapshot(run)
  }

  markRunComplete(tabId: string): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run) return undefined
    const at = this.now()
    run.phase = "completed"
    run.lastActivityAt = at
    run.statusLabel = "Completed"
    this.terminalizeActiveSubagents(run, "completed", at)
    this.recompute(run)
    return this.snapshot(run)
  }

  markRunFailed(tabId: string, error: Omit<RunErrorState, "at"> & { at?: number }): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run) return undefined
    const at = error.at ?? this.now()
    run.phase = "failed"
    run.lastActivityAt = at
    run.lastError = { ...error, at }
    run.statusLabel = error.message || "Failed"
    run.partialOutputPreserved = true
    this.recompute(run)
    return this.snapshot(run)
  }

  markRunCancelled(tabId: string, message = "User cancelled the run"): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run) return undefined
    const at = this.now()
    run.phase = "cancelled"
    run.lastActivityAt = at
    run.lastError = this.errorState("user_cancelled", "user", message, at, "non_retryable")
    run.statusLabel = "Cancelled"
    this.terminalizeActiveSubagents(run, "cancelled", at)
    this.recompute(run)
    return this.snapshot(run)
  }

  // When the parent run reaches a terminal state, no further subagent events
  // can arrive for it (the run is cleared right after the final snapshot is
  // posted). Any subagent still in a non-terminal status would otherwise be
  // reported as "running" forever, so close them out with the run's outcome.
  private terminalizeActiveSubagents(run: MutableRunState, status: "completed" | "cancelled", at: number): void {
    for (const subagent of run.subagents.values()) {
      if (TERMINAL_SUBAGENT_STATUSES.has(subagent.status)) continue
      subagent.status = status
      subagent.completedAt = at
      subagent.updatedAt = at
    }
  }

  markRunInterrupted(tabId: string, message: string): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run) return undefined
    const at = this.now()
    run.phase = "interrupted"
    run.lastActivityAt = at
    run.lastError = this.errorState("transport_disconnected", "event_stream", message, at, "refresh_from_server")
    run.statusLabel = "Stream disconnected"
    run.partialOutputPreserved = true
    this.recompute(run)
    return this.snapshot(run)
  }

  markActiveSubagentsUnresolved(tabId: string, message: string): AgentRunState | undefined {
    const run = this.runs.get(tabId)
    if (!run) return undefined
    const at = this.now()
    let changed = false
    for (const subagent of run.subagents.values()) {
      if (subagent.status !== "queued" && subagent.status !== "running" && subagent.status !== "waiting" && subagent.status !== "unknown") {
        continue
      }
      // Skip subagents linked to a child session — the SubagentHeartbeat polls
      // every 5s and detects completion via child session removal. The grace
      // timeout (30s) is far too short for legitimate long-running subagents;
      // marking them failed prematurely stops the heartbeat and shows
      // "unconfirmed" in the UI. Only mark subagents that were never linked to
      // a child session (orphaned/never discovered by the heartbeat).
      if (subagent.childSessionId) {
        continue
      }
      subagent.status = "failed"
      subagent.error = message
      subagent.completedAt = at
      subagent.updatedAt = at
      changed = true
    }
    if (changed) {
      run.lastError = this.errorState("subagent_unresolved", "subagent", message, at, "refresh_from_server")
      run.partialOutputPreserved = true
      run.lastActivityAt = at
      this.recompute(run)
    }
    return this.snapshot(run)
  }

  shouldTriggerStartupTimeout(tabId: string, timeoutMs: number): boolean {
    const run = this.runs.get(tabId)
    if (!run || TERMINAL_PHASES.has(run.phase)) return false
    if (run.firstActivityAt) return false
    return this.now() - run.acceptedAt >= timeoutMs
  }

  getFinalizeDeferReason(tabId: string): string | null {
    const run = this.runs.get(tabId)
    if (!run) return null
    const tools = activeToolCount(run.tools)
    if (tools > 0) return `${tools} tool running`
    const subagents = activeSubagentCount(run.subagents)
    if (subagents > 0) return `${subagents} subagent running`
    return null
  }

  clear(tabId: string): void {
    this.runs.delete(tabId)
  }

  private markOpenCodeActivity(run: MutableRunState, at: number): void {
    run.firstActivityAt ??= at
    run.lastActivityAt = at
    if (run.phase === "waiting_for_activity") run.phase = "running"
  }

  private recompute(run: MutableRunState): void {
    run.activeToolCount = activeToolCount(run.tools)
    run.activeSubagentCount = activeSubagentCount(run.subagents)
    if (!TERMINAL_PHASES.has(run.phase)) {
      if (run.activeToolCount > 0) run.phase = "waiting_on_tool"
      else if (run.activeSubagentCount > 0) run.phase = "waiting_on_subagent"
      else if (run.firstActivityAt) run.phase = "running"
      else run.phase = "waiting_for_activity"
    }
    if (TERMINAL_PHASES.has(run.phase)) return
    const runningTool = [...run.tools.values()].find((tool) => tool.status === "running" || tool.status === "pending")
    if (runningTool) {
      run.statusLabel = `Running tool: ${runningTool.name}`
      return
    }
    const runningSubagent = [...run.subagents.values()].find((subagent) =>
      subagent.status === "running" || subagent.status === "queued" || subagent.status === "waiting" || subagent.status === "unknown"
    )
    if (runningSubagent) {
      run.statusLabel = runningSubagent.currentActivity
        ? `Subagent: ${runningSubagent.agentName} - ${runningSubagent.currentActivity}`
        : `Reviewing with ${run.activeSubagentCount} subagent${run.activeSubagentCount === 1 ? "" : "s"}`
      return
    }
    if (!run.firstActivityAt) run.statusLabel = "Waiting"
  }

  private snapshot(run: MutableRunState): AgentRunState {
    return {
      ...run,
      tools: [...run.tools.values()].map((tool) => ({ ...tool })),
      subagents: [...run.subagents.values()].map((subagent) => ({ ...subagent })),
      lastError: run.lastError ? { ...run.lastError } : undefined,
    }
  }

  private errorState(
    kind: ErrorKind,
    source: RunErrorState["source"],
    message: string,
    at: number,
    recoverability: Recoverability,
  ): RunErrorState {
    return { kind, source, recoverability, message, at }
  }
}
