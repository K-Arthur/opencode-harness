import { randomUUID } from "crypto"
import type { CreateV2Client } from "./opencodeClientFactory"
import { log } from "../utils/outputChannel"
import { validateServerUrl } from "../utils/security"

type V2OpencodeClient = ReturnType<CreateV2Client>

/** baseUrl + optional auth header. */
type ClientConfig = { baseUrl: string; headers?: Record<string, string> }

const createV2ClientFn: CreateV2Client = (config) => {
  const factory = require("./opencodeClientFactory") as typeof import("./opencodeClientFactory")
  return factory.createV2Client(config)
}

export class AuthProvider {
  private _serverPassword = ""
  private _remoteServerUrl: string | null = null
  private _remoteServerPassword: string | null = null

  constructor(
    private readonly createV2Client: CreateV2Client = createV2ClientFn,
  ) {}

  get serverPassword(): string {
    return this._serverPassword
  }

  get isRemote(): boolean {
    return this._remoteServerUrl !== null
  }

  get remoteServerUrl(): string | null {
    return this._remoteServerUrl
  }

  get authHeader(): string | undefined {
    if (this._remoteServerPassword) return this.buildRemoteAuthHeader(this._remoteServerPassword)
    if (!this._serverPassword) return undefined
    return `Basic ${Buffer.from(`opencode:${this._serverPassword}`).toString("base64")}`
  }

  get baseUrl(): string | null {
    if (this._remoteServerUrl) return this._remoteServerUrl
    return null
  }

  setRemoteServer(url: string | null | undefined, password?: string | null): void {
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

    this._remoteServerUrl = trimmed.length > 0 ? trimmed : null
    this._remoteServerPassword = password?.trim() || null
  }

  generatePassword(): void {
    const envPassword = process.env["OPENCODE_SERVER_PASSWORD"]
    if (envPassword) {
      this._serverPassword = envPassword
      log.info("Using OPENCODE_SERVER_PASSWORD from environment")
    } else {
      this._serverPassword = `oc-${randomUUID()}`
    }
  }

  /** Connection config for the local spawned server (baseUrl + Basic auth when set). */
  private localClientConfig(port: number): ClientConfig {
    const baseUrl = `http://127.0.0.1:${port}`
    if (this._serverPassword) {
      const basic = Buffer.from(`opencode:${this._serverPassword}`).toString("base64")
      return { baseUrl, headers: { Authorization: `Basic ${basic}` } }
    }
    return { baseUrl }
  }

  /** Connection config for a remote attach (baseUrl + remote auth header when set). */
  private remoteClientConfig(baseUrl: string): ClientConfig {
    if (this._remoteServerPassword) {
      return { baseUrl, headers: { Authorization: this.buildRemoteAuthHeader(this._remoteServerPassword) } }
    }
    return { baseUrl }
  }

  makeV2Client(port: number): V2OpencodeClient {
    return this.createV2Client(this.localClientConfig(port))
  }

  makeRemoteV2Client(baseUrl: string): V2OpencodeClient {
    return this.createV2Client(this.remoteClientConfig(baseUrl))
  }

  buildRemoteAuthHeader(secret: string): string {
    if (/^(Basic|Bearer)\s+/i.test(secret)) return secret
    return `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}`
  }

  buildHealthHeaders(): Record<string, string> {
    if (!this._serverPassword) return {}
    const basic = Buffer.from(`opencode:${this._serverPassword}`).toString("base64")
    return { Authorization: `Basic ${basic}` }
  }
}
