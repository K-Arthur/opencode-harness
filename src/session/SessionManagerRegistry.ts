import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { SessionManager } from "./SessionManager"
import type { LocalSessionProcessManager } from "./LocalSessionProcessManager"
import type { SessionProcessHandle, SessionConfig } from "./SessionProcessManager"
import type { McpServerManager } from "../mcp/McpServerManager"

export type ProcessStrategy = "shared" | "per-tab"

interface ManagedProcess {
  processId: string
  manager: SessionManager
  tabIds: Set<string>
}

export class SessionManagerRegistry implements vscode.Disposable {
  private readonly managed = new Map<string, ManagedProcess>()
  private readonly tabToProcess = new Map<string, string>()
  private readonly strategy: ProcessStrategy
  private defaultManager: SessionManager | null = null

  constructor(
    private readonly processManager: LocalSessionProcessManager,
    private readonly mcpServerManager?: McpServerManager,
  ) {
    const config = vscode.workspace.getConfiguration("opencode.sessions")
    this.strategy = config.get<ProcessStrategy>("processStrategy", "shared")
    log.info(`[registry] Process strategy: ${this.strategy}`)
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
      }
    }
  }

  getProcessForTab(tabId: string): string | undefined {
    return this.tabToProcess.get(tabId)
  }

  getTabCount(processId: string): number {
    return this.managed.get(processId)?.tabIds.size ?? 0
  }

  /**
   * Spawn a new opencode server process, create a SessionManager for it, and
   * register both in the registry. Available in "per-tab" strategy only.
   * @returns The process handle, the new SessionManager, and the process ID.
   */
  async spawnAndRegisterSession(
    config?: SessionConfig,
    tabId?: string,
  ): Promise<{ handle: SessionProcessHandle; sessionManager: SessionManager; processId: string }> {
    if (this.strategy !== "per-tab") {
      throw new Error("spawnAndRegisterSession only valid with processStrategy='per-tab'")
    }

    // 1. Spawn a new opencode serve process
    const handle = await this.processManager.spawnSession(config)
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

    log.info(`[registry] Spawned and registered session process ${processId} on port ${handle.currentPort}`)
    return { handle, sessionManager: sm, processId }
  }

  dispose(): void {
    this.tabToProcess.clear()
    this.managed.clear()
    this._onProcessRegistered.dispose()
  }

  private readonly _onProcessRegistered = new vscode.EventEmitter<string>()
  readonly onProcessRegistered = this._onProcessRegistered.event
}
