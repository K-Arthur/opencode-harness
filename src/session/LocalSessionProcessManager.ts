import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { PortPool } from "../utils/portPool"
import { ServerLifecycle } from "./ServerLifecycle"
import { AuthProvider } from "./AuthProvider"
import type { SessionConfig, SessionProcessHandle, SessionProcessManager } from "./SessionProcessManager"

class LocalSessionProcessHandle implements SessionProcessHandle {
  private _status: "running" | "crashed" | "stopped" = "stopped"
  private _pid: number | undefined
  private _port: number | undefined
  private _disposed = false
  private readonly _onCrash = new vscode.EventEmitter<void>()
  readonly onCrash = this._onCrash.event
  constructor(readonly id: string, private readonly auth: AuthProvider, private readonly portPool: PortPool) {}
  get status() { return this._status }
  get pid() { return this._pid }
  get port() { return this._port }
  private lifecycle: ServerLifecycle | null = null
  async start(config: SessionConfig): Promise<void> {
    if (this._status === "running") return
    if (this._disposed) throw new Error("Handle disposed")
    this.lifecycle = new ServerLifecycle(this.auth)
    const port = config.port ?? await this.portPool.reserve()
    await this.lifecycle.start(async (assignedPort) => {
      this._port = assignedPort
      this._status = "running"
      log.info(`Process ${this.id} started on port ${assignedPort}`)
    })
    this.lifecycle.onDisconnected(({ code, signal }) => {
      if (this._disposed) return
      log.warn(`Process ${this.id} exited (code=${code}, signal=${signal})`)
      this._status = "crashed"
      this.portPool.release(port)
      this._onCrash.fire()
    })
  }
  async stop(): Promise<void> {
    if (this._status === "stopped") return
    this._status = "stopped"
    if (this._port) { this.portPool.release(this._port); this._port = undefined }
    if (this.lifecycle) { await this.lifecycle.stop(); this.lifecycle.dispose(); this.lifecycle = null }
    this._pid = undefined
  }
  async restart(): Promise<void> { await this.stop(); await this.start({}) }
  dispose(): void { if (this._disposed) return; this._disposed = true; void this.stop(); this._onCrash.dispose() }
}

export class LocalSessionProcessManager implements SessionProcessManager {
  private readonly handles = new Map<string, LocalSessionProcessHandle>()
  private readonly _onSessionCrash = new vscode.EventEmitter<{ id: string; handle: SessionProcessHandle }>()
  private readonly portPool: PortPool
  private readonly auth: AuthProvider
  private disposed = false
  readonly onSessionCrash = this._onSessionCrash.event
  constructor(auth?: AuthProvider) {
    this.auth = auth ?? new AuthProvider()
    this.portPool = new PortPool()
  }
  async spawnSession(config: SessionConfig): Promise<SessionProcessHandle> {
    if (this.disposed) throw new Error("disposed")
    const id = `process-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const handle = new LocalSessionProcessHandle(id, this.auth, this.portPool)
    handle.onCrash(() => { this._onSessionCrash.fire({ id, handle }) })
    this.handles.set(id, handle)
    return handle
  }
  async killSession(id: string): Promise<void> {
    const handle = this.handles.get(id)
    if (!handle) return
    await handle.stop(); handle.dispose(); this.handles.delete(id)
  }
  listActive() { return Array.from(this.handles.values()) }
  getHandle(id: string) { return this.handles.get(id) }
  dispose(): void {
    if (this.disposed) return; this.disposed = true
    for (const h of this.handles.values()) h.dispose()
    this.handles.clear(); this._onSessionCrash.dispose()
  }
}
