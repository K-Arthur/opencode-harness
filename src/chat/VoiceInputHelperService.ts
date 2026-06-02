import * as fs from "fs"
import * as http from "http"
import * as path from "path"
import {
  VOICE_INPUT_MAX_UPLOAD_BYTES,
  type VoiceAudioPayload,
  type VoiceInputProvider,
  type VoiceInputSettings,
  sanitizeVoiceTranscript,
} from "./voiceInputCore"

interface UriLike {
  toString(): string
}

interface PendingVoiceHelperRequest {
  requestId: string
  token: string
  provider: VoiceInputProvider
  settings: VoiceInputSettings
  createdAt: number
}

type HelperErrorReason =
  | "provider_disabled"
  | "missing_api_key"
  | "invalid_request"
  | "no_helper_file"
  | "open_failed"
  | "helper_failed"
  | "empty_transcript"

export interface VoiceInputHelperServiceDeps {
  extensionPath: string
  parseUri: (value: string) => UriLike
  asExternalUri: (uri: UriLike) => PromiseLike<UriLike>
  openExternal: (uri: UriLike) => PromiseLike<boolean>
  getSettings: () => PromiseLike<VoiceInputSettings>
  transcribeAudio: (payload: VoiceAudioPayload) => PromiseLike<void>
  postMessage?: (msg: Record<string, unknown>) => void
  now?: () => number
  randomUUID?: () => string
  log?: (level: "info" | "warn" | "error", message: string, err?: unknown) => void
}

export interface OpenBrowserHelperResult {
  ok: boolean
  requestId?: string
  helperUri?: string
  reason?: HelperErrorReason
}

class BodyTooLargeError extends Error {}

const HELPER_REQUEST_TTL_MS = 10 * 60 * 1000
const JSON_OVERHEAD_BYTES = 16 * 1024

export class VoiceInputHelperService {
  private server: http.Server | undefined
  private serverOrigin: string | undefined
  private pending = new Map<string, PendingVoiceHelperRequest>()
  private readonly extensionPath: string
  private readonly parseUri: (value: string) => UriLike
  private readonly asExternalUri: (uri: UriLike) => PromiseLike<UriLike>
  private readonly openExternal: (uri: UriLike) => PromiseLike<boolean>
  private readonly getSettings: () => PromiseLike<VoiceInputSettings>
  private readonly transcribeAudio: (payload: VoiceAudioPayload) => PromiseLike<void>
  private readonly postMessage?: (msg: Record<string, unknown>) => void
  private readonly now: () => number
  private readonly randomUUID: () => string
  private readonly log: (level: "info" | "warn" | "error", message: string, err?: unknown) => void

  constructor(deps: VoiceInputHelperServiceDeps) {
    this.extensionPath = deps.extensionPath
    this.parseUri = deps.parseUri
    this.asExternalUri = deps.asExternalUri
    this.openExternal = deps.openExternal
    this.getSettings = deps.getSettings
    this.transcribeAudio = deps.transcribeAudio
    this.postMessage = deps.postMessage
    this.now = deps.now ?? (() => Date.now())
    this.randomUUID = deps.randomUUID ?? defaultRandomUUID
    this.log = deps.log ?? (() => {})
  }

  async openBrowserHelper(requestId: unknown): Promise<OpenBrowserHelperResult> {
    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 120) {
      this.postError(undefined, "invalid_request", "Missing speech-to-text request id.")
      return { ok: false, reason: "invalid_request" }
    }

    const settings = await this.getSettings()
    if (!settings.enabled) {
      this.postError(requestId, "provider_disabled", "Voice input is disabled in settings.")
      return { ok: false, requestId, reason: "provider_disabled" }
    }
    if (settings.provider === "openai" && !settings.hasOpenAiApiKey) {
      this.postError(requestId, "missing_api_key", "Speech-to-text requires an OpenAI API key.")
      return { ok: false, requestId, reason: "missing_api_key" }
    }
    if (!this.resolveHelperFilePath()) {
      this.postError(requestId, "no_helper_file", "Voice helper file was not found.")
      return { ok: false, requestId, reason: "no_helper_file" }
    }

    try {
      this.prunePending()
      const origin = await this.ensureServer()
      const token = this.randomUUID()
      this.pending.set(token, {
        requestId,
        token,
        provider: settings.provider,
        settings,
        createdAt: this.now(),
      })

      const helperUrl = new URL("/voice-helper.html", origin)
      helperUrl.searchParams.set("requestId", requestId)
      helperUrl.searchParams.set("token", token)
      helperUrl.searchParams.set("provider", settings.provider)
      helperUrl.searchParams.set("maxDurationSeconds", String(settings.maxDurationSeconds))
      helperUrl.searchParams.set("maxUploadBytes", String(settings.maxUploadBytes))
      const localUri = this.parseUri(helperUrl.toString())
      const externalUri = await this.asExternalUri(localUri)
      const opened = await this.openExternal(externalUri)
      if (!opened) {
        this.pending.delete(token)
        this.postError(requestId, "open_failed", "Could not open the voice helper in your browser.")
        return { ok: false, requestId, reason: "open_failed" }
      }

      const helperUri = externalUri.toString()
      this.postMessage?.({ type: "stt_helper_opened", requestId, helperUri, provider: settings.provider })
      return { ok: true, requestId, helperUri }
    } catch (err) {
      this.log("error", `Failed to open voice helper: ${String(err)}`, err)
      this.postError(requestId, "open_failed", "Could not open the voice helper in your browser.")
      return { ok: false, requestId, reason: "open_failed" }
    }
  }

  dispose(): void {
    this.pending.clear()
    if (this.server) {
      this.server.close()
      this.server = undefined
      this.serverOrigin = undefined
    }
  }

  private async ensureServer(): Promise<string> {
    if (this.serverOrigin) return this.serverOrigin

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((err) => {
        this.log("error", `Voice helper request failed: ${String(err)}`, err)
        this.sendJson(res, 500, { ok: false, error: "helper_failed" })
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      server.close()
      throw new Error("Voice helper server did not expose a TCP port")
    }

    this.server = server
    this.serverOrigin = `http://127.0.0.1:${address.port}`
    return this.serverOrigin
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = this.serverOrigin ?? "http://127.0.0.1"
    const url = new URL(req.url ?? "/", origin)
    if (req.method === "GET" && url.pathname === "/voice-helper.html") {
      this.serveHelperHtml(res)
      return
    }
    if (req.method === "POST" && url.pathname === "/api/browser-transcript") {
      await this.handleBrowserTranscript(req, res)
      return
    }
    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      await this.handleTranscribe(req, res)
      return
    }
    this.sendJson(res, 404, { ok: false, error: "not_found" })
  }

  private serveHelperHtml(res: http.ServerResponse): void {
    const filePath = this.resolveHelperFilePath()
    if (!filePath) {
      this.sendJson(res, 404, { ok: false, error: "no_helper_file" })
      return
    }
    const html = fs.readFileSync(filePath, "utf8")
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    })
    res.end(html)
  }

  private async handleBrowserTranscript(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJson(req, 128 * 1024)
    const pending = this.consumePending(body)
    if (!pending) {
      this.sendJson(res, 403, { ok: false, error: "invalid_token" })
      return
    }
    if (pending.provider !== "browser") {
      this.postError(pending.requestId, "invalid_request", "Browser transcript is not enabled for this voice request.")
      this.sendJson(res, 400, { ok: false, error: "invalid_provider" })
      return
    }
    const text = sanitizeVoiceTranscript((body as { text?: unknown }).text)
    if (!text) {
      this.postError(pending.requestId, "empty_transcript", "No speech was detected in the recording.")
      this.sendJson(res, 400, { ok: false, error: "empty_transcript" })
      return
    }
    this.postMessage?.({ type: "stt_transcript", requestId: pending.requestId, text })
    this.sendJson(res, 200, { ok: true })
  }

  private async handleTranscribe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: unknown
    try {
      body = await this.readJson(req, Math.ceil(VOICE_INPUT_MAX_UPLOAD_BYTES * 1.4) + JSON_OVERHEAD_BYTES)
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        this.sendJson(res, 413, { ok: false, error: "too_large" })
        return
      }
      throw err
    }
    const pending = this.consumePending(body)
    if (!pending) {
      this.sendJson(res, 403, { ok: false, error: "invalid_token" })
      return
    }
    if (pending.provider !== "openai") {
      this.postError(pending.requestId, "invalid_request", "Cloud transcription is not enabled for this voice request.")
      this.sendJson(res, 400, { ok: false, error: "invalid_provider" })
      return
    }

    const payload = body as Record<string, unknown>
    await this.transcribeAudio({
      requestId: pending.requestId,
      mimeType: payload.mimeType,
      data: payload.data,
      sizeBytes: payload.sizeBytes,
    })
    this.sendJson(res, 200, { ok: true })
  }

  private consumePending(body: unknown): PendingVoiceHelperRequest | undefined {
    if (!body || typeof body !== "object") return undefined
    const payload = body as Record<string, unknown>
    const token = typeof payload.token === "string" ? payload.token : ""
    const requestId = typeof payload.requestId === "string" ? payload.requestId : ""
    const pending = this.pending.get(token)
    if (!pending || pending.requestId !== requestId) return undefined
    this.pending.delete(token)
    return pending
  }

  private async readJson(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        throw new BodyTooLargeError("Request body too large")
      }
      chunks.push(buffer)
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  }

  private resolveHelperFilePath(): string | null {
    const candidates = [
      path.join(this.extensionPath, "dist", "chat", "webview", "media", "voice-helper.html"),
      path.join(this.extensionPath, "media", "voice-helper.html"),
    ]
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        // Try the next candidate.
      }
    }
    this.log("warn", `voice-helper.html not found; checked: ${candidates.join(", ")}`)
    return null
  }

  private prunePending(): void {
    const expiresBefore = this.now() - HELPER_REQUEST_TTL_MS
    for (const [token, request] of this.pending) {
      if (request.createdAt < expiresBefore) this.pending.delete(token)
    }
  }

  private sendJson(res: http.ServerResponse, status: number, value: Record<string, unknown>): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    res.end(JSON.stringify(value))
  }

  private postError(requestId: string | undefined, reason: HelperErrorReason, message: string): void {
    this.postMessage?.({
      type: "stt_error",
      requestId,
      reason,
      message,
    })
  }
}

function defaultRandomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
