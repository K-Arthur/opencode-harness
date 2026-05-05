import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { TabManager } from "./TabManager"
import { log } from "../utils/outputChannel"

export interface CompactorCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (msg: string) => void
}

export class AutoCompactor {
  private snoozeUntil = 0
  private snoozeTokens = 0

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionStore: SessionStore,
    private readonly contextMonitor: ContextMonitor,
    private readonly tabManager: TabManager,
  ) {}

  tryCompactIfNeeded(callbacks: CompactorCallbacks): void {
    if (!this.sessionManager.isRunning) return
    const activeTab = this.tabManager.getActiveTab()
    if (!activeTab || activeTab.isStreaming) return
    if (!activeTab.cliSessionId) return

    const session = this.sessionStore.get(activeTab.id)
    if (!session || session.messages.length < 10) return

    const autoCompact = this.contextMonitor.getAutoCompactSetting()
    if (autoCompact === "off") return

    const now = Date.now()
    if (now < this.snoozeUntil) return
    const currentTokens = this.contextMonitor["currentTokens"] || 0
    if (currentTokens > 0 && currentTokens < this.snoozeTokens + (this.snoozeTokens * 0.05)) return

    const doCompact = () => {
      log.info(`Auto-compacting session ${activeTab.id} (context >= 80%, ${session.messages.length} messages)`)
      callbacks.postMessage({ type: "compaction_started", sessionId: activeTab.id })
      void this.sessionManager.compactSession(activeTab.cliSessionId!).then(() => {
        log.info(`Auto-compaction completed for session ${activeTab.id}`)
        callbacks.postMessage({
          type: "message",
          sessionId: activeTab.id,
          message: {
            role: "system",
            blocks: [{ type: "task_banner", status: "success", text: "Session auto-compacted (context was >= 80%)" }],
            timestamp: Date.now(),
            sessionId: activeTab.id,
          },
        })
        callbacks.postMessage({ type: "session_compacted", sessionId: activeTab.id })
      }).catch((err) => {
        log.warn("Auto-compaction failed", err)
        callbacks.postRequestError("Auto-compaction failed")
      })
    }

    if (autoCompact === "auto") {
      doCompact()
    } else {
      const usage = this.contextMonitor["currentTokens"] || 0
      const limit = this.contextMonitor["tokenLimit"] || 100000
      const pct = Math.round((usage / limit) * 100)
      callbacks.postMessage({
        type: "compact_banner",
        sessionId: activeTab.id,
        percent: pct,
        tokens: usage,
        maxTokens: limit,
        actions: ["compact_now", "remind_later"],
      })
    }
  }

  handleBannerAction(sessionId: string | undefined, action: string, callbacks: CompactorCallbacks): void {
    if (!sessionId) return
    if (action === "compact_now") {
      this.compactNow(sessionId, callbacks)
      this.snoozeUntil = 0
    } else if (action === "remind_later") {
      this.snoozeUntil = Date.now() + 10 * 60 * 1000
      const currentTokens = (this.contextMonitor as any)["currentTokens"] || 0
      this.snoozeTokens = currentTokens
      callbacks.postMessage({ type: "compact_banner_dismissed", sessionId })
    }
  }

  async compactNow(sessionId: string, callbacks: CompactorCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(sessionId)
    if (!tab?.cliSessionId || !this.sessionManager.isRunning) {
      callbacks.postRequestError("Cannot compact: server not running or session not linked")
      return
    }

    try {
      callbacks.postMessage({ type: "compaction_started", sessionId })
      await this.sessionManager.compactSession(tab.cliSessionId)
      log.info(`Session compacted: ${sessionId} (cli: ${tab.cliSessionId})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Compaction failed"
      log.error("Compaction failed", err)
      callbacks.postRequestError(message)
    }
  }
}
