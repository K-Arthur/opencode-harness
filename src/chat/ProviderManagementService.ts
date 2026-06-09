import { ProviderConfigManager, type ProviderConfig } from "../model/ProviderConfigManager"
import { log } from "../utils/outputChannel"

export interface ProviderManagementServiceDeps {
  providerConfigManager: ProviderConfigManager
  postMessage: (msg: Record<string, unknown>) => void
}

export class ProviderManagementService {
  constructor(private deps: ProviderManagementServiceDeps) {}

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
}
