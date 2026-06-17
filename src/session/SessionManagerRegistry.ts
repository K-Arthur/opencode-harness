import * as vscode from "vscode"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { log } from "../utils/outputChannel"
import { SessionManager } from "./SessionManager"
import type { LocalSessionProcessManager } from "./LocalSessionProcessManager"
import type { SessionProcessHandle, SessionConfig } from "./SessionProcessManager"
import type { McpServerManager } from "../mcp/McpServerManager"
import type { TabRestorationState } from "./sessionTypes"

export type ProcessStrategy = "shared" | "per-tab"

interface ManagedProcess {
  processId: string
  manager: SessionManager
  tabIds: Set<string>
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface ProcessCrashEvent {
  processId: string
  tabIds: string[]
  timestamp: number
}

export class SessionManagerRegistry implements vscode.Disposable {
  private readonly managed = new Map<string, ManagedProcess>()
  private readonly tabToProcess = new Map<string, string>()
  private readonly strategy: ProcessStrategy
  private defaultManager: SessionManager | null = null
  private disposed = false

  // ── Crash resilience ──────────────────────────────────────────────
  private readonly _onProcessCrash = new vscode.EventEmitter<ProcessCrashEvent>()
  /** Fires when a per-tab process crashes. Contains the process ID and all
   *  tab IDs that were assigned to it. The host should create TabRestorationState
   *  entries and offer resume. */
  readonly onProcessCrash = this._onProcessCrash.event

  // ── LRU eviction ──────────────────────────────────────────────────
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private readonly IDLE_CHECK_INTERVAL_MS = 60_000

  constructor(
    private readonly processManager: LocalSessionProcessManager,
    private readonly mcpServerManager?: McpServerManager,
  ) {
    const config = vscode.workspace.getConfiguration("opencode.sessions")
    this.strategy = config.get<ProcessStrategy>("processStrategy", "shared")
    log.info(`[registry] Process strategy: ${this.strategy}`)

    // Subscribe to process crashes for per-tab resilience
    if (this.strategy === "per-tab") {
      this.processManager.onSessionCrash(({ id }) => {
        this.handleProcessCrash(id)
      })
    }
  }

  get processStrategy(): ProcessStrategy {
    return this.strategy
  }

  setDefaultManager(manager: SessionManager): void {
    this.defaultManager = manager
  }

  getDefault(): SessionManager {
    if (!this.defaultManager) {
      throw new Error("SessionManagerRegistry: default manager not set")
    }
    return this.defaultManager
  }

  getSessionManager(tabId?: string): SessionManager {
    if (this.strategy === "shared" || !tabId) {
      return this.getDefault()
    }

    const processId = this.tabToProcess.get(tabId)
    if (processId) {
      const entry = this.managed.get(processId)
      if (entry) return entry.manager
    }

    return this.getDefault()
  }

  registerProcess(processId: string, manager: SessionManager): void {
    if (this.managed.has(processId)) {
      log.warn(`[registry] Process ${processId} already registered, overwriting`)
    }
    this.managed.set(processId, {
      processId,
      manager,
      tabIds: new Set(),
    })
    this._onProcessRegistered.fire(processId)
    log.info(`[registry] Registered process ${processId}`)
  }

  async assignTab(tabId: string, processId: string): Promise<boolean> {
    const entry = this.managed.get(processId)
    if (!entry) {
      log.warn(`[registry] Cannot assign tab ${tabId} to unknown process ${processId}`)
      return false
    }

    const prevProcessId = this.tabToProcess.get(tabId)
    if (prevProcessId) {
      const prev = this.managed.get(prevProcessId)
      prev?.tabIds.delete(tabId)
    }

    this.tabToProcess.set(tabId, processId)
    entry.tabIds.add(tabId)
    this.clearIdleTimer(processId)
    log.info(`[registry] Assigned tab ${tabId} → process ${processId}`)
    return true
  }

  unassignTab(tabId: string): void {
    const processId = this.tabToProcess.get(tabId)
    if (!processId) return
    this.tabToProcess.delete(tabId)
    const entry = this.managed.get(processId)
    if (entry) {
      entry.tabIds.delete(tabId)
      if (entry.tabIds.size === 0) {
        log.info(`[registry] Process ${processId} has no tabs, marking idle`)
        this.armIdleTimer(processId)
      }
    }
  }

  getProcessForTab(tabId: string): string | undefined {
    return this.tabToProcess.get(tabId)
  }

  getTabCount(processId: string): number {
    return this.managed.get(processId)?.tabIds.size ?? 0
  }

  /** Build a list of TabRestorationState entries for all tabs that were
   *  assigned to the crashed process. The host should persist these and
   *  offer resume. */
  getCrashRestorationStates(processId: string): TabRestorationState[] {
    const entry = this.managed.get(processId)
    if (!entry) return []
    const states: TabRestorationState[] = []
    for (const tabId of entry.tabIds) {
      states.push({
        tabId,
        cliSessionId: this.tabManagerCliSessionId(tabId),
        wasStreaming: true,
        interruptedAt: Date.now(),
      })
    }
    return states
  }

  /**
   * Spawn a new opencode server process, create a SessionManager for it, and
   * register both in the registry. Available in "per-tab" strategy only.
   * Automatically sets OPENCODE_DATA_DIR for per-process SQLite isolation.
   * @returns The process handle, the new SessionManager, and the process ID.
   */
  async spawnAndRegisterSession(
    config?: SessionConfig,
    tabId?: string,
  ): Promise<{ handle: SessionProcessHandle; sessionManager: SessionManager; processId: string }> {
    if (this.strategy !== "per-tab") {
      throw new Error("spawnAndRegisterSession only valid with processStrategy='per-tab'")
    }

    // Generate a unique data directory for this process so SQLite doesn't
    // conflict with other instances (ADR-010 §Phase-3).
    const dataDir = mkdtempSync(join(tmpdir(), `opencode-proc-`))
    const env = { ...config?.env, OPENCODE_DATA_DIR: dataDir }

    const spawnConfig: SessionConfig = { ...config, env }

    // 1. Spawn a new opencode serve process
    const handle = await this.processManager.spawnSession(spawnConfig)
    const processId = handle.id

    // 2. Create a SessionManager connected to this process
    const sm = new SessionManager(this.mcpServerManager)
    sm.serverLifecycle.setStoredPort(handle.currentPort)
    await sm.start()

    // 3. Register in the registry
    this.registerProcess(processId, sm)

    // 4. Auto-assign tab if provided
    if (tabId) {
      await this.assignTab(tabId, processId)
    }

    log.info(`[registry] Spawned session process ${processId} on port ${handle.currentPort} (dataDir=${dataDir})`)
    return { handle, sessionManager: sm, processId }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private handleProcessCrash(processId: string): void {
    const entry = this.managed.get(processId)
    if (!entry) return

    const tabIds = Array.from(entry.tabIds)
    log.warn(`[registry] Process ${processId} crashed with ${tabIds.length} assigned tab(s)`)

    // Unassign all tabs
    for (const tabId of tabIds) {
      this.tabToProcess.delete(tabId)
    }

    // Remove from managed map
    this.managed.delete(processId)

    // Fire crash event for the host
    this._onProcessCrash.fire({
      processId,
      tabIds,
      timestamp: Date.now(),
    })
  }

  private tabManagerCliSessionId(tabId: string): string | undefined {
    // The registry itself doesn't store cliSessionIds — this is a hook
    // that ChatProvider can override via setTabCliSessionIdResolver.
    return this._cliSessionIdResolver?.(tabId)
  }

  private _cliSessionIdResolver: ((tabId: string) => string | undefined) | null = null

  /** Set a resolver that maps tab IDs to their current CLI session IDs,
   *  used when building TabRestorationState after a process crash. */
  setTabCliSessionIdResolver(resolver: (tabId: string) => string | undefined): void {
    this._cliSessionIdResolver = resolver
  }

  // ── LRU eviction ──────────────────────────────────────────────────

  private get idleTimeoutMs(): number {
    const config = vscode.workspace.getConfiguration("opencode.sessions")
    return (config.get<number>("processIdleTimeoutMinutes", 5)) * 60_000
  }

  private armIdleTimer(processId: string): void {
    const entry = this.managed.get(processId)
    if (!entry || entry.idleTimer) return

    entry.idleTimer = setTimeout(() => {
      if (this.disposed) return
      if (entry.tabIds.size > 0) return // re-acquired

      log.info(`[registry] Killing idle process ${processId} (no tabs for ${this.idleTimeoutMs / 60_000}min)`)
      void this.processManager.killSession(processId).catch((err) => {
        log.warn(`[registry] Failed to kill idle process ${processId}`, err)
      })
      this.managed.delete(processId)
    }, this.idleTimeoutMs)

    // Ensure the timer doesn't block process exit
    if (typeof entry.idleTimer.unref === "function") {
      entry.idleTimer.unref()
    }

    this.startIdleCheck()
  }

  private clearIdleTimer(processId: string): void {
    const entry = this.managed.get(processId)
    if (!entry?.idleTimer) return
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
    this.stopIdleCheckIfEmpty()
  }

  private startIdleCheck(): void {
    if (this.idleCheckTimer) return
    this.idleCheckTimer = setInterval(() => {
      if (this.disposed) return
      this.stopIdleCheckIfEmpty()
    }, this.IDLE_CHECK_INTERVAL_MS)
    if (typeof this.idleCheckTimer.unref === "function") {
      this.idleCheckTimer.unref()
    }
  }

  private stopIdleCheckIfEmpty(): void {
    if (!this.idleCheckTimer) return
    const hasIdle = Array.from(this.managed.values()).some(e => e.idleTimer !== undefined)
    if (hasIdle) return
    clearInterval(this.idleCheckTimer)
    this.idleCheckTimer = null
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }
    for (const entry of this.managed.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
    }
    this.tabToProcess.clear()
    this.managed.clear()
    this._onProcessRegistered.dispose()
    this._onProcessCrash.dispose()
  }

  private readonly _onProcessRegistered = new vscode.EventEmitter<string>()
  readonly onProcessRegistered = this._onProcessRegistered.event
}
