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
      const originalContent = edit.originalContent || await this.readFile(uri)
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

  private resolveWorkspaceFile(filePath: string): vscode.Uri | null {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) return null

    const root = workspaceFolders[0]!.uri.fsPath
    const fullPath = path.resolve(root, filePath)
    const relative = path.relative(root, fullPath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null

    return vscode.Uri.file(fullPath)
  }

  dispose(): void {}

  async showSideBySideDiff(filePath: string, proposedContent: string, title?: string): Promise<void> {
    const uri = this.resolveWorkspaceFile(filePath)
    if (!uri) {
      throw new Error("Diff target is outside the current workspace.")
    }

    const originalDoc = await vscode.workspace.openTextDocument(uri)
    const originalContent = originalDoc.getText()

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const baseName = path.basename(filePath)
    const leftUri = vscode.Uri.parse(`untitled:${baseName}.original.${timestamp}`)
    const rightUri = vscode.Uri.parse(`untitled:${baseName}.proposed.${timestamp}`)

    await vscode.workspace.openTextDocument(leftUri).then(doc => {
      const edit = new vscode.WorkspaceEdit()
      edit.insert(leftUri, new vscode.Position(0, 0), originalContent)
      return vscode.workspace.applyEdit(edit)
    })

    await vscode.workspace.openTextDocument(rightUri).then(doc => {
      const edit = new vscode.WorkspaceEdit()
      edit.insert(rightUri, new vscode.Position(0, 0), proposedContent)
      return vscode.workspace.applyEdit(edit)
    })

    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title || `Diff: ${filePath}`)
  }
}
