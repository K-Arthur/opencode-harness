import { log } from "../utils/outputChannel"
import * as vscode from "vscode"
import { estimateTokens } from "../utils/tokenCounter"
import type { WorkspaceAdapter } from "./WorkspaceAdapter"

export interface GatherConfig {
  mode: "basic" | "deep"
  maxTokens?: number
}

export interface ContextPackage {
  openFiles: {
    path: string
    language: string
    content: string
    selection?: { startLine: number; endLine: number; text: string }
  }[]
  diagnostics: { file: string; errors: string[]; warnings: string[]; hints: string[] }[]
  workspaceTree: { name: string; type: "file" | "directory"; children?: unknown[] }[]
  projectConfigs: { type: string; path: string; content: string }[]
  gitStatus: { branch: string; modified: string[]; staged: string[]; recentDiff?: string }
  terminalOutput?: { name: string; text: string }
  explicitContext?: { type: string; content: string }[]
}

export class ContextEngine {
  private _onConfigChanged = new vscode.EventEmitter<void>()
  onConfigChanged = this._onConfigChanged.event

  constructor(private readonly adapter: WorkspaceAdapter) {}

  async gatherContext(config: GatherConfig = { mode: "basic" }): Promise<ContextPackage> {
    const [openFiles, diagnostics, workspaceTree, projectConfigs, gitStatus] = await Promise.all([
      this.gatherOpenFiles(config.maxTokens),
      this.gatherDiagnostics(),
      this.gatherWorkspaceTree(),
      this.gatherProjectConfigs(),
      this.gatherGitStatus(),
    ])

    return { openFiles, diagnostics, workspaceTree, projectConfigs, gitStatus }
  }

  private async gatherOpenFiles(maxTokens = 50_000): Promise<ContextPackage["openFiles"]> {
    const result: ContextPackage["openFiles"] = []
    const tabs = this.adapter.listOpenTabs()
    let usedTokens = 0

    for (const tab of tabs) {
      try {
        const fileContent = await this.adapter.readFile(tab.uri)
        let content = fileContent.content
        const contentTokens = estimateTokens(content)

        if (usedTokens + contentTokens > maxTokens) {
          const remainingTokens = maxTokens - usedTokens
          if (remainingTokens <= 0) {
            content = `[File skipped: would exceed token limit of ${maxTokens}]`
          } else {
            const maxChars = remainingTokens * 4
            content = content.slice(0, maxChars) + `\n[File truncated: remaining ${contentTokens - remainingTokens} tokens hidden]`
            usedTokens += remainingTokens
          }
        } else {
          usedTokens += contentTokens
        }

        const selection = this.adapter.getActiveSelection()
        let selectionInfo: { startLine: number; endLine: number; text: string } | undefined
        if (selection && selection.uri === tab.uri) {
          selectionInfo = { startLine: selection.startLine, endLine: selection.endLine, text: selection.text }
        }

        result.push({
          path: this.adapter.getRelativePath(tab.uri),
          language: fileContent.languageId,
          content,
          selection: selectionInfo,
        })
      } catch {
        // skip inaccessible files
      }
    }
    return result.slice(0, 10)
  }

  private gatherDiagnostics(): ContextPackage["diagnostics"] {
    return this.adapter.getDiagnostics()
  }

  private async gatherWorkspaceTree(depth = 3): Promise<ContextPackage["workspaceTree"]> {
    const folders = this.adapter.getWorkspaceFolders()
    if (folders.length === 0) return []

    try {
      const files = await this.adapter.findFiles("**/*", "**/node_modules/**", 100)
      const tree: Map<string, { name: string; type: "file" | "directory" }> = new Map()

      for (const file of files) {
        const relative = this.adapter.getRelativePath(file)
        const parts = relative.split("/")
        if (parts.length > depth) continue
        for (let i = 0; i < parts.length; i++) {
          const fullPath = parts.slice(0, i + 1).join("/")
          if (!tree.has(fullPath)) {
            tree.set(fullPath, {
              name: parts[i]!,
              type: i === parts.length - 1 ? "file" : "directory",
            })
          }
        }
      }

      return Array.from(tree.values())
    } catch (err) {
      log.warn("[ContextEngine] Failed to gather workspace tree", err)
      return []
    }
  }

  private async gatherProjectConfigs(): Promise<ContextPackage["projectConfigs"]> {
    const configs: ContextPackage["projectConfigs"] = []
    const configFiles = ["package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"]

    for (const fileName of configFiles) {
      const files = await this.adapter.findFiles(fileName, "**/node_modules/**", 1)
      if (files.length > 0) {
        try {
          const fileContent = await this.adapter.readFile(files[0]!)
          configs.push({
            type: fileName,
            path: this.adapter.getRelativePath(files[0]!),
            content: fileContent.content,
          })
        } catch {
          // skip
        }
      }
    }

    return configs
  }

  private async gatherGitStatus(): Promise<ContextPackage["gitStatus"]> {
    return this.adapter.getGitInfo()
  }

  dispose(): void {
    this._onConfigChanged.dispose()
  }
}
