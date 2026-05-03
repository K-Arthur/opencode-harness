import * as vscode from "vscode"
import { spawn } from "child_process"

export interface ModelInfo {
  id: string
  provider: string
  displayName: string
}

export class ModelManager {
  private _onModelChanged = new vscode.EventEmitter<string>()
  readonly onModelChanged = this._onModelChanged.event

  private currentModel = ""
  private availableModels: ModelInfo[] = []
  private statusBarItem: vscode.StatusBarItem

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101)
    this.statusBarItem.name = "OpenCode Model"
    this.statusBarItem.command = "opencode-harness.selectModel"
    const saved = vscode.workspace.getConfiguration("opencode").get<string>("model")
    if (saved) this.currentModel = saved
    this.render()
  }

  get model(): string {
    return this.currentModel
  }

  set model(val: string) {
    this.currentModel = val
    vscode.workspace.getConfiguration("opencode").update("model", val, vscode.ConfigurationTarget.Global)
    this._onModelChanged.fire(val)
    this.render()
  }

  async refreshModels(): Promise<ModelInfo[]> {
    this.availableModels = await this.fetchModels()
    return this.availableModels
  }

  private async fetchModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = []

    // Try SDK provider listing first
    try {
      const url = `http://127.0.0.1:${4096}/config/providers`
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json() as { providers: { id: string; models: { id: string; name?: string }[] }[] }
        for (const provider of data.providers || []) {
          for (const model of provider.models || []) {
            models.push({ id: `${provider.id}/${model.id}`, provider: provider.id, displayName: model.name || model.id })
          }
        }
        if (models.length > 0) return models
      }
    } catch { /* fall through */ }

    // Fall back to CLI opencode models
    try {
      const output = await this.execCli(["models", "--refresh"])
      const lines = output.split("\n").filter((l) => l.trim())
      for (const line of lines) {
        const parts = line.trim().split("/")
        if (parts.length === 2) {
          models.push({ id: line.trim(), provider: parts[0], displayName: parts[1] })
        }
      }
    } catch { /* fall through */ }

    // Hardcoded fallback
    if (models.length === 0) {
      models.push(
        { id: "anthropic/claude-sonnet-4-20250514", provider: "anthropic", displayName: "Claude Sonnet 4" },
        { id: "anthropic/claude-haiku-3-5-20241022", provider: "anthropic", displayName: "Claude Haiku 3.5" },
        { id: "openai/gpt-4o", provider: "openai", displayName: "GPT-4o" },
        { id: "openai/gpt-4o-mini", provider: "openai", displayName: "GPT-4o Mini" },
        { id: "opencode/gpt-5.1-codex", provider: "opencode", displayName: "GPT 5.1 Codex (Zen)" },
        { id: "opencode/claude-sonnet-4-5", provider: "opencode", displayName: "Claude Sonnet 4.5 (Zen)" },
      )
    }

    return models
  }

  private execCli(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("opencode", args, { timeout: 15000 })
      let out = ""
      let err = ""
      proc.stdout?.on("data", (d: Buffer) => { out += d.toString() })
      proc.stderr?.on("data", (d: Buffer) => { err += d.toString() })
      proc.on("close", (code) => {
        if (code === 0) resolve(out)
        else reject(new Error(err || `exit code ${code}`))
      })
      proc.on("error", reject)
    })
  }

  async pickModel(): Promise<string | undefined> {
    const models = await this.refreshModels()
    if (models.length === 0) {
      vscode.window.showErrorMessage("No models available. Check that opencode is installed and a provider is configured.")
      return
    }

    const items = models.map((m) => ({
      label: m.displayName,
      description: m.id,
      detail: `Provider: ${m.provider}`,
      id: m.id,
    }))

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a model",
      matchOnDescription: true,
      matchOnDetail: true,
    })

    if (picked) {
      this.model = picked.id
      vscode.window.showInformationMessage(`Model changed to ${picked.description}`)
    }

    return picked?.id
  }

  private render(): void {
    if (this.currentModel) {
      const short = this.currentModel.split("/").pop() || this.currentModel
      this.statusBarItem.text = `$(symbol-ruler) ${short}`
      this.statusBarItem.tooltip = `Active model: ${this.currentModel}\nClick to change`
      this.statusBarItem.show()
    } else {
      this.statusBarItem.hide()
    }
  }

  dispose(): void {
    this.statusBarItem.dispose()
    this._onModelChanged.dispose()
  }
}
