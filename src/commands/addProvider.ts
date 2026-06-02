import * as path from "path"
import * as vscode from "vscode"
import { ModelManager } from "../model/ModelManager"
import {
  type CustomProviderInput,
  expandHomePath,
  getWritableOpenCodeConfigPath,
  mergeCustomProviderConfig,
  normalizeProviderId,
  readOpenCodeConfigFile,
  redactConfigSecrets,
  serializeOpenCodeConfig,
  writeOpenCodeConfigWithBackup,
} from "../model/OllamaConfigService"
import { SessionManager } from "../session/SessionManager"
import { log } from "../utils/outputChannel"

const TITLE = "Add OpenAI-compatible Provider"
const APPLY_ACTION = "Apply"
const OPEN_CONFIG_ACTION = "Open Config"
const CONFIGURE_LOCAL_ACTION = "Configure Local Anyway"
const PROVIDER_DOCS_ACTION = "Provider Docs"

export function registerAddProviderCommand(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  modelManager: ModelManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.addProvider", async () => {
      try {
        await addProvider(sessionManager, modelManager)
      } catch (err) {
        log.error("Add provider command failed", err)
        vscode.window.showErrorMessage("Failed to add provider. Check the OpenCode Harness output channel for details.")
      }
    })
  )
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

async function addProvider(sessionManager: SessionManager, modelManager: ModelManager): Promise<void> {
  if (sessionManager.isRemote) {
    const remoteChoice = await vscode.window.showWarningMessage(
      "This OpenCode session is attached to a remote server. Local OpenCode config changes will not affect that server.",
      CONFIGURE_LOCAL_ACTION,
      PROVIDER_DOCS_ACTION,
    )
    if (remoteChoice === PROVIDER_DOCS_ACTION) {
      await vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai/docs/providers/"))
      return
    }
    if (remoteChoice !== CONFIGURE_LOCAL_ACTION) return
  }

  const name = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "Provider display name",
    placeHolder: "e.g. Together AI",
  })
  if (name === undefined) return
  const trimmedName = name.trim()
  if (!trimmedName) {
    vscode.window.showWarningMessage("Provider name cannot be empty.")
    return
  }
  const id = normalizeProviderId(trimmedName)
  if (!id) {
    vscode.window.showWarningMessage("Could not derive a valid provider id from that name. Use letters, numbers, '.', '-' or '_'.")
    return
  }

  const baseURL = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "OpenAI-compatible base URL (usually ends in /v1)",
    placeHolder: "https://api.together.xyz/v1",
    validateInput: (value) => (isValidHttpUrl(value.trim()) ? undefined : "Enter a valid http(s) URL"),
  })
  if (baseURL === undefined) return
  const trimmedBaseURL = baseURL.trim()
  if (!trimmedBaseURL) return

  const apiKey = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "API key — stored in your OpenCode config. Leave blank for keyless/local endpoints.",
    password: true,
    placeHolder: "sk-…",
  })
  if (apiKey === undefined) return

  const modelsRaw = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "Model IDs (comma-separated)",
    placeHolder: "meta-llama/Llama-3.3-70B-Instruct-Turbo, mixtral-8x7b",
  })
  if (modelsRaw === undefined) return
  const modelIds = modelsRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (modelIds.length === 0) {
    vscode.window.showWarningMessage("Enter at least one model id for the provider.")
    return
  }

  const input: CustomProviderInput = {
    id,
    name: trimmedName,
    baseURL: trimmedBaseURL,
    apiKey: apiKey.trim() || undefined,
    modelIds,
  }

  const defaultConfigPath = getWritableOpenCodeConfigPath()
  const selectedPath = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "OpenCode config file to update",
    value: defaultConfigPath,
    placeHolder: defaultConfigPath,
  })
  if (selectedPath === undefined) return
  const trimmedPath = selectedPath.trim()
  if (!trimmedPath) return

  const configPath = path.resolve(expandHomePath(trimmedPath))
  const existingConfig = await readOpenCodeConfigFile(configPath)
  const mergedConfig = mergeCustomProviderConfig(existingConfig, input)
  // Preview hides every API key (this provider's and any other provider's).
  const preview = serializeOpenCodeConfig(redactConfigSecrets(mergedConfig))

  const previewDoc = await vscode.workspace.openTextDocument({
    content: preview,
    language: "json",
  })
  await vscode.window.showTextDocument(previewDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside })

  const applyChoice = await vscode.window.showInformationMessage(
    `Preview opened for ${configPath} (API keys hidden). Add provider "${input.name}" with ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}?`,
    { modal: true },
    APPLY_ACTION,
    OPEN_CONFIG_ACTION,
    "Cancel",
  )

  if (applyChoice === OPEN_CONFIG_ACTION) {
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(configPath))
    return
  }
  if (applyChoice !== APPLY_ACTION) return

  const hadModelSelected = Boolean(modelManager.model)
  const { backupPath } = await writeOpenCodeConfigWithBackup(configPath, mergedConfig)

  const restartRecommended = sessionManager.isRunning && !sessionManager.isRemote

  await modelManager.refreshModels(
    sessionManager.isRunning ? sessionManager.currentPort : undefined,
    sessionManager.isRunning ? sessionManager.authHeader : undefined,
  )

  if (!hadModelSelected) {
    const firstModel = modelIds[0]
    if (firstModel) {
      modelManager.setModel(`${id}/${firstModel}`)
      if (sessionManager.isRunning) sessionManager.setModel(id, firstModel)
    }
  }

  const backupSuffix = backupPath ? ` Backup: ${path.basename(backupPath)}.` : ""
  if (restartRecommended) {
    vscode.window.showWarningMessage(
      `Provider "${input.name}" was written to ${configPath}.${backupSuffix} Restart or reconnect OpenCode if its models do not appear.`,
      "Refresh Models",
    ).then((choice) => {
      if (choice === "Refresh Models") {
        void modelManager.refreshModels(
          sessionManager.isRunning ? sessionManager.currentPort : undefined,
          sessionManager.isRunning ? sessionManager.authHeader : undefined,
        )
      }
    })
    return
  }

  vscode.window.showInformationMessage(
    `Provider "${input.name}" configured for OpenCode with ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}.${backupSuffix}`,
  )
}
