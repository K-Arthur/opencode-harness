import * as path from "path"
import * as vscode from "vscode"
import { ModelManager } from "../model/ModelManager"
import {
  DEFAULT_OLLAMA_HOST,
  expandHomePath,
  fetchOllamaModelDetails,
  fetchOllamaModelIds,
  getWritableOpenCodeConfigPath,
  mergeOllamaConfig,
  normalizeOllamaHost,
  readOpenCodeConfigFile,
  redactConfigSecrets,
  resolveOllamaEndpoints,
  serializeOpenCodeConfig,
  writeOpenCodeConfigWithBackup,
} from "../model/OllamaConfigService"
import { SessionManager } from "../session/SessionManager"
import { log } from "../utils/outputChannel"

const APPLY_ACTION = "Apply"
const OPEN_CONFIG_ACTION = "Open Config"
const CONFIGURE_LOCAL_ACTION = "Configure Local Anyway"
const PROVIDER_DOCS_ACTION = "Provider Docs"

export function registerConfigureOllamaCommand(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  modelManager: ModelManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.configureOllama", async () => {
      try {
        await configureOllama(sessionManager, modelManager)
      } catch (err) {
        log.error("Configure Ollama command failed", err)
        vscode.window.showErrorMessage("Failed to configure Ollama. Check the OpenCode Harness output channel for details.")
      }
    })
  )
}

async function configureOllama(sessionManager: SessionManager, modelManager: ModelManager): Promise<void> {
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

  const defaultHost = normalizeOllamaHost(process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST)
  const hostInput = await vscode.window.showInputBox({
    title: "Configure Ollama for OpenCode",
    prompt: "Ollama server URL (host:port)",
    value: defaultHost,
    placeHolder: DEFAULT_OLLAMA_HOST,
  })
  if (hostInput === undefined) return
  const endpoints = resolveOllamaEndpoints(hostInput)

  let modelIds: string[]
  try {
    modelIds = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Detecting Ollama models",
        cancellable: false,
      },
      () => fetchOllamaModelIds(fetch, endpoints.tagsUrl),
    )
  } catch (err) {
    vscode.window.showErrorMessage(
      err instanceof Error ? err.message : `Could not reach Ollama at ${endpoints.tagsUrl}.`,
    )
    return
  }

  if (modelIds.length === 0) {
    vscode.window.showWarningMessage("Ollama is reachable, but it did not report any installed models.")
    return
  }

  // Probe /api/show per model so each provider entry carries a real
  // context window and an honest tool_call flag (best-effort; failures
  // fall back to sane defaults).
  const modelDetails = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Inspecting Ollama models",
      cancellable: false,
    },
    () => fetchOllamaModelDetails(modelIds, fetch, endpoints.showUrl),
  )

  const defaultConfigPath = getWritableOpenCodeConfigPath()
  const selectedPath = await vscode.window.showInputBox({
    title: "Configure Ollama for OpenCode",
    prompt: "OpenCode config file to update",
    value: defaultConfigPath,
    placeHolder: defaultConfigPath,
  })
  if (!selectedPath) return

  const trimmedPath = selectedPath.trim()
  if (!trimmedPath) return

  const configPath = path.resolve(expandHomePath(trimmedPath))
  const existingConfig = await readOpenCodeConfigFile(configPath)
  const mergedConfig = mergeOllamaConfig(existingConfig, modelDetails, endpoints.baseURL)
  // Hide any API keys (other providers') so the preview tab never leaks secrets.
  const preview = serializeOpenCodeConfig(redactConfigSecrets(mergedConfig))

  const previewDoc = await vscode.workspace.openTextDocument({
    content: preview,
    language: "json",
  })
  await vscode.window.showTextDocument(previewDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside })

  const applyChoice = await vscode.window.showInformationMessage(
    `Preview opened for ${configPath}. Apply Ollama provider with ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}?`,
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

  if (!hadModelSelected && modelIds.length === 1) {
    const modelId = modelIds[0]
    if (modelId) {
      modelManager.setModel(`ollama/${modelId}`)
      if (sessionManager.isRunning) sessionManager.setModel("ollama", modelId)
    }
  }

  const backupSuffix = backupPath ? ` Backup: ${path.basename(backupPath)}.` : ""
  if (restartRecommended) {
    vscode.window.showWarningMessage(
      `Ollama config was written to ${configPath}.${backupSuffix} Restart or reconnect OpenCode if the Ollama models do not appear.`,
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
    `Ollama configured for OpenCode with ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}.${backupSuffix}`,
  )
}
