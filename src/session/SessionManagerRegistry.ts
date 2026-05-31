import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import type { SessionManager } from "./SessionManager"

export class SessionManagerRegistry implements vscode.Disposable {
  private shared: SessionManager
  private tabOverrides = new Map<string, SessionManager>()
  private processMap = new Map<string, SessionManager>()
  private disposed = false
  constructor(shared: SessionManager) { this.shared = shared }
  getSessionManager(tabId?: string): SessionManager {
    if (this.disposed) throw new Error("disposed")
    if (tabId) { const o = this.tabOverrides.get(tabId); if (o) return o }
    return this.shared
  }
  getDefault(): SessionManager { if (this.disposed) throw new Error("disposed"); return this.shared }
  registerProcess(processId: string, manager: SessionManager): void { this.processMap.set(processId, manager); log.info(`Registered process ${processId}`) }
  assignTab(tabId: string, processId: string): boolean {
    const m = this.processMap.get(processId); if (!m) { log.warn(`assignTab: process ${processId} not registered`); return false }
    this.tabOverrides.set(tabId, m); return true
  }
  unassignTab(tabId: string): void { this.tabOverrides.delete(tabId) }
  removeProcess(processId: string): void {
    const m = this.processMap.get(processId); if (!m) return
    for (const [tabId, mgr] of this.tabOverrides) { if (mgr === m) this.tabOverrides.delete(tabId) }
    this.processMap.delete(processId)
  }
  isTabAssigned(tabId: string): boolean { return this.tabOverrides.has(tabId) }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.tabOverrides.clear(); this.processMap.clear() }
}
