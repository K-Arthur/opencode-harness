import type { TabManager } from "../TabManager"
import type { StreamCallbacks } from "./StreamCoordinatorTypes"
import type { ToolPartialInput } from "./StreamCoordinatorTypes"
import type { LiveToolOutputSnapshot } from "../../session/liveToolOutput"
import type { SessionManager } from "../../session/SessionManager"
import { classifyTool } from "./toolClassifier"
import { log } from "../../utils/outputChannel"

/** Offset tracking for partial output dedup. */
export interface ToolPartialOffset {
  token: number
  stdoutLength: number
  stderrLength: number
}

/** Dependencies shared by reference from StreamCoordinator. */
export interface ToolPartialPollerDeps {
  tabManager: TabManager
  toolPartialFallbackTimers: Map<string, ReturnType<typeof setTimeout>>
  toolPartialPollTimers: Map<string, ReturnType<typeof setInterval>>
  toolPartialOffsets: Map<string, ToolPartialOffset>
  toolPartialWarnedSessions: Set<string>
  readonly TOOL_PARTIAL_FALLBACK_DELAY_MS: number
  readonly TOOL_PARTIAL_POLL_INTERVAL_MS: number
  /** Resolve the session manager for a tab (ADR-010 per-tab routing). */
  getSm: (tabId?: string) => SessionManager
  /** Check if a tool is still pending — delegated to ToolCallTracker. */
  isToolPending: (tabId: string, toolId: string) => boolean
  /** Callback to append a tool partial back to StreamCoordinator. */
  appendToolPartial: (tabId: string, partial: ToolPartialInput, callbacks: StreamCallbacks, source: "sse" | "poll") => void
}

/**
 * Manages fallback polling for live tool output (bash/shell commands).
 * When the SSE stream doesn't provide partial output within a grace
 * period, this service polls the server for live output snapshots.
 * Extracted from StreamCoordinator to isolate polling lifecycle from
 * stream content assembly.
 */
export class ToolPartialPoller {
  constructor(private readonly deps: ToolPartialPollerDeps) {}

  toolPartialKey(tabId: string, toolId: string): string {
    return `${tabId}\u0000${toolId}`
  }

  private isToolPartialPollable(toolCall: { name?: string; class?: string; args?: unknown }): boolean {
    const name = (toolCall.name || "").toLowerCase()
    const cls = (toolCall.class || classifyTool(toolCall.name || "")).toLowerCase()
    if (cls === "exec") return true
    if (/(bash|shell|command|terminal|zsh|sh|exec)/i.test(name)) return true
    const args = toolCall.args && typeof toolCall.args === "object" ? toolCall.args as Record<string, unknown> : undefined
    return typeof args?.command === "string" || typeof args?.cmd === "string"
  }

  stopToolPartialPolling(tabId: string, toolId: string): void {
    const key = this.toolPartialKey(tabId, toolId)
    const fallback = this.deps.toolPartialFallbackTimers.get(key)
    if (fallback) clearTimeout(fallback)
    this.deps.toolPartialFallbackTimers.delete(key)
    const poll = this.deps.toolPartialPollTimers.get(key)
    if (poll) clearInterval(poll)
    this.deps.toolPartialPollTimers.delete(key)
    this.deps.toolPartialOffsets.delete(key)
  }

  stopAllToolPartialPolling(tabId: string): void {
    const prefix = `${tabId}\u0000`
    for (const key of Array.from(this.deps.toolPartialFallbackTimers.keys())) {
      if (!key.startsWith(prefix)) continue
      const timer = this.deps.toolPartialFallbackTimers.get(key)
      if (timer) clearTimeout(timer)
      this.deps.toolPartialFallbackTimers.delete(key)
    }
    for (const key of Array.from(this.deps.toolPartialPollTimers.keys())) {
      if (!key.startsWith(prefix)) continue
      const timer = this.deps.toolPartialPollTimers.get(key)
      if (timer) clearInterval(timer)
      this.deps.toolPartialPollTimers.delete(key)
    }
    for (const key of Array.from(this.deps.toolPartialOffsets.keys())) {
      if (key.startsWith(prefix)) this.deps.toolPartialOffsets.delete(key)
    }
  }

  armToolPartialPolling(
    tabId: string,
    toolId: string,
    toolCall: { name?: string; class?: string; args?: unknown },
    callbacks: StreamCallbacks,
  ): void {
    if (!this.isToolPartialPollable(toolCall)) return
    const key = this.toolPartialKey(tabId, toolId)
    if (this.deps.toolPartialFallbackTimers.has(key) || this.deps.toolPartialPollTimers.has(key)) return

    const fallback = setTimeout(() => {
      this.deps.toolPartialFallbackTimers.delete(key)
      if (this.deps.toolPartialOffsets.has(key)) return
      const poll = setInterval(() => {
        void this.pollToolPartialOutput(tabId, toolId, callbacks)
      }, this.deps.TOOL_PARTIAL_POLL_INTERVAL_MS)
      this.deps.toolPartialPollTimers.set(key, poll)
      void this.pollToolPartialOutput(tabId, toolId, callbacks)
    }, this.deps.TOOL_PARTIAL_FALLBACK_DELAY_MS)
    this.deps.toolPartialFallbackTimers.set(key, fallback)
  }

  /** Clear fallback + poll timers when SSE source takes over. */
  clearSsePolling(tabId: string, toolId: string): void {
    const key = this.toolPartialKey(tabId, toolId)
    const fallback = this.deps.toolPartialFallbackTimers.get(key)
    if (fallback) clearTimeout(fallback)
    this.deps.toolPartialFallbackTimers.delete(key)
    const poll = this.deps.toolPartialPollTimers.get(key)
    if (poll) clearInterval(poll)
    this.deps.toolPartialPollTimers.delete(key)
  }

  getOffset(key: string): ToolPartialOffset | undefined {
    return this.deps.toolPartialOffsets.get(key)
  }

  setOffset(key: string, offset: ToolPartialOffset): void {
    this.deps.toolPartialOffsets.set(key, offset)
  }

  private warnNoLiveOutputOnce(tabId: string): void {
    const cliSessionId = this.deps.tabManager.getTab(tabId)?.cliSessionId ?? tabId
    if (this.deps.toolPartialWarnedSessions.has(cliSessionId)) return
    this.deps.toolPartialWarnedSessions.add(cliSessionId)
    log.warn(`Live tool output polling: no recognizable live output buffer exposed for session ${cliSessionId}`)
  }

  private partialFromSnapshot(toolId: string, snapshot: LiveToolOutputSnapshot): ToolPartialInput {
    return {
      id: toolId,
      token: snapshot.token,
      stdout: snapshot.stdout,
      stderr: snapshot.stderr,
      stdoutLength: snapshot.stdoutLength,
      stderrLength: snapshot.stderrLength,
      stdoutLineCount: snapshot.stdoutLineCount,
      stderrLineCount: snapshot.stderrLineCount,
      durationMs: snapshot.durationMs,
      exitCode: snapshot.exitCode,
    }
  }

  async pollToolPartialOutput(tabId: string, toolId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.deps.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return
    if (!this.deps.isToolPending(tabId, toolId)) {
      this.stopToolPartialPolling(tabId, toolId)
      return
    }

    const key = this.toolPartialKey(tabId, toolId)
    const previous = this.deps.toolPartialOffsets.get(key)
    try {
      const snapshot = await this.deps.getSm(tabId).getToolPartialOutput(tab.cliSessionId, toolId, previous?.token ?? 0)
      if (!snapshot.available) {
        this.warnNoLiveOutputOnce(tabId)
        return
      }
      this.deps.appendToolPartial(tabId, this.partialFromSnapshot(toolId, snapshot), callbacks, "poll")
    } catch (err) {
      log.warn(`Live tool output polling failed for ${tabId}/${toolId}`, err)
    }
  }

  /** Clear all timers and state — called from StreamCoordinator.dispose. */
  dispose(): void {
    for (const timer of this.deps.toolPartialFallbackTimers.values()) {
      clearTimeout(timer)
    }
    this.deps.toolPartialFallbackTimers.clear()
    for (const timer of this.deps.toolPartialPollTimers.values()) {
      clearInterval(timer)
    }
    this.deps.toolPartialPollTimers.clear()
    this.deps.toolPartialOffsets.clear()
    this.deps.toolPartialWarnedSessions.clear()
  }
}
