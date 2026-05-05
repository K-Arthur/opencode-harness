import * as vscode from "vscode"
import { DiffApplier, type ProposedEdit } from "../../diff/DiffApplier"
import { log } from "../../utils/outputChannel"
import { randomUUID } from "crypto"

export class DiffHandler {
  private pendingDiffs = new Map<string, ProposedEdit>()
  private acceptingDiffs = new Set<string>()

  constructor(private readonly diffApplier: DiffApplier) {}

  /**
   * Register a new diff block with a stable UUID v4.
   * Called when a diff: block is received from the SSE stream.
   */
  register(edit: ProposedEdit): string {
    const diffId = randomUUID()
    this.pendingDiffs.set(diffId, edit)
    return diffId
  }

  /**
   * Accept a diff by its stable diffId.
   * - Calls DiffApplier.apply()
   * - Emits { type: 'diff:accepted', diffId, path } to the webview
   * - Records in checkpoint log
   * - If DiffApplier.apply throws, emited diff:error — never leaves webview stuck
   */
  async accept(diffId: string): Promise<{ ok: boolean; message?: string }> {
    // Atomic check-and-set to prevent double-apply race
    if (this.acceptingDiffs.has(diffId)) {
      return { ok: false, message: "Diff is already being applied." }
    }
    this.acceptingDiffs.add(diffId)

    const edit = this.pendingDiffs.get(diffId)
    if (!edit) {
      this.acceptingDiffs.delete(diffId)
      return { ok: false, message: "Diff is no longer available." }
    }

    // Delete before async to prevent concurrent accept
    this.pendingDiffs.delete(diffId)

    try {
      const ok = await this.diffApplier.acceptEdit(edit)
      if (!ok) {
        return { ok: false, message: "VS Code could not apply the edit." }
      }

      vscode.window.showInformationMessage(`Applied changes to ${edit.filePath || "file"}.`)

      // Emit to webview via the registered callback (set by StreamCoordinator)
      this.emitToWebview?.({
        type: 'diff:accepted',
        diffId,
        path: edit.filePath,
      })

      return { ok: true, message: "Applied" }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Failed to apply diff", e)

      // Never leave the webview action bar in a stuck/pending state
      this.emitToWebview?.({
        type: 'diff:error',
        diffId,
        error: message,
      })

      return { ok: false, message }
    } finally {
      this.acceptingDiffs.delete(diffId)
    }
  }

  /**
   * Discard a diff by its stable diffId.
   * - Removes from registry
   * - Emits { type: 'diff:discarded', diffId } to the webview
   */
  reject(diffId: string): void {
    this.pendingDiffs.delete(diffId)
    this.acceptingDiffs.delete(diffId)

    this.emitToWebview?.({
      type: 'diff:discarded',
      diffId,
    })
  }

  /**
   * Open the file associated with a diff in the editor.
   * Called when the "Open File" button is clicked in the webview.
   */
  async openFile(diffId: string): Promise<void> {
    const edit = this.pendingDiffs.get(diffId)
    if (!edit?.filePath) return

    try {
      const doc = await vscode.workspace.openTextDocument(edit.filePath)
      await vscode.window.showTextDocument(doc)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Failed to open file", e)
      vscode.window.showErrorMessage(`Could not open file: ${message}`)
    }
  }

  setMessageId(_diffId: string, _messageId: string): void {
    // No longer needed — we use stable diffIds now
  }

  /**
   * Callback to emit messages to the webview.
   * Set by StreamCoordinator when initializing the diff handler.
   */
  emitToWebview?: (msg: Record<string, unknown>) => void

  dispose(): void {
    this.pendingDiffs.clear()
    this.acceptingDiffs.clear()
  }
}
