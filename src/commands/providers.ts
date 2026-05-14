import * as vscode from "vscode"
import { ProviderConfigManager } from "../model/ProviderConfigManager"
import { log } from "../utils/outputChannel"

export function registerProviderCommands(
  context: vscode.ExtensionContext,
  providerConfigManager: ProviderConfigManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.addProvider", async () => {
      try {
        const name = await vscode.window.showInputBox({
          prompt: "Enter provider name:",
          placeHolder: "Provider name (e.g., Anthropic, OpenAI)",
        })
        if (!name) return

        const apiKey = await vscode.window.showInputBox({
          prompt: "Enter API key:",
          placeHolder: "Your API key",
          password: true,
        })
        if (!apiKey) return

        const baseUrl = await vscode.window.showInputBox({
          prompt: "Enter base URL (optional):",
          placeHolder: "API base URL (optional)",
        })

        const id = await providerConfigManager.upsertConfig({
          name,
          apiKey,
          baseUrl: baseUrl || undefined,
          enabled: true,
          models: [],
        })
        vscode.window.showInformationMessage(`Provider "${name}" added successfully`)
      } catch (err) {
        log.error("Add provider failed", err)
        vscode.window.showErrorMessage("Failed to add provider.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.listProviders", async () => {
      try {
        const configs = providerConfigManager.getAllConfigs()
        if (configs.length === 0) {
          vscode.window.showInformationMessage("No provider configurations found.")
          return
        }

        const items = configs.map((c) => ({
          label: c.name,
          description: c.enabled ? "Enabled" : "Disabled",
          detail: `Models: ${c.models.length}`,
          config: c,
        }))

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Choose a provider to manage",
        })

        if (selected) {
          const action = await vscode.window.showQuickPick(
            [
              { label: "Edit", description: "Edit provider configuration" },
              { label: "Toggle", description: "Enable or disable provider" },
              { label: "Delete", description: "Delete provider configuration" },
            ],
            { placeHolder: "Choose an action" }
          )

          if (action?.label === "Edit") {
            const apiKey = await vscode.window.showInputBox({
              prompt: "Enter new API key:",
              placeHolder: "Your API key",
              password: true,
            })
            if (apiKey) {
              await providerConfigManager.upsertConfig({
                ...selected.config,
                apiKey,
              })
              vscode.window.showInformationMessage("Provider updated successfully")
            }
          } else if (action?.label === "Toggle") {
            await providerConfigManager.setConfigEnabled(selected.config.id, !selected.config.enabled)
            vscode.window.showInformationMessage(`Provider ${selected.config.enabled ? "disabled" : "enabled"}`)
          } else if (action?.label === "Delete") {
            await providerConfigManager.deleteConfig(selected.config.id)
            vscode.window.showInformationMessage("Provider deleted")
          }
        }
      } catch (err) {
        log.error("List providers failed", err)
        vscode.window.showErrorMessage("Failed to list providers.")
      }
    })
  )
}
