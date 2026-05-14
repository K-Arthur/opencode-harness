import * as vscode from "vscode"
import { PromptStashManager } from "../prompts/PromptStashManager"
import { log } from "../utils/outputChannel"

export function registerPromptCommands(
  context: vscode.ExtensionContext,
  promptStashManager: PromptStashManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.stashPrompt", async (name?: string) => {
      try {
        if (!name) {
          name = await vscode.window.showInputBox({
            prompt: "Enter a name for the stash:",
            placeHolder: "Stash name (e.g., Code Review, Bug Fix)",
          })
          if (!name) return
        }

        const content = await vscode.window.showInputBox({
          prompt: "Enter the prompt content to stash:",
          placeHolder: "Your prompt text (e.g., Always write tests first)",
        })
        if (!content) return

        const id = await promptStashManager.stashGlobal(name, content)
        vscode.window.showInformationMessage(`Prompt "${name}" stashed successfully`)
      } catch (err) {
        log.error("Stash prompt failed", err)
        vscode.window.showErrorMessage("Failed to stash prompt.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.listStashedPrompts", async () => {
      try {
        const stashes = promptStashManager.getGlobalStashes()
        if (stashes.length === 0) {
          vscode.window.showInformationMessage("No stashed prompts found.")
          return
        }

        const items = stashes.map((s) => ({
          label: s.name,
          description: `${s.content.slice(0, 50)}${s.content.length > 50 ? "..." : ""}`,
          detail: `Used ${s.usageCount} times`,
          stash: s,
        }))

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Choose a stashed prompt",
        })

        if (selected) {
          const action = await vscode.window.showQuickPick(
            [
              { label: "Insert to input", description: "Insert prompt to the current input" },
              { label: "Copy to clipboard", description: "Copy prompt to clipboard" },
              { label: "Delete", description: "Delete this stash" },
            ],
            { placeHolder: "Choose an action" }
          )

          if (action?.label === "Insert to input") {
            await vscode.env.clipboard.writeText(selected.stash.content)
            vscode.window.showInformationMessage("Prompt copied to clipboard. Paste it in the chat input.")
            await promptStashManager.recordUsage(selected.stash.id)
          } else if (action?.label === "Copy to clipboard") {
            await vscode.env.clipboard.writeText(selected.stash.content)
            vscode.window.showInformationMessage("Prompt copied to clipboard.")
            await promptStashManager.recordUsage(selected.stash.id)
          } else if (action?.label === "Delete") {
            await promptStashManager.deleteStash(selected.stash.id)
            vscode.window.showInformationMessage("Stash deleted.")
          }
        }
      } catch (err) {
        log.error("List stashed prompts failed", err)
        vscode.window.showErrorMessage("Failed to list stashed prompts.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.deleteStash", async () => {
      try {
        const stashes = promptStashManager.getGlobalStashes()
        if (stashes.length === 0) {
          vscode.window.showInformationMessage("No stashed prompts found.")
          return
        }

        const items = stashes.map((s) => ({
          label: s.name,
          description: s.content.slice(0, 50),
          stash: s,
        }))

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a stash to delete",
        })

        if (selected) {
          await promptStashManager.deleteStash(selected.stash.id)
          vscode.window.showInformationMessage(`Stash "${selected.label}" deleted.`)
        }
      } catch (err) {
        log.error("Delete stash failed", err)
        vscode.window.showErrorMessage("Failed to delete stash.")
      }
    })
  )
}
