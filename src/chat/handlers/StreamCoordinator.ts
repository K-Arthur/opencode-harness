import * as vscode from "vscode"
import { DiffApplier, type ProposedEdit } from "../../diff/DiffApplier"
import { DiffHandler } from "./DiffHandler"
import { TabManager } from "../TabManager"
import { SessionManager } from "../../session/SessionManager"
import { SessionStore } from "../../session/SessionStore"
import { ContextEngine } from "../../context/ContextEngine"
import { ContextMonitor } from "../../monitor/ContextMonitor"
import { RateLimitMonitor } from "../../monitor/RateLimitMonitor"
import { estimateContextTokens, parseModelRef } from "../../utils/tokenCounter"
import { ModelManager } from "../../model/ModelManager"
import { log } from "../../utils/outputChannel"
import type { Block, ChatMessage } from "../types"
import type { DiffHunk } from "../webview/types"

export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
}

type ToolEndResult = { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean }

/** Explicit lifecycle states for a streaming session */
export type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout"

export class StreamCoordinator {
  private diffHandler: DiffHandler
  private readonly diffApplier: DiffApplier
  /** Watchdog interval for stuck streams (no activity for 90 seconds) */
  private readonly STREAM_STUCK_MS = 90000
  /** Time-to-first-byte timeout: no chunk received within 45s */
  readonly TTFB_TIMEOUT_MS = 45000
  /** Inter-chunk inactivity timeout: no chunk for 90s after first byte */
  readonly CHUNK_INACTIVITY_TIMEOUT_MS = 90000
  /** Short grace window for terminal status to be followed by late tool_end events */
  readonly TOOL_FINALIZE_GRACE_MS = 2000
  /** Hard cap for truly interrupted long-running turns */
  readonly HARD_STREAM_TIMEOUT_MS = 600000
  private streamWatchdog: ReturnType<typeof setInterval> | null = null
  private stuckStreamHandlers: Map<string, StreamCallbacks> = new Map()
  private ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** Tabs currently in the process of finalizing — guards against double-finalize */
  private finalizingTabs = new Set<string>()
  /** Per-tab stream lifecycle state for observability */
  private streamStates = new Map<string, StreamLifecycleState>()
  /** Per-tab active message ID — detects when the server starts a new assistant message mid-stream */
  private activeMessageIds = new Map<string, string>()
  /** Per-tab tool call counter for stable deterministic IDs when server IDs are missing */
  private toolCallCounts = new Map<string, number>()
  /** Per-tab pending tool call IDs. Set insertion order gives FIFO fallback for missing IDs. */
  private activeToolCallIds = new Map<string, Set<string>>()
  /** Last activity per pending tool, used when reconciling stale terminal states. */
  private toolActivityAt = new Map<string, Map<string, number>>()
  /** Per-tab chunk batching buffer for reducing webview message traffic */
  private chunkBuffers = new Map<string, string>()
  /** Per-tab chunk flush timers */
  private chunkFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Chunk batch flush interval (ms) */
  private readonly CHUNK_BATCH_MS = 50
  /** Per-tab heartbeat sequence counters */
  private heartbeatSeqs = new Map<string, number>()
  /** Per-tab last acked heartbeat seq */
  private heartbeatAckedSeqs = new Map<string, number>()
  /** Per-tab last acked chunk seq */
  private heartbeatAckedChunkSeqs = new Map<string, number>()
  /** Per-tab heartbeat interval timers */
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
  /** Per-tab hard stream timeout timers */
  private hardStreamTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionStore: SessionStore,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor,
    private readonly modelManager: ModelManager,
    private readonly tabManager: TabManager,
    private readonly rateLimitMonitor: RateLimitMonitor,
    diffApplier: DiffApplier
  ) {
    this.diffApplier = diffApplier
    this.diffHandler = new DiffHandler(diffApplier)
  }

  private setStreamState(tabId: string, state: StreamLifecycleState, context?: Record<string, unknown>): void {
    const previous = this.streamStates.get(tabId) || "idle"
    this.streamStates.set(tabId, state)
    const ctxStr = context ? ` ${JSON.stringify(context)}` : ""
    log.info(`[stream:${tabId}] ${previous} → ${state}${ctxStr}`)
  }

  private startWatchdog(): void {
    if (this.streamWatchdog) return
    this.streamWatchdog = setInterval(() => {
      const allTabs = this.tabManager.getAllTabs()
      const anyStreaming = allTabs.some(t => t.isStreaming)
      if (!anyStreaming) {
        this.stopWatchdog()
        return
      }
      for (const tab of allTabs) {
        if (tab.isStreaming && tab.lastActivityTime) {
          const stuckMs = Date.now() - tab.lastActivityTime
          if (stuckMs > this.STREAM_STUCK_MS) {
            log.warn(`Watchdog: Stream for tab ${tab.id} stuck for ${Math.round(stuckMs / 1000)}s, finalizing`)
            const callbacks = this.stuckStreamHandlers.get(tab.id)
            if (callbacks) {
              void this.finalizeStream(tab.id, callbacks).catch(err => log.error("Watchdog finalize failed", err))
            } else {
              log.warn(`No callbacks for stuck tab ${tab.id}, resetting state`)
              this.tabManager.setStreaming(tab.id, false)
              this.tabManager.setWaitingForCompletion(tab.id, false)
            }
          }
        }
      }
    }, 15000)
  }

  private stopWatchdog(): void {
    if (this.streamWatchdog) {
      clearInterval(this.streamWatchdog)
      this.streamWatchdog = null
    }
  }

  private clearTtfbTimeout(tabId: string): void {
    const timer = this.ttfbTimeouts.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.ttfbTimeouts.delete(tabId)
    }
  }

  private clearPendingToolGraceTimeout(tabId: string): void {
    const timer = this.pendingToolGraceTimeouts.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    this.pendingToolGraceTimeouts.delete(tabId)
  }

  private getOrCreatePendingToolIds(tabId: string): Set<string> {
    let pending = this.activeToolCallIds.get(tabId)
    if (!pending) {
      pending = new Set<string>()
      this.activeToolCallIds.set(tabId, pending)
    }
    return pending
  }

  private getLastPendingToolId(tabId: string): string | undefined {
    const pending = this.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return undefined
    return Array.from(pending)[pending.size - 1]
  }

  private trackToolActivity(tabId: string, toolId: string): void {
    let activity = this.toolActivityAt.get(tabId)
    if (!activity) {
      activity = new Map<string, number>()
      this.toolActivityAt.set(tabId, activity)
    }
    activity.set(toolId, Date.now())
  }

  private postToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): boolean {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return false

    const pending = this.activeToolCallIds.get(tabId)
    let toolId = result.id && result.id !== "unknown" ? result.id : undefined
    if (!toolId || (pending && !pending.has(toolId))) {
      toolId = pending?.values().next().value
    }
    if (!toolId) return false

    if (pending) {
      pending.delete(toolId)
      if (pending.size === 0) {
        this.activeToolCallIds.delete(tabId)
        this.clearPendingToolGraceTimeout(tabId)
      }
    }
    this.toolActivityAt.get(tabId)?.delete(toolId)

    callbacks.postMessage({
      type: "stream_tool_end",
      sessionId: tabId,
      toolId,
      result: { ...result, id: toolId },
    })

    const block = tab.blocksBuffer.find(b => b.type === "tool-call" && b.id === toolId)
    if (block) {
      block.state = result.stale ? "stale" : result.ok ? "result" : "error"
      block.result = result.result
      block.durationMs = result.durationMs
    }
    return true
  }

  private resetPendingToolGraceTimeout(tabId: string, callbacks: StreamCallbacks): void {
    if (this.pendingToolGraceTimeouts.has(tabId)) return

    const timeout = setTimeout(() => {
      this.pendingToolGraceTimeouts.delete(tabId)
      void this.finishStalePendingToolCalls(tabId, callbacks)
        .then(() => this.maybeFinalizeStream(tabId, callbacks, "status"))
        .catch(err => log.error("Pending tool grace finalization failed", err))
    }, this.TOOL_FINALIZE_GRACE_MS)
    this.pendingToolGraceTimeouts.set(tabId, timeout)
  }

  private async reconcilePendingToolCallsFromServer(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const pending = this.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return

    const tab = this.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return

    try {
      const messages = await this.sessionManager.getSessionMessages(tab.cliSessionId)
      const lastAssistant = [...messages].reverse().find(message => message.info.role === "assistant")
      if (!lastAssistant) return

      const messageInfo = lastAssistant.info as { id?: string }
      for (const part of lastAssistant.parts) {
        if (!this.isRecord(part) || part.type !== "tool") continue
        const state: Record<string, unknown> = this.isRecord(part.state) ? part.state as Record<string, unknown> : {}
        const status = typeof state.status === "string" ? state.status : ""
        if (status !== "completed" && status !== "error") continue

        const resolvedId = this.stableToolPartId(part, messageInfo.id)
        const currentPending = this.activeToolCallIds.get(tabId)
        if (!currentPending || currentPending.size === 0) return

        const fallbackId = currentPending.size === 1 ? currentPending.values().next().value : undefined
        const toolId = resolvedId && currentPending.has(resolvedId) ? resolvedId : fallbackId
        if (!toolId) continue

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

  private stableToolPartId(part: Record<string, unknown>, messageId?: string): string | undefined {
    if (typeof part.id === "string" && part.id) return part.id
    if (typeof part.callID === "string" && part.callID) return part.callID
    const partMessageId = typeof part.messageID === "string" ? part.messageID : messageId
    const tool = typeof part.tool === "string" ? part.tool : "tool"
    return partMessageId ? `${partMessageId}:${tool}` : undefined
  }

  private async finishStalePendingToolCalls(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

    const pending = this.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return

    const ids = Array.from(pending)
    log.warn(`Marking ${ids.length} pending tool call(s) stale for ${tabId} after terminal server status`)
    for (const toolId of ids) {
      this.postToolEnd(tabId, {
        id: toolId,
        ok: true,
        result: "Tool did not emit a completion event before the server became idle.",
        stale: true,
      }, callbacks)
    }
  }

  /**
   * Reset the chunk-inactivity timeout. If no further chunks arrive within
   * CHUNK_INACTIVITY_TIMEOUT_MS, finalize the stream — this is the catch-all
   * fallback that fires when the server stops emitting chunks but never sends
   * an explicit message_complete or idle status (releasing the streaming-state
   * lock so the user can switch modes again).
   */
  private resetCompletionTimeout(tabId: string, callbacks: StreamCallbacks): void {
    this.tabManager.clearCompletionTimeout(tabId)
    const timeout = setTimeout(() => {
      const t = this.tabManager.getTab(tabId)
      if (t?.waitingForCompletion) {
        log.warn(`Chunk inactivity timeout for tab ${tabId} after ${this.CHUNK_INACTIVITY_TIMEOUT_MS}ms — checking finalization`)
        void this.maybeFinalizeStream(tabId, callbacks, "status").catch(err => log.error("Inactivity finalize failed", err))
      }
    }, this.CHUNK_INACTIVITY_TIMEOUT_MS)
    this.tabManager.setCompletionTimeout(tabId, timeout)
  }

  async startPrompt(tabId: string, text: string, callbacks: StreamCallbacks, variant?: string): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) {
      callbacks.postRequestError("Tab not found")
      return
    }

    // Store callbacks for watchdog
    this.stuckStreamHandlers.set(tabId, callbacks)
    this.toolCallCounts.set(tabId, 0)
    this.activeToolCallIds.delete(tabId)
    this.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)

    if (!this.sessionManager.isRunning) {
      try {
        await this.sessionManager.start()
      } catch (e) {
        const msg = (e as Error).message
        log.error("Failed to start OpenCode server", e)
        vscode.window.showErrorMessage(`Could not start OpenCode. ${msg}`)
        callbacks.postRequestError(msg)
        this.cleanupTab(tabId)
        return
      }
    }

    // Reserve the streaming slot ATOMICALLY before any `await`
    const canStream = this.tabManager.canStartStreaming()
    if (!canStream.ok) {
      log.warn(`Concurrent stream limit reached: ${canStream.reason}`)
      vscode.window.showWarningMessage(canStream.reason!)
      this.stuckStreamHandlers.delete(tabId)
      // Notify webview so it can reset optimistic streaming state
      callbacks.postMessage({
        type: "prompt_rejected",
        sessionId: tabId,
        reason: canStream.reason || "Concurrent stream limit reached",
      })
      return
    }

    // Now set streaming state AFTER atomic reservation
    this.tabManager.setStreaming(tabId, true)
    this.setStreamState(tabId, "sending", { model: tab.model, sessionId: tab.cliSessionId })

    try {
      this.refreshContextTokenEstimate()

      const cliSessionId = await this.sessionManager.ensureSession(tab.cliSessionId, `Tab ${tabId.slice(0, 8)}`)
      this.tabManager.setCliSessionId(tabId, cliSessionId)
      this.sessionStore.updateCliSessionId(tabId, cliSessionId)

      // NOTE: User message is already rendered and stored by the webview.
      // Persisting here caused duplicate rendering (garbled/flash effect).
      callbacks.postMessage({
        type: "stream_start",
        sessionId: tabId,
        messageId: `resp-${cliSessionId}`,
      })

      this.tabManager.setWaitingForCompletion(tabId, true)
      this.tabManager.clearBuffer(tabId)
      this.startWatchdog()

      // TTFB (time-to-first-byte) timeout — fires if no stream chunk arrives within 30s
      const ttfbTimeout = setTimeout(() => {
        const t = this.tabManager.getTab(tabId)
        if (t?.isStreaming && t.waitingForCompletion) {
          log.warn(`TTFB timeout for tab ${tabId} — no chunk received within ${this.TTFB_TIMEOUT_MS}ms`)
          this.setStreamState(tabId, "timeout", { sessionId: t.cliSessionId })
          callbacks.postMessage({
            type: "stream_end",
            sessionId: tabId,
            messageId: `resp-${t.cliSessionId}`,
            blocks: [],
            reason: "ttfb_timeout",
            partial: false,
            retryable: true,
          })
          this.cleanupTab(tabId)
        }
      }, this.TTFB_TIMEOUT_MS)
      this.ttfbTimeouts.set(tabId, ttfbTimeout)

      // Completion timeout fallback — fires if the full 60s window elapses with no completion
      const timeout = setTimeout(() => {
        const t = this.tabManager.getTab(tabId)
        if (t?.waitingForCompletion) {
          log.warn(`Message completion timeout for tab ${tabId}`)
          void this.finalizeStream(tabId, callbacks).catch(err => log.error("Timeout finalize failed", err))
        }
      }, 45000)
      this.tabManager.setCompletionTimeout(tabId, timeout)

      const modelRef = tab.model ? parseModelRef(tab.model) : undefined

      // Pass tools configuration to server based on mode
      // Plan mode: disable file_edit to prevent edits (server uses tools field)
      // Build/Auto modes: enable file_edit (default behavior)
      const tools = tab.mode === "plan" ? { file_edit: false } : undefined

      await this.sessionManager.sendPromptAsync(cliSessionId, [{ type: "text", text }], { model: modelRef, tools, variant })

      this.startHeartbeat(tabId, callbacks)
      this.startHardWatchdog(tabId, callbacks)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Prompt failed", e)
      vscode.window.showErrorMessage(`OpenCode request failed: ${message}`)
      // Emit stream_end so the webview cleans up the assistant placeholder BEFORE showing the error
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: `resp-${tab.cliSessionId || tabId}`,
        blocks: [],
        reason: "error",
      })
      callbacks.postRequestError(message)
      this.cleanupTab(tabId)
    }
  }

  async finalizeStream(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.waitingForCompletion) return

    // Idempotency guard: prevent double-finalize from concurrent events
    if (this.finalizingTabs.has(tabId)) {
      log.info(`finalizeStream skipped for ${tabId} — already finalizing`)
      return
    }
    this.finalizingTabs.add(tabId)

    try {
      this.setStreamState(tabId, "completing", { sessionId: tab.cliSessionId })

      // Clear TTFB timeout if still active
      this.clearTtfbTimeout(tabId)

      // Clear stored callbacks for watchdog
      this.stuckStreamHandlers.delete(tabId)

      this.tabManager.clearCompletionTimeout(tabId)
      this.tabManager.setWaitingForCompletion(tabId, false)

      let blocks: Block[] = []

      try {
        // Fetch the definitive complete message list from the server to ensure all tool blocks and text are present.
        if (tab.cliSessionId) {
          const messages = await this.sessionManager.getSessionMessages(tab.cliSessionId)
          const lastAssistant = [...messages].reverse().find(message => message.info.role === "assistant")
          if (lastAssistant) {
            blocks = this.partsToBlocks(lastAssistant.parts)
            const info = lastAssistant.info as { cost?: number; tokens?: { input?: number; output?: number } }
            if (typeof info.cost === "number") {
              callbacks.postMessage({ type: "cost_update", sessionId: tabId, cost: info.cost })
            }
            if (info.tokens) {
              const input = info.tokens.input ?? 0
              const output = info.tokens.output ?? 0
              callbacks.postMessage({ type: "token_usage", sessionId: tabId, usage: { prompt: input, completion: output, total: input + output } })
              const selectedModel = tab.model || this.modelManager.model
              const provider = parseModelRef(selectedModel).providerID || parseModelRef(this.modelManager.model).providerID || undefined
              this.rateLimitMonitor.recordTokenUsage(input, output, provider, info.cost)
            }
          }
        }
      } catch (err) {
        log.warn(`Failed to fetch final session for ${tabId}, falling back to buffer`, err)
      }

      // MERGE/FALLBACK: Build the definitive block list with proper deduplication.
      // Priority: live blocksBuffer (has real-time tool/skill/thought blocks) > server blocks > streamingBuffer.
      // We MUST use blocksBuffer as the primary source if it contains more than just text blocks,
      // because it accumulates ALL block types during streaming (text, tools, skills, thinking).
      const hasNonTextBlocks = tab.blocksBuffer.some(b => b.type !== "text")

      if (tab.blocksBuffer.length > 0 && (hasNonTextBlocks || blocks.length === 0)) {
        log.info(`finalizeStream: Using live blocksBuffer for ${tabId} (${tab.blocksBuffer.length} blocks, hasNonText: ${hasNonTextBlocks})`)

        // Start with the live buffer (has all real-time blocks)
        const mergedBlocks = [...tab.blocksBuffer]

        // Merge server blocks: add any text content that the live buffer might have missed
        if (blocks.length > 0) {
          for (const serverBlock of blocks) {
            const exists = mergedBlocks.some(b =>
              b.type === serverBlock.type &&
              (b as any).id === (serverBlock as any).id
            )
            if (!exists && serverBlock.type === "text") {
              // Server may have the final complete text - use it to replace any partial text blocks
              const existingTextIdx = mergedBlocks.findIndex(b => b.type === "text")
              if (existingTextIdx >= 0) {
                mergedBlocks[existingTextIdx] = serverBlock
              } else {
                mergedBlocks.push(serverBlock)
              }
            }
          }
        }

        blocks = mergedBlocks
      }

      // DIAGNOSTIC LOGGING: Log what we're about to send
      log.info(`finalizeStream: FINAL blocks for ${tabId}: ${JSON.stringify(blocks.map(b => ({ type: b.type, id: (b as any).id, state: (b as any).state })))}`)

      // Fallback if both are empty
      if (blocks.length === 0 && tab.streamingBuffer) {
        // Strip context wrapper from response if present
        const cleanedText = this.stripContextWrapper(tab.streamingBuffer)

        // Check if there's actual content after stripping context
        if (cleanedText.trim()) {
          blocks.push({ type: "text", text: cleanedText })
        }
      }

      if (blocks.length > 0) {
        const assistantMsg: ChatMessage = {
          role: "assistant",
          blocks,
          timestamp: Date.now(),
          sessionId: tabId,
        }
        this.sessionStore.appendMessage(tabId, assistantMsg)
      }

      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: `resp-${tab.cliSessionId}`,
        blocks,
      })

      this.tabManager.setStreaming(tabId, false)
      this.tabManager.clearBuffer(tabId)
      this.tabManager.clearBlocksBuffer(tabId)
      this.toolCallCounts.delete(tabId)
      this.activeToolCallIds.delete(tabId)
      this.toolActivityAt.delete(tabId)
      this.clearPendingToolGraceTimeout(tabId)
      this.activeMessageIds.delete(tabId)
      this.stopHeartbeat(tabId)
      this.clearHardWatchdog(tabId)
      this.chunkBuffers.delete(tabId)
      const flushTimer = this.chunkFlushTimers.get(tabId)
      if (flushTimer) {
        clearTimeout(flushTimer)
        this.chunkFlushTimers.delete(tabId)
      }
      this.setStreamState(tabId, "idle", { sessionId: tab.cliSessionId })
    } finally {
      this.finalizingTabs.delete(tabId)
    }
  }

  async maybeFinalizeStream(tabId: string, callbacks: StreamCallbacks, trigger: "message_complete" | "status"): Promise<boolean> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.waitingForCompletion) return false

    await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

    const deferReason = this.getFinalizeDeferReason(tabId, tab.blocksBuffer, trigger)
    if (deferReason) {
      log.info(`maybeFinalizeStream: deferred for ${tabId} on ${trigger}: ${deferReason}`)
      if (deferReason.includes("tool call")) {
        this.resetPendingToolGraceTimeout(tabId, callbacks)
      } else {
        this.resetCompletionTimeout(tabId, callbacks)
      }
      return false
    }

    await this.finalizeStream(tabId, callbacks)
    return true
  }

  private getFinalizeDeferReason(tabId: string, blocks: Block[], trigger: "message_complete" | "status"): string | null {
    const pending = this.activeToolCallIds.get(tabId)
    if (pending && pending.size > 0) return `${pending.size} tool call(s) still running`

    if (trigger !== "message_complete") return null

    const lastToolIndex = [...blocks].reverse().findIndex((block) => block.type === "tool-call" || block.type === "tool_call")
    if (lastToolIndex < 0) return null

    const absoluteToolIndex = blocks.length - 1 - lastToolIndex
    const hasTextAfterTool = blocks.slice(absoluteToolIndex + 1).some((block) => {
      return block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0
    })

    return hasTextAfterTool ? null : "assistant message only contains tool blocks"
  }

  /**
   * Abort a streaming session.
   * - Calls abort() on the underlying fetch controller
   * - Emits stream:end with { reason: 'aborted' }
   * - Always cleans up the tab state
   */
  async abort(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.cliSessionId || !this.sessionManager.isRunning) return

    try {
      await this.sessionManager.abortSession(tab.cliSessionId)
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: `resp-${tab.cliSessionId}`,
        blocks: [],
        reason: "aborted",
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.warn("Abort failed", e)
      // Still emit stream_end with aborted reason even if abort call fails
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: `resp-${tab.cliSessionId}`,
        blocks: [],
        reason: "aborted",
      })
    } finally {
      this.cleanupTab(tabId)
    }
  }

  private flushChunkBuffer(tabId: string, cbs: StreamCallbacks): void {
    const buf = this.chunkBuffers.get(tabId)
    this.chunkBuffers.delete(tabId)
    const timer = this.chunkFlushTimers.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.chunkFlushTimers.delete(tabId)
    }
    if (!buf) return
    cbs.postMessage({
      type: "stream_chunk",
      sessionId: tabId,
      text: buf,
    })
  }

  private startHeartbeat(tabId: string, callbacks: StreamCallbacks): void {
    this.stopHeartbeat(tabId)
    this.heartbeatSeqs.set(tabId, 0)
    this.heartbeatAckedSeqs.set(tabId, 0)
    const timer = setInterval(() => {
      const tab = this.tabManager.getTab(tabId)
      if (!tab?.isStreaming) {
        this.stopHeartbeat(tabId)
        return
      }
      const seq = (this.heartbeatSeqs.get(tabId) || 0) + 1
      this.heartbeatSeqs.set(tabId, seq)
      callbacks.postMessage({
        type: "stream_ping",
        sessionId: tabId,
        seq,
      })
      const ackedSeq = this.heartbeatAckedSeqs.get(tabId) || 0
      if (seq - ackedSeq > 2) {
        log.warn(`Heartbeat: tab ${tabId} missed ${seq - ackedSeq} pings, sending force_rerender`)
        const fullText = tab.streamingBuffer || ""
        callbacks.postMessage({
          type: "force_rerender",
          sessionId: tabId,
          text: fullText,
        })
      }
    }, 5000)
    this.heartbeatTimers.set(tabId, timer)
  }

  private stopHeartbeat(tabId: string): void {
    const timer = this.heartbeatTimers.get(tabId)
    if (timer) {
      clearInterval(timer)
      this.heartbeatTimers.delete(tabId)
    }
    this.heartbeatSeqs.delete(tabId)
    this.heartbeatAckedSeqs.delete(tabId)
    this.heartbeatAckedChunkSeqs.delete(tabId)
  }

  handleStreamAck(tabId: string, seq: number, lastRenderedChunkSeq?: number): void {
    this.heartbeatAckedSeqs.set(tabId, seq)
    if (lastRenderedChunkSeq !== undefined) {
      this.heartbeatAckedChunkSeqs.set(tabId, lastRenderedChunkSeq)
    }
  }

  async reconcileAfterReconnect(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return

    this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId, reason: "reconnecting" })

    try {
      await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

      const messages = await this.sessionManager.getSessionMessages(tab.cliSessionId)
      const lastAssistant = [...messages].reverse().find(m => m.info.role === "assistant")
      if (lastAssistant) {
        const blocks = this.partsToBlocks(lastAssistant.parts)
        callbacks.postMessage({
          type: "force_rerender",
          sessionId: tabId,
          blocks,
          text: tab.streamingBuffer || "",
        })
      }
    } catch (err) {
      log.warn(`reconcileAfterReconnect failed for ${tabId}`, err)
    }
  }

  async retryFromHere(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    const lastMessages = this.sessionStore.get(tabId)
    const lastAssistant = [...(lastMessages?.messages || [])].reverse().find(m => m.role === "assistant")
    const lastUser = [...(lastMessages?.messages || [])].reverse().find(m => m.role === "user")
    const snippet = lastAssistant?.blocks
      ?.filter(b => b.type === "text")
      ?.map(b => (b as any).text || "")
      ?.join(" ")
      ?.slice(0, 200) || ""

    const retryPrompt = lastUser
      ? `Continue from where you left off. Last assistant output began: "${snippet}${snippet.length >= 200 ? "..." : ""}". Please complete the task.`
      : "Please retry the last request."

    const cliSessionId = tab.cliSessionId
    if (!cliSessionId) return

    log.info(`retryFromHere: retrying for tab ${tabId}`)
    await this.startPrompt(tabId, retryPrompt, callbacks)
  }

  private startHardWatchdog(tabId: string, callbacks: StreamCallbacks): void {
    this.clearHardWatchdog(tabId)
    const timer = setTimeout(() => {
      const tab = this.tabManager.getTab(tabId)
      if (!tab?.isStreaming) return
      log.error(`Hard stream timeout for tab ${tabId} after ${this.HARD_STREAM_TIMEOUT_MS}ms — marking interrupted`)
      this.setStreamState(tabId, "timeout", { sessionId: tab.cliSessionId })
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: `resp-${tab.cliSessionId}`,
        blocks: [],
        reason: "hard_timeout",
        partial: true,
        retryable: true,
      })
      this.cleanupTab(tabId)
    }, this.HARD_STREAM_TIMEOUT_MS)
    this.hardStreamTimers.set(tabId, timer)
  }

  private clearHardWatchdog(tabId: string): void {
    const timer = this.hardStreamTimers.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.hardStreamTimers.delete(tabId)
    }
  }

  appendChunk(tabId: string, text: string, callbacks?: StreamCallbacks, messageId?: string): void {
    // Clear TTFB timeout on first chunk — the model has started responding
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first chunk received for tab ${tabId}`)
    }

    this.tabManager.appendToBuffer(tabId, text)

    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    const lastBlock = tab.blocksBuffer[tab.blocksBuffer.length - 1]
    if (lastBlock && lastBlock.type === "text") {
      lastBlock.text += text
    } else {
      tab.blocksBuffer.push({ type: "text", text })
    }

    // The server may emit multiple messages per prompt (e.g. text → tool calls → text).
    // Track the active server messageId for observability/logging only — DO NOT synthesize
    // stream_end / stream_start for the webview, since that splits the visual bubble in half
    // and leaves text/tool blocks orphaned outside the streaming bubble. The webview already
    // accumulates all blocks of a turn into a single bubble; finalizeStream is the sole
    // trigger for closing it.
    const cbs = callbacks || this.stuckStreamHandlers.get(tabId)
    if (messageId) {
      const prevId = this.activeMessageIds.get(tabId)
      if (prevId && prevId !== messageId) {
        log.info(`appendChunk: server messageId changed for tab ${tabId}: ${prevId} → ${messageId} (continuing in same bubble)`)
      }
      this.activeMessageIds.set(tabId, messageId)
    }

    if (tab.isStreaming) {
      this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId })
    }

    // Reset the completion timeout on each chunk to prevent the timeout from
    // firing while the model is still actively streaming data.
    if (cbs) this.resetCompletionTimeout(tabId, cbs)

    log.info(`appendChunk -> webview tab=${tabId} len=${text.length} messageId=${messageId || "none"} preview=${JSON.stringify(text.slice(0, 60))}`)
    if (cbs) {
      const existing = this.chunkBuffers.get(tabId) || ""
      this.chunkBuffers.set(tabId, existing + text)
      if (!this.chunkFlushTimers.has(tabId)) {
        const timer = setTimeout(() => {
          this.flushChunkBuffer(tabId, cbs)
        }, this.CHUNK_BATCH_MS)
        this.chunkFlushTimers.set(tabId, timer)
      }
    }
  }

  appendToolStart(tabId: string, toolCall: { id?: string; name: string; class?: string; args?: unknown; state?: string }, callbacks: StreamCallbacks): void {
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first tool call received for tab ${tabId}`)
    }

    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    if (tab.isStreaming) {
      if (!tab.waitingForCompletion) return
      this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId })
    }

    this.resetCompletionTimeout(tabId, callbacks)

    const stableId = toolCall.id || this.getStableToolId(tabId)
    const pending = this.getOrCreatePendingToolIds(tabId)
    const existingBlock = tab.blocksBuffer.find(b => b.type === "tool-call" && b.id === stableId)
    if (pending.has(stableId) || existingBlock) {
      log.info(`appendToolStart: duplicate start for ${stableId} on ${tabId}; updating existing tool call`)
      this.trackToolActivity(tabId, stableId)
      callbacks.postMessage({
        type: "stream_tool_update",
        sessionId: tabId,
        toolCall: { ...toolCall, id: stableId },
      })
      if (existingBlock) {
        if (toolCall.args !== undefined) existingBlock.args = toolCall.args
        if (toolCall.class) existingBlock.class = toolCall.class as any
        if (toolCall.name) existingBlock.name = toolCall.name
      }
      return
    }

    pending.add(stableId)
    this.trackToolActivity(tabId, stableId)
    callbacks.postMessage({
      type: "stream_tool_start",
      sessionId: tabId,
      toolCall: { ...toolCall, id: stableId },
    })

    // Persist tool block
    tab.blocksBuffer.push({
      type: "tool-call",
      id: stableId,
      name: toolCall.name,
      class: (toolCall.class as any) || this.toolClass(toolCall.name),
      state: toolCall.state === "pending" ? "pending" : "running",
      args: toolCall.args,
    })
  }

  appendSkill(tabId: string, skillName: string, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    // Skills are indicators that something is happening.
    // They are rendered as badges in the stream.
    tab.blocksBuffer.push({ type: "skill_badge", skillName })

    callbacks.postMessage({
      type: "skill_indicator",
      sessionId: tabId,
      skillName,
    })
  }

  appendToolUpdate(tabId: string, toolCall: { id?: string; name: string; class?: string; args?: unknown; state?: string }, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    this.resetCompletionTimeout(tabId, callbacks)

    const toolId = toolCall.id || this.getLastPendingToolId(tabId)
    if (!toolId) return

    this.trackToolActivity(tabId, toolId)
    callbacks.postMessage({
      type: "stream_tool_update",
      sessionId: tabId,
      toolCall: { ...toolCall, id: toolId },
    })

    // Update persisted tool block
    const block = tab.blocksBuffer.find(b => b.type === "tool-call" && b.id === toolId)
    if (block) {
      if (toolCall.args) block.args = toolCall.args
      if (toolCall.class) block.class = toolCall.class as any
      if (toolCall.state === "pending" || toolCall.state === "running") block.state = toolCall.state
    }
  }

  private getStableToolId(tabId: string): string {
    const count = (this.toolCallCounts.get(tabId) || 0) + 1
    this.toolCallCounts.set(tabId, count)
    return `tool-${count}`
  }

  appendToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    this.resetCompletionTimeout(tabId, callbacks)
    this.postToolEnd(tabId, result, callbacks)
  }

  getDiffHandler(): DiffHandler {
    return this.diffHandler
  }

  private cleanupTab(tabId: string): void {
    this.clearTtfbTimeout(tabId)
    this.tabManager.setStreaming(tabId, false)
    this.tabManager.setWaitingForCompletion(tabId, false)
    this.tabManager.clearCompletionTimeout(tabId)
    this.tabManager.clearBuffer(tabId)
    this.stuckStreamHandlers.delete(tabId)
    this.toolCallCounts.delete(tabId)
    this.activeToolCallIds.delete(tabId)
    this.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)
    this.activeMessageIds.delete(tabId)
    this.stopHeartbeat(tabId)
    this.clearHardWatchdog(tabId)
    const cbs = this.stuckStreamHandlers.get(tabId)
    if (cbs) this.flushChunkBuffer(tabId, cbs)
    this.chunkBuffers.delete(tabId)
    const flushTimer = this.chunkFlushTimers.get(tabId)
    if (flushTimer) {
      clearTimeout(flushTimer)
      this.chunkFlushTimers.delete(tabId)
    }
  }

  private refreshContextTokenEstimate(): void {
    void this.contextEngine.gatherContext()
      .then(ctxPkg => this.contextMonitor.updateTokens(estimateContextTokens(ctxPkg)))
      .catch(err => log.warn("Failed to refresh context token estimate", err))
  }

  private partsToBlocks(parts: readonly unknown[]): Block[] {
    const blocks: Block[] = []
    for (const part of parts) {
      if (!this.isRecord(part)) continue
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        blocks.push({ type: "text", text: part.text })
        continue
      }
      if (part.type === "tool") {
        const state = this.isRecord(part.state) ? part.state : {}
        const status = typeof state.status === "string" ? state.status : "running"
        const result = typeof state.output === "string" ? state.output : undefined
        const error = typeof state.error === "string" ? state.error : undefined

        const toolCount = blocks.filter(b => b.type === "tool-call").length + 1
        blocks.push({
          type: "tool-call",
          id: typeof part.id === "string" ? part.id : `tool-${toolCount}`,
          name: typeof part.tool === "string" ? part.tool : "tool",
          class: this.toolClass(typeof part.tool === "string" ? part.tool : ""),
          state: status === "completed" || status === "error" ? "result" : status,
          args: state.input,
          result,
          error,
        })
        continue
      }
      if (part.type === "skill" || part.type === "skill_badge") {
        const skillName = typeof (part as any).skillName === "string" ? (part as any).skillName : (typeof (part as any).skill === "string" ? (part as any).skill : "skill")
        blocks.push({ type: "skill_badge", skillName })
        continue
      }
    }
    return blocks
  }

  private toolClass(toolName: string): "read" | "write" | "exec" | "meta" {
    const lower = toolName.toLowerCase()
    if (lower.includes("edit") || lower.includes("write") || lower.includes("patch")) return "write"
    if (lower.includes("bash") || lower.includes("shell") || lower.includes("exec")) return "exec"
    if (lower.includes("task") || lower.includes("todo")) return "meta"
    return "read"
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
  }

  /**
   * Strip context wrapper from response text.
   * The AI may echo back the context block, which we don't want to display.
   * Uses non-greedy matching to avoid over-stripping valid content.
   */
  private stripContextWrapper(text: string): string {
    // Only remove complete <context>...</context> blocks (non-greedy match)
    // This avoids stripping valid content that might contain angle brackets
    const contextRegex = /<context>[\s\S]*?<\/context>/gi
    let cleaned = text.replace(contextRegex, "").trim()

    // Log warning if partial context tags remain (unexpected AI behavior)
    if (cleaned.includes("<context>") || cleaned.includes("</context>")) {
      log.warn("Response contains partial context tags - this is unexpected")
    }

    return cleaned
  }

  dispose(): void {
    if (this.streamWatchdog) {
      clearInterval(this.streamWatchdog)
      this.streamWatchdog = null
    }
    this.stuckStreamHandlers.clear()
    for (const timer of this.ttfbTimeouts.values()) {
      clearTimeout(timer)
    }
    this.ttfbTimeouts.clear()
    for (const timer of this.hardStreamTimers.values()) {
      clearTimeout(timer)
    }
    this.hardStreamTimers.clear()
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer)
    }
    this.heartbeatTimers.clear()
    for (const timer of this.chunkFlushTimers.values()) {
      clearTimeout(timer)
    }
    this.chunkFlushTimers.clear()
    this.chunkBuffers.clear()
    this.diffHandler.dispose()
  }
}
