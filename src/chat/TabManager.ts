import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export interface TabState {
  id: string
  cliSessionId?: string
  streamingBuffer: string
  waitingForCompletion: boolean
  completionTimeout: ReturnType<typeof setTimeout> | null
  isStreaming: boolean
  model: string
  mode: string
  lastActivityTime: number  // Timestamp of last activity for watchdog
}

export class TabManager {
  private tabs = new Map<string, TabState>()
  private activeTabId = ""
  private readonly MAX_CONCURRENT_STREAMS = 3
  private readonly MAX_TABS = 20

  private _onTabCreated = new vscode.EventEmitter<string>()
  private _onTabClosed = new vscode.EventEmitter<string>()
  private _onTabSwitched = new vscode.EventEmitter<string>()
  private _onStreamingStateChanged = new vscode.EventEmitter<{ tabId: string; isStreaming: boolean }>()

  readonly onTabCreated = this._onTabCreated.event
  readonly onTabClosed = this._onTabClosed.event
  readonly onTabSwitched = this._onTabSwitched.event
  readonly onStreamingStateChanged = this._onStreamingStateChanged.event

  createTab(id: string, cliSessionId?: string, model?: string, mode?: string): TabState | null {
    if (this.tabs.size >= this.MAX_TABS) {
      log.warn(`Tab creation blocked: max ${this.MAX_TABS} tabs reached`)
      return null
    }
    const tab: TabState = {
      id,
      cliSessionId,
      streamingBuffer: "",
      waitingForCompletion: false,
      completionTimeout: null,
      isStreaming: false,
      model: model || "",
      mode: mode || "normal",
      lastActivityTime: Date.now(),
    }
    this.tabs.set(id, tab)
    this.activeTabId = id
    this._onTabCreated.fire(id)
    log.info(`Tab created: ${id} (session: ${cliSessionId || "pending"})`)
    return tab
  }

  closeTab(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false

    // Abort any active streaming
    if (tab.isStreaming) {
      this.setStreaming(id, false)
    }

    if (tab.completionTimeout) {
      clearTimeout(tab.completionTimeout)
      tab.completionTimeout = null
    }

    this.tabs.delete(id)
    this._onTabClosed.fire(id)
    log.info(`Tab closed: ${id}`)

    // If active tab was closed, switch to another
    if (this.activeTabId === id) {
      const remaining = Array.from(this.tabs.keys())
      this.activeTabId = remaining.length > 0 ? remaining[0] ?? "" : ""
      if (this.activeTabId) {
        this._onTabSwitched.fire(this.activeTabId)
      }
    }

    return true
  }

  switchTab(id: string): boolean {
    if (!this.tabs.has(id)) return false
    this.activeTabId = id
    this._onTabSwitched.fire(id)
    return true
  }

  getTab(id: string): TabState | undefined {
    return this.tabs.get(id)
  }

  getActiveTab(): TabState | undefined {
    return this.tabs.get(this.activeTabId)
  }

  getActiveId(): string {
    return this.activeTabId
  }

  getAllTabs(): TabState[] {
    return Array.from(this.tabs.values())
  }

  getTabCount(): number {
    return this.tabs.size
  }

  getStreamingCount(): number {
    return Array.from(this.tabs.values()).filter((t) => t.isStreaming).length
  }

  canStartStreaming(): { ok: boolean; reason?: string } {
    const streamingTabs = Array.from(this.tabs.values()).filter((t) => t.isStreaming)
    if (streamingTabs.length >= this.MAX_CONCURRENT_STREAMS) {
      const names = streamingTabs.map((t) => `"${t.id}"`).join(", ")
      return {
        ok: false,
        reason: `Maximum ${this.MAX_CONCURRENT_STREAMS} concurrent streams reached. Currently streaming: ${names}`,
      }
    }
    return { ok: true }
  }

  setStreaming(id: string, isStreaming: boolean): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    if (isStreaming && !tab.isStreaming) {
      const streamingCount = this.getStreamingCount()
      if (streamingCount >= this.MAX_CONCURRENT_STREAMS) {
        const names = Array.from(this.tabs.values()).filter((t) => t.isStreaming).map((t) => `"${t.id}"`).join(", ")
        log.warn(`Cannot set streaming — limit ${this.MAX_CONCURRENT_STREAMS} reached. Currently streaming: ${names}`)
        return false
      }
    }
    tab.isStreaming = isStreaming
    tab.lastActivityTime = Date.now()
    this._onStreamingStateChanged.fire({ tabId: id, isStreaming })
    return true
  }

  setModel(id: string, model: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.model = model
    return true
  }

  setMode(id: string, mode: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.mode = mode
    return true
  }

  setCliSessionId(id: string, cliSessionId: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.cliSessionId = cliSessionId
    return true
  }

  setWaitingForCompletion(id: string, waiting: boolean): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.waitingForCompletion = waiting
    return true
  }

  setCompletionTimeout(id: string, timeout: ReturnType<typeof setTimeout>): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    if (tab.completionTimeout) clearTimeout(tab.completionTimeout)
    tab.completionTimeout = timeout
    return true
  }

  clearCompletionTimeout(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    if (tab.completionTimeout) {
      clearTimeout(tab.completionTimeout)
      tab.completionTimeout = null
    }
    return true
  }

  appendToBuffer(id: string, text: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.streamingBuffer += text
    tab.lastActivityTime = Date.now()
    return true
  }

  clearBuffer(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.streamingBuffer = ""
    return true
  }

  dispose(): void {
    for (const tab of this.tabs.values()) {
      if (tab.completionTimeout) {
        clearTimeout(tab.completionTimeout)
      }
    }
    this.tabs.clear()
    this._onTabCreated.dispose()
    this._onTabClosed.dispose()
    this._onTabSwitched.dispose()
    this._onStreamingStateChanged.dispose()
  }
}
