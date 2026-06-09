import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import fastDiff from "fast-diff"
import { log } from "../utils/outputChannel"

export interface ProposedEdit {
  filePath: string
  originalContent: string
  proposedContent: string
  messageId: string
  blockId: string
  backupPath?: string
}

export class DiffApplier {
  private acceptedEdits = new Map<string, ProposedEdit>()
  private diffDocuments = new Map<string, string>()
  private diffDocumentProvider?: vscode.Disposable

  parseCodeBlocks(parts: { type: string; text?: string }[]): ProposedEdit[] {
    const edits: ProposedEdit[] = []
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        const blocks = this.extractCodeBlocks(part.text)
        for (const block of blocks) {
          if (!block.path) continue
          edits.push({
            filePath: block.path,
            originalContent: "",
            proposedContent: block.code,
            messageId: "",
            blockId: `block_${crypto.randomUUID().slice(0, 8)}`,
          })
        }
      }
    }
    return edits
  }

  private extractCodeBlocks(text: string): { path?: string; language?: string; code: string }[] {
    const blocks: { path?: string; language?: string; code: string }[] = []
    const regex = /```([^\n]*)\n([\s\S]*?)```/g
    let match
    while ((match = regex.exec(text)) !== null) {
      const info = this.parseFenceInfo(match[1] || "")
      blocks.push({
        language: info.language,
        path: info.path,
        code: match[2] ?? "",
      })
    }
    return blocks
  }

  private parseFenceInfo(info: string): { language?: string; path?: string } {
    const trimmed = info.trim()
    if (!trimmed) return {}

    const commentMatch = trimmed.match(/^(\S+)?\s*\/\/\s*(.+)$/)
    if (commentMatch) {
      return { language: commentMatch[1] ?? undefined, path: commentMatch[2]?.trim() }
    }

    const fileMatch = trimmed.match(/^(\S+)?\s+(?:file=|filename=|path=)?(.+)$/)
    if (fileMatch) {
      return { language: fileMatch[1] ?? undefined, path: fileMatch[2]?.trim().replace(/^["']|["']$/g, "") }
    }

    return { language: trimmed }
  }

  async generateDiff(filePath: string, proposedContent: string): Promise<string> {
    const uri = this.resolveWorkspaceFile(filePath)
    if (!uri) return proposedContent

    try {
      const originalDoc = await vscode.workspace.openTextDocument(uri)
      const originalContent = originalDoc.getText()
      return this.computeUnifiedDiff(filePath, originalContent, proposedContent)
    } catch {
      return `+ ${proposedContent.split("\n").join("\n+ ")}`
    }
  }

  private computeUnifiedDiff(filePath: string, original: string, proposed: string): string {
    if (original === proposed) return "(no changes)"

    const diffs = fastDiff(original, proposed)
    const result: string[] = []
    let lineBuffer = ""
    let currentType: number | null = null

    const flushLine = () => {
      if (lineBuffer === "" || currentType === null) return
      if (currentType === fastDiff.EQUAL) {
        result.push(`  ${lineBuffer}`)
      } else if (currentType === fastDiff.DELETE) {
        result.push(`- ${lineBuffer}`)
      } else if (currentType === fastDiff.INSERT) {
        result.push(`+ ${lineBuffer}`)
      }
      lineBuffer = ""
    }

    for (const [type, text] of diffs) {
      if (currentType !== null && currentType !== type) {
        flushLine()
      }
      currentType = type

      const parts = text.split("\n")
      for (let i = 0; i < parts.length - 1; i++) {
        lineBuffer += parts[i]
        flushLine()
      }
      lineBuffer += parts[parts.length - 1]
    }

    flushLine()
    return result.join("\n")
  }

  async acceptEdit(edit: ProposedEdit): Promise<boolean> {
    const uri = this.resolveWorkspaceFile(edit.filePath)
    if (!uri) {
      throw new Error("Diff target is outside the current workspace.")
    }

    try {
      // Create backup before applying changes
      let originalContent = edit.originalContent
      if (!originalContent) {
        try {
          originalContent = await this.readFile(uri)
        } catch {
          originalContent = ""
        }
      }
      const backupPath = this.createBackup(edit.filePath, originalContent)
      edit.backupPath = backupPath
      log.info(`Backup created: ${backupPath}`)

      // Atomic update or create
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const wholeRange = new vscode.Range(0, 0, doc.lineCount, 0)
        const wEdit = new vscode.WorkspaceEdit()
        wEdit.replace(uri, wholeRange, edit.proposedContent)
        return await vscode.workspace.applyEdit(wEdit)
      } catch {
        const wEdit = new vscode.WorkspaceEdit()
        wEdit.createFile(uri, { overwrite: true, contents: Buffer.from(edit.proposedContent, "utf8") })
        return await vscode.workspace.applyEdit(wEdit)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Error applying edit to ${edit.filePath}`, err)

      if (edit.backupPath) {
        log.info(`Backup available for rollback: ${edit.backupPath}`)
      }

      throw new Error(`Failed to apply diff: ${msg}`)
    }
  }

  async rollbackEdit(edit: ProposedEdit): Promise<boolean> {
    if (!edit.backupPath) {
      throw new Error("No backup available for this edit")
    }

    try {
      const backupContent = fs.readFileSync(edit.backupPath, "utf-8")
      const uri = this.resolveWorkspaceFile(edit.filePath)
      if (!uri) throw new Error("Original file path no longer valid")

      const doc = await vscode.workspace.openTextDocument(uri)
      const wholeRange = new vscode.Range(0, 0, doc.lineCount, 0)
      const wEdit = new vscode.WorkspaceEdit()
      wEdit.replace(uri, wholeRange, backupContent)
      return await vscode.workspace.applyEdit(wEdit)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Rollback failed: ${msg}`)
    }
  }

  private async readFile(uri: vscode.Uri): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(uri)
    return doc.getText()
  }

  private createBackup(filePath: string, content: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) return ""

    const root = workspaceFolders[0]!.uri.fsPath
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const baseName = path.basename(filePath)
    const backupName = `${baseName}.${timestamp}.bak`
    // Store backups in a dedicated directory to avoid polluting source directories
    const backupDir = path.join(root, ".opencode", "backups")
    const backupPath = path.join(backupDir, backupName)

    fs.mkdirSync(backupDir, { recursive: true })

    fs.writeFileSync(backupPath, content, "utf-8")
    return backupPath
  }

  rejectEdit(_edit: ProposedEdit): void {
    // No-op
  }

  markAcceptedEdit(diffId: string, edit: ProposedEdit): void {
    this.acceptedEdits.set(diffId, edit)
  }

  getAcceptedEdit(diffId: string): ProposedEdit | undefined {
    return this.acceptedEdits.get(diffId)
  }

  private resolveWorkspaceFile(filePath: string): vscode.Uri | null {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) return null

    const root = workspaceFolders[0]!.uri.fsPath
    const fullPath = path.resolve(root, filePath)
    const relative = path.relative(root, fullPath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null

    return vscode.Uri.file(fullPath)
  }

  dispose(): void {
    this.diffDocumentProvider?.dispose()
    this.diffDocuments.clear()
    this.acceptedEdits.clear()
  }

  async showSideBySideDiff(filePath: string, proposedContent: string, title?: string): Promise<void> {
    const uri = this.resolveWorkspaceFile(filePath)
    if (!uri) {
      throw new Error("Diff target is outside the current workspace.")
    }

    const originalDoc = await vscode.workspace.openTextDocument(uri)
    const originalContent = originalDoc.getText()

    this.ensureDiffDocumentProvider()
    const timestamp = encodeURIComponent(new Date().toISOString())
    const baseName = encodeURIComponent(path.basename(filePath))
    const leftUri = vscode.Uri.parse(`opencode-diff:/${baseName}.original.${timestamp}`)
    const rightUri = vscode.Uri.parse(`opencode-diff:/${baseName}.proposed.${timestamp}`)
    this.diffDocuments.set(leftUri.toString(), originalContent)
    this.diffDocuments.set(rightUri.toString(), proposedContent)

    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title || `Diff: ${filePath}`)
  }

  private ensureDiffDocumentProvider(): void {
    if (this.diffDocumentProvider) return
    this.diffDocumentProvider = vscode.workspace.registerTextDocumentContentProvider("opencode-diff", {
      provideTextDocumentContent: (uri) => this.diffDocuments.get(uri.toString()) ?? "",
    })
  }

  /** Parse a unified diff string into an array of hunk descriptors. Pure function — no I/O. */
  parseUnifiedDiff(diffText: string): Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }> {
    const hunks: Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }> = []
    const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
    let current: (typeof hunks)[number] | null = null

    for (const raw of diffText.split("\n")) {
      const m = hunkHeaderRe.exec(raw)
      if (m) {
        if (current) hunks.push(current)
        current = {
          oldStart: parseInt(m[1]!, 10),
          oldCount: parseInt(m[2] ?? "1", 10),
          newStart: parseInt(m[3]!, 10),
          newCount: parseInt(m[4] ?? "1", 10),
          lines: [],
        }
        continue
      }
      if (!current) continue
      if (raw.startsWith("+")) {
        current.lines.push({ type: "added", content: raw.slice(1) })
      } else if (raw.startsWith("-")) {
        current.lines.push({ type: "removed", content: raw.slice(1) })
      } else if (raw.startsWith(" ")) {
        current.lines.push({ type: "context", content: raw.slice(1) })
      }
    }
    if (current) hunks.push(current)
    return hunks
  }

  /**
   * Apply a subset of hunks (those with `hunkId` present in `acceptedHunkIds`) to `filePath`
   * using a single atomic `WorkspaceEdit`. All edits share one undo step.
   *
   * Returns `true` on success. Returns `false` with a logged warning if the file cannot be opened.
   */
  async applyHunks(
    filePath: string,
    hunks: Array<{ hunkId: string; id: string; oldStart: number; oldCount: number; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }>,
    acceptedHunkIds: Set<string>
  ): Promise<boolean> {
    const uri = this.resolveWorkspaceFile(filePath)
    if (!uri) {
      log.warn(`applyHunks: ${filePath} is outside the current workspace`)
      return false
    }

    let doc: vscode.TextDocument
    try {
      doc = await vscode.workspace.openTextDocument(uri)
    } catch {
      log.warn(`applyHunks: could not open ${filePath}`)
      return false
    }

    const wEdit = new vscode.WorkspaceEdit()

    for (const hunk of hunks) {
      const id = hunk.id ?? hunk.hunkId
      if (!acceptedHunkIds.has(id)) continue

      // Build the replacement text from accepted (non-removed) lines
      const lines = hunk.lines
      const removedCount = lines.filter(l => l.type === "removed").length
      const contextLines = lines.filter(l => l.type === "context")

      // Replacement text: context + added lines (removed lines disappear)
      const replacement = lines
        .filter(l => l.type !== "removed")
        .map(l => l.content)
        .join("\n")

      const startLine = hunk.oldStart - 1
      const endLine = startLine + removedCount + contextLines.length

      const startPos = new vscode.Position(startLine, 0)
      const endPos = doc.lineAt(Math.min(endLine - 1, doc.lineCount - 1)).range.end
      const rangeToReplace = new vscode.Range(startPos, endPos)

      wEdit.replace(uri, rangeToReplace, replacement)
    }

    return vscode.workspace.applyEdit(wEdit)
  }
}
