import * as vscode from "vscode"
import { ModelManager } from "../model/ModelManager"
import { SessionStore } from "../session/SessionStore"
import { SessionManager } from "../session/SessionManager"
import { log } from "../utils/outputChannel"

export function registerSelectModelCommand(
  context: vscode.ExtensionContext,
  modelManager: ModelManager,
  sessionManager: SessionManager,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.selectModel", async () => {
      try {
        // Always try to refresh models — use server if running (with auth), otherwise CLI
        const port = sessionManager.isRunning ? sessionManager.currentPort : undefined
        await modelManager.refreshModels(port, sessionManager.isRunning ? sessionManager.authHeader : undefined)
        const currentModel = modelManager.model
        const model = await modelManager.pickModel()
        if (model && model !== currentModel) {
          // model is in "provider/modelId" format from pickModel()
          const slashIdx = model.indexOf("/")
          const providerID = slashIdx >= 0 ? model.substring(0, slashIdx) : "unknown"
          const modelID = slashIdx >= 0 ? model.substring(slashIdx + 1) : model

          // Update global default (used for new sessions/prompts)
          modelManager.setModel(model)
          sessionManager.setModel(providerID, modelID)
          log.info(`Model switched to ${providerID}/${modelID} (no server restart)`)

          // Ask if user wants to apply to current session too
          const activeSession = sessionStore.getActive()
          if (activeSession && activeSession.model !== model) {
            const choice = await vscode.window.showInformationMessage(
              `Apply ${modelID} to current session "${activeSession.name}"?`,
              "Apply to Current Session",
              "Just Set Default",
            )
            if (choice === "Apply to Current Session") {
              sessionStore.updateModel(activeSession.id, model)
              log.info(`Model for session ${activeSession.id} updated to ${model}`)
            }
          }
        }
      } catch (err) {
        log.error("Select model command failed", err)
        vscode.window.showErrorMessage("Failed to select model. Check the OpenCode output channel for details.")
      }
    })
  )
}

export function registerSetContextWindowOverrideCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.setContextWindowOverride", async () => {
      try {
        const config = vscode.workspace.getConfiguration("opencode")
        const currentOverride = config.get<number>("contextWindowOverride", 0)
        const input = await vscode.window.showInputBox({
          prompt: "Enter context window override (tokens)",
          placeHolder: currentOverride > 0 ? currentOverride.toString() : "0 (use server value)",
          validateInput: (value) => {
            const num = Number(value)
            if (isNaN(num) || num < 0) {
              return "Must be a non-negative number"
            }
            return null
          },
        })
        if (input !== undefined) {
          const value = Number(input)
          await config.update("contextWindowOverride", value, vscode.ConfigurationTarget.Global)
          log.info(`Context window override set to ${value}`)
          vscode.window.showInformationMessage(
            value > 0
              ? `Context window override set to ${value} tokens`
              : "Context window override cleared (using server value)",
          )
        }
      } catch (err) {
        log.error("Set context window override command failed", err)
        vscode.window.showErrorMessage("Failed to set context window override. Check the OpenCode output channel for details.")
      }
    })
  )
}
