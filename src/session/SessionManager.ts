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
import { findFreePort } from "../utils/portFinder"
import { log } from "../utils/outputChannel"
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
  private readonly eventNormalizer = createSdkEventNormalizer()

  /** Current model selection – sent per-prompt via the SDK. */
  private currentModel: ModelRef | null = null

  /** Guard against concurrent start() calls (C1 fix) */
  private startPromise: Promise<void> | null = null

  /** Whether the manager has been disposed */
  private disposed = false

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

  private async _start(): Promise<void> {
    this.port = await findFreePort()

    const opencodePath = await this.findOpencodeBinary()
    if (!opencodePath) {
      throw new Error(
        "OpenCode is not installed. Install it from https://opencode.ai, then reload the window."
      )
    }

    log.info(`Starting opencode server on port ${this.port} (${opencodePath})`)

    this.serverProcess = spawn(opencodePath, ["serve", "--port", String(this.port), "--hostname", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
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

    this.client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${this.port}` })
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
    while (Date.now() - start < timeoutMs) {
      try {
        // M4: Per-request timeout to avoid burning all retries on one hanging fetch
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2_000)
        const resp = await fetch(`http://127.0.0.1:${this.port}/global/health`, {
          signal: controller.signal,
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

    this.client.event
      .subscribe()
      .then((events) => {
        void (async () => {
          try {
            for await (const event of events.stream) {
              this.handleSdkEvent(event)
            }
          } catch (err) {
            // Stream ended or aborted – that's fine for abort, log others
            if (this.eventStreamController?.signal.aborted) return
            log.warn("Event stream ended unexpectedly", err)
          }
        })()
      })
      .catch((err: Error) => {
        log.error("Event subscription failed", err)
      })

    log.info("Subscribed to OpenCode event stream")
  }

  private handleSdkEvent(event: SdkEvent): void {
    for (const normalized of this.eventNormalizer.normalize(event as unknown as SdkEventLike)) {
      this._onEvent.fire(normalized)
    }
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
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.create({ body: { title } })
    if (resp.error) throw new Error(`Failed to create session: ${JSON.stringify(resp.error)}`)
    log.info(`Created session: ${(resp.data as Session)?.id}`)
    return resp.data as Session
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.delete({ path: { id } })
    log.info(`Deleted session: ${id}`)
    return true
  }

  async getSession(id: string): Promise<Session> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.get({ path: { id } })
    // C6: Check for SDK error before returning data
    if (resp.error) throw new Error(`Failed to get session: ${JSON.stringify(resp.error)}`)
    return resp.data as Session
  }

  async listSessions(): Promise<Session[]> {
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
    model?: ModelRef
  ): Promise<{ info: Message; parts: Part[] }> {
    if (!this.client) throw new Error("Server not running")

    const modelRef = model ?? this.currentModel ?? undefined
    log.info(`Sending prompt to session ${sessionId} (model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"})`)

    const resp = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        ...(modelRef ? { model: modelRef } : {}),
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
    model?: ModelRef
  ): Promise<void> {
    if (!this.client) throw new Error("Server not running")

    const modelRef = model ?? this.currentModel ?? undefined
    log.info(`Sending async prompt to session ${sessionId}`)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const resp = await this.client.session.promptAsync({
          path: { id: sessionId },
          body: {
            parts,
            ...(modelRef ? { model: modelRef } : {}),
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

        if (attempt < this.MAX_RETRIES) {
          log.warn(`Prompt attempt ${attempt + 1} failed, retrying...`, lastError)
          await this.exponentialDelay(attempt)
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
      /fetch failed/i,
      /socket/i,
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

  async sendCommand(sessionId: string, command: string): Promise<{ info: Message; parts: Part[] }> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.command({
      path: { id: sessionId },
      body: { command, arguments: "" },
    })
    if (resp.error) throw new Error(`Command failed: ${JSON.stringify(resp.error)}`)
    return resp.data as { info: Message; parts: Part[] }
  }

  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.abort({ path: { id: sessionId } })
    log.info(`Aborted session: ${sessionId}`)
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
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
    if (!this.client) throw new Error("Server not running")
    await this.client.session.revert({ path: { id: sessionId }, body: { messageID: messageId } })
    log.info(`Reverted message ${messageId} in session ${sessionId}`)
    return true
  }

  async respondToPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
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
  private async recoverSessions(): Promise<void> {
    if (!this.client) return
    try {
      const serverSessions = await this.listSessions()
      log.info(`Server has ${serverSessions.length} persisted session(s)`)
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
