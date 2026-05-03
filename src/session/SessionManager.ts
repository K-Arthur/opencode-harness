import * as vscode from "vscode"
import { createOpencodeClient, type OpencodeClient, type Session, type Message, type Part, type TextPartInput, type FilePartInput, type AgentPartInput, type SubtaskPartInput } from "@opencode-ai/sdk"
import { spawn, type ChildProcess } from "child_process"
import { findFreePort, isPortInUse } from "../utils/portFinder"
import { estimateTokens, estimateContextTokens } from "../utils/tokenCounter"

export interface OpencodeEvent {
  type: "tool_start" | "tool_end" | "skill_load" | "thinking" | "text_chunk" | "server_connected" | "server_disconnected"
  sessionId?: string
  data?: unknown
}

export interface ContextPackage {
  openFiles: { path: string; language: string; content: string; selection?: { startLine: number; endLine: number; text: string } }[]
  diagnostics: unknown
  workspaceTree: unknown
  projectConfigs: unknown[]
  gitStatus: { branch: string; modified: string[]; staged: string[]; recentDiff?: string }
  terminalOutput?: { name: string; text: string }
  explicitContext?: { type: string; content: string }[]
}

export class SessionManager {
  private client: OpencodeClient | null = null
  private serverProcess: ChildProcess | null = null
  private port = 0
  private _onEvent = new vscode.EventEmitter<OpencodeEvent>()
  onEvent = this._onEvent.event
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0

  get isRunning(): boolean {
    return this.client !== null
  }

  get currentPort(): number {
    return this.port
  }

  async start(): Promise<void> {
    if (this.client) return

    this.port = await findFreePort()

    const opencodePath = await this.findOpencodeBinary()
    if (!opencodePath) {
      throw new Error("OpenCode binary not found on PATH. Install it from https://opencode.ai")
    }

    this.serverProcess = spawn(opencodePath, [
      "serve",
      "--port", String(this.port),
      "--hostname", "127.0.0.1",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    this.serverProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString()
      console.log(`[opencode server] ${output}`)
    })

    this.serverProcess.stderr?.on("data", (data: Buffer) => {
      console.error(`[opencode server] ${data.toString()}`)
    })

    this.serverProcess.on("exit", (code) => {
      console.log(`[opencode server] Process exited with code ${code}`)
      if (this.client) {
        this._onEvent.fire({ type: "server_disconnected", data: { code } })
        this.client = null
        this.scheduleReconnect()
      }
    })

    await this.waitForHealth()

    this.client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${this.port}` })
    this.reconnectAttempts = 0
    this._onEvent.fire({ type: "server_connected", data: { port: this.port } })

    this.subscribeToEvents()
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM")
      this.serverProcess = null
    }
    this.client = null
    this.port = 0
    this.reconnectAttempts = 0
  }

  private async findOpencodeBinary(): Promise<string | null> {
    const which = spawn("which", ["opencode"])
    return new Promise((resolve) => {
      let output = ""
      which.stdout?.on("data", (d: Buffer) => { output += d.toString() })
      which.on("close", () => {
        resolve(output.trim() || null)
      })
      which.on("error", () => resolve(null))
    })
  }

  private async waitForHealth(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`http://127.0.0.1:${this.port}/global/health`)
        if (resp.ok) {
          const data = await resp.json() as { healthy: boolean; version: string }
          if (data.healthy) return
        }
      } catch {
        // server not ready yet
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error("Server failed to start within timeout")
  }

  private subscribeToEvents(): void {
    if (!this.client) return
    this.client.event.subscribe().then((events) => {
      void (async () => {
        for await (const event of events.stream) {
          this._onEvent.fire({
            type: event.type as OpencodeEvent["type"],
            sessionId: (event.properties as { sessionID?: string } | undefined)?.sessionID,
            data: event.properties,
          })
        }
      })()
    }).catch((err: Error) => {
      console.error("[SessionManager] Event subscription failed:", err.message)
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 5) return
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.start().catch(() => {
        this.scheduleReconnect()
      })
    }, delay)
  }

  async createSession(title?: string): Promise<Session> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.create({ body: { title } })
    return resp.data as Session
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.delete({ path: { id } })
    return true
  }

  async getSession(id: string): Promise<Session> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.get({ path: { id } })
    return resp.data as Session
  }

  async listSessions(): Promise<Session[]> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.list()
    return resp.data as Session[]
  }

  async sendPrompt(sessionId: string, parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[]): Promise<{ info: Message; parts: Part[] }> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.prompt({
      path: { id: sessionId },
      body: { parts },
    })
    return { info: resp.data!.info, parts: resp.data!.parts }
  }

  async sendCommand(sessionId: string, command: string): Promise<{ info: Message; parts: Part[] }> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.command({
      path: { id: sessionId },
      body: { command, arguments: "" },
    })
    return { info: resp.data!.info, parts: resp.data!.parts }
  }

  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.abort({ path: { id: sessionId } })
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.messages({ path: { id: sessionId }, query: { limit } })
    return resp.data as { info: unknown; parts: Part[] }[]
  }

  async getSessionDiff(sessionId: string, messageId?: string): Promise<unknown> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.diff({
      path: { id: sessionId },
      query: { messageID: messageId },
    })
    return resp.data
  }

  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.revert({ path: { id: sessionId }, body: { messageID: messageId } })
    return true
  }

  dispose(): void {
    void this.stop()
    this._onEvent.dispose()
  }
}
