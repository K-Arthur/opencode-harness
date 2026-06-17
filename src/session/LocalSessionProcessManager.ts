import * as vscode from "vscode"
import { spawn, type ChildProcess } from "child_process"
import { log } from "../utils/outputChannel"
import { PortPool } from "../utils/portPool"
import type {
  SessionConfig,
  SessionProcessHandle,
  SessionProcessManager,
} from "./SessionProcessManager"

interface ProcessEntry {
  handle: SessionProcessHandleImpl
  config: SessionConfig
}

class SessionProcessHandleImpl implements SessionProcessHandle {
  private _status: "running" | "crashed" | "stopped" = "stopped"
  private _pid?: number
  private process: ChildProcess | null = null
  private port = 0
  private readonly _onCrash = new vscode.EventEmitter<void>()

  readonly onCrash = this._onCrash.event

  constructor(
    readonly id: string,
    private readonly portPool: PortPool,
    private readonly onStop: (id: string) => void,
  ) {}

  get status(): "running" | "crashed" | "stopped" {
    return this._status
  }

  get pid(): number | undefined {
    return this._pid
  }

  get currentPort(): number {
    return this.port
  }

  async start(config: SessionConfig): Promise<void> {
    if (this._status === "running") return

    const port = config.port ?? (await this.portPool.reserve())
    this.port = port

    const args = ["serve", "--port", String(port)]
    const cwd = config.cwd ?? config.workspaceRoot ?? process.cwd()
    const env = { ...process.env, ...config.env }

    log.info(`[process-pool] Starting opencode serve for ${this.id} on port ${port}`)

    return new Promise<void>((resolve, reject) => {
      const child = spawn("opencode", args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
      })

      this.process = child
      this._pid = child.pid
      this._status = "running"

      let started = false
      const startupTimeout = setTimeout(() => {
        if (!started) {
          started = true
          reject(new Error(`Process ${this.id} failed to start within 10s`))
        }
      }, 10_000)

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString()
        if (!started && (text.includes("listening") || text.includes("ready") || text.includes(port.toString()))) {
          started = true
          clearTimeout(startupTimeout)
          log.info(`[process-pool] Process ${this.id} ready on port ${port} (pid=${child.pid})`)
          resolve()
        }
      })

      child.stderr?.on("data", (data: Buffer) => {
        log.debug(`[process-pool] ${this.id} stderr: ${data.toString().trim()}`)
      })

      child.on("error", (err) => {
        log.error(`[process-pool] Process ${this.id} error`, err)
        this._status = "crashed"
        this.portPool.release(this.port)
        this._onCrash.fire()
        if (!started) {
          started = true
          clearTimeout(startupTimeout)
          reject(err)
        }
      })

      child.on("exit", (code, signal) => {
        log.info(`[process-pool] Process ${this.id} exited (code=${code}, signal=${signal})`)
        this.process = null
        this._pid = undefined
        if (this._status === "running") {
          this._status = code === 0 ? "stopped" : "crashed"
          if (this._status === "crashed") {
            this._onCrash.fire()
          }
        }
        this.portPool.release(this.port)
        this.onStop(this.id)
        // Clear startup timeout if process exits before start() resolved
        if (!started) {
          started = true
          clearTimeout(startupTimeout)
          reject(new Error(`Process ${this.id} exited prematurely (code=${code}, signal=${signal})`))
        }
      })
    })
  }

  async stop(): Promise<void> {
    if (this._status !== "running" || !this.process) {
      this._status = "stopped"
      return
    }

    return new Promise<void>((resolve) => {
      const child = this.process!
      const timeout = setTimeout(() => {
        log.warn(`[process-pool] Force-killing ${this.id} (pid=${child.pid})`)
        child.kill("SIGKILL")
        resolve()
      }, 5000)

      child.on("exit", () => {
        clearTimeout(timeout)
        this._status = "stopped"
        resolve()
      })

      child.kill("SIGTERM")
    })
  }

  async restart(): Promise<void> {
    const port = this.port
    await this.stop()
    this.port = port
    await this.start({ port })
  }

  dispose(): void {
    this._onCrash.dispose()
    if (this.process) {
      this.process.kill("SIGKILL")
      this.process = null
    }
  }
}

export class LocalSessionProcessManager implements SessionProcessManager, vscode.Disposable {
  private readonly processes = new Map<string, ProcessEntry>()
  private readonly portPool: PortPool
  private readonly _onSessionCrash = new vscode.EventEmitter<{ id: string; handle: SessionProcessHandle }>()

  readonly onSessionCrash = this._onSessionCrash.event

  constructor(basePort = 15000, maxPorts = 100) {
    this.portPool = new PortPool(basePort, maxPorts)
  }

  async spawnSession(config: SessionConfig = {}): Promise<SessionProcessHandle> {
    const id = `proc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const handle = new SessionProcessHandleImpl(id, this.portPool, (stoppedId) => {
      this.processes.delete(stoppedId)
    })

    handle.onCrash(() => {
      this._onSessionCrash.fire({ id, handle })
    })

    this.processes.set(id, { handle, config })
    await handle.start(config)
    return handle
  }

  async killSession(id: string): Promise<void> {
    const entry = this.processes.get(id)
    if (!entry) return
    await entry.handle.stop()
    this.processes.delete(id)
  }

  listActive(): SessionProcessHandle[] {
    return Array.from(this.processes.values())
      .filter(e => e.handle.status === "running")
      .map(e => e.handle)
  }

  getHandle(id: string): SessionProcessHandle | undefined {
    return this.processes.get(id)?.handle
  }

  get activeCount(): number {
    return this.listActive().length
  }

  dispose(): void {
    for (const entry of this.processes.values()) {
      entry.handle.dispose()
    }
    this.processes.clear()
    this._onSessionCrash.dispose()
  }
}
