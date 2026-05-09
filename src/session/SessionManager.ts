import * as vscode from "vscode"
import {
  createOpencodeClient,
  type OpencodeClient,
  type Session,
  type Message,
  type Part,
  type TextPartInput,
  type FilePartInput,
  type AgentPartInput,
  type SubtaskPartInput,
  type Event as SdkEvent,
} from "@opencode-ai/sdk"
import { spawn, type ChildProcess } from "child_process"
import { randomUUID } from "crypto"
import { findFreePort } from "../utils/portFinder"
import { log } from "../utils/outputChannel"
import { validateServerUrl } from "../utils/security"
import { createSdkEventNormalizer, type SdkEventLike } from "./EventNormalizer"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type OpencodeEventType =
  | "tool_start"
  | "tool_end"
  | "skill_load"
  | "thinking"
  | "text_chunk"
  | "message_complete"
  | "session_status"
  | "server_connected"
  | "server_disconnected"
  | "server_error"
  | "file_edited"
  | "permission_request"
  | "permission_replied"

export interface OpencodeEvent {
  type: OpencodeEventType | string
  sessionId?: string
  data?: unknown
}

export interface ContextPackage {
  openFiles: {
    path: string
    language: string
    content: string
    selection?: { startLine: number; endLine: number; text: string }
  }[]
  diagnostics: unknown
  workspaceTree: unknown
  projectConfigs: unknown[]
  gitStatus: { branch: string; modified: string[]; staged: string[]; recentDiff?: string }
  terminalOutput?: { name: string; text: string }
  explicitContext?: { type: string; content: string }[]
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface PromptOptions {
  model?: ModelRef
  tools?: Record<string, boolean>
  variant?: string
}

/* ------------------------------------------------------------------ */
/*  SessionManager                                                     */
/* ------------------------------------------------------------------ */

export class SessionManager {
  private client: OpencodeClient | null = null
  private serverProcess: ChildProcess | null = null
  private port = 0
  private _onEvent = new vscode.EventEmitter<OpencodeEvent>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private eventStreamController: AbortController | null = null
  private eventReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private eventReconnectAttempts = 0
  private lastRawEventAt = 0
  private lastNormalizedEventAt = 0
  private lastRawEventType = ""
  private lastNormalizedEventType = ""
  private readonly eventNormalizer = createSdkEventNormalizer()

  /** Current model selection – sent per-prompt via the SDK. */
  private currentModel: ModelRef | null = null

  /** Guard against concurrent start() calls (C1 fix) */
  private startPromise: Promise<void> | null = null

  /** Whether the manager has been disposed */
  private disposed = false

  /** Previously stored port for potential reuse across reloads */
  private storedPort?: number

  /** Per-run server password — generated on start, never persisted */
  private serverPassword = ""

  /** Set a previously stored port to attempt reuse before spawning a new server */
  setStoredPort(port?: number): void {
    this.storedPort = port
  }

  /**
   * When set, `_start()` skips spawning a local opencode binary and connects
   * directly to the supplied URL. Auth is applied via {@link authHeader}.
   */
  private remoteServerUrl: string | null = null
  private remoteServerToken: string | null = null

  /** Configure remote-attach mode. Pass null/empty to fall back to local spawn. */
  setRemoteServer(url: string | null | undefined, token?: string | null): void {
    const trimmed = (url ?? "").trim().replace(/\/+$/, "")

    if (trimmed.length > 0) {
      const validation = validateServerUrl(trimmed)
      if (!validation.valid) {
        throw new Error(`Invalid remote server URL: ${validation.warning ?? trimmed}`)
      }
      if (validation.warning) {
        log.warn(`Remote server URL warning: ${validation.warning}`)
      }
    }

    this.remoteServerUrl = trimmed.length > 0 ? trimmed : null
    this.remoteServerToken = token?.trim() || null
  }

  /** True when the manager is configured to attach to a remote server. */
  get isRemote(): boolean {
    return this.remoteServerUrl !== null
  }

  /**
   * Generate a cryptographically random server password.
   * If OPENCODE_SERVER_PASSWORD is already set in the parent environment (e.g. user
   * configured it in their shell), we respect that value rather than generating one.
   * Used for --password flag on the server process and Bearer auth on the SDK client.
   * Never persisted to disk — lives only in this instance's lifetime.
   */
  private generatePassword(): string {
    const envPassword = process.env["OPENCODE_SERVER_PASSWORD"]
    if (envPassword) {
      this.serverPassword = envPassword
      log.info("Using OPENCODE_SERVER_PASSWORD from environment")
    } else {
      this.serverPassword = `oc-${randomUUID()}`
    }
    return this.serverPassword
  }

  /* ---- public getters ---- */

  readonly onEvent = this._onEvent.event

  get isRunning(): boolean {
    return this.client !== null
  }

  get currentPort(): number {
    return this.port
  }

  get model(): ModelRef | null {
    return this.currentModel
  }

  /**
   * Authorization header for the current server instance.
   * - Remote-attach mode: Bearer token from `opencode.serverAuthToken`.
   * - Local spawn: HTTP Basic auth derived from the generated server password.
   * Returns undefined when no auth is required.
   */
  get authHeader(): string | undefined {
    if (this.remoteServerToken) return `Bearer ${this.remoteServerToken}`
    if (!this.serverPassword) return undefined
    return `Basic ${Buffer.from(`opencode:${this.serverPassword}`).toString("base64")}`
  }

  /* ---- lifecycle ---- */

  async start(): Promise<void> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (this.client) return

    // C1: Guard against concurrent start() calls — reuse in-flight promise
    if (this.startPromise) return this.startPromise

    this.startPromise = this._start()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private makeRemoteClient(baseUrl: string): OpencodeClient {
    if (this.remoteServerToken) {
      return createOpencodeClient({
        baseUrl,
        headers: { Authorization: `Bearer ${this.remoteServerToken}` },
      })
    }
    return createOpencodeClient({ baseUrl })
  }

  private async _startRemote(): Promise<void> {
    const baseUrl = this.remoteServerUrl!
    log.info(`Attaching to remote opencode server at ${baseUrl}`)

    // Health check the remote endpoint before declaring connected.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const headers: Record<string, string> = {}
      if (this.remoteServerToken) headers["Authorization"] = `Bearer ${this.remoteServerToken}`
      const resp = await fetch(`${baseUrl}/global/health`, {
        signal: controller.signal,
        headers,
      })
      if (!resp.ok) {
        throw new Error(`Remote server returned HTTP ${resp.status}`)
      }
      const data = (await resp.json()) as { healthy?: boolean; version?: string }
      if (!data.healthy) {
        throw new Error("Remote server reported unhealthy")
      }
      log.info(`Remote opencode healthy (version ${data.version ?? "unknown"})`)
    } finally {
      clearTimeout(timer)
    }

    this.client = this.makeRemoteClient(baseUrl)
    this.port = 0 // not meaningful in remote mode
    this.reconnectAttempts = 0
    this._onEvent.fire({ type: "server_connected", data: { port: 0, remote: true, url: baseUrl } })
    this.subscribeToEvents()
    await this.recoverSessions()
  }

  private makeClient(port: number): OpencodeClient {
    const baseUrl = `http://127.0.0.1:${port}`
    if (this.serverPassword) {
      const basic = Buffer.from(`opencode:${this.serverPassword}`).toString("base64")
      return createOpencodeClient({
        baseUrl,
        headers: { Authorization: `Basic ${basic}` },
      })
    }
    return createOpencodeClient({ baseUrl })
  }

  private async _start(): Promise<void> {
    // Remote-attach mode: skip spawn, connect directly.
    if (this.remoteServerUrl) {
      await this._startRemote()
      return
    }
    // Generate a per-run server password if not already set
    if (!this.serverPassword) {
      this.generatePassword()
    }
    // Attempt to reuse previously stored port if server still healthy
    if (this.storedPort) {
      try {
        const healthHeaders: Record<string, string> = {}
        if (this.serverPassword) {
          healthHeaders["Authorization"] = `Basic ${Buffer.from(`opencode:${this.serverPassword}`).toString("base64")}`
        }
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
            this.client = this.makeClient(this.port)

            // Verify the password works by making an authenticated API call
            try {
              await this.client.session.list()
            } catch {
              log.info(`Stored port ${this.storedPort} auth mismatch — starting new server`)
              this.client = null
              this.port = 0
              throw new Error("Auth verification failed")
            }

            this.reconnectAttempts = 0
            this._onEvent.fire({ type: "server_connected", data: { port: this.port } })
            log.info("OpenCode server connected (reused)")
            this.subscribeToEvents()
            await this.recoverSessions()
            return
          }
        }
      } catch (e) {
        const msg = (e as Error).message
        if (!msg.includes("Auth verification failed")) {
          log.info(`Stored port ${this.storedPort} health check failed, starting new server`)
        }
      }
    }

    this.port = await findFreePort()

    const opencodePath = await this.findOpencodeBinary()
    if (!opencodePath) {
      throw new Error(
        "OpenCode is not installed. Install it from https://opencode.ai, then reload the window."
      )
    }

    log.info(`Starting opencode server on port ${this.port} (${opencodePath})`)

    // Determine working directory - use workspace folder if available
    let cwd: string | undefined
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      cwd = folders[0]!.uri.fsPath
      log.info(`Starting opencode server in workspace: ${cwd}`)
    } else {
      cwd = process.cwd()
      log.info(`No workspace folder; using cwd: ${cwd}`)
    }

    // Only pass essential env vars to the child process to prevent secret leakage
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
    childEnv["OPENCODE_SERVER_PASSWORD"] = this.serverPassword
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
      if (this.client) {
        this._onEvent.fire({ type: "server_disconnected", data: { code, signal } })
        this.client = null
        this.scheduleReconnect()
      }
    })

    this.serverProcess.on("error", (err) => {
      log.error("opencode server process error", err)
    })

    await this.waitForHealth()

    this.client = this.makeClient(this.port)
    this.reconnectAttempts = 0
    this._onEvent.fire({ type: "server_connected", data: { port: this.port } })
    log.info("OpenCode server connected")

    this.subscribeToEvents()

    // Try to recover existing sessions from the server (persisted to disk by opencode)
    await this.recoverSessions()
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.eventStreamController) {
      this.eventStreamController.abort()
      this.eventStreamController = null
    }
    
    const proc = this.serverProcess
    this.serverProcess = null
    this.client = null
    this.port = 0
    this.reconnectAttempts = 0

    if (proc) {
      // C4: Graceful shutdown — SIGTERM then wait, with SIGKILL fallback
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
    if (this.eventReconnectTimer) {
      clearTimeout(this.eventReconnectTimer)
      this.eventReconnectTimer = null
    }
    this.eventStreamController?.abort()
    this._onEvent.dispose()
    // We can't await stop() in a synchronous dispose(), but we can fire it off
    this.stop().catch(err => log.error("Error during SessionManager disposal", err))
  }

  /* ---- binary discovery ---- */

  private async findOpencodeBinary(): Promise<string | null> {
    const config = vscode.workspace.getConfiguration("opencode")
    const customPath = config.get<string>("binaryPath")
    if (customPath) {
      // Validate: must be absolute, no shell metacharacters
      if (!/^[/\\]|[A-Za-z]:/.test(customPath) || /[;&|`$(){}!#~<>]/.test(customPath)) {
        log.warn(`Custom binary path "${customPath}" is invalid or unsafe. Falling back to PATH lookup.`)
      } else {
        log.info(`Using custom opencode binary path: ${customPath}`)
        return customPath
      }
    }

    // Cross-platform binary discovery
    const isWindows = process.platform === "win32"
    const cmd = isWindows ? "where" : "which"
    const which = spawn(cmd, ["opencode"], { shell: false })
    return new Promise((resolve) => {
      let output = ""
      which.stdout?.on("data", (d: Buffer) => {
        output += d.toString()
      })
      which.on("close", () => {
        resolve(output.trim() || null)
      })
      which.on("error", () => resolve(null))
    })
  }

  /* ---- health check ---- */

  private async waitForHealth(timeoutMs = 10_000): Promise<void> {
    const start = Date.now()
    const healthHeaders: Record<string, string> = {}
    if (this.serverPassword) {
      const basic = Buffer.from(`opencode:${this.serverPassword}`).toString("base64")
      healthHeaders["Authorization"] = `Basic ${basic}`
    }
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
    throw new Error(
      "OpenCode server did not start within 10 seconds. Check the output channel for details."
    )
  }

  /* ---- SSE events ---- */

  private subscribeToEvents(): void {
    if (!this.client) return

    // C3: Abort previous event stream before creating a new one
    if (this.eventStreamController) {
      this.eventStreamController.abort()
    }
    this.eventStreamController = new AbortController()
    const controller = this.eventStreamController

    this.client.event
      .subscribe()
      .then((events) => {
        void (async () => {
          try {
            this.eventReconnectAttempts = 0
            log.info("OpenCode event stream opened")
            for await (const event of events.stream) {
              if (controller.signal.aborted) return
              this.lastRawEventAt = Date.now()
              this.lastRawEventType = event.type
              this.handleSdkEvent(event)
            }
            if (!controller.signal.aborted && !this.disposed) {
              log.warn(`Event stream closed (last raw=${this.lastRawEventType || "none"})`)
              this.scheduleEventStreamReconnect()
            }
          } catch (err) {
            // Stream ended or aborted – that's fine for abort, log others
            if (controller.signal.aborted) return
            log.warn("Event stream ended unexpectedly", err)
            this.scheduleEventStreamReconnect()
          }
        })()
      })
      .catch((err: Error) => {
        log.error("Event subscription failed", err)
        this.scheduleEventStreamReconnect()
      })

    log.info("Subscribed to OpenCode event stream")
  }

  private handleSdkEvent(event: SdkEvent): void {
    for (const normalized of this.eventNormalizer.normalize(event as unknown as SdkEventLike)) {
      this.lastNormalizedEventAt = Date.now()
      this.lastNormalizedEventType = normalized.type
      this._onEvent.fire(normalized)
    }
  }

  private scheduleEventStreamReconnect(): void {
    if (this.disposed || !this.client || this.eventReconnectTimer) return
    const attempt = this.eventReconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000)
    const rawAge = this.lastRawEventAt ? `${Date.now() - this.lastRawEventAt}ms ago` : "never"
    const normalizedAge = this.lastNormalizedEventAt ? `${Date.now() - this.lastNormalizedEventAt}ms ago` : "never"
    log.warn(`Reconnecting OpenCode event stream in ${delay}ms (attempt ${attempt + 1}; last raw=${this.lastRawEventType || "none"} ${rawAge}; last normalized=${this.lastNormalizedEventType || "none"} ${normalizedAge})`)
    this.eventReconnectTimer = setTimeout(() => {
      this.eventReconnectTimer = null
      if (this.disposed || !this.client) return
      this.subscribeToEvents()
      this._onEvent.fire({ type: "event_stream_reconnected" })
    }, delay)
  }

  /* ---- reconnect ---- */

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 5) {
      log.error("Max reconnect attempts reached. Please restart the extension.")
      return
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16_000)
    this.reconnectAttempts++
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/5)`)
    this.reconnectTimer = setTimeout(() => {
      this.start().catch((err) => {
        log.error("Reconnect failed", err)
        this.scheduleReconnect()
      })
    }, delay)
  }

  /* ---- session operations ---- */

  async createSession(title?: string): Promise<Session> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.create({ body: { title } })
    if (resp.error) throw new Error(`Failed to create session: ${JSON.stringify(resp.error)}`)
    log.info(`Created session: ${(resp.data as Session)?.id}`)
    return resp.data as Session
  }

  async deleteSession(id: string): Promise<boolean> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    await this.client.session.delete({ path: { id } })
    log.info(`Deleted session: ${id}`)
    return true
  }

  async getSession(id: string): Promise<Session> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.get({ path: { id } })
    // C6: Check for SDK error before returning data
    if (resp.error) throw new Error(`Failed to get session: ${JSON.stringify(resp.error)}`)
    return resp.data as Session
  }

  async getSessionMessages(id: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.messages({ path: { id } })
    if (resp.error) throw new Error(`Failed to get session messages: ${JSON.stringify(resp.error)}`)
    return (resp.data as Array<{ info: Message; parts: Part[] }> | undefined) ?? []
  }

  async listSessions(): Promise<Session[]> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.list()
    // C6: Check for SDK error before returning data
    if (resp.error) throw new Error(`Failed to list sessions: ${JSON.stringify(resp.error)}`)
    return (resp.data as Session[]) ?? []
  }

  /**
   * Send a prompt to a session.
   * The model is set **per-prompt** (not as a CLI flag), which allows
   * switching models without restarting the server.
   */
  async sendPrompt(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions
  ): Promise<{ info: Message; parts: Part[] }> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")

    const modelRef = options?.model ?? this.currentModel ?? undefined
    const variant = options?.variant
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    log.info(`Sending prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(options?.tools ?? {})})`)

    const resp = await this.client.session.prompt({
      path: { id: sessionId },
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: {
        parts,
        ...(modelRef ? { model: modelRef } : {}),
        ...(variant ? { variant } : {}),
        ...(options?.tools ? { tools: options.tools } : {}),
      },
    })

    if (resp.error) {
      throw new Error(`Prompt failed: ${JSON.stringify(resp.error)}`)
    }

    const data = resp.data as { info: Message; parts: Part[] } | undefined
    if (!data) throw new Error("Prompt returned no data")

    return { info: data.info, parts: data.parts }
  }

  /**
   * Send a prompt asynchronously – starts processing and returns immediately.
   * Use event stream to receive streaming updates.
   * Includes exponential backoff retry for network-related failures.
   */
  private readonly MAX_RETRIES = 3
  private readonly BASE_BACKOFF_MS = 1000 // 1 second

  async sendPromptAsync(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions
  ): Promise<void> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")

    const modelRef = options?.model ?? this.currentModel ?? undefined
    const variant = options?.variant
    // Generate a per-prompt idempotency key so the server can deduplicate retries
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    log.info(`Sending async prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(options?.tools ?? {})})`)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const resp = await this.client.session.promptAsync({
          path: { id: sessionId },
          body: {
            parts,
            ...(modelRef ? { model: modelRef } : {}),
            ...(variant ? { variant } : {}),
            ...(options?.tools ? { tools: options.tools } : {}),
          },
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        })

        if (resp.error) {
          const errorMsg = JSON.stringify(resp.error)
          // Only retry on network/timeout errors, not business logic errors
          if (this.isRetryableError(resp.error) && attempt < this.MAX_RETRIES) {
            lastError = new Error(`Async prompt failed: ${errorMsg}`)
            log.warn(`Prompt attempt ${attempt + 1} failed, retrying...`, lastError)
            await this.exponentialDelay(attempt)
            continue
          }
          throw new Error(`Async prompt failed: ${errorMsg}`)
        }

        // Success - return early
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // Only retry network/timeout errors — not business logic failures
        if (this.isRetryableError(err) && attempt < this.MAX_RETRIES) {
          log.warn(`Prompt attempt ${attempt + 1} failed, retrying...`, lastError)
          await this.exponentialDelay(attempt)
        } else {
          throw lastError
        }
      }
    }

    throw lastError || new Error("Prompt failed after retries")
  }

  /**
   * Determine if an error is retryable (network/timeout, not business logic)
   */
  private isRetryableError(error: unknown): boolean {
    if (!error) return false
    const errorStr = typeof error === "string" ? error : JSON.stringify(error)
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /econnrefused/i,
      /econnreset/i,
      /etimedout/i,
      /enotfound/i,
      /enetunreach/i,
      /fetch failed/i,
      /socket hang up/i,
      /request failed/i,
    ]
    return retryablePatterns.some(pattern => pattern.test(errorStr))
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private async exponentialDelay(attempt: number): Promise<void> {
    const baseDelay = this.BASE_BACKOFF_MS * Math.pow(2, attempt)
    const jitter = Math.random() * 0.3 * baseDelay // Add up to 30% jitter
    const delay = Math.min(baseDelay + jitter, 30000) // Cap at 30 seconds
    log.info(`Retrying in ${Math.round(delay)}ms...`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  async sendCommand(sessionId: string, command: string, args?: string): Promise<{ info: Message; parts: Part[] }> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.command({
      path: { id: sessionId },
      body: { command, arguments: args ?? "" },
    })
    if (resp.error) throw new Error(`Command failed: ${JSON.stringify(resp.error)}`)
    return resp.data as { info: Message; parts: Part[] }
  }

  async compactSession(sessionId: string, model?: ModelRef): Promise<boolean> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const modelRef = model ?? this.currentModel ?? undefined
    const resp = await this.client.session.summarize({
      path: { id: sessionId },
      body: modelRef ? { providerID: modelRef.providerID, modelID: modelRef.modelID } : undefined,
    })
    if (resp.error) throw new Error(`Compaction failed: ${JSON.stringify(resp.error)}`)
    log.info(`Session compacted: ${sessionId}`)
    return resp.data as boolean
  }

  async listCommands(): Promise<Array<{ name: string; description?: string; template: string }>> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.command.list()
    if (resp.error) throw new Error(`Failed to list commands: ${JSON.stringify(resp.error)}`)
    return (resp.data as Array<{ name: string; description?: string; template: string }>) ?? []
  }

  async abortSession(sessionId: string): Promise<boolean> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    await this.client.session.abort({ path: { id: sessionId } })
    log.info(`Aborted session: ${sessionId}`)
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.messages({
      path: { id: sessionId },
      query: { limit },
    })
    // C6: Check for SDK error before returning data
    if (resp.error) throw new Error(`Failed to get messages: ${JSON.stringify(resp.error)}`)
    return (resp.data as { info: unknown; parts: Part[] }[]) ?? []
  }

  async getSessionDiff(sessionId: string, messageId?: string): Promise<unknown> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.diff({
      path: { id: sessionId },
      query: { messageID: messageId },
    })
    // C6: Check for SDK error before returning data
    if (resp.error) throw new Error(`Failed to get diff: ${JSON.stringify(resp.error)}`)
    return resp.data
  }

  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    await this.client.session.revert({ path: { id: sessionId }, body: { messageID: messageId } })
    log.info(`Reverted message ${messageId} in session ${sessionId}`)
    return true
  }

  async respondToPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")
    if (!sessionId) throw new Error("Permission response missing session ID")
    if (!permissionId) throw new Error("Permission response missing permission ID")
    const normalized = this.normalizePermissionResponse(response)
    const resp = await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response: normalized },
    })
    if (resp.error) throw new Error(`Permission response failed: ${JSON.stringify(resp.error)}`)
    log.info(`Permission ${permissionId} responded with: ${normalized}`)
  }

  private normalizePermissionResponse(response: string): "once" | "always" | "reject" {
    if (response === "always") return "always"
    if (response === "reject" || response === "deny") return "reject"
    return "once"
  }

  /* ---- model management ---- */

  setModel(providerID: string, modelID: string): void {
    this.currentModel = { providerID, modelID }
    log.info(`Model set to ${providerID}/${modelID}`)
    // No server restart needed – model is sent per-prompt
  }

  clearModel(): void {
    this.currentModel = null
    log.info("Model cleared – will use server default")
  }

  /* ---- session recovery (after server restart) ---- */

  /**
   * After the server starts, query it for any sessions that were persisted
   * to disk. Fire a `sessions_recovered` event so the SessionStore can
   * re-attach local sessions to their server-side counterparts.
   */
  /**
   * Resolve the workspace directory the extension is running against. Used to
   * scope session listings to the current project, matching opencode CLI
   * behavior. Returns undefined when no folder is open or in remote-attach
   * mode (the remote server may report paths from a different mount point
   * that we cannot meaningfully compare).
   */
  private currentWorkspaceDir(): string | undefined {
    if (this.isRemote) return undefined
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return undefined
    return folders[0]!.uri.fsPath
  }

  /** True when `dir` matches the current workspace folder, or when scoping is disabled. */
  isInCurrentWorkspace(dir?: string): boolean {
    const workspace = this.currentWorkspaceDir()
    if (!workspace) return true
    if (!dir) return false
    return dir === workspace
  }

  private async recoverSessions(): Promise<void> {
    if (!this.client) return
    try {
      const allServerSessions = await this.listSessions()
      // Filter out only subagent (child) sessions. We intentionally show sessions
      // from all workspaces so CLI-created sessions surface in the unified modal.
      const serverSessions = allServerSessions.filter((s) => !s.parentID)
      const dropped = allServerSessions.length - serverSessions.length
      log.info(`Server has ${serverSessions.length} session(s) (${dropped} hidden: subagents only)`)
      this._onEvent.fire({
        type: "sessions_recovered",
        data: { sessions: serverSessions },
      })
    } catch (err) {
      log.warn("Could not recover sessions from server (non-fatal)", err)
    }
  }

  /**
   * Check whether a server-side session still exists.
   * Used to validate a locally-stored cliSessionId after a server restart.
   */
  async sessionExists(id: string): Promise<boolean> {
    if (!this.client) return false
    try {
      await this.getSession(id)
      return true
    } catch {
      return false
    }
  }

  /**
   * Attempt to re-attach a local session to a server-side session.
   * Returns the valid cliSessionId (existing or newly created).
   *
   * Flow:
   *  1. If the local session has a cliSessionId, check if it still exists on the server.
   *  2. If yes → reuse it (server persisted the session across restart).
   *  3. If no  → create a new server-side session. The server won't have the old
   *     history, but the local UI still shows it. The next prompt will be the first
   *     in the new server session.
   */
  async ensureSession(cliSessionId: string | undefined, title?: string): Promise<string> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")

    // If we have an existing ID, verify it's still valid on the server
    if (cliSessionId) {
      const exists = await this.sessionExists(cliSessionId)
      if (exists) {
        log.info(`Re-attached to existing server session: ${cliSessionId}`)
        return cliSessionId
      }
      log.info(`Server session ${cliSessionId} no longer exists – creating new one`)
    }

    // Create a fresh server-side session
    const session = await this.createSession(title)
    return session.id
  }
}
