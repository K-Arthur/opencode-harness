import * as vscode from "vscode"
import {
  type Session,
  type Message,
  type Part,
  type TextPartInput,
  type FilePartInput,
  type AgentPartInput,
  type SubtaskPartInput,
} from "@opencode-ai/sdk/v2"
import * as os from "os"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { log } from "../utils/outputChannel"
import type { McpServerManager } from "../mcp/McpServerManager"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import type { SdkEventLike } from "./eventHandlers/types"
import { AuthProvider } from "./AuthProvider"
import { ServerLifecycle } from "./ServerLifecycle"
import { SseSubscriber } from "./SseSubscriber"
import { SessionClient } from "./SessionClient"
import { PtyService } from "./PtyService"
import type { LiveToolOutputSnapshot } from "./liveToolOutput"
import { probeServerCompatibility } from "./compatibilityProbe"
import type { BackendRuntime, CompatibilityProbeResult, RuntimePreference } from "./serverIdentity"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type { OpencodeEventType, OpencodeEvent, ModelRef, PromptOptions, EventStreamLifecycleState, EventStreamStatus } from "./sessionTypes"
import type { OpencodeEvent, ModelRef, PromptOptions, EventStreamStatus } from "./sessionTypes"

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

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match || !match[1]) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "")
    result[key] = val
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  SessionManager — thin façade                                       */
/* ------------------------------------------------------------------ */

export class SessionManager {
  private v2Client: V2OpencodeClient | null = null
  private compatibility: CompatibilityProbeResult | null = null
  private connectionGeneration = 0
  private disposed = false
  private startPromise: Promise<void> | null = null
  private _onEvent = new vscode.EventEmitter<OpencodeEvent>()
  private readonly lifecycleDisposables: vscode.Disposable[] = []

  readonly authProvider: AuthProvider
  readonly serverLifecycle: ServerLifecycle
  readonly sseSubscriber: SseSubscriber
  readonly sessionClient: SessionClient
  readonly ptyService: PtyService

  constructor(mcpServerManager?: McpServerManager) {
    this.authProvider = new AuthProvider()
    this.serverLifecycle = new ServerLifecycle(this.authProvider)
    this.sessionClient = new SessionClient(
      mcpServerManager ?? undefined,
      () => this.disposed,
      () => this.v2Client,
      () => this.apiSurface,
      () => this.workspaceDirectory(),
    )
    this.ptyService = new PtyService(
      () => this.v2Client,
      () => this.authHeader,
      () => this.serverBaseUrl(),
    )
    this.sseSubscriber = new SseSubscriber(
      () => this.v2Client !== null,
      () => this.serverBaseUrl(),
      () => this.authHeader,
      (event) => this._onEvent.fire(event),
      () => this.apiSurface,
    )
    this.lifecycleDisposables.push(
      this.serverLifecycle.onDisconnected((data) => {
        this.sseSubscriber.disconnect()
        this.v2Client = null
        this.compatibility = null
        this._onEvent.fire({ type: "server_disconnected", data })
      }),
    )
  }

  /* ---- public getters ---- */

  readonly onEvent = this._onEvent.event

  subscribe(name: string, handler: (event: OpencodeEvent) => void): vscode.Disposable {
    return this._onEvent.event((event) => {
      try {
        handler(event)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(`SessionManager subscriber "${name}" threw on ${event.type}: ${message}`, err)
      }
    })
  }

  get isRunning(): boolean {
    // The SDK client is installed before the compatibility handshake runs.
    // Treat that interval as not ready so callers wait for the verified API
    // surface instead of sending a legacy request to an OpenCode 2 server.
    return this.v2Client !== null && this.compatibility?.supported === true
  }

  getV2Client(): V2OpencodeClient | null {
    return this.v2Client
  }

  get serverIdentity(): CompatibilityProbeResult["identity"] | null {
    return this.compatibility?.identity ?? null
  }

  get capabilities(): CompatibilityProbeResult["capabilities"] | null {
    return this.compatibility?.capabilities ?? null
  }

  get runtime(): BackendRuntime {
    return this.compatibility?.identity.runtime ?? this.serverLifecycle.runtime
  }

  get apiSurface(): "legacy" | "opencode2" | "unknown" {
    return this.compatibility?.identity.apiSurface ?? "unknown"
  }

  get currentPort(): number {
    return this.serverLifecycle.currentPort
  }

  get model(): ModelRef | null {
    return this.sessionClient.model
  }

  get authHeader(): string | undefined {
    return this.authProvider.authHeader
  }

  get isRemote(): boolean {
    return this.authProvider.isRemote
  }

  get eventStreamStatus(): EventStreamStatus {
    return this.sseSubscriber.status
  }

  get isEventStreamReady(): boolean {
    return this.sseSubscriber.isReady
  }

  async waitForEventStreamReady(timeoutMs = 5_000): Promise<boolean> {
    return this.sseSubscriber.waitForReady(timeoutMs)
  }

  private serverBaseUrl(): string | null {
    if (this.authProvider.isRemote && this.authProvider.remoteServerUrl) return this.authProvider.remoteServerUrl
    if (this.serverLifecycle.currentPort > 0) return `http://127.0.0.1:${this.serverLifecycle.currentPort}`
    return null
  }

  /* ---- lifecycle ---- */

  async start(): Promise<void> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (this.v2Client && this.compatibility?.supported === true) return
    if (this.startPromise) return this.startPromise

    const operation = (async () => {
      if (this.authProvider.isRemote) {
        await this._startRemote()
        return
      }

      await this.serverLifecycle.start(async (port) => {
        this.v2Client = this.authProvider.makeV2Client(port, this.workspaceDirectory())
        try {
          await this.verifyCompatibility(`http://127.0.0.1:${port}`, false)
          this._onEvent.fire({ type: "server_connected", data: this.connectionData(port, false) })
          this.sseSubscriber.subscribe()
          await this.recoverSessions()
        } catch (error) {
          this.v2Client = null
          await this.serverLifecycle.stop()
          throw error
        }
      })
    })()
    this.startPromise = operation
    try {
      await operation
    } finally {
      if (this.startPromise === operation) this.startPromise = null
    }
  }

  private async _startRemote(): Promise<void> {
    const baseUrl = this.authProvider.remoteServerUrl!
    log.info(`Attaching to remote OpenCode server at ${baseUrl}`)
    this.v2Client = this.authProvider.makeRemoteV2Client(baseUrl)
    try {
      await this.verifyCompatibility(baseUrl, true)
      this._onEvent.fire({ type: "server_connected", data: this.connectionData(0, true) })
      this.sseSubscriber.subscribe()
      await this.recoverSessions()
    } catch (error) {
      this.v2Client = null
      throw error
    }
  }

  async stop(): Promise<void> {
    this.sseSubscriber.disconnect()
    this.ptyService.dispose()
    await this.serverLifecycle.stop()
    this.v2Client = null
    this.compatibility = null
  }

  /**
   * Change the runtime used by this extension connection.
   *
   * The extension deliberately owns one active runtime at a time. Switching
   * tears down the current HTTP/SSE client before persisting the preference and
   * starting the selected runtime, so sessions and event state cannot leak
   * between the legacy and OpenCode 2 API surfaces.
   */
  private runtimeSwitchPromise: Promise<void> | null = null

  async setRuntimePreference(preference: RuntimePreference): Promise<void> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (this.runtimeSwitchPromise) return this.runtimeSwitchPromise
    if (this.v2Client && this.runtimePreference() === preference) return

    const operation = (async () => {
      const previousPreference = this.runtimePreference()
      const currentlyConnected = this.v2Client !== null
      if (currentlyConnected) {
        this._onEvent.fire({
          type: "server_disconnected",
          data: { reason: "runtime_switch", runtime: this.runtime },
        })
        // stop() disposes PTY permanently. Runtime switching is a reconnect,
        // not extension disposal, so retain the PTY service for the new client.
        this.sseSubscriber.disconnect()
        await this.serverLifecycle.stop()
        this.v2Client = null
        this.compatibility = null
      }

      try {
        await vscode.workspace.getConfiguration("opencode").update(
          "runtime",
          preference,
          vscode.ConfigurationTarget.Global,
        )
        await this.start()
      } catch (error) {
        // A failed switch must not leave the setting pointing at a runtime
        // that did not pass the compatibility handshake. Restore the prior
        // preference and, when possible, reattach the previous connection.
        try {
          await vscode.workspace.getConfiguration("opencode").update(
            "runtime",
            previousPreference,
            vscode.ConfigurationTarget.Global,
          )
          if (currentlyConnected) await this.start()
        } catch (restoreError) {
          log.error("Failed to restore the previous OpenCode runtime after a switch failure", restoreError)
        }
        throw error
      }
    })()

    this.runtimeSwitchPromise = operation
    try {
      await operation
    } finally {
      this.runtimeSwitchPromise = null
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const disposable of this.lifecycleDisposables) disposable.dispose()
    this.lifecycleDisposables.length = 0
    this.ptyService.dispose()
    this.sseSubscriber.dispose()
    this._onEvent.dispose()
    this.serverLifecycle.dispose()
  }

  /* ---- configuration ---- */

  setStoredPort(port?: number): void {
    this.serverLifecycle.setStoredPort(port)
  }

  setRemoteServer(url: string | null | undefined, password?: string | null): void {
    this.authProvider.setRemoteServer(url, password)
    this.compatibility = null
  }

  /* ---- session operations (delegate to SessionClient) ---- */

  async createSession(title?: string): Promise<Session> {
    return this.sessionClient.createSession(title)
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessionClient.deleteSession(id)
  }

  async archiveSession(id: string, archived: boolean): Promise<Session> {
    return this.sessionClient.archiveSession(id, archived)
  }

  async forkSession(sessionId: string, messageId: string): Promise<Session> {
    return this.sessionClient.forkSession(sessionId, messageId)
  }

  /** Run a shell command in session context (P1.4). Returns the AI's response. */
  async runShell(
    sessionId: string,
    command: string,
    opts?: { model?: { providerID: string; modelID: string }; agent?: string; messageID?: string },
  ): Promise<{ messageId: string; text: string }> {
    return this.sessionClient.runShell(sessionId, command, opts)
  }

  /** Create a shareable link for a session (P3.2). */
  async shareSession(sessionId: string): Promise<Session> {
    return this.sessionClient.shareSession(sessionId)
  }

  /** Remove the shareable link for a session (P3.2). */
  async unshareSession(sessionId: string): Promise<Session> {
    return this.sessionClient.unshareSession(sessionId)
  }

  async getSession(id: string): Promise<Session> {
    return this.sessionClient.getSession(id)
  }

  async updateSessionTitle(id: string, title: string): Promise<Session> {
    return this.sessionClient.updateSessionTitle(id, title)
  }

  async getSessionMessages(id: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    return this.sessionClient.getSessionMessages(id)
  }

  async getToolPartialOutput(sessionId: string, callId: string, sinceToken = 0): Promise<LiveToolOutputSnapshot> {
    return this.sessionClient.getToolPartialOutput(sessionId, callId, sinceToken)
  }

  async listSessions(): Promise<Session[]> {
    return this.sessionClient.listSessions()
  }

  /** Read a workspace file (and its server-computed diff) for the changed-files view. */
  async getFileContent(path: string, directory?: string, messageId?: string): Promise<unknown> {
    return this.sessionClient.readFile(path, directory, messageId)
  }

  async sendPrompt(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions,
  ): Promise<{ info: Message; parts: Part[] }> {
    return this.sessionClient.sendPrompt(sessionId, parts, options)
  }

  async sendPromptAsync(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions,
  ): Promise<void> {
    return this.sessionClient.sendPromptAsync(
      sessionId,
      parts,
      options,
      this.sseSubscriber.status.state,
      this.sseSubscriber.status.lastRawEventType,
    )
  }

  async sendCommand(sessionId: string, command: string, args?: string): Promise<{ info: Message; parts: Part[] }> {
    return this.sessionClient.sendCommand(sessionId, command, args)
  }

  async compactSession(sessionId: string, model?: ModelRef): Promise<boolean> {
    return this.sessionClient.compactSession(sessionId, model)
  }

  async listCommands(): Promise<Array<{ name: string; description?: string; template: string; agent?: string; source?: string }>> {
    return this.sessionClient.listCommands()
  }

  async listSkills(): Promise<Array<{ name: string; description?: string; source: "skill" }>> {
    return this.sessionClient.listSkills()
  }

  async abortSession(sessionId: string): Promise<boolean> {
    return this.sessionClient.abortSession(sessionId)
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    return this.sessionClient.getMessages(sessionId, limit)
  }

  async getSessionDiff(sessionId: string, messageId?: string): Promise<unknown> {
    return this.sessionClient.getSessionDiff(sessionId, messageId)
  }

  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    return this.sessionClient.revertMessage(sessionId, messageId)
  }

  async revert(sessionId: string, messageId: string, partId?: string): Promise<boolean> {
    return this.sessionClient.revert(sessionId, messageId, partId)
  }

  async unrevert(sessionId: string): Promise<boolean> {
    return this.sessionClient.unrevert(sessionId)
  }

  async respondToPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
    return this.sessionClient.respondToPermission(sessionId, permissionId, response)
  }

  async replyToQuestion(sessionId: string, requestID: string, answers: string[][]): Promise<void> {
    return this.sessionClient.replyToQuestion(sessionId, requestID, answers)
  }

  async rejectQuestion(sessionId: string, requestID: string): Promise<void> {
    return this.sessionClient.rejectQuestion(sessionId, requestID)
  }

  async getSessionTodos(id: string): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    return this.sessionClient.getSessionTodos(id)
  }

  async listAgents(directory?: string): Promise<Array<{ name: string; description?: string; mode: string; builtIn: boolean }>> {
    return this.sessionClient.listAgents(directory)
  }

  async sessionExists(id: string): Promise<boolean> {
    return this.sessionClient.sessionExists(id)
  }

  async ensureSession(cliSessionId: string | undefined, title?: string): Promise<string> {
    return this.sessionClient.ensureSession(cliSessionId, title)
  }

  /* ---- model management ---- */

  setModel(providerID: string, modelID: string): void {
    this.sessionClient.setModel(providerID, modelID)
  }

  clearModel(): void {
    this.sessionClient.clearModel()
  }

  /* ---- session recovery ---- */

  private async recoverSessions(): Promise<void> {
    if (!this.v2Client) return
    try {
      const allServerSessions = await this.listSessions()
      const serverSessions = allServerSessions.filter((s) => !(s as { parentID?: string }).parentID)
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

  private runtimePreference(): RuntimePreference {
    const value = vscode.workspace.getConfiguration("opencode").get<string>("runtime", "auto")
    return value === "opencode" || value === "opencode2" ? value : "auto"
  }

  private workspaceDirectory(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  }

  private async verifyCompatibility(baseUrl: string, isRemote: boolean): Promise<void> {
    const result = await probeServerCompatibility({
      baseUrl,
      authHeader: this.authHeader,
      v2Client: this.v2Client,
      directory: this.workspaceDirectory(),
      isRemote,
      runtimePreference: this.runtimePreference(),
    })
    this.compatibility = result
    this.connectionGeneration++
    if (!result.supported) {
      throw new Error(result.reason ?? "The selected OpenCode server is not compatible with this extension")
    }
    log.info(`Verified OpenCode runtime=${result.identity.runtime}, API=${result.identity.apiSurface}, version=${result.identity.version}, connection=${this.connectionGeneration}`)
  }

  private connectionData(port: number, remote: boolean): Record<string, unknown> {
    return {
      port,
      remote,
      url: this.serverBaseUrl() ?? undefined,
      runtime: this.runtime,
      apiSurface: this.apiSurface,
      preference: this.runtimePreference(),
      version: this.serverIdentity?.version,
      connectionGeneration: this.connectionGeneration,
    }
  }

  /* ---- event helpers (exposed for callers that need them) ---- */

  sessionIdFromEvent(event: { properties?: unknown; type?: string }): string | undefined {
    return this.sseSubscriber.sessionIdFromEvent(event as SdkEventLike)
  }

  /* ---- skill scanning ---- */

  async scanLocalSkills(): Promise<Array<{ id: string; name: string; description: string; category: string }>> {
    const seen = new Set<string>()
    const results: Array<{ id: string; name: string; description: string; category: string }> = []

    async function readSkillMd(
      mdPath: string,
      skillId: string,
      category: string,
    ): Promise<{ id: string; name: string; description: string; category: string }> {
      let name = skillId
      let description = ""
      try {
        const content = await fsPromises.readFile(mdPath, "utf8")
        const fm = parseSkillFrontmatter(content)
        name = fm.name || skillId
        description = fm.description || ""
      } catch { /* unreadable skill, use defaults */ }
      return { id: skillId, name, description, category }
    }

    const agentsBase = process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".agents")
    const userSkillsDir = path.join(agentsBase, "skills")
    const lockPath = path.join(agentsBase, ".skill-lock.json")

    let lockHandled = false
    try {
      const raw = await fsPromises.readFile(lockPath, "utf8")
      const lock = JSON.parse(raw) as { skills: Record<string, { pluginName?: string }> }
      const entries = await Promise.all(
        Object.entries(lock.skills).map(([skillId, meta]) => {
          const mdPath = path.join(userSkillsDir, skillId, "SKILL.md")
          return readSkillMd(mdPath, skillId, meta.pluginName ?? "skills")
        })
      )
      for (const entry of entries) {
        if (!seen.has(entry.id)) { seen.add(entry.id); results.push(entry) }
      }
      lockHandled = true
    } catch { /* no lock file */ }

    if (!lockHandled) {
      try {
        const dirs = await fsPromises.readdir(userSkillsDir, { withFileTypes: true })
        const entries = await Promise.all(
          dirs.filter((d) => d.isDirectory()).map((d) => readSkillMd(path.join(userSkillsDir, d.name, "SKILL.md"), d.name, "skills"))
        )
        for (const entry of entries) {
          if (!seen.has(entry.id)) { seen.add(entry.id); results.push(entry) }
        }
      } catch { /* no skills dir */ }
    }

    const pluginsDir = path.join(os.homedir(), ".cache", "plugins")
    try {
      const pluginDirs = await fsPromises.readdir(pluginsDir, { withFileTypes: true })
      await Promise.all(
        pluginDirs.filter((d) => d.isDirectory()).map(async (pluginDir) => {
          const pluginSkillsDir = path.join(pluginsDir, pluginDir.name, "skills")
          try {
            const skillDirs = await fsPromises.readdir(pluginSkillsDir, { withFileTypes: true })
            const entries = await Promise.all(
              skillDirs.filter((d) => d.isDirectory()).map((d) =>
                readSkillMd(path.join(pluginSkillsDir, d.name, "SKILL.md"), d.name, pluginDir.name)
              )
            )
            for (const entry of entries) {
              if (!seen.has(entry.id)) { seen.add(entry.id); results.push(entry) }
            }
          } catch { /* no skills subdir */ }
        })
      )
    } catch { /* no plugins dir */ }

    return results
  }
}
