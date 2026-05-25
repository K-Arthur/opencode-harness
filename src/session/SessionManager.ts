import * as vscode from "vscode"
import {
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
import { randomUUID } from "crypto"
import * as os from "os"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { log } from "../utils/outputChannel"
import type { McpServerManager } from "../mcp/McpServerManager"
import type { SdkEventLike } from "./types"
import { AuthProvider } from "./AuthProvider"
import { ServerLifecycle } from "./ServerLifecycle"
import { SseSubscriber } from "./SseSubscriber"
import { SessionClient } from "./SessionClient"

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
  | "session_updated"
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
  agent?: string
  tools?: Record<string, boolean>
  variant?: string
  signal?: AbortSignal
}

export type EventStreamLifecycleState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"

export interface EventStreamStatus {
  state: EventStreamLifecycleState
  lastRawEventType?: string
  lastRawEventAt?: number
  reconnectAttempts: number
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
  private client: OpencodeClient | null = null
  private disposed = false
  private _onEvent = new vscode.EventEmitter<OpencodeEvent>()

  readonly authProvider: AuthProvider
  readonly serverLifecycle: ServerLifecycle
  readonly sseSubscriber: SseSubscriber
  readonly sessionClient: SessionClient

  constructor(mcpServerManager?: McpServerManager) {
    this.authProvider = new AuthProvider()
    this.serverLifecycle = new ServerLifecycle(this.authProvider)
    this.sessionClient = new SessionClient(
      () => this.client,
      mcpServerManager ?? undefined,
      () => this.disposed,
    )
    this.sseSubscriber = new SseSubscriber(
      () => this.client,
      () => this.serverBaseUrl(),
      () => this.authHeader,
      (event) => this._onEvent.fire(event),
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
    return this.client !== null
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
    if (this.client) return

    if (this.authProvider.isRemote) {
      await this._startRemote()
      return
    }

    await this.serverLifecycle.start(async (port) => {
      this.client = this.authProvider.makeClient(port)
      this.sseSubscriber.subscribe()
      await this.recoverSessions()
    })
  }

  private async _startRemote(): Promise<void> {
    const baseUrl = this.authProvider.remoteServerUrl!
    log.info(`Attaching to remote opencode server at ${baseUrl}`)

    const headers: Record<string, string> = {}
    if (this.authProvider.authHeader) headers["Authorization"] = this.authProvider.authHeader
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const resp = await fetch(`${baseUrl}/global/health`, {
        signal: controller.signal,
        headers,
      })
      if (!resp.ok) throw new Error(`Remote server returned HTTP ${resp.status}`)
      const data = (await resp.json()) as { healthy?: boolean; version?: string }
      if (!data.healthy) throw new Error("Remote server reported unhealthy")
      log.info(`Remote opencode healthy (version ${data.version ?? "unknown"})`)
    } finally {
      clearTimeout(timer)
    }

    this.client = this.authProvider.makeRemoteClient(baseUrl)
    this._onEvent.fire({ type: "server_connected", data: { port: 0, remote: true, url: baseUrl } })
    this.sseSubscriber.subscribe()
    await this.recoverSessions()
  }

  async stop(): Promise<void> {
    this.sseSubscriber.disconnect()
    await this.serverLifecycle.stop()
    this.client = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
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
  }

  /* ---- session operations (delegate to SessionClient) ---- */

  async createSession(title?: string): Promise<Session> {
    return this.sessionClient.createSession(title)
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessionClient.deleteSession(id)
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

  async listSessions(): Promise<Session[]> {
    return this.sessionClient.listSessions()
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

  async respondToPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
    return this.sessionClient.respondToPermission(sessionId, permissionId, response)
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

  private currentWorkspaceDir(): string | undefined {
    if (this.isRemote) return undefined
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return undefined
    return folders[0]!.uri.fsPath
  }

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
