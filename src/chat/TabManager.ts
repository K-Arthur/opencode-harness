import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { Block } from "./types"
import type { TabRestorationState } from "../session/sessionTypes"

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
  blocksBuffer: Block[]
  instructions?: string
}

const OPEN_TABS_STORAGE_KEY = "opencode-harness.openTabs"
const ACTIVE_TAB_STORAGE_KEY = "opencode-harness.activeTab"
const RESTORATION_STATE_KEY = "opencode-harness.tabRestoration"

export class TabManager {
  private tabs = new Map<string, TabState>()
  private cliSessionIndex = new Map<string, TabState>()
  private activeTabId = ""
  private maxConcurrentStreams: number
  private readonly MAX_TABS = 20

  private restorationStates = new Map<string, TabRestorationState>()

  private _onTabCreated = new vscode.EventEmitter<string>()
  private _onTabClosed = new vscode.EventEmitter<string>()
  private _onTabSwitched = new vscode.EventEmitter<string>()
  private _onStreamingStateChanged = new vscode.EventEmitter<{ tabId: string; isStreaming: boolean }>()
  private _onInstructionsChanged = new vscode.EventEmitter<{ tabId: string; instructions: string }>()
  private _onModeChanged = new vscode.EventEmitter<{ tabId: string; mode: string }>()
  private _onCliSessionIdRegistered = new vscode.EventEmitter<{ tabId: string; cliSessionId: string }>()

  readonly onTabCreated = this._onTabCreated.event
  readonly onTabClosed = this._onTabClosed.event
  readonly onTabSwitched = this._onTabSwitched.event
  readonly onStreamingStateChanged = this._onStreamingStateChanged.event
  readonly onInstructionsChanged = this._onInstructionsChanged.event
  readonly onModeChanged = this._onModeChanged.event
  readonly onCliSessionIdRegistered = this._onCliSessionIdRegistered.event

  /**
   * Tab IDs persisted from the previous session, in order. Populated by the
   * constructor and frozen at that moment — adding/closing tabs at runtime
   * mutates the underlying storage but does NOT change this list, so callers
   * can use it to "restore exactly what was open".
   */
  private readonly restoredTabIds: readonly string[]
  private readonly restoredActiveId: string

  constructor(private readonly storage?: vscode.Memento) {
    const saved = storage?.get<string[]>(OPEN_TABS_STORAGE_KEY, []) ?? []
    this.restoredTabIds = Object.freeze(saved.filter((id) => typeof id === "string" && id.length > 0).slice(0, this.MAX_TABS))
    this.restoredActiveId = storage?.get<string>(ACTIVE_TAB_STORAGE_KEY, "") ?? ""

    const config = vscode.workspace.getConfiguration("opencode")
    this.maxConcurrentStreams = config.get<number>("sessions.maxConcurrentStreams", 5)

    const raw = storage?.get<Record<string, TabRestorationState>>(RESTORATION_STATE_KEY, {}) ?? {}
    for (const [tabId, state] of Object.entries(raw)) {
      if (tabId && state && typeof state.interruptedAt === "number") {
        this.restorationStates.set(tabId, state)
      }
    }
  }

  /** Tab IDs that were open the last time the extension ran. Read-only snapshot. */
  getRestoredTabIds(): readonly string[] {
    return this.restoredTabIds
  }

  /** Active tab ID at the time the extension last shut down. */
  getRestoredActiveId(): string {
    return this.restoredActiveId
  }

  private persist(): void {
    if (!this.storage) return
    void this.storage.update(OPEN_TABS_STORAGE_KEY, Array.from(this.tabs.keys()))
    void this.storage.update(ACTIVE_TAB_STORAGE_KEY, this.activeTabId)
  }

  private persistRestorationState(): void {
    if (!this.storage) return
    const obj: Record<string, TabRestorationState> = {}
    for (const [tabId, state] of this.restorationStates) {
      obj[tabId] = state
    }
    void this.storage.update(RESTORATION_STATE_KEY, obj)
  }

  captureStreamingSnapshot(): void {
    this.restorationStates.clear()
    const now = Date.now()
    for (const tab of this.tabs.values()) {
      if (tab.isStreaming) {
        this.restorationStates.set(tab.id, {
          tabId: tab.id,
          cliSessionId: tab.cliSessionId,
          wasStreaming: true,
          interruptedAt: now,
        })
      }
    }
    this.persistRestorationState()
    if (this.restorationStates.size > 0) {
      log.info(`Captured streaming snapshot for ${this.restorationStates.size} tab(s)`)
    }
  }

  getInterruptedTabs(): TabRestorationState[] {
    return Array.from(this.restorationStates.values()).filter(s => s.wasStreaming)
  }

  clearRestorationState(tabId: string): void {
    this.restorationStates.delete(tabId)
    this.persistRestorationState()
  }

  clearAllRestorationStates(): void {
    this.restorationStates.clear()
    this.persistRestorationState()
  }


  createTab(id: string, cliSessionId?: string, model?: string, mode?: string, options?: { setActive?: boolean }): TabState | null {
    if (this.tabs.has(id)) {
      log.warn(`Tab with ID ${id} already exists — returning existing tab`)
      return this.tabs.get(id)!
    }
    if (cliSessionId && this.cliSessionIndex.has(cliSessionId)) {
      log.warn(`Tab for CLI session ${cliSessionId} already exists — returning existing tab`)
      return this.cliSessionIndex.get(cliSessionId)!
    }
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
      mode: mode || "build",
      lastActivityTime: Date.now(),
      blocksBuffer: [],
    }
    this.tabs.set(id, tab)
    if (cliSessionId) this.cliSessionIndex.set(cliSessionId, tab)
    if (options?.setActive !== false) this.activeTabId = id
    this.persist()
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

    if (tab.cliSessionId) this.cliSessionIndex.delete(tab.cliSessionId)

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
    this.persist()

    return true
  }

  switchTab(id: string): boolean {
    if (!this.tabs.has(id)) return false
    this.activeTabId = id
    this.persist()
    this._onTabSwitched.fire(id)
    return true
  }

  getTab(id: string): TabState | undefined {
    return this.tabs.get(id)
  }

  getTabByCliSessionId(cliSessionId: string): TabState | undefined {
    return this.cliSessionIndex.get(cliSessionId)
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
    if (streamingTabs.length >= this.maxConcurrentStreams) {
      const names = streamingTabs.map((t) => `"${t.id}"`).join(", ")
      return {
        ok: false,
        reason: `Maximum ${this.maxConcurrentStreams} concurrent streams reached. Currently streaming: ${names}`,
      }
    }
    return { ok: true }
  }

  setStreaming(id: string, isStreaming: boolean): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    if (isStreaming && !tab.isStreaming) {
      const streamingCount = this.getStreamingCount()
      if (streamingCount >= this.maxConcurrentStreams) {
        const names = Array.from(this.tabs.values()).filter((t) => t.isStreaming).map((t) => `"${t.id}"`).join(", ")
        log.warn(`Cannot set streaming — limit ${this.maxConcurrentStreams} reached. Currently streaming: ${names}`)
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
    if (tab.mode === mode) return true
    tab.mode = mode
    this._onModeChanged.fire({ tabId: id, mode })
    return true
  }

  setInstructions(id: string, instructions: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.instructions = instructions
    this._onInstructionsChanged.fire({ tabId: id, instructions })
    return true
  }

  setCliSessionId(id: string, cliSessionId: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) {
      log.error(`setCliSessionId failed: no tab with id "${id}" (cliSessionId="${cliSessionId}"). Events for this session will be dropped.`)
      return false
    }
    if (tab.cliSessionId) this.cliSessionIndex.delete(tab.cliSessionId)
    tab.cliSessionId = cliSessionId
    this.cliSessionIndex.set(cliSessionId, tab)
    this._onCliSessionIdRegistered.fire({ tabId: id, cliSessionId })
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

  appendToBlocksBuffer(id: string, block: Block): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.blocksBuffer.push(block)
    tab.lastActivityTime = Date.now()
    return true
  }

  clearBlocksBuffer(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.blocksBuffer = []
    return true
  }

  touchActivity(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!tab) return false
    tab.lastActivityTime = Date.now()
    return true
  }

  dispose(): void {
    for (const tab of this.tabs.values()) {
      if (tab.completionTimeout) {
        clearTimeout(tab.completionTimeout)
      }
    }
    this.tabs.clear()
    this.cliSessionIndex.clear()
    this._onTabCreated.dispose()
    this._onTabClosed.dispose()
    this._onTabSwitched.dispose()
    this._onStreamingStateChanged.dispose()
    this._onInstructionsChanged.dispose()
    this._onCliSessionIdRegistered.dispose()
  }
}
