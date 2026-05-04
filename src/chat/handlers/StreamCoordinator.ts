import * as vscode from "vscode"
import { DiffApplier } from "../../diff/DiffApplier"
import { DiffHandler } from "./DiffHandler"
import { TabManager } from "../TabManager"
import { SessionManager } from "../../session/SessionManager"
import { SessionStore } from "../../session/SessionStore"
import { ContextEngine } from "../../context/ContextEngine"
import { ContextMonitor } from "../../monitor/ContextMonitor"
import { estimateContextTokens } from "../../utils/tokenCounter"
import { ModelManager } from "../../model/ModelManager"
import { log } from "../../utils/outputChannel"
import type { Block, ChatMessage } from "../ChatProvider"

export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string) => void
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

    // Start watchdog to check for stuck streams every 30 seconds
    this.streamWatchdog = setInterval(() => {
      const allTabs = this.tabManager.getAllTabs()
      for (const tab of allTabs) {
        if (tab.isStreaming && tab.lastActivityTime) {
          const stuckMs = Date.now() - tab.lastActivityTime
          if (stuckMs > this.STREAM_STUCK_MS) {
            log.warn(`Watchdog: Stream for tab ${tab.id} stuck for ${Math.round(stuckMs / 1000)}s, finalizing`)
            const callbacks = this.stuckStreamHandlers.get(tab.id)
            if (callbacks) {
              void this.finalizeStream(tab.id, callbacks)
            } else {
              // No callbacks stored - just reset the streaming state
              log.warn(`No callbacks for stuck tab ${tab.id}, resetting state`)
              this.tabManager.setStreaming(tab.id, false)
              this.tabManager.setWaitingForCompletion(tab.id, false)
            }
          }
        }
      }
    }, 30000)
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

    // Check concurrent limit
    const canStream = this.tabManager.canStartStreaming()
    if (!canStream.ok) {
      log.warn(`Concurrent stream limit reached: ${canStream.reason}`)
      vscode.window.showWarningMessage(canStream.reason!)
      return
    }

    try {
      const ctxPkg = await this.contextEngine.gatherContext()
      this.contextMonitor.updateTokens(estimateContextTokens(ctxPkg))

      const cliSessionId = await this.sessionManager.ensureSession(tab.cliSessionId, `Tab ${tabId.slice(0, 8)}`)
      this.tabManager.setCliSessionId(tabId, cliSessionId)
      this.sessionStore.updateCliSessionId(tabId, cliSessionId)

      const contextText = this.buildContextText(ctxPkg)

      // NOTE: User message is already rendered and stored by the webview.
      // Persisting here caused duplicate rendering (garbled/flash effect).

      callbacks.postMessage({
        type: "stream_start",
        sessionId: tabId,
        messageId: `resp-${cliSessionId}`,
      })

      this.tabManager.setStreaming(tabId, true)
      this.tabManager.setWaitingForCompletion(tabId, true)
      this.tabManager.clearBuffer(tabId)

      // Timeout fallback
      const timeout = setTimeout(() => {
        const t = this.tabManager.getTab(tabId)
        if (t?.waitingForCompletion) {
          log.warn(`Message completion timeout for tab ${tabId}`)
          void this.finalizeStream(tabId, callbacks)
        }
      }, 60000)
      this.tabManager.setCompletionTimeout(tabId, timeout)

      const modelRef = tab.model ? this.parseModelRef(tab.model) : undefined

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

        const edits = this.diffApplier.parseCodeBlocks([{ type: "text", text: cleanedText }])
        for (const edit of edits) {
          edit.messageId = `resp-${tab.cliSessionId}`
          try {
            const diffText = await this.diffApplier.generateDiff(edit.filePath, edit.proposedContent)
            this.diffHandler.register(edit.blockId, edit)
            blocks.push({
              type: "diff_block",
              id: edit.blockId,
              filePath: edit.filePath,
              diffText,
              messageId: edit.messageId,
            })
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e)
            log.warn(`Failed to generate diff for ${edit.filePath}: ${err}`)
            blocks.push({
              type: "task_banner",
              status: "warning",
              text: `Could not generate diff for ${edit.filePath}: ${err}`,
            })
          }
        }
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
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.warn("Abort failed", e)
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
  }

  private buildContextText(ctxPkg: any): string {
    const openFiles = ctxPkg.openFiles.map((f: { path: string; language: string }) => `${f.path} (${f.language})`).join(", ") || "none"
    const gitStatus = `branch: ${ctxPkg.gitStatus.branch}, modified: ${ctxPkg.gitStatus.modified.length}, staged: ${ctxPkg.gitStatus.staged.length}`
    
    const tree = ctxPkg.workspaceTree
      .map((t: { name: string; type: string }) => `${t.type === "directory" ? "/" : ""}${t.name}`)
      .slice(0, 50)
      .join(", ")

    const configs = ctxPkg.projectConfigs
      .map((c: { type: string; path: string }) => `${c.type} at ${c.path}`)
      .join(", ")

    return `<context>
Open files: ${openFiles}
Git status: ${gitStatus}
Workspace structure: ${tree}${ctxPkg.workspaceTree.length > 50 ? " (truncated)" : ""}
Project configs: ${configs || "none"}
Diagnostics: ${Array.isArray(ctxPkg.diagnostics) ? ctxPkg.diagnostics.length : 0} files with errors or warnings
</context>`
  }

  private parseModelRef(model: string) {
    const slashIdx = model.indexOf("/")
    if (slashIdx === -1) return { providerID: "", modelID: model }
    return {
      providerID: model.substring(0, slashIdx),
      modelID: model.substring(slashIdx + 1),
    }
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
  }
}
