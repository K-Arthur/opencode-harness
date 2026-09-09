import { spawn, type ChildProcess } from "child_process"
import { existsSync } from "fs"
import * as os from "os"
import * as vscode from "vscode"
import { findFreePort } from "../utils/portFinder"
import { log } from "../utils/outputChannel"
import { executableNamesForRuntime, knownOpencodeBinaryPaths, preferExeOnWindows } from "../install/installPlan"
import type { AuthProvider } from "./AuthProvider"
import type { BackendRuntime, RuntimePreference } from "./serverIdentity"

export class ServerLifecycle {
  private serverProcess: ChildProcess | null = null
  private port = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private startPromise: Promise<void> | null = null
  private disposed = false
  private storedPort: number | undefined
  private selectedRuntime: BackendRuntime = "unknown"

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

  /** Runtime inferred from the executable or reused server health route. */
  get runtime(): BackendRuntime {
    return this.selectedRuntime
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
    this.selectedRuntime = "unknown"
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
        const preference = this.runtimePreference()
        const legacyHealthUrl = `http://127.0.0.1:${this.storedPort}/global/health`
        const healthUrls = preference === "opencode2"
          ? [`http://127.0.0.1:${this.storedPort}/api/health`]
          : preference === "opencode"
            ? [legacyHealthUrl]
            : [`http://127.0.0.1:${this.storedPort}/api/health`, legacyHealthUrl]
        for (const healthUrl of healthUrls) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 2000)
          try {
            const resp = await fetch(healthUrl, { signal: controller.signal, headers: healthHeaders })
            if (resp.ok) {
              const data = await resp.json() as { healthy?: boolean; version?: string }
              if (data.healthy === true) {
                this.port = this.storedPort
                this.selectedRuntime = healthUrl.endsWith("/api/health") ? "opencode2" : "opencode"
                this.reconnectAttempts = 0
                this._onConnected.fire({ port: this.port, remote: false })
                log.info(`OpenCode server connected (reused, runtime=${this.selectedRuntime})`)
                await onReady(this.port)
                return
                }
            } else if (resp.status !== 404 || healthUrls.length === 1) {
              log.warn(`Zombie server detected on port ${this.storedPort} (health check HTTP ${resp.status}); starting a fresh instance`)
            }
          } finally {
            clearTimeout(timer)
          }
        }
        // Health endpoint responded but reported unhealthy — a zombie or
        // partially-started process is holding the port. Log explicitly so
        // the user can distinguish this from a clean fresh start.
        log.warn(`Zombie server detected on port ${this.storedPort} (health check returned healthy=false or endpoint unavailable); starting a fresh instance`)
      } catch (e) {
        const msg = (e as Error).message
        if (!msg.includes("Auth verification failed")) {
          log.debug(`Stored port ${this.storedPort} health check failed (${msg}), starting new server`)
        }
      }
    }

    this.port = await findFreePort()

    const opencodePath = await this.findOpencodeBinary()
    if (!opencodePath) {
      throw new Error("OpenCode CLI not found. Run the 'OpenCode: Install CLI' command, or install it from https://opencode.ai, then reload the window.")
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
    // Both names are intentionally supplied: this lets an explicitly selected
    // runtime and an auto-detected runtime authenticate during transitions,
    // while the selected runtime remains the source of truth for diagnostics.
    childEnv["OPENCODE_PASSWORD"] = this.auth.serverPassword
    childEnv["OPENCODE_SERVER_PASSWORD"] = this.auth.serverPassword
    this.serverProcess = spawn(opencodePath, ["serve", "--port", String(this.port), "--hostname", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
      shell: false,
      cwd,
    })
    const proc = this.serverProcess

    proc.stdout?.on("data", (data: Buffer) => {
      log.info(`[${this.selectedRuntime}:stdout] ${data.toString().trimEnd()}`)
    })

    proc.stderr?.on("data", (data: Buffer) => {
      log.warn(`[${this.selectedRuntime}:stderr] ${data.toString().trimEnd()}`)
    })

    proc.on("exit", (code, signal) => {
      const intentional = this.serverProcess !== proc || this.disposed
      const runtime = this.selectedRuntime
      if (this.serverProcess === proc) this.serverProcess = null
      this.port = 0
      this.selectedRuntime = "unknown"
      log.warn(`${runtime} server exited (code=${code}, signal=${signal})`)
      this._onDisconnected.fire({ code, signal })
      if (!intentional) this.scheduleReconnect(onReady)
    })

    proc.on("error", (err) => {
      log.error("opencode server process error", err)
    })

    await this.waitForHealth()

    this.reconnectAttempts = 0
    this._onConnected.fire({ port: this.port, remote: false })
    log.info(`OpenCode server connected (runtime=${this.selectedRuntime})`)
    await onReady(this.port)
  }

  private async waitForHealth(timeoutMs = 30_000): Promise<void> {
    const start = Date.now()
    const healthHeaders = this.auth.buildHealthHeaders()
    while (Date.now() - start < timeoutMs) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2_000)
        try {
          const urls = this.healthUrlsForRuntime(this.selectedRuntime === "unknown" ? this.runtimePreference() : this.selectedRuntime)
          for (const url of urls) {
            const resp = await fetch(url, { signal: controller.signal, headers: healthHeaders })
            if (resp.ok) {
              const data = (await resp.json()) as { healthy?: boolean; version?: string }
              if (data.healthy === true) {
                this.selectedRuntime = url.endsWith("/api/health") ? "opencode2" : "opencode"
                log.info(`OpenCode server healthy (runtime=${this.selectedRuntime}, version=${data.version ?? "unknown"})`)
                return
              }
            }
          }
        } finally {
          clearTimeout(timer)
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error("OpenCode server did not start within 30 seconds. Check the output channel for details.")
  }

  private async findOpencodeBinary(): Promise<string | null> {
    const config = vscode.workspace.getConfiguration("opencode")
    const preference = this.runtimePreference()
    const customPath = config.get<string>("binaryPath")
    if (customPath) {
      if (!/^[/\\]|[A-Za-z]:/.test(customPath) || /[;&|`$(){}!#~<>]/.test(customPath)) {
        log.warn(`Custom binary path "${customPath}" is invalid or unsafe. Falling back to PATH lookup.`)
      } else if (process.platform === "win32" && /\.(cmd|ps1)$/i.test(customPath)) {
        log.warn(`Custom binary path "${customPath}" is a .cmd/.ps1 wrapper. Node.js cannot spawn it with shell:false (EFTYPE/EINVAL). Falling back to PATH lookup.`)
      } else {
        this.selectedRuntime = preference === "opencode2" || preference === "opencode"
          ? preference
          : this.runtimeFromExecutable(customPath)
        log.info(`Using custom ${this.selectedRuntime} binary path: ${customPath}`)
        return customPath
      }
    }

    const isWindows = process.platform === "win32"
    const cmd = isWindows ? "where" : "which"
    for (const executable of executableNamesForRuntime(preference)) {
      const which = spawn(cmd, [executable], { shell: false })
      const fromPath = await new Promise<string | null>((resolve) => {
        let output = ""
        which.stdout?.on("data", (d: Buffer) => { output += d.toString() })
        which.on("close", () => { resolve(preferExeOnWindows(output, process.platform)) })
        which.on("error", () => resolve(null))
      })
      if (fromPath) {
        this.selectedRuntime = this.runtimeFromExecutable(fromPath)
        return fromPath
      }
    }

    // PATH lookup failed. The official install script writes to ~/.opencode/bin
    // and updates shell rc files, but the running extension host won't see that
    // PATH change until VS Code restarts — so probe the known locations directly.
    for (const executable of executableNamesForRuntime(preference)) {
      const candidates = executable === "opencode"
        ? knownOpencodeBinaryPaths(process.platform, os.homedir(), process.env)
        : knownOpencodeBinaryPaths(process.platform, os.homedir(), process.env, executable)
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          this.selectedRuntime = this.runtimeFromExecutable(candidate)
          log.info(`Found ${this.selectedRuntime} binary at ${candidate} (not on PATH)`)
          return candidate
        }
      }
    }
    return null
  }

  private runtimePreference(): RuntimePreference {
    const value = vscode.workspace.getConfiguration("opencode").get<string>("runtime", "auto")
    return value === "opencode" || value === "opencode2" ? value : "auto"
  }

  private runtimeFromExecutable(executable: string): BackendRuntime {
    return /(^|[\\/])opencode2(?:\.exe)?$/i.test(executable) ? "opencode2" : "opencode"
  }

  private healthUrlsForRuntime(runtime: RuntimePreference | BackendRuntime): string[] {
    const baseUrl = `http://127.0.0.1:${this.port}`
    if (runtime === "opencode2") return [`${baseUrl}/api/health`]
    if (runtime === "opencode") return [`${baseUrl}/global/health`]
    return [`${baseUrl}/api/health`, `${baseUrl}/global/health`]
  }

  private scheduleReconnect(onReady: (port: number) => Promise<void>): void {
    if (this.disposed) return
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
