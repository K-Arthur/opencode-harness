import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { ProviderConfigManager } from "./ProviderConfigManager"

export interface ModelInfo {
  id: string
  provider: string
  displayName: string
  contextWindow?: number
  outputLimit?: number
  available?: boolean
  unavailableReason?: string
  supportsVariants?: boolean
}

const MODEL_CACHE_KEY = "opencode-harness.modelCache"

export class ModelManager {
  private _models: ModelInfo[] = []
  private _current: string = ""
  private _onModelChanged = new vscode.EventEmitter<string>()
  private _onModelsRefreshed = new vscode.EventEmitter<void>()
  private _globalState?: vscode.Memento
  private providerConfigManager?: ProviderConfigManager

  readonly onModelChanged = this._onModelChanged.event
  readonly onModelsRefreshed = this._onModelsRefreshed.event

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
      const cached = this._globalState.get<ModelInfo[]>(MODEL_CACHE_KEY, [])
      if (cached.length > 0) {
        this._models = cached
        this._onModelsRefreshed.fire()
        log.info(`Loaded ${cached.length} cached models from globalState`)
      }
    } catch (err) {
      log.warn("Failed to load cached models", err)
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
    return info?.contextWindow
  }

  setModel(modelId: string): void {
    if (this._current !== modelId) {
      this._current = modelId
      this._onModelChanged.fire(modelId)
      log.info(`Model changed to: ${modelId}`)
    }
  }

  /**
   * Fetch available models from the opencode server's config endpoint.
   * The caller must provide the port (from SessionManager) or we fall back
   * to querying `opencode` CLI directly.
   */
  async refreshModels(port?: number, authHeader?: string): Promise<ModelInfo[]> {
    try {
      let models: ModelInfo[]
      if (port) {
        models = await this.fetchModelsFromServer(port, authHeader)
      } else {
        models = await this.fetchModelsFromCli()
      }
      // Auto-select first model if none is currently selected
      if (!this._current && models.length > 0 && models[0]) {
        const firstId = `${models[0].provider}/${models[0].id}`
        this.setModel(firstId)
      }
      return models
    } catch (err) {
      log.error("Failed to refresh models", err)
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
      const providers = Array.isArray(data) ? data : data.providers || []
      for (const provider of providers) {
        const providerModels = Array.isArray(provider.models)
          ? provider.models
          : Object.entries(provider.models || {}).map(([id, model]: [string, any]) => ({
              id: model.id || id,
              name: model.name,
              reasoning: model.capabilities?.reasoning === true || model.reasoning === true,
            }))

        for (const m of providerModels) {
          const reasoning = m.reasoning === true || 
                            (m.name && (m.name.includes("Thinking") || m.name.includes("Reasoning") || m.name.includes("O1"))) ||
                            (m.id && (m.id.includes("thinking") || m.id.includes("reasoning") || m.id.includes("o1")))
          
          models.push({
            id: m.id,
            provider: provider.id,
            displayName: m.name || m.id,
            contextWindow: m.limit?.context || undefined,
            outputLimit: m.limit?.output || undefined,
            supportsVariants: !!reasoning,
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
            const lines = stdout.trim().split("\n").filter(l => l.trim())
            this._models = lines.map((line) => {
              const trimmed = line.trim()
              const slashIdx = trimmed.indexOf("/")
              if (slashIdx >= 0) {
                const provider = trimmed.substring(0, slashIdx)
                const modelId = trimmed.substring(slashIdx + 1)
                return {
                  id: modelId,
                  provider,
                  displayName: modelId,
                }
              }
              return {
                id: trimmed,
                provider: "unknown",
                displayName: trimmed,
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
        items.push({
          label: m.displayName + unavailableSuffix,
          description: isCurrent ? "● Current" : "",
          detail: m.contextWindow ? `${m.contextWindow.toLocaleString()} tokens` : "",
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
