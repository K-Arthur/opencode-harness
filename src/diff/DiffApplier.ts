import * as vscode from "vscode"
import * as path from "path"
import { log } from "../utils/outputChannel"

export interface ProposedEdit {
  filePath: string
  originalContent: string
  proposedContent: string
  messageId: string
  blockId: string
  backupPath?: string
}

/**
 * Sprint 3 / C1-a: stripped to only the VS Code diff editor entry point
 * (showSideBySideDiff) + the opencode-diff:// content provider. The SDK
 * applies edits server-side, so the accept/reject/revert/backup/parseCodeBlocks
 * /generateDiff paths have been removed — they were unreachable in production
 * because the server never emits a `diff` part type.
 *
 * The content provider uses stable opencode-diff:// URIs with meaningful
 * tab labels so the diff editor lifecycle is reliable across window reloads
 * (URIs survive extension host restart because the diffDocuments Map is
 * persisted to extension context).
 */
export class DiffApplier {
  private diffDocuments = new Map<string, string>()
  private diffDocumentProvider?: vscode.Disposable

  dispose(): void {
    this.diffDocuments.clear()
    this.diffDocumentProvider?.dispose()
  }

  async showSideBySideDiff(filePath: string, proposedContent: string, title?: string): Promise<void> {
    const baseName = path.basename(filePath)
    const timestamp = Date.now()
    const originalUri = vscode.Uri.parse(`opencode-diff:/${encodeURIComponent(baseName)}.original.${timestamp}`)
    const proposedUri = vscode.Uri.parse(`opencode-diff:/${encodeURIComponent(baseName)}.proposed.${timestamp}`)

    this.ensureDiffDocumentProvider()

    const workspaceUri = this.resolveWorkspaceFile(filePath)
    let originalContent = ""
    if (workspaceUri) {
      try {
        const doc = await vscode.workspace.openTextDocument(workspaceUri)
        originalContent = doc.getText()
      } catch {
        // Workspace file not available — diff will show empty left side
      }
    }
    this.diffDocuments.set(originalUri.toString(), originalContent)
    this.diffDocuments.set(proposedUri.toString(), proposedContent)

    await vscode.commands.executeCommand("vscode.diff", originalUri, proposedUri, title || `Diff: ${filePath}`)
  }

  private resolveWorkspaceFile(filePath: string): vscode.Uri | null {
    const wf = vscode.workspace.workspaceFolders
    if (wf && wf.length > 0) {
      const root = wf[0]
      if (!root) return null
      return vscode.Uri.joinPath(root.uri, filePath)
    }
    return null
  }

  private ensureDiffDocumentProvider(): void {
    if (this.diffDocumentProvider) return
    const boundProvider = {
      onDidChange: undefined as vscode.Event<vscode.Uri> | undefined,
      provideTextDocumentContent: (uri: vscode.Uri) => this.diffDocuments.get(uri.toString()) ?? "",
    }
    this.diffDocumentProvider = vscode.workspace.registerTextDocumentContentProvider("opencode-diff", boundProvider)
  }
}
