import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseUrl?: string
  enabled: boolean
  models: string[]
  headers?: Record<string, string>
  headerTimeout?: number
}

export interface ProviderConfigManagerOptions {
  context: vscode.ExtensionContext
}

export class ProviderConfigManager {
  private static readonly STORAGE_KEY = "providerConfigs"
  private configs: Map<string, ProviderConfig> = new Map()

  constructor(private opts: ProviderConfigManagerOptions) {
    this.loadConfigs()
  }

  /**
   * Load provider configurations from global state.
   */
  private loadConfigs(): void {
    try {
      const data = this.opts.context.globalState.get<Record<string, ProviderConfig>>(ProviderConfigManager.STORAGE_KEY, {})
      this.configs = new Map(Object.entries(data))
      log.info(`Loaded ${this.configs.size} provider configurations`)
    } catch (err) {
      log.error("Failed to load provider configurations", err)
      this.configs = new Map()
    }
  }

  /**
   * Save provider configurations to global state.
   */
  private saveConfigs(): void {
    try {
      const data = Object.fromEntries(this.configs)
      void this.opts.context.globalState.update(ProviderConfigManager.STORAGE_KEY, data)
    } catch (err) {
      log.error("Failed to save provider configurations", err)
    }
  }

  /**
   * Generate a unique ID for a provider configuration.
   */
  private generateId(): string {
    return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  /**
   * Add or update a provider configuration.
   */
  async upsertConfig(config: Omit<ProviderConfig, "id">): Promise<string> {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error("Provider name cannot be empty")
    }
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error("API key cannot be empty")
    }
    
    const id = this.generateId()
    const fullConfig: ProviderConfig = {
      name: config.name.trim(),
      apiKey: config.apiKey.trim(),
      baseUrl: config.baseUrl?.trim(),
      enabled: config.enabled ?? true,
      models: config.models || [],
      headers: config.headers,
      headerTimeout: config.headerTimeout,
      id,
    }
    this.configs.set(id, fullConfig)
    this.saveConfigs()
    return id
  }

  /**
   * Get all provider configurations.
   */
  getAllConfigs(): ProviderConfig[] {
    return Array.from(this.configs.values())
  }

  /**
   * Get enabled provider configurations.
   */
  getEnabledConfigs(): ProviderConfig[] {
    return this.getAllConfigs().filter((c) => c.enabled)
  }

  /**
   * Get a provider configuration by ID.
   */
  getConfig(id: string): ProviderConfig | undefined {
    return this.configs.get(id)
  }

  /**
   * Delete a provider configuration.
   */
  async deleteConfig(id: string): Promise<void> {
    if (!id || id.trim().length === 0) {
      return // Silently ignore empty IDs
    }
    const deleted = this.configs.delete(id)
    if (deleted) {
      this.saveConfigs()
    }
  }

  /**
   * Enable or disable a provider configuration.
   */
  async setConfigEnabled(id: string, enabled: boolean): Promise<void> {
    if (!id || id.trim().length === 0) {
      return // Silently ignore empty IDs
    }
    const config = this.configs.get(id)
    if (config) {
      config.enabled = enabled
      this.saveConfigs()
    }
  }

  /**
   * Get API key for a provider.
   */
  getApiKey(providerId: string): string | undefined {
    if (!providerId || providerId.trim().length === 0) {
      return undefined
    }
    const config = this.configs.get(providerId)
    return config?.apiKey
  }

  /**
   * Get base URL for a provider.
   */
  getBaseUrl(providerId: string): string | undefined {
    if (!providerId || providerId.trim().length === 0) {
      return undefined
    }
    const config = this.configs.get(providerId)
    return config?.baseUrl
  }

  getHeaders(providerId: string): Record<string, string> | undefined {
    if (!providerId || providerId.trim().length === 0) {
      return undefined
    }
    const config = this.configs.get(providerId)
    return config?.headers
  }

  getHeaderTimeout(providerId: string): number | undefined {
    if (!providerId || providerId.trim().length === 0) {
      return undefined
    }
    const config = this.configs.get(providerId)
    return config?.headerTimeout
  }

  dispose(): void {
    // Nothing to dispose
  }
}
