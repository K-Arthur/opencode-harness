import { randomUUID } from "crypto"
import type { CreateOpencodeClient } from "./opencodeClientFactory"
import { log } from "../utils/outputChannel"
import { validateServerUrl } from "../utils/security"

type OpencodeClient = ReturnType<CreateOpencodeClient>
type OpencodeClientConfig = Parameters<CreateOpencodeClient>[0]

function createOpencodeClient(config?: OpencodeClientConfig): OpencodeClient {
  const factory = require("./opencodeClientFactory") as typeof import("./opencodeClientFactory")
  return factory.createOpencodeClient(config)
}

export class AuthProvider {
  private _serverPassword = ""
  private _remoteServerUrl: string | null = null
  private _remoteServerPassword: string | null = null

  constructor(private readonly createClient: CreateOpencodeClient = createOpencodeClient) {}

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

  makeClient(port: number): OpencodeClient {
    const baseUrl = `http://127.0.0.1:${port}`
    if (this._serverPassword) {
      const basic = Buffer.from(`opencode:${this._serverPassword}`).toString("base64")
      return this.createClient({
        baseUrl,
        headers: { Authorization: `Basic ${basic}` },
      })
    }
    return this.createClient({ baseUrl })
  }

  makeRemoteClient(baseUrl: string): OpencodeClient {
    if (this._remoteServerPassword) {
      return this.createClient({
        baseUrl,
        headers: { Authorization: this.buildRemoteAuthHeader(this._remoteServerPassword) },
      })
    }
    return this.createClient({ baseUrl })
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
