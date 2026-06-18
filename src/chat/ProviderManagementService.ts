import { ProviderConfigManager, type ProviderConfig } from "../model/ProviderConfigManager"
import type { V2OpencodeClient } from "../session/opencodeClientFactory"
import type { ProviderAuthMethod } from "@opencode-ai/sdk"
import { log } from "../utils/outputChannel"
import type {
  ProviderDiscoveryItem,
  ProviderAuthMethodInfo,
  ProviderCredentialInfo,
} from "./webview/types"

export interface ProviderManagementServiceDeps {
  providerConfigManager: ProviderConfigManager
  postMessage: (msg: Record<string, unknown>) => void
  getV2Client: () => V2OpencodeClient | null
}

export class ProviderManagementService {
  constructor(private deps: ProviderManagementServiceDeps) {}

  // ── Existing CRUD (local config) ──────────────────────────────────────

  async handleAddProvider(name: string, apiKey: string, baseUrl?: string): Promise<void> {
    try {
      const id = await this.deps.providerConfigManager.upsertConfig({
        name,
        apiKey,
        baseUrl,
        enabled: true,
        models: [],
      })
      this.deps.postMessage({ type: "provider_added", id, name })
    } catch (err) {
      log.error("Add provider failed", err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to add provider" })
    }
  }

  handleListProviders(): void {
    try {
      const providers = this.deps.providerConfigManager.getAllConfigs()
      this.deps.postMessage({ type: "provider_list", providers })
    } catch (err) {
      log.error("List providers failed", err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to list providers" })
    }
  }

  async handleUpdateProvider(id: string, updates: Record<string, unknown>): Promise<void> {
    try {
      const config = this.deps.providerConfigManager.getConfig(id)
      if (!config) {
        this.deps.postMessage({ type: "provider_error", error: "Provider not found" })
        return
      }
      await this.deps.providerConfigManager.upsertConfig({
        ...config,
        ...updates,
      } as unknown as Omit<ProviderConfig, "id">)
      this.deps.postMessage({ type: "provider_updated", id })
    } catch (err) {
      log.error("Update provider failed", err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to update provider" })
    }
  }

  async handleDeleteProvider(id: string): Promise<void> {
    try {
      await this.deps.providerConfigManager.deleteConfig(id)
      this.deps.postMessage({ type: "provider_deleted", id })
    } catch (err) {
      log.error("Delete provider failed", err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to delete provider" })
    }
  }

  // ── SDK-backed discovery ──────────────────────────────────────────────

  async handleDiscoverProviders(): Promise<void> {
    const client = this.deps.getV2Client()
    if (!client) {
      this.deps.postMessage({ type: "provider_error", error: "Server not running" })
      return
    }
    try {
      const [listResp, authResp] = await Promise.all([
        client.provider.list(),
        client.provider.auth(),
      ])
      const listData = listResp.data
      const authData = authResp.data
      if (!listData?.all) {
        this.deps.postMessage({ type: "provider_discovery_list", providers: [] })
        return
      }

      const localConfigs = this.deps.providerConfigManager.getAllConfigs()
      const localByName = new Map<string, ProviderConfig>()
      for (const c of localConfigs) localByName.set(c.name.toLowerCase(), c)

      const items: ProviderDiscoveryItem[] = listData.all.map((p) => {
        const hasLocalKey = !!p.key || !!localByName.get(p.id.toLowerCase())?.apiKey
        const isEnvProvider = p.source === "env" && p.env.length > 0
        const methods = authData?.[p.id] ?? authData?.[p.name] ?? []
        const hasOauth = methods.some((m: ProviderAuthMethod) => m.type === "oauth")

        let status: ProviderDiscoveryItem["status"] = "connected"
        if (isEnvProvider && !hasLocalKey) {
          // Env providers are connected if the env vars are set (server wouldn't
          // list them otherwise). Mark as connected, not needs_key.
          status = "connected"
        } else if (!hasLocalKey && hasOauth) {
          status = "needs_oauth"
        } else if (!hasLocalKey && !hasOauth) {
          status = "needs_key"
        }

        return {
          id: p.id,
          name: p.name,
          source: p.source,
          status,
          modelCount: Object.keys(p.models ?? {}).length,
          envVars: p.env ?? [],
        }
      })

      this.deps.postMessage({ type: "provider_discovery_list", providers: items })
    } catch (err) {
      log.error("Discover providers failed", err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to discover providers" })
    }
  }

  // ── SDK-backed auth methods ───────────────────────────────────────────

  async handleGetProviderAuthMethods(providerId: string): Promise<void> {
    const client = this.deps.getV2Client()
    if (!client) {
      this.deps.postMessage({ type: "provider_error", error: "Server not running" })
      return
    }
    try {
      const resp = await client.provider.auth()
      const methods = resp.data?.[providerId] ?? []
      const mapped: ProviderAuthMethodInfo[] = methods.map((m: ProviderAuthMethod) => ({
        type: m.type,
        label: m.label,
      }))
      this.deps.postMessage({ type: "provider_auth_methods", providerId, methods: mapped })
    } catch (err) {
      log.error(`Get auth methods for ${providerId} failed`, err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to get auth methods" })
    }
  }

  // ── API key connection ────────────────────────────────────────────────

  async handleConnectProviderKey(providerId: string, key: string): Promise<void> {
    const client = this.deps.getV2Client()
    if (!client) {
      this.deps.postMessage({ type: "provider_error", error: "Server not running", providerId })
      return
    }
    try {
      const resp = await client.auth.set({
        providerID: providerId,
        auth: { type: "api", key },
      })
      if (resp.error) {
        throw new Error(`Auth set failed: ${JSON.stringify(resp.error)}`)
      }
      this.deps.postMessage({ type: "provider_added", id: providerId, name: providerId })
      log.info(`API key set for provider ${providerId}`)
    } catch (err) {
      log.error(`Connect provider key for ${providerId} failed`, err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to set API key", providerId })
    }
  }

  // ── OAuth flow ────────────────────────────────────────────────────────

  async handleConnectProviderOAuth(providerId: string, methodIndex?: number): Promise<void> {
    const client = this.deps.getV2Client()
    if (!client) {
      this.deps.postMessage({ type: "provider_error", error: "Server not running" })
      return
    }
    try {
      const resp = await client.provider.oauth.authorize({
        providerID: providerId,
        ...(methodIndex !== undefined ? { method: methodIndex } : {}),
      })
      if (resp.error) {
        throw new Error(`OAuth authorize failed: ${JSON.stringify(resp.error)}`)
      }
      const data = resp.data as { url?: string; instructions?: string } | undefined
      if (data?.url) {
        this.deps.postMessage({
          type: "provider_oauth_started",
          providerId,
          authorizationUrl: data.url,
          instructions: data.instructions,
        })
      } else {
        throw new Error("No authorization URL returned")
      }
    } catch (err) {
      log.error(`OAuth authorize for ${providerId} failed`, err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to start OAuth flow" })
    }
  }

  async handleCompleteProviderOAuth(providerId: string, code?: string, methodIndex?: number): Promise<void> {
    const client = this.deps.getV2Client()
    if (!client) {
      this.deps.postMessage({ type: "provider_error", error: "Server not running" })
      return
    }
    try {
      const resp = await client.provider.oauth.callback({
        providerID: providerId,
        ...(methodIndex !== undefined ? { method: methodIndex } : {}),
        ...(code ? { code } : {}),
      })
      if (resp.error) {
        throw new Error(`OAuth callback failed: ${JSON.stringify(resp.error)}`)
      }
      this.deps.postMessage({ type: "provider_oauth_completed", providerId, ok: true })
      log.info(`OAuth completed for provider ${providerId}`)
    } catch (err) {
      log.error(`OAuth callback for ${providerId} failed`, err)
      this.deps.postMessage({
        type: "provider_oauth_completed",
        providerId,
        ok: false,
        error: err instanceof Error ? err.message : "OAuth completion failed",
      })
    }
  }

  // ── Credential management ─────────────────────────────────────────────

  async handleListProviderCredentials(): Promise<void> {
    try {
      const configs = this.deps.providerConfigManager.getAllConfigs()
      const credentials: ProviderCredentialInfo[] = configs
        .filter((c) => c.apiKey)
        .map((c) => ({
          id: c.id ?? c.name,
          providerId: c.name,
          label: c.name,
          type: "api" as const,
        }))
      this.deps.postMessage({ type: "provider_credential_list", credentials })
    } catch (err) {
      log.error("List provider credentials failed", err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to list credentials" })
    }
  }

  async handleRemoveProviderCredential(credentialId: string): Promise<void> {
    try {
      await this.deps.providerConfigManager.deleteConfig(credentialId)
      this.deps.postMessage({ type: "provider_deleted", id: credentialId })
      log.info(`Removed credential ${credentialId}`)
    } catch (err) {
      log.error(`Remove credential ${credentialId} failed`, err)
      this.deps.postMessage({ type: "provider_error", error: "Failed to remove credential" })
    }
  }
}
