import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export interface ModelInfo {
  id: string
  provider: string
  displayName: string
}

export class ModelManager {
  private _models: ModelInfo[] = []
  private _current: string = ""
  private _onModelChanged = new vscode.EventEmitter<string>()
  private _onModelsRefreshed = new vscode.EventEmitter<void>()
  private statusBarItem: vscode.StatusBarItem

  readonly onModelChanged = this._onModelChanged.event
  readonly onModelsRefreshed = this._onModelsRefreshed.event

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.statusBarItem.name = "OpenCode Model"
    this.statusBarItem.command = "opencode-harness.selectModel"
    this.updateStatusBar()
    this.statusBarItem.show()
  }

  get model(): string {
    return this._current
  }

  get models(): ModelInfo[] {
    return this._models
  }

  setModel(modelId: string): void {
    if (this._current !== modelId) {
      this._current = modelId
      this._onModelChanged.fire(modelId)
      this.updateStatusBar()
      log.info(`Model changed to: ${modelId}`)
    }
  }

  /**
   * Fetch available models from the opencode server's config endpoint.
   * The caller must provide the port (from SessionManager) or we fall back
   * to querying `opencode` CLI directly.
   */
  async refreshModels(port?: number): Promise<ModelInfo[]> {
    try {
      if (port) {
        return await this.fetchModelsFromServer(port)
      }
      return await this.fetchModelsFromCli()
    } catch (err) {
      log.error("Failed to refresh models", err)
      return this._models
    }
  }

  private async fetchModelsFromServer(port: number): Promise<ModelInfo[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/config/providers`, {
        signal: controller.signal
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
            }))

        for (const m of providerModels) {
          models.push({
            id: m.id,
            provider: provider.id,
            displayName: m.name || m.id,
          })
        }
      }

      this._models = models
      this._onModelsRefreshed.fire()
      log.info(`Refreshed models from server: ${models.length} models available`)
      return models
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchModelsFromCli(): Promise<ModelInfo[]> {
    const { spawn } = await import("child_process")
    const config = vscode.workspace.getConfiguration("opencode")
    const binaryPath = config.get<string>("binaryPath") || "opencode"

    return new Promise((resolve) => {
      const child = spawn(binaryPath, ["models"], {
        stdio: ["ignore", "pipe", "pipe"],
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

    const items = this._models.map((m) => ({
      label: m.displayName,
      description: `${m.provider}/${m.id}`,
      detail: `${m.provider}/${m.id}` === this._current ? "● Current" : "",
      // Store full provider/model path for the round-trip to work
      fullId: `${m.provider}/${m.id}`,
    }))

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a model",
      title: "OpenCode Model Selection",
    })

    return picked?.fullId
  }

  private updateStatusBar(): void {
    if (this._current) {
      // Display just the model name, but store provider/modelId internally
      const display = this._current.includes("/")
        ? this._current.split("/").pop()!
        : this._current
      this.statusBarItem.text = `$(symbol-color) ${display}`
      this.statusBarItem.tooltip = `OpenCode Model: ${this._current}\nClick to change`
    } else {
      this.statusBarItem.text = "$(symbol-color) Default Model"
      this.statusBarItem.tooltip = "OpenCode: Using default model\nClick to select a model"
    }
  }

  dispose(): void {
    this.statusBarItem.dispose()
    this._onModelChanged.dispose()
    this._onModelsRefreshed.dispose()
  }
}
