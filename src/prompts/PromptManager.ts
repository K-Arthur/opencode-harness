import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import { log } from "../utils/outputChannel"

export interface CustomPrompt {
  name: string
  description: string
  content: string
}

export interface PromptCommand {
  name: string
  description: string
  template: string
  isCustom: boolean
}

export class PromptManager implements vscode.Disposable {
  private prompts: CustomPrompt[] = []
  private watchers: vscode.Disposable[] = []
  private onChangeCallbacks: Array<() => void> = []

  scanWorkspace(): void {
    this.prompts = []
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return

    for (const folder of workspaceFolders) {
      const promptDir = path.join(folder.uri.fsPath, ".opencode", "prompts")
      if (!fs.existsSync(promptDir) || !fs.statSync(promptDir).isDirectory()) continue

      try {
        const files = fs.readdirSync(promptDir)
        for (const file of files) {
          if (!file.endsWith(".md")) continue
          const filePath = path.join(promptDir, file)
          const content = fs.readFileSync(filePath, "utf8")
          const name = file.replace(/\.md$/, "")
          const description = this.extractDescription(content)
          this.prompts.push({ name, description, content })
        }
      } catch (err) {
        log.error(`Error scanning prompts in ${promptDir}`, err)
      }
    }
  }

  private extractDescription(content: string): string {
    const lines = content.split("\n")
    const firstLine = lines.find((l) => l.trim().length > 0)
    if (!firstLine) return ""
    if (firstLine.startsWith("#")) {
      return firstLine.replace(/^#+\s*/, "").trim()
    }
    return firstLine.trim().slice(0, 80)
  }

  getPrompts(): CustomPrompt[] {
    return [...this.prompts]
  }

  getPromptCommands(): PromptCommand[] {
    return this.prompts.map((p) => ({
      name: p.name,
      description: p.description,
      template: p.content,
      isCustom: true,
    }))
  }

  resolvePrompt(name: string, variables: Record<string, string>): string | null {
    const prompt = this.prompts.find((p) => p.name === name)
    if (!prompt) return null

    let resolved = prompt.content
    for (const [key, value] of Object.entries(variables)) {
      resolved = resolved.replace(new RegExp(`\\{\\{\\s*${this.escapeRegex(key)}\\s*\\}\\}`, "g"), value)
    }
    return resolved
  }

  getPrompt(name: string): CustomPrompt | undefined {
    return this.prompts.find((p) => p.name === name)
  }

  onChanged(callback: () => void): void {
    this.onChangeCallbacks.push(callback)
  }

  watchPrompts(): void {
    this.disposeWatchers()
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return

    for (const folder of workspaceFolders) {
      const promptDir = path.join(folder.uri.fsPath, ".opencode", "prompts")
      const pattern = new vscode.RelativePattern(promptDir, "*.md")
      try {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        watcher.onDidCreate(() => this.refresh())
        watcher.onDidChange(() => this.refresh())
        watcher.onDidDelete(() => this.refresh())
        this.watchers.push(watcher)
      } catch (err) {
        log.error("Failed to create prompt file watcher", err)
      }
    }
  }

  private refresh(): void {
    this.scanWorkspace()
    for (const cb of this.onChangeCallbacks) {
      try {
        cb()
      } catch (err) {
        log.error("Error in prompt change callback", err)
      }
    }
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) w.dispose()
    this.watchers = []
  }

  dispose(): void {
    this.disposeWatchers()
    this.onChangeCallbacks = []
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
}
