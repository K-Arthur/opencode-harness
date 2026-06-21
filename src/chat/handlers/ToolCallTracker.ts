import type { TabManager } from "../TabManager"
import type { StreamCallbacks, ToolEndResult } from "./StreamCoordinatorTypes"
import type { SessionManager } from "../../session/SessionManager"
import type { RunActivityTracker } from "./RunActivityTracker"
import type { ToolActivityInput, AgentRunState } from "./runActivityTypes"
import { log } from "../../utils/outputChannel"

/** Dependencies shared by reference from StreamCoordinator. */
export interface ToolCallTrackerDeps {
  tabManager: TabManager
  activityTracker: RunActivityTracker
  activeToolCallIds: Map<string, Set<string>>
  toolCallCounts: Map<string, number>
  toolActivityAt: Map<string, Map<string, number>>
  pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>>
  readonly TOOL_FINALIZE_GRACE_MS: number
  /** Resolve the session manager for a tab (ADR-010 per-tab routing). */
  getSm: (tabId?: string) => SessionManager
  /** Stop partial polling for a specific tool — delegated to ToolPartialPoller. */
  stopToolPartialPolling: (tabId: string, toolId: string) => void
  /** Record a tool run activity — delegated to StreamCoordinator. */
  recordToolRunActivity: (tabId: string, activity: ToolActivityInput, callbacks?: StreamCallbacks) => void
  /** Post a run activity snapshot — delegated to StreamCoordinator. */
  postRunActivitySnapshot: (tabId: string, snapshot: AgentRunState | undefined, callbacks: StreamCallbacks) => void
  /** Trigger maybeFinalizeStream — delegated to StreamCoordinator. */
  maybeFinalizeStream: (tabId: string, callbacks: StreamCallbacks, trigger: "message_complete" | "status") => Promise<boolean>
}

/**
 * Tracks pending tool calls, their activity timestamps, and grace timeouts.
 * Handles server reconciliation of tool calls that completed on the server
 * but whose completion events were lost on the SSE stream. Extracted from
 * StreamCoordinator to isolate tool-call lifecycle tracking from stream
 * content assembly.
 */
export class ToolCallTracker {
  constructor(private readonly deps: ToolCallTrackerDeps) {}

  getOrCreatePendingToolIds(tabId: string): Set<string> {
    let pending = this.deps.activeToolCallIds.get(tabId)
    if (!pending) {
      pending = new Set<string>()
      this.deps.activeToolCallIds.set(tabId, pending)
    }
    return pending
  }

  getLastPendingToolId(tabId: string): string | undefined {
    const pending = this.deps.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return undefined
    return Array.from(pending)[pending.size - 1]
  }

  trackToolActivity(tabId: string, toolId: string): void {
    let activity = this.deps.toolActivityAt.get(tabId)
    if (!activity) {
      activity = new Map<string, number>()
      this.deps.toolActivityAt.set(tabId, activity)
    }
    activity.set(toolId, Date.now())
  }

  getStableToolId(tabId: string): string {
    const count = (this.deps.toolCallCounts.get(tabId) || 0) + 1
    this.deps.toolCallCounts.set(tabId, count)
    return `tool-${count}`
  }

  clearPendingToolGraceTimeout(tabId: string): void {
    const timer = this.deps.pendingToolGraceTimeouts.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    this.deps.pendingToolGraceTimeouts.delete(tabId)
  }

  postToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): boolean {
    const tab = this.deps.tabManager.getTab(tabId)
    if (!tab) return false

    const pending = this.deps.activeToolCallIds.get(tabId)
    let toolId = result.id && result.id !== "unknown" ? result.id : undefined
    if (!toolId || (pending && !pending.has(toolId))) {
      if (pending && pending.size === 1) {
        toolId = pending.values().next().value
      } else if (pending && pending.size > 1) {
        log.warn(`postToolEnd: ambiguous ID "${result.id}" with ${pending.size} pending tools — picking most recently active`)
        const activity = this.deps.toolActivityAt.get(tabId)
        let latestTime = 0
        for (const id of pending) {
          const t = activity?.get(id) ?? 0
          if (t > latestTime) { latestTime = t; toolId = id }
        }
      }
    }
    if (!toolId) return false

    this.deps.stopToolPartialPolling(tabId, toolId)

    if (pending) {
      pending.delete(toolId)
      if (pending.size === 0) {
        this.deps.activeToolCallIds.delete(tabId)
        this.clearPendingToolGraceTimeout(tabId)
      }
    }
    this.deps.toolActivityAt.get(tabId)?.delete(toolId)

    const block = tab.blocksBuffer.find(b => (b.type === "tool-call" || b.type === "question") && b.id === toolId)
    this.deps.recordToolRunActivity(tabId, {
      id: toolId,
      name: typeof block?.name === "string" ? block.name : "tool",
      status: result.stale ? "unresolved" : result.ok ? "completed" : "failed",
      result: result.result,
      error: result.ok ? undefined : result.result,
    }, callbacks)

    callbacks.postMessage({
      type: "stream_tool_end",
      sessionId: tabId,
      toolId,
      result: { ...result, id: toolId },
    })

    if (block) {
      block.state = result.state ?? (result.stale ? "stale" : result.ok ? "result" : "error")
      block.result = result.result
      block.durationMs = result.durationMs
      if (typeof result.exitCode === "number") {
        ;(block as Record<string, unknown>).exitCode = result.exitCode
      }
      if (typeof result.stderr === "string") {
        ;(block as Record<string, unknown>).stderr = result.stderr
      }
      if (result.resultTruncated) {
        ;(block as Record<string, unknown>).resultTruncated = true
      }
    }
    return true
  }

  resetPendingToolGraceTimeout(tabId: string, callbacks: StreamCallbacks): void {
    if (this.deps.pendingToolGraceTimeouts.has(tabId)) return

    const timeout = setTimeout(() => {
      this.deps.pendingToolGraceTimeouts.delete(tabId)
      void this.markUnresolvedPendingToolCalls(tabId, callbacks)
        .then(() => this.markUnresolvedActiveSubagents(tabId, callbacks))
        .then(() => this.deps.maybeFinalizeStream(tabId, callbacks, "status"))
        .catch(err => log.error("Pending tool grace finalization failed", err))
    }, this.deps.TOOL_FINALIZE_GRACE_MS)
    this.deps.pendingToolGraceTimeouts.set(tabId, timeout)
  }

  async reconcilePendingToolCallsFromServer(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const pending = this.deps.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return

    const tab = this.deps.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return

    try {
      const messages = await this.deps.getSm(tabId).getSessionMessages(tab.cliSessionId)
      const lastAssistant = [...messages].reverse().find(message => message.info.role === "assistant")
      if (!lastAssistant) return

      const messageInfo = lastAssistant.info as { id?: string }
      for (const part of lastAssistant.parts) {
        if (!this.isRecord(part) || part.type !== "tool") continue
        const state: Record<string, unknown> = this.isRecord(part.state) ? part.state as Record<string, unknown> : {}
        const status = typeof state.status === "string" ? state.status : ""
        if (status !== "completed" && status !== "error") continue

        const resolvedId = this.stableToolPartId(part, messageInfo.id)
        const currentPending = this.deps.activeToolCallIds.get(tabId)
        if (!currentPending || currentPending.size === 0) break

        const fallbackId = currentPending.size === 1 ? currentPending.values().next().value : undefined
        const toolId = resolvedId && currentPending.has(resolvedId) ? resolvedId : fallbackId
        if (!toolId) continue

        const toolName = typeof part.tool === "string" ? part.tool : ""
        const isQuestionTool = toolName.toLowerCase() === "question"
        if (isQuestionTool) {
          const qBlock = tab.blocksBuffer.find(
            b => b.type === "question" && (b.id === toolId || (b as Record<string, unknown>).toolCallId === toolId)
          )
          if (qBlock && !(qBlock as Record<string, unknown>).answered) {
            log.info(`reconcilePendingToolCallsFromServer: keeping question tool ${toolId} pending (not yet answered)`)
            continue
          }
        }

        const result = typeof state.output === "string"
          ? state.output
          : state.output !== undefined
            ? JSON.stringify(state.output)
            : typeof state.error === "string"
              ? state.error
              : ""
        this.postToolEnd(tabId, { id: toolId, ok: status === "completed", result }, callbacks)
      }
    } catch (err) {
      log.warn(`Failed to reconcile pending tools for ${tabId}`, err)
    }
  }

  stableToolPartId(part: Record<string, unknown>, messageId?: string): string | undefined {
    if (typeof part.id === "string" && part.id) return part.id
    if (typeof part.callID === "string" && part.callID) return part.callID
    const partMessageId = typeof part.messageID === "string" ? part.messageID : messageId
    const tool = typeof part.tool === "string" ? part.tool : "tool"
    return partMessageId ? `${partMessageId}:${tool}` : undefined
  }

  async markUnresolvedPendingToolCalls(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

    const pending = this.deps.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return

    const ids = Array.from(pending)
    log.warn(`Marking ${ids.length} pending tool call(s) unresolved for ${tabId} after terminal server status`)
    for (const toolId of ids) {
      const tab = this.deps.tabManager.getTab(tabId)
      const isQuestionBlock = tab?.blocksBuffer.some(b => {
        if (b.type !== "question") return false
        const rec = b as Record<string, unknown>
        return b.id === toolId || rec.toolCallId === toolId
      })
      if (isQuestionBlock) {
        log.info(`markUnresolvedPendingToolCalls: skipping question tool ${toolId} (still awaiting answer)`)
        continue
      }
      const block = tab?.blocksBuffer.find(b => b.type === "tool-call" && b.id === toolId)
      this.deps.recordToolRunActivity(tabId, {
        id: toolId,
        name: typeof block?.name === "string" ? block.name : "tool",
        status: "unresolved",
        error: "Tool did not emit a completion event before the server became idle.",
      }, callbacks)
      callbacks.postMessage({
        type: "stream_tool_unresolved",
        sessionId: tabId,
        toolCallId: toolId,
        message: "Tool did not emit a completion event before the server became idle.",
      })
    }
  }

  markUnresolvedActiveSubagents(tabId: string, callbacks: StreamCallbacks): void {
    const active = this.deps.activityTracker.getSnapshot(tabId)?.activeSubagentCount ?? 0
    if (active === 0) return
    const message = "Subagent did not emit a completion event before the server became idle."
    log.warn(`Marking ${active} active subagent(s) unresolved for ${tabId} after terminal server status`)
    const snapshot = this.deps.activityTracker.markActiveSubagentsUnresolved(tabId, message)
    this.deps.postRunActivitySnapshot(tabId, snapshot, callbacks)
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
  }

  /** Clear all state for a tab — called from StreamCoordinator.cleanupTab. */
  clearTab(tabId: string): void {
    this.deps.activeToolCallIds.delete(tabId)
    this.deps.toolCallCounts.delete(tabId)
    this.deps.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)
  }

  /** Clear all timers and state — called from StreamCoordinator.dispose. */
  dispose(): void {
    for (const timer of this.deps.pendingToolGraceTimeouts.values()) {
      clearTimeout(timer)
    }
    this.deps.pendingToolGraceTimeouts.clear()
    this.deps.activeToolCallIds.clear()
    this.deps.toolCallCounts.clear()
    this.deps.toolActivityAt.clear()
  }
}
