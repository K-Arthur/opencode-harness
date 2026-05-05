import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const config = vscode.workspace.getConfiguration("opencode.inlineSuggestions")
    const enabled = config.get<boolean>("enabled", true)
    if (!enabled) return []

    const triggerDelay = config.get<number>("triggerDelay", 300)

    if (token.isCancellationRequested) return []

    const prefixEnd = Math.max(0, document.offsetAt(position) - 2000)
    const prefixStart = Math.max(0, prefixEnd)
    const prefix = document.getText(new vscode.Range(document.positionAt(prefixStart), position))

    const suffix = document.getText(
      new vscode.Range(position, document.positionAt(document.getText().length)),
    )

    return new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      this.clearDebounce()

      const onCancel = token.onCancellationRequested(() => {
        this.clearDebounce()
        resolve([])
        onCancel.dispose()
      })

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        onCancel.dispose()

        if (token.isCancellationRequested) {
          resolve([])
          return
        }

        const completion = this.generateCompletion(prefix, suffix)
        if (completion) {
          resolve([completion])
        } else {
          resolve([])
        }
      }, triggerDelay)
    })
  }

  private generateCompletion(prefix: string, suffix: string): vscode.InlineCompletionItem | null {
    if (prefix.length === 0) return null

    log.info(`InlineCompletion: prefix=${prefix.length}chars suffix=${suffix.length}chars`)

    const insertText = "// TODO: implement completion via opencode server"
    return new vscode.InlineCompletionItem(insertText)
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  dispose(): void {
    this.clearDebounce()
  }
}
