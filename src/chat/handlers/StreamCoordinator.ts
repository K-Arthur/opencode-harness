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
  postRequestError: (message: string) => void
}

interface ContextShape {
  openFiles: Array<{ path: string; language: string }>
  gitStatus: { branch: string; modified: string[]; staged: string[] }
  workspaceTree: Array<{ name: string; type: string }>
  projectConfigs: Array<{ type: string; path: string }>
  diagnostics: unknown
}

export class StreamCoordinator {
  private diffHandler: DiffHandler
  private readonly diffApplier: DiffApplier
  private readonly STREAM_STUCK_MS = 120000 // 2 minutes - watchdog for stuck streams
  private streamWatchdog: ReturnType<typeof setInterval> | null = null
  private stuckStreamHandlers: Map<string, StreamCallbacks> = new Map()

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
              void this.finalizeStream(tab.id, callbacks)
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
        return
      }
    }

    // Reserve the streaming slot ATOMICALLY before any `await`
    // This was fixed in the hardening milestone — prevents race conditions
    const canStream = this.tabManager.canStartStreaming()
    if (!canStream.ok) {
      log.warn(`Concurrent stream limit reached: ${canStream.reason}`)
      vscode.window.showWarningMessage(canStream.reason!)
      this.stuckStreamHandlers.delete(tabId)
      return
    }

    // Now set streaming state AFTER atomic reservation
    this.tabManager.setStreaming(tabId, true)

    try {
      const ctxPkg = await this.contextEngine.gatherContext()
      this.contextMonitor.updateTokens(estimateContextTokens(ctxPkg))

      const cliSessionId = await this.sessionManager.ensureSession(tab.cliSessionId, `Tab ${tabId.slice(0, 8)}`)
      this.tabManager.setCliSessionId(tabId, cliSessionId)
      this.sessionStore.updateCliSessionId(tabId, cliSessionId)

      const contextText = this.buildContextText(ctxPkg as unknown as ContextShape)

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

      // Timeout fallback
      const timeout = setTimeout(() => {
        const t = this.tabManager.getTab(tabId)
        if (t?.waitingForCompletion) {
          log.warn(`Message completion timeout for tab ${tabId}`)
          void this.finalizeStream(tabId, callbacks)
        }
      }, 60000)
      this.tabManager.setCompletionTimeout(tabId, timeout)

      const modelRef = tab.model ? parseModelRef(tab.model) : undefined

      await this.sessionManager.sendPromptAsync(cliSessionId, [
        { type: "text", text: contextText },
        { type: "text", text },
      ], modelRef)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Prompt failed", e)
      vscode.window.showErrorMessage(`OpenCode request failed: ${message}`)
      callbacks.postRequestError(message)
      this.cleanupTab(tabId)
    }
  }

  async finalizeStream(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.waitingForCompletion) return

    // Clear stored callbacks for watchdog
    this.stuckStreamHandlers.delete(tabId)

    this.tabManager.clearCompletionTimeout(tabId)
    this.tabManager.setWaitingForCompletion(tabId, false)

    const blocks: Block[] = []
    if (tab.streamingBuffer) {
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

  appendChunk(tabId: string, text: string, callbacks: StreamCallbacks): void {
    this.tabManager.appendToBuffer(tabId, text)
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    callbacks.postMessage({
      type: "stream_chunk",
      sessionId: tabId,
      text,
    })
  }

  getDiffHandler(): DiffHandler {
    return this.diffHandler
  }

  private cleanupTab(tabId: string): void {
    this.tabManager.setStreaming(tabId, false)
    this.tabManager.setWaitingForCompletion(tabId, false)
    this.tabManager.clearCompletionTimeout(tabId)
    this.tabManager.clearBuffer(tabId)
    this.stuckStreamHandlers.delete(tabId)
  }

  private buildContextText(ctxPkg: ContextShape): string {
    const openFiles = ctxPkg.openFiles?.map((f: { path: string; language: string }) => `${f.path} (${f.language})`).join(", ") || "none"
    const gitStatus = `branch: ${ctxPkg.gitStatus?.branch || "unknown"}, modified: ${(ctxPkg.gitStatus?.modified || []).length}, staged: ${(ctxPkg.gitStatus?.staged || []).length}`

    const tree = (ctxPkg.workspaceTree || [])
      .map((t: { name: string; type: string }) => `${t.type === "directory" ? "/" : ""}${t.name}`)
      .slice(0, 50)
      .join(", ")

    const configs = (ctxPkg.projectConfigs || [])
      .map((c: { type: string; path: string }) => `${c.type} at ${c.path}`)
      .join(", ")

    return `<context>
Open files: ${openFiles}
Git status: ${gitStatus}
Workspace structure: ${tree}${ctxPkg.workspaceTree?.length > 50 ? " (truncated)" : ""}
Project configs: ${configs || "none"}
Diagnostics: ${Array.isArray(ctxPkg.diagnostics) ? ctxPkg.diagnostics.length : 0} files with errors or warnings
</context>`
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
    this.diffHandler.dispose()
  }
}
