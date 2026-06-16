import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { ProviderConfigManager } from "./ProviderConfigManager"
import { resolveContextWindow, resolveModelOutputLimit } from "./contextWindowResolver"
import { fetchOpenRouterModels, isCacheFresh as isOpenRouterCacheFresh } from "./openRouterMetadata"
import { fetchModelsDevModels, isCacheFresh as isModelsDevCacheFresh, type ModelsDevEntry } from "./modelsDevMetadata"

export interface ModelInfo {
  id: string
  provider: string
  displayName: string
  contextWindow?: number
  outputLimit?: number
  available?: boolean
  unavailableReason?: string
  supportsVariants?: boolean
  variantNames?: string[]
  favorite?: boolean
  enabled?: boolean
}

const MODEL_CACHE_KEY = "opencode-harness.modelCache"
const OPENROUTER_CACHE_KEY = "opencode-harness.openRouterContextCache"
const OPENROUTER_CACHE_TS_KEY = "opencode-harness.openRouterContextCacheTimestamp"
const MODELS_DEV_CACHE_KEY = "opencode-harness.modelsDevContextCache"
const MODELS_DEV_CACHE_TS_KEY = "opencode-harness.modelsDevContextCacheTimestamp"

export class ModelManager {
  private _models: ModelInfo[] = []
  private _current: string = ""
  private _onModelChanged = new vscode.EventEmitter<string>()
  private _onModelsRefreshed = new vscode.EventEmitter<void>()
  private _globalState?: vscode.Memento
  private providerConfigManager?: ProviderConfigManager
  private _favoriteModels: Set<string> = new Set()
  private _disabledModels: Set<string> = new Set()
  /**
   * Cross-provider context-window catalogue from OpenRouter. Populated
   * dynamically during `refreshModels` using OpenRouter's metadata API.
   */
  private _openRouterCache: Map<string, number> = new Map()

  /**
   * models.dev context-window + output-limit catalogue. models.dev is
   * the authoritative source that opencode itself queries to build its
   * model list. Carries opencode-only free SKUs that OpenRouter never
   * sees (e.g. deepseek-v4-flash-free, kimi-k2.5-free).
   * Populated during `refreshModels` with a 24h parallel fetch.
   */
  private _modelsDevCache: Map<string, ModelsDevEntry> = new Map()
  private _modelsDevCacheTimestamp: number | null = null

  get onModelChanged(): vscode.Event<string> {
    return this._onModelChanged.event
  }

  get onModelsRefreshed(): vscode.Event<void> {
    return this._onModelsRefreshed.event
  }

  constructor() {
  }

  /** Inject globalState for model caching. Call once after construction. */
  setGlobalState(globalState: vscode.Memento): void {
    this._globalState = globalState
    this.loadCachedModels()
  }

  /** Inject provider config manager. Call once after construction. */
  setProviderConfigManager(providerConfigManager: ProviderConfigManager): void {
    this.providerConfigManager = providerConfigManager
  }

  /**
   * Get API key for a provider from configured provider settings.
   */
  getProviderApiKey(providerId: string): string | undefined {
    return this.providerConfigManager?.getApiKey(providerId)
  }

  /**
   * Get base URL for a provider from configured provider settings.
   */
  getProviderBaseUrl(providerId: string): string | undefined {
    return this.providerConfigManager?.getBaseUrl(providerId)
  }

  private loadCachedModels(): void {
    if (!this._globalState) return
    try {
      this._favoriteModels = new Set(this._globalState.get<string[]>("opencode-harness.favoriteModels", []))
      this._disabledModels = new Set(this._globalState.get<string[]>("opencode-harness.disabledModels", []))

      const cached = this._globalState.get<ModelInfo[]>(MODEL_CACHE_KEY, [])
      if (cached.length > 0) {
        this._models = cached.map(m => {
          const modelKey = `${m.provider}/${m.id}`
          return {
            ...m,
            favorite: this._favoriteModels.has(modelKey),
            enabled: !this._disabledModels.has(modelKey),
          }
        })
        this._onModelsRefreshed.fire()
        log.info(`Loaded ${cached.length} cached models from globalState`)
      }
    } catch (err) {
      log.warn("Failed to load cached models", err)
    }
    this.loadOpenRouterCache()
    this.loadModelsDevCache()
  }

  /**
   * Hydrate the cross-provider context-window cache from globalState.
   * Skipped silently when the persisted timestamp is older than 24h —
   * `refreshOpenRouterCacheIfStale` will then refetch on the next
   * `refreshModels` call.
   */
  private loadOpenRouterCache(): void {
    if (!this._globalState) return
    try {
      const persisted = this._globalState.get<Record<string, number>>(OPENROUTER_CACHE_KEY, {})
      const timestamp = this._globalState.get<number>(OPENROUTER_CACHE_TS_KEY, 0)
      if (isOpenRouterCacheFresh(timestamp) && persisted && Object.keys(persisted).length > 0) {
        this._openRouterCache = new Map(Object.entries(persisted))
        log.info(`Loaded ${this._openRouterCache.size} OpenRouter context-window entries from cache`)
      }
    } catch (err) {
      log.warn("Failed to load OpenRouter context-window cache", err)
    }
  }

  /**
   * Hydrate the models.dev context-window cache from globalState.
   * Skipped silently when the persisted timestamp is older than 24h —
   * `refreshModelsDevCacheIfStale` will then refetch on the next
   * `refreshModels` call.
   */
  private loadModelsDevCache(): void {
    if (!this._globalState) return
    try {
      const persisted = this._globalState.get<Record<string, { contextWindow: number; outputLimit?: number }>>(
        MODELS_DEV_CACHE_KEY, {},
      )
      const timestamp = this._globalState.get<number>(MODELS_DEV_CACHE_TS_KEY, 0)
      if (isModelsDevCacheFresh(timestamp) && persisted && Object.keys(persisted).length > 0) {
        this._modelsDevCache = new Map(Object.entries(persisted) as [string, ModelsDevEntry][])
        this._modelsDevCacheTimestamp = timestamp
        log.info(`Loaded ${this._modelsDevCache.size} models.dev context-window entries from cache`)
      }
    } catch (err) {
      log.warn("Failed to load models.dev context-window cache", err)
    }
  }

  /**
   * Refresh the models.dev context-window cache when it's missing or
   * stale (24h+ old). Non-blocking: a failed fetch leaves the previous
   * cache intact so the user keeps whatever fallback they had.
   */
  private async refreshModelsDevCacheIfStale(): Promise<void> {
    if (!this._globalState) return
    const timestamp = this._globalState.get<number>(MODELS_DEV_CACHE_TS_KEY, 0)
    if (isModelsDevCacheFresh(timestamp) && this._modelsDevCache.size > 0) return
    const fetched = await fetchModelsDevModels({ log: (m) => log.info(m) })
    if (fetched.size === 0) return
    this._modelsDevCache = fetched
    this._modelsDevCacheTimestamp = Date.now()
    try {
      const serialized: Record<string, { contextWindow: number; outputLimit?: number }> = {}
      for (const [k, v] of fetched.entries()) serialized[k] = v
      await this._globalState.update(MODELS_DEV_CACHE_KEY, serialized)
      await this._globalState.update(MODELS_DEV_CACHE_TS_KEY, this._modelsDevCacheTimestamp)
    } catch (err) {
      log.warn("Failed to persist models.dev context-window cache", err)
    }
  }

  /**
   * Refresh the OpenRouter context-window cache when it's missing or
   * stale (24h+ old). Non-blocking: a failed fetch leaves the previous
   * cache intact so the user keeps whatever fallback they had.
   */
  private async refreshOpenRouterCacheIfStale(): Promise<void> {
    if (!this._globalState) return
    const timestamp = this._globalState.get<number>(OPENROUTER_CACHE_TS_KEY, 0)
    if (isOpenRouterCacheFresh(timestamp) && this._openRouterCache.size > 0) return
    const fetched = await fetchOpenRouterModels({ log: (m) => log.info(m) })
    if (fetched.size === 0) return
    this._openRouterCache = fetched
    try {
      const serialized: Record<string, number> = {}
      for (const [k, v] of fetched.entries()) serialized[k] = v
      await this._globalState.update(OPENROUTER_CACHE_KEY, serialized)
      await this._globalState.update(OPENROUTER_CACHE_TS_KEY, Date.now())
    } catch (err) {
      log.warn("Failed to persist OpenRouter context-window cache", err)
    }
  }

  toggleModelFavorite(modelId: string): boolean {
    if (this._favoriteModels.has(modelId)) {
      this._favoriteModels.delete(modelId)
    } else {
      this._favoriteModels.add(modelId)
    }
    this.savePreferences()
    this.updateModelProperties(modelId, { favorite: this._favoriteModels.has(modelId) })
    return this._favoriteModels.has(modelId)
  }

  setModelEnabled(modelId: string, enabled: boolean): void {
    if (enabled) {
      this._disabledModels.delete(modelId)
    } else {
      this._disabledModels.add(modelId)
    }
    this.savePreferences()
    this.updateModelProperties(modelId, { enabled })
  }

  private savePreferences(): void {
    if (!this._globalState) return
    this._globalState.update("opencode-harness.favoriteModels", Array.from(this._favoriteModels))
    this._globalState.update("opencode-harness.disabledModels", Array.from(this._disabledModels))
  }

  private updateModelProperties(modelId: string, props: Partial<ModelInfo>): void {
    const model = this._models.find(m => `${m.provider}/${m.id}` === modelId)
    if (model) {
      Object.assign(model, props)
      this.saveCachedModels()
      this._onModelsRefreshed.fire()
    }
  }

  private saveCachedModels(): void {
    if (!this._globalState) return
    try {
      this._globalState.update(MODEL_CACHE_KEY, this._models)
    } catch (err) {
      log.warn("Failed to save model cache", err)
    }
  }

  get model(): string {
    return this._current
  }

  get models(): ModelInfo[] {
    return this._models
  }

  getContextWindow(modelId?: string): number | undefined {
    const target = modelId || this._current
    if (!target) return undefined
    const info = this._models.find(m => `${m.provider}/${m.id}` === target)
    return resolveContextWindow(target, info?.contextWindow, {
      log: (m) => log.info(m),
      modelsDevCache: this._modelsDevCache,
      openRouterCache: this._openRouterCache,
    })
  }

  getOutputLimit(modelId?: string): number | undefined {
    const target = modelId || this._current
    if (!target) return undefined
    const info = this._models.find(m => `${m.provider}/${m.id}` === target)
    return resolveModelOutputLimit(target, info?.outputLimit, {
      modelsDevCache: this._modelsDevCache,
    })
  }

  setModel(modelId: string): void {
    if (this._current !== modelId) {
      this._current = modelId
      this._onModelChanged.fire(modelId)
      log.info(`Model changed to: ${modelId}`)
    }
  }

  getModeModel(mode: string, fallbackModel?: string): string {
    const modeModels = vscode.workspace.getConfiguration("opencode").get<Record<string, string>>("modeModels", {})
    const override = modeModels?.[mode]
    if (override && typeof override === "string" && override.trim()) {
      return override
    }
    return (fallbackModel && fallbackModel.trim()) || this._current
  }

  /**
   * Fetch available models from the opencode server's config endpoint.
   * The caller must provide the port (from SessionManager) or we fall back
   * to querying `opencode` CLI directly.
   */
  async refreshModels(port?: number, authHeader?: string): Promise<ModelInfo[]> {
    try {
      // Kick off both context-window refreshes in parallel — models.dev
      // is the authoritative catalogue (covers opencode free SKUs that
      // OpenRouter never carries). Non-blocking failure: a network error
      // just leaves the previous cache in place.
      const modelsDevPromise = this.refreshModelsDevCacheIfStale().catch((err) => {
        log.warn("models.dev cache refresh failed", err)
      })
      const openRouterPromise = this.refreshOpenRouterCacheIfStale().catch((err) => {
        log.warn("OpenRouter cache refresh failed", err)
      })

      let models: ModelInfo[]
      if (port) {
        models = await this.fetchModelsFromServer(port, authHeader)
      } else {
        models = await this.fetchModelsFromCli()
      }

      // Wait for both refreshes so the post-refresh `getContextWindow`
      // calls (fired by `onModelsRefreshed` listeners) already see the
      // fresh caches. Without this, the very first model the user sees
      // after install would miss the fallback.
      await Promise.all([modelsDevPromise, openRouterPromise])

      // Auto-select first model if none is currently selected
      if (!this._current && models.length > 0 && models[0]) {
        const firstId = `${models[0].provider}/${models[0].id}`
        this.setModel(firstId)
      }
      return models
    } catch (err) {
      log.warn("Failed to refresh models (expected during cold start)", err)
      return this._models
    }
  }

  private async fetchModelsFromServer(port: number, authHeader?: string): Promise<ModelInfo[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const fetchHeaders: Record<string, string> = {}
      if (authHeader) fetchHeaders["Authorization"] = authHeader
      const resp = await fetch(`http://127.0.0.1:${port}/config/providers`, {
        signal: controller.signal,
        headers: fetchHeaders,
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const text = await resp.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch (err) {
        throw new Error(`Malformed JSON response from server: ${text.slice(0, 100)}...`)
      }

      const models: ModelInfo[] = []
      const providersRaw = Array.isArray(data) ? data : data?.providers
      if (!Array.isArray(providersRaw)) {
        throw new Error(`Unexpected server response shape: expected array or { providers: [...] }, got ${typeof data}`)
      }
      const providers = providersRaw
      let unresolvedContextWindowCount = 0
      for (const provider of providers) {
        if (!provider || typeof provider !== 'object' || !provider.id) continue
        const providerModels = Array.isArray(provider.models)
          ? provider.models
          : Object.entries(provider.models || {}).map(([id, model]: [string, any]) => ({
              ...model,
              id: model.id || id,
              name: model.name,
              reasoning: model.capabilities?.reasoning === true || model.reasoning === true,
            }))

        for (const m of providerModels) {
          const reasoning = m.reasoning === true || 
                            (m.name && (m.name.includes("Thinking") || m.name.includes("Reasoning") || m.name.includes("O1"))) ||
                            (m.id && (m.id.includes("thinking") || m.id.includes("reasoning") || m.id.includes("o1")))
          const modelKey = `${provider.id}/${m.id}`
          
          const ctx = resolveContextWindow(modelKey, m.limit?.context, {
            log: (msg) => log.debug(msg),
            modelsDevCache: this._modelsDevCache,
            openRouterCache: this._openRouterCache,
          })
          if (ctx === undefined) unresolvedContextWindowCount++

          const variantNames = m.variants && typeof m.variants === "object"
            ? Object.keys(m.variants).filter(k => {
                const v = m.variants[k]
                return v && typeof v === "object" && v.disabled !== true
              })
            : undefined

          models.push({
            id: m.id,
            provider: provider.id,
            displayName: m.name || m.id,
            contextWindow: ctx,
            outputLimit: m.limit?.output || undefined,
            supportsVariants: !!reasoning,
            variantNames: variantNames && variantNames.length > 0 ? variantNames : undefined,
            available: m.available !== false,
            unavailableReason: m.unavailableReason || undefined,
            favorite: this._favoriteModels.has(modelKey),
            enabled: !this._disabledModels.has(modelKey),
          })
        }
      }

      const prevCount = this._models.length
      this._models = models
      this.saveCachedModels()
      this._onModelsRefreshed.fire()
      if (models.length !== prevCount) {
        log.info(`Refreshed models from server: ${models.length} models available`)
      }
      if (unresolvedContextWindowCount > 0) {
        log.info(`Refreshed models: ${models.length} (${unresolvedContextWindowCount} without limit.context — server didn't report and no models.dev / OpenRouter match)`)
      }
      return models
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchModelsFromCli(): Promise<ModelInfo[]> {
    const { spawn } = await import("child_process")
    const config = vscode.workspace.getConfiguration("opencode")
    const customPath = config.get<string>("binaryPath")
    const binaryPath = customPath || "opencode"

    // Validate custom binary path (same check as CliDiagnostics)
    if (customPath) {
      const isSafe = /^[/\\]|[A-Za-z]:/.test(customPath) && !/[;&|`$(){}!#~<>]/.test(customPath)
      if (!isSafe) {
        log.warn(`Custom binary path "${customPath}" is invalid or unsafe. Falling back to PATH lookup.`)
        return this._models
      }
    }

    const allowedEnvVars = ["PATH", "HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME", "LANG", "TERM", "SHELL", "TMPDIR", "TEMP", "TMP"]
    const childEnv: Record<string, string> = {}
    for (const key of allowedEnvVars) {
      const val = process.env[key]
      if (val) childEnv[key] = val
    }
    return new Promise((resolve) => {
      const child = spawn(binaryPath, ["models"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
        shell: false,
      })
      // H2: Add 10-second timeout to prevent hanging CLI process
      const timeout = setTimeout(() => {
        log.warn("opencode CLI models command timed out after 10s — killing process")
        child.kill("SIGKILL")
        resolve(this._models)
      }, 10_000)
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
      child.on("close", (code) => {
        clearTimeout(timeout)
        if (code === 0 && stdout.trim()) {
          try {
            const rawLines = stdout.trim().split("\n").filter(l => l.trim())
            const validLines: string[] = []
            for (const line of rawLines) {
              const trimmed = line.trim()
              // Accept "provider/modelId" or bare "modelId" format
              const hasValidFormat = trimmed.includes("/")
                ? /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)
                : /^[a-zA-Z0-9_.-]+$/.test(trimmed)
              if (hasValidFormat) validLines.push(trimmed)
              else log.warn(`Skipping malformed CLI model line: "${trimmed.slice(0, 60)}"`)
            }
            this._models = validLines.map((line) => {
              const trimmed = line.trim()
              const slashIdx = trimmed.indexOf("/")
              if (slashIdx >= 0) {
                const provider = trimmed.substring(0, slashIdx)
                const modelId = trimmed.substring(slashIdx + 1)
                const modelKey = `${provider}/${modelId}`
                return {
                  id: modelId,
                  provider,
                  displayName: modelId,
                  available: true,
                  favorite: this._favoriteModels.has(modelKey),
                  enabled: !this._disabledModels.has(modelKey),
                }
              }
              const modelKey = `unknown/${trimmed}`
              return {
                id: trimmed,
                provider: "unknown",
                displayName: trimmed,
                available: true,
                favorite: this._favoriteModels.has(modelKey),
                enabled: !this._disabledModels.has(modelKey),
              }
            })
            this._onModelsRefreshed.fire()
            log.info(`Refreshed models from CLI: ${this._models.length} models available`)
          } catch {
            log.warn("Could not parse model list from CLI output")
          }
        } else {
          if (code === null) {
            log.warn(`CLI model list terminated by signal: ${stderr.trim()}`)
          } else {
            log.warn(`CLI model list failed (code=${code}): ${stderr.trim()}`)
          }
        }
        resolve(this._models)
      })
      child.on("error", (err) => {
        const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT"
        if (isNotFound) {
          log.warn(`${binaryPath} not found on PATH – models will be available once the server connects`)
        } else {
          log.error(`Failed to run ${binaryPath} models`, err)
        }
        resolve(this._models)
      })
    })
  }

  async pickModel(): Promise<string | undefined> {
    if (this._models.length === 0) {
      const action = await vscode.window.showWarningMessage(
        "No models available. OpenCode models are fetched from the server once connected.",
        "Open Chat"
      )
      if (action === "Open Chat") {
        vscode.commands.executeCommand("opencode-harness.openChat")
      }
      return undefined
    }

    // Group by provider with separators
    const byProvider = new Map<string, ModelInfo[]>()
    for (const m of this._models) {
      const list = byProvider.get(m.provider) || []
      list.push(m)
      byProvider.set(m.provider, list)
    }

    const items: (vscode.QuickPickItem & { fullId?: string })[] = []
    for (const [provider, providerModels] of byProvider) {
      items.push({
        label: provider,
        kind: vscode.QuickPickItemKind.Separator,
      })
      for (const m of providerModels) {
        const fullId = `${m.provider}/${m.id}`
        const isCurrent = fullId === this._current
        const unavailableSuffix = m.available === false ? " (unavailable)" : ""
        const effectiveContext = resolveContextWindow(fullId, m.contextWindow, {
          modelsDevCache: this._modelsDevCache,
          openRouterCache: this._openRouterCache,
        })
        items.push({
          label: m.displayName + unavailableSuffix,
          description: isCurrent ? "● Current" : "",
          detail: effectiveContext ? `${effectiveContext.toLocaleString()} tokens` : "",
          fullId,
        })
      }
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Choose an AI model for this session",
      title: "OpenCode Model Selection",
    })

    return picked?.fullId
  }

  dispose(): void {
    this._onModelChanged.dispose()
    this._onModelsRefreshed.dispose()
  }
}
