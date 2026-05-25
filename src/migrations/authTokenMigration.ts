import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

/**
 * Resolve the remote server auth token from SecretStorage (preferred) with
 * fallback to the legacy settings.json entry. Migrates found settings values
 * to secrets for future use.
 */
export async function resolveAuthToken(context: vscode.ExtensionContext): Promise<string> {
  // Try SecretStorage first (post-migration)
  const secretsToken = await context.secrets.get("opencode-harness.serverAuthToken")
  if (secretsToken) return secretsToken

  // Fallback: read from legacy settings.json
  const legacyToken = vscode.workspace.getConfiguration("opencode").get<string>("serverAuthToken") || ""
  if (legacyToken) {
    // Migrate to SecretStorage and clear legacy setting
    await context.secrets.store("opencode-harness.serverAuthToken", legacyToken)
    await vscode.workspace.getConfiguration("opencode").update("serverAuthToken", undefined, vscode.ConfigurationTarget.Global)
    log.info("Migrated serverAuthToken from settings.json to SecretStorage")
  }
  return legacyToken
}
