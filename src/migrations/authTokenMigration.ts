import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

const SECRET_KEY = "opencode-harness.serverAuthToken"

/**
 * Resolve the remote server auth token from SecretStorage. Legacy settings
 * values are migrated once, cleared from settings, and logged so plaintext
 * tokens do not remain an invisible fallback.
 */
export async function resolveAuthToken(context: vscode.ExtensionContext): Promise<string> {
  const secretsToken = await context.secrets.get(SECRET_KEY)
  if (secretsToken) return secretsToken

  const config = vscode.workspace.getConfiguration("opencode")
  const inspected = config.inspect<string>("serverAuthToken")
  const legacyToken = inspected?.globalValue || inspected?.workspaceValue || inspected?.workspaceFolderValue || ""
  if (legacyToken) {
    await context.secrets.store(SECRET_KEY, legacyToken)
    await Promise.all([
      inspected?.globalValue ? config.update("serverAuthToken", undefined, vscode.ConfigurationTarget.Global) : Promise.resolve(),
      inspected?.workspaceValue ? config.update("serverAuthToken", undefined, vscode.ConfigurationTarget.Workspace) : Promise.resolve(),
    ])
    if (inspected?.workspaceFolderValue) {
      log.warn("Found a workspace-folder opencode.serverAuthToken setting. It was migrated to SecretStorage, but you should remove it from folder settings manually.")
    }
    log.warn("Migrated legacy opencode.serverAuthToken setting to SecretStorage and cleared plaintext settings fallback.")
  }
  return legacyToken
}
