import * as vscode from "vscode"
import { DiffApplier, type ProposedEdit } from "../../diff/DiffApplier"
import { DiffHandler } from "./DiffHandler"
import { TabManager } from "../TabManager"
import { SessionManager } from "../../session/SessionManager"
import { SessionStore } from "../../session/SessionStore"
import { ContextEngine } from "../../context/ContextEngine"
import { ContextMonitor } from "../../monitor/ContextMonitor"
import { estimateContextTokens, parseModelRef } from "../../utils/tokenCounter"
import { ModelManager } from "../../model/ModelManager"
import { log } from "../../utils/outputChannel"
import type { Block, ChatMessage } from "../types"
import type { DiffHunk } from "../webview/types"

export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
}

/** Explicit lifecycle states for a streaming session */
export type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout"

export class StreamCoordinator {
  private diffHandler: DiffHandler
  private readonly diffApplier: DiffApplier
  /** Watchdog interval for stuck streams (no activity for 2 minutes) */
  private readonly STREAM_STUCK_MS = 120000
  /** Time-to-first-byte timeout: no chunk received within 30s */
  readonly TTFB_TIMEOUT_MS = 30000
  /** Inter-chunk inactivity timeout: no chunk for 60s after first byte */
  readonly CHUNK_INACTIVITY_TIMEOUT_MS = 60000
  private streamWatchdog: ReturnType<typeof setInterval> | null = null
  private stuckStreamHandlers: Map<string, StreamCallbacks> = new Map()
  private ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** Tabs currently in the process of finalizing — guards against double-finalize */
  private finalizingTabs = new Set<string>()
  /** Per-tab stream lifecycle state for observability */
  private streamStates = new Map<string, StreamLifecycleState>()
  /** Per-tab active message ID — detects when the server starts a new assistant message mid-stream */
  private activeMessageIds = new Map<string, string>()

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionStore: SessionStore,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor,
    private readonly modelManager: ModelManager,
    private readonly tabManager: TabManager,
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
    }, 30000)
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

  /**
   * Reset the completion timeout for a tab — clears the existing timeout and
   * sets a fresh 60s timer. Used on each chunk to keep the timeout from firing
   * while the model is still responding.
   */
  private resetCompletionTimeout(tabId: string, callbacks: StreamCallbacks): void {
    this.tabManager.clearCompletionTimeout(tabId)
    const timeout = setTimeout(() => {
      const t = this.tabManager.getTab(tabId)
      if (t?.waitingForCompletion) {
        log.warn(`Message completion timeout for tab ${tabId}`)
        // Emit stream_end with reason: timeout and partial: true so the webview
        // can show a recoverable state (user can retry without losing partial output)
        const partialText = t.streamingBuffer || ""
        const blocks: Block[] = partialText.trim()
          ? [{ type: "text", text: this.stripContextWrapper(partialText) }]
          : []
        callbacks.postMessage({
          type: "stream_end",
          sessionId: tabId,
          messageId: `resp-${t.cliSessionId}`,
          blocks,
          reason: "timeout",
          partial: true,
        })
        this.tabManager.setStreaming(tabId, false)
        this.tabManager.clearBuffer(tabId)
        this.stuckStreamHandlers.delete(tabId)
        this.clearTtfbTimeout(tabId)
      }
    }, 60000)
    this.tabManager.setCompletionTimeout(tabId, timeout)
  }

  async startPrompt(tabId: string, text: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) {
      callbacks.postRequestError("Tab not found")
      return
    }

    // Store callbacks for watchdog
    this.stuckStreamHandlers.set(tabId, callbacks)

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
      }, 60000)
      this.tabManager.setCompletionTimeout(tabId, timeout)

      const modelRef = tab.model ? parseModelRef(tab.model) : undefined

      await this.sessionManager.sendPromptAsync(cliSessionId, [{ type: "text", text }], modelRef)
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
          }
        }
      } catch (err) {
        log.warn(`Failed to fetch final session for ${tabId}, falling back to buffer`, err)
      }

      // Fallback if session fetch fails or returned empty blocks
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
      this.setStreamState(tabId, "idle", { sessionId: tab.cliSessionId })
    } finally {
      this.finalizingTabs.delete(tabId)
    }
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

  appendChunk(tabId: string, text: string, callbacks?: StreamCallbacks, messageId?: string): void {
    // Clear TTFB timeout on first chunk — the model has started responding
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first chunk received for tab ${tabId}`)
    }

    this.tabManager.appendToBuffer(tabId, text)

    // Detect new assistant message — the server may emit multiple messages
    // per prompt (e.g. thinking + response). Switch to a new stream bubble
    // when the messageId changes instead of silently dropping chunks.
    const cbs = callbacks || this.stuckStreamHandlers.get(tabId)
    if (messageId) {
      const prevId = this.activeMessageIds.get(tabId)
      if (prevId && prevId !== messageId && cbs) {
        log.info(`appendChunk: messageId changed for tab ${tabId}: ${prevId} → ${messageId}. Closing previous stream and starting new one.`)
        cbs.postMessage({
          type: "stream_end",
          sessionId: tabId,
          messageId: `resp-${prevId}`,
          blocks: [],
          reason: "message_transition",
        })
        cbs.postMessage({
          type: "stream_start",
          sessionId: tabId,
          messageId: `resp-${messageId}`,
        })
      }
      this.activeMessageIds.set(tabId, messageId)
    }

    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    if (tab.isStreaming) {
      this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId })
    }

    // Reset the completion timeout on each chunk to prevent the timeout from
    // firing while the model is still actively streaming data.
    if (cbs) this.resetCompletionTimeout(tabId, cbs)

    log.info(`appendChunk -> webview tab=${tabId} len=${text.length} messageId=${messageId || "none"} preview=${JSON.stringify(text.slice(0, 60))}`)
    if (cbs) {
      cbs.postMessage({
        type: "stream_chunk",
        sessionId: tabId,
        text,
      })
    }
  }

  appendToolStart(tabId: string, toolCall: { id: string; name: string; class?: string; args?: unknown }, callbacks: StreamCallbacks): void {
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

    callbacks.postMessage({
      type: "stream_tool_start",
      sessionId: tabId,
      toolCall,
    })
  }

  appendToolEnd(tabId: string, result: { id: string; ok: boolean; result?: string; durationMs?: number }, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    this.resetCompletionTimeout(tabId, callbacks)

    callbacks.postMessage({
      type: "stream_tool_end",
      sessionId: tabId,
      result,
    })
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
        blocks.push({
          type: "tool-call",
          id: typeof part.id === "string" ? part.id : `tool-${blocks.length + 1}`,
          name: typeof part.tool === "string" ? part.tool : "tool",
          class: this.toolClass(typeof part.tool === "string" ? part.tool : ""),
          state: status === "completed" || status === "error" ? "result" : status,
          args: state.input,
          result,
          error,
        })
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
    // Clear all TTFB timeouts
    for (const timer of this.ttfbTimeouts.values()) {
      clearTimeout(timer)
    }
    this.ttfbTimeouts.clear()
    this.diffHandler.dispose()
  }
}
