import { spawn, type ChildProcess } from "child_process"
import * as vscode from "vscode"
import { findFreePort } from "../utils/portFinder"
import { log } from "../utils/outputChannel"
import type { AuthProvider } from "./AuthProvider"

export class ServerLifecycle {
  private serverProcess: ChildProcess | null = null
  private port = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private startPromise: Promise<void> | null = null
  private disposed = false
  private storedPort: number | undefined

  private readonly _onConnected = new vscode.EventEmitter<{ port: number; remote: boolean; url?: string }>()
  private readonly _onDisconnected = new vscode.EventEmitter<{ code: number | null; signal: string | null }>()

  readonly onConnected = this._onConnected.event
  readonly onDisconnected = this._onDisconnected.event

  constructor(private readonly auth: AuthProvider) {}

  get isRunning(): boolean {
    return this.port > 0 || this.auth.isRemote
  }

  get currentPort(): number {
    return this.port
  }

  setStoredPort(port?: number): void {
    this.storedPort = port
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  async start(onReady: (port: number) => Promise<void>): Promise<void> {
    if (this.disposed) throw new Error("ServerLifecycle has been disposed")
    if (this.port > 0) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this._start(onReady)
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const proc = this.serverProcess
    this.serverProcess = null
    this.port = 0
    this.reconnectAttempts = 0

    if (proc) {
      log.info(`Stopping opencode server (pid=${proc.pid})`)
      proc.kill("SIGTERM")

      const exited = await Promise.race([
        new Promise<boolean>((resolve) => {
          proc.once("exit", () => resolve(true))
        }),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 3_000)
        }),
      ])

      if (!exited) {
        log.warn("Server did not exit within 3s — sending SIGKILL")
        proc.kill("SIGKILL")
      }
    }
    log.info("OpenCode server stopped")
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this._onConnected.dispose()
    this._onDisconnected.dispose()
    this.stop().catch(err => log.error("Error during ServerLifecycle disposal", err))
  }

  resetPort(): void {
    this.port = 0
  }

  private async _start(onReady: (port: number) => Promise<void>): Promise<void> {
    if (!this.auth.serverPassword) {
      this.auth.generatePassword()
    }

    if (this.storedPort) {
      try {
        const healthHeaders = this.auth.buildHealthHeaders()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2000)
        const resp = await fetch(`http://127.0.0.1:${this.storedPort}/global/health`, {
          signal: controller.signal,
          headers: healthHeaders,
        })
        clearTimeout(timer)
        if (resp.ok) {
          const data = await resp.json() as { healthy?: boolean }
          if (data.healthy) {
            this.port = this.storedPort
            this.reconnectAttempts = 0
            this._onConnected.fire({ port: this.port, remote: false })
            log.info("OpenCode server connected (reused)")
            await onReady(this.port)
            return
          }
        }
      } catch (e) {
        const msg = (e as Error).message
        if (!msg.includes("Auth verification failed")) {
          log.debug(`Stored port ${this.storedPort} health check failed, starting new server`)
        }
      }
    }

    this.port = await findFreePort()

    const opencodePath = await this.findOpencodeBinary()
    if (!opencodePath) {
      throw new Error("OpenCode is not installed. Install it from https://opencode.ai, then reload the window.")
    }

    log.info(`Starting opencode server on port ${this.port} (${opencodePath})`)

    let cwd: string | undefined
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      cwd = folders[0]!.uri.fsPath
      log.info(`Starting opencode server in workspace: ${cwd}`)
    } else {
      cwd = process.cwd()
      log.info(`No workspace folder; using cwd: ${cwd}`)
    }

    const allowedEnvVars = [
      "PATH", "HOME", "USERPROFILE", "APPDATA",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_DATA_DIRS",
      "OPENCODE_DATA_DIR",
      "LANG", "TERM", "SHELL", "TMPDIR", "TEMP", "TMP",
    ]
    const childEnv: Record<string, string> = {}
    for (const key of allowedEnvVars) {
      const val = process.env[key]
      if (val) childEnv[key] = val
    }
    childEnv["OPENCODE_SERVER_PASSWORD"] = this.auth.serverPassword
    this.serverProcess = spawn(opencodePath, ["serve", "--port", String(this.port), "--hostname", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
      shell: false,
      cwd,
    })

    this.serverProcess.stdout?.on("data", (data: Buffer) => {
      log.info(`[opencode:stdout] ${data.toString().trimEnd()}`)
    })

    this.serverProcess.stderr?.on("data", (data: Buffer) => {
      log.warn(`[opencode:stderr] ${data.toString().trimEnd()}`)
    })

    this.serverProcess.on("exit", (code, signal) => {
      log.warn(`opencode server exited (code=${code}, signal=${signal})`)
      this._onDisconnected.fire({ code, signal })
      this.scheduleReconnect(onReady)
    })

    this.serverProcess.on("error", (err) => {
      log.error("opencode server process error", err)
    })

    await this.waitForHealth()

    this.reconnectAttempts = 0
    this._onConnected.fire({ port: this.port, remote: false })
    log.info("OpenCode server connected")
    await onReady(this.port)
  }

  private async waitForHealth(timeoutMs = 10_000): Promise<void> {
    const start = Date.now()
    const healthHeaders = this.auth.buildHealthHeaders()
    while (Date.now() - start < timeoutMs) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2_000)
        const resp = await fetch(`http://127.0.0.1:${this.port}/global/health`, {
          signal: controller.signal,
          headers: healthHeaders,
        })
        clearTimeout(timer)
        if (resp.ok) {
          const data = (await resp.json()) as { healthy?: boolean; version?: string }
          if (data.healthy) {
            log.info(`OpenCode server healthy (version ${data.version ?? "unknown"})`)
            return
          }
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error("OpenCode server did not start within 10 seconds. Check the output channel for details.")
  }

  private async findOpencodeBinary(): Promise<string | null> {
    const config = vscode.workspace.getConfiguration("opencode")
    const customPath = config.get<string>("binaryPath")
    if (customPath) {
      if (!/^[/\\]|[A-Za-z]:/.test(customPath) || /[;&|`$(){}!#~<>]/.test(customPath)) {
        log.warn(`Custom binary path "${customPath}" is invalid or unsafe. Falling back to PATH lookup.`)
      } else {
        log.info(`Using custom opencode binary path: ${customPath}`)
        return customPath
      }
    }

    const isWindows = process.platform === "win32"
    const cmd = isWindows ? "where" : "which"
    const which = spawn(cmd, ["opencode"], { shell: false })
    return new Promise((resolve) => {
      let output = ""
      which.stdout?.on("data", (d: Buffer) => { output += d.toString() })
      which.on("close", () => { resolve(output.trim() || null) })
      which.on("error", () => resolve(null))
    })
  }

  private scheduleReconnect(onReady: (port: number) => Promise<void>): void {
    if (this.reconnectAttempts >= 5) {
      log.error("Max reconnect attempts reached. Please restart the extension.")
      return
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16_000)
    this.reconnectAttempts++
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/5)`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.start(onReady).catch((err) => {
        log.error("Reconnect failed", err)
        this.scheduleReconnect(onReady)
      })
    }, delay)
  }
}
