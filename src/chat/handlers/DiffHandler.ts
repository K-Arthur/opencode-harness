import * as vscode from "vscode"
import { DiffApplier, type ProposedEdit } from "../../diff/DiffApplier"
import { log } from "../../utils/outputChannel"

export class DiffHandler {
  private pendingDiffs = new Map<string, ProposedEdit>()

  constructor(private readonly diffApplier: DiffApplier) {}

  register(blockId: string, edit: ProposedEdit): void {
    this.pendingDiffs.set(blockId, edit)
  }

  async accept(blockId: string): Promise<{ ok: boolean; message?: string }> {
    const edit = this.pendingDiffs.get(blockId)
    if (!edit) {
      return { ok: false, message: "Diff is no longer available." }
    }

    try {
      const ok = await this.diffApplier.acceptEdit(edit)
      if (!ok) {
        return { ok: false, message: "VS Code could not apply the edit." }
      }
      this.pendingDiffs.delete(blockId)
      vscode.window.showInformationMessage(`Applied changes to ${edit.filePath}.`)
      return { ok: true, message: "Applied" }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Failed to apply diff", e)
      return { ok: false, message }
    }
  }

  reject(blockId: string): void {
    this.pendingDiffs.delete(blockId)
  }

  setMessageId(blockId: string, messageId: string): void {
    const edit = this.pendingDiffs.get(blockId)
    if (edit) edit.messageId = messageId
  }
}
