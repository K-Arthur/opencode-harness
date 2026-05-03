import * as vscode from "vscode"

export interface ProposedEdit {
  filePath: string
  originalContent: string
  proposedContent: string
  messageId: string
  blockId: string
}

export class DiffApplier {
  parseCodeBlocks(parts: { type: string; text?: string }[]): ProposedEdit[] {
    const edits: ProposedEdit[] = []
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        const blocks = this.extractCodeBlocks(part.text)
        for (const block of blocks) {
          edits.push({
            filePath: block.path || "unknown",
            originalContent: "",
            proposedContent: block.code,
            messageId: "",
            blockId: `block_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          })
        }
      }
    }
    return edits
  }

  private extractCodeBlocks(text: string): { path?: string; language?: string; code: string }[] {
    const blocks: { path?: string; language?: string; code: string }[] = []
    const regex = /```(\w+)?(?:\s+\/\/\s*([^\n]+))?\n([\s\S]*?)```/g
    let match
    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        language: match[1] || undefined,
        path: match[2] || undefined,
        code: match[3],
      })
    }
    return blocks
  }

  async generateDiff(filePath: string, proposedContent: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return proposedContent

    const fullPath = filePath.startsWith("/")
      ? filePath
      : vscode.Uri.joinPath(workspaceFolders[0].uri, filePath).fsPath

    try {
      const originalUri = vscode.Uri.file(fullPath)
      const originalDoc = await vscode.workspace.openTextDocument(originalUri)
      const originalContent = originalDoc.getText()
      return this.computeUnifiedDiff(filePath, originalContent, proposedContent)
    } catch {
      return `+ ${proposedContent.split("\n").join("\n+ ")}`
    }
  }

  private computeUnifiedDiff(filePath: string, original: string, proposed: string): string {
    if (original === proposed) return "(no changes)"
    const originalLines = original.split("\n")
    const proposedLines = proposed.split("\n")
    const result: string[] = []

    let i = 0
    let j = 0
    while (i < originalLines.length || j < proposedLines.length) {
      if (i < originalLines.length && j < proposedLines.length && originalLines[i] === proposedLines[j]) {
        result.push(`  ${originalLines[i]}`)
        i++
        j++
      } else {
        if (i < originalLines.length) {
          result.push(`- ${originalLines[i]}`)
          i++
        }
        if (j < proposedLines.length) {
          result.push(`+ ${proposedLines[j]}`)
          j++
        }
      }
    }
    return result.join("\n")
  }

  async acceptEdit(edit: ProposedEdit): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return false

    const fullPath = edit.filePath.startsWith("/")
      ? edit.filePath
      : vscode.Uri.joinPath(workspaceFolders[0].uri, edit.filePath).fsPath

    const uri = vscode.Uri.file(fullPath)

    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      const wholeRange = new vscode.Range(0, 0, doc.lineCount, 0)
      const wEdit = new vscode.WorkspaceEdit()
      wEdit.replace(uri, wholeRange, edit.proposedContent)
      return await vscode.workspace.applyEdit(wEdit)
    } catch {
      const wEdit = new vscode.WorkspaceEdit()
      wEdit.createFile(uri, { overwrite: true })
      await vscode.workspace.applyEdit(wEdit)
      const doc = await vscode.workspace.openTextDocument(uri)
      const wEdit2 = new vscode.WorkspaceEdit()
      wEdit2.insert(uri, new vscode.Position(0, 0), edit.proposedContent)
      return await vscode.workspace.applyEdit(wEdit2)
    }
  }

  rejectEdit(_edit: ProposedEdit): void {
    // No-op
  }
}
