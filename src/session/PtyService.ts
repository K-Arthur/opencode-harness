import * as vscode from "vscode"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import type { PtySessionInfo, PtyOutputEvent, PtyConnectToken } from "./ptyTypes"
import { log } from "../utils/outputChannel"
import { v2ErrorDetail } from "./v2ErrorDetail"

function mapSdkPty(sdk: { id: string; title: string; command: string; status: string; pid: number; exitCode?: number }): PtySessionInfo {
  return {
    id: sdk.id,
    title: sdk.title,
    command: sdk.command,
    status: sdk.status === "exited" ? "exited" : "running",
    pid: sdk.pid,
    exitCode: sdk.exitCode,
  }
}

export class PtyService {
  private readonly sockets = new Map<string, WebSocket>()
  private disposed = false

  constructor(
    private readonly getV2Client: () => V2OpencodeClient | null,
    private readonly getAuthHeader: () => string | undefined,
    private readonly getBaseUrl: () => string | null,
  ) {}

  dispose(): void {
    this.disposed = true
    for (const [id, socket] of this.sockets) {
      try { socket.close() } catch { /* ignore */ }
    }
    this.sockets.clear()
  }

  private guard(): V2OpencodeClient {
    if (this.disposed) throw new Error("PtyService has been disposed")
    const client = this.getV2Client()
    if (!client) throw new Error("Server not running")
    return client
  }

  async createSession(options?: {
    command?: string
    args?: string[]
    cwd?: string
    title?: string
  }): Promise<PtySessionInfo> {
    const client = this.guard()
    const resp = await client.pty.create(options)
    if (resp.error) throw new Error(`PTY create failed: ${v2ErrorDetail(resp.error, (resp as { response?: { status?: number } }).response?.status)}`)
    const data = resp.data as Record<string, unknown>
    log.info(`PTY session created: ${data.id as string}`)
    return mapSdkPty(data as Parameters<typeof mapSdkPty>[0])
  }

  async getSession(ptyId: string): Promise<PtySessionInfo> {
    const client = this.guard()
    const resp = await client.pty.get({ ptyID: ptyId })
    if (resp.error) throw new Error(`PTY get failed: ${v2ErrorDetail(resp.error, (resp as { response?: { status?: number } }).response?.status)}`)
    return mapSdkPty(resp.data as Parameters<typeof mapSdkPty>[0])
  }

  async removeSession(ptyId: string): Promise<void> {
    const socket = this.sockets.get(ptyId)
    if (socket) {
      try { socket.close() } catch { /* ignore */ }
      this.sockets.delete(ptyId)
    }
    const client = this.guard()
    const resp = await client.pty.remove({ ptyID: ptyId })
    if (resp.error) throw new Error(`PTY remove failed: ${v2ErrorDetail(resp.error, (resp as { response?: { status?: number } }).response?.status)}`)
    log.info(`PTY session removed: ${ptyId}`)
  }

  async listSessions(): Promise<PtySessionInfo[]> {
    const client = this.guard()
    const resp = await client.pty.list()
    if (resp.error) throw new Error(`PTY list failed: ${v2ErrorDetail(resp.error, (resp as { response?: { status?: number } }).response?.status)}`)
    const items = resp.data as Array<Record<string, unknown>> | undefined
    return (items ?? []).map((item) => mapSdkPty(item as Parameters<typeof mapSdkPty>[0]))
  }

  async updateSession(ptyId: string, options: { title?: string; size?: { rows: number; cols: number } }): Promise<PtySessionInfo> {
    const client = this.guard()
    const resp = await client.pty.update({ ptyID: ptyId, ...options })
    if (resp.error) throw new Error(`PTY update failed: ${v2ErrorDetail(resp.error, (resp as { response?: { status?: number } }).response?.status)}`)
    return mapSdkPty(resp.data as Parameters<typeof mapSdkPty>[0])
  }

  async getConnectToken(ptyId: string): Promise<PtyConnectToken> {
    const client = this.guard()
    const resp = await client.pty.connectToken({ ptyID: ptyId })
    if (resp.error) throw new Error(`PTY connect-token failed: ${v2ErrorDetail(resp.error, (resp as { response?: { status?: number } }).response?.status)}`)
    const data = resp.data as { ticket: string; expires_in: number }
    return { ticket: data.ticket, expiresIn: data.expires_in }
  }

  async connectWebSocket(
    ptyId: string,
    ticket: string,
    onOutput: (event: PtyOutputEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const baseUrl = this.getBaseUrl()
    if (!baseUrl) throw new Error("No server URL available")
    const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:")
    const wsUrl = `${wsBase}/pty/${ptyId}/connect?ticket=${encodeURIComponent(ticket)}`

    if (signal?.aborted) return

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl)
      let opened = false

      const cleanup = (): void => {
        if (ptyId) this.sockets.delete(ptyId)
        signal?.removeEventListener("abort", onAbort)
      }

      const onAbort = (): void => {
        try { socket.close() } catch { /* ignore */ }
        cleanup()
        reject(new DOMException("Aborted", "AbortError"))
      }
      signal?.addEventListener("abort", onAbort)

      socket.onopen = () => {
        opened = true
        this.sockets.set(ptyId, socket)
        log.info(`PTY WebSocket connected: ${ptyId}`)
        resolve()
      }

      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          onOutput({ ptyId, data: event.data, type: "stdout" })
        } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          onOutput({ ptyId, data: event.data, type: "stdout" })
        }
      }

      socket.onerror = (event: Event) => {
        if (!opened) {
          cleanup()
          reject(new Error(`PTY WebSocket error: ${ptyId}`))
        }
      }

      socket.onclose = (event: CloseEvent) => {
        cleanup()
        if (!opened) {
          reject(new Error(`PTY WebSocket closed: code=${event.code}`))
        }
      }
    })
  }

  async sendInput(ptyId: string, data: string): Promise<void> {
    const socket = this.sockets.get(ptyId)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`PTY ${ptyId}: not connected`)
    }
    socket.send(data)
  }

  async setTerminalSize(ptyId: string, rows: number, cols: number): Promise<void> {
    await this.updateSession(ptyId, { size: { rows, cols } })
  }

  isConnected(ptyId: string): boolean {
    const socket = this.sockets.get(ptyId)
    return socket !== undefined && socket.readyState === WebSocket.OPEN
  }
}
