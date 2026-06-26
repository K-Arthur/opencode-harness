import * as vscode from "vscode"

export const OPENCODE_NAMESPACE = "opencodeHarness"

export type ColorCustomizations = Record<string, unknown>

export class ThemeStateMutator {
  /**
   * Safely merges the provided OpenCode overrides into the existing
   * workbench.colorCustomizations under the opencodeHarness namespace without
   * erasing unrelated user settings.
   */
  async applyColorCustomizations(
    overrides: Record<string, string>,
    target: vscode.ConfigurationTarget
  ): Promise<void> {
    const workbench = vscode.workspace.getConfiguration("workbench")
    const current = this.readExistingValue(workbench, "colorCustomizations", target)
    const merged = this.mergeNamespace(current, overrides)
    await workbench.update("colorCustomizations", merged, target)
  }

  /**
   * Safely merges the provided OpenCode token overrides into the existing
   * editor.tokenColorCustomizations under the opencodeHarness namespace.
   */
  async applyTokenColorCustomizations(
    overrides: Record<string, string | Record<string, string>>,
    target: vscode.ConfigurationTarget
  ): Promise<void> {
    const editor = vscode.workspace.getConfiguration("editor")
    const current = this.readExistingValue(editor, "tokenColorCustomizations", target)
    const merged = this.mergeNamespace(current, overrides)
    await editor.update("tokenColorCustomizations", merged, target)
  }

  /**
   * Removes the opencodeHarness namespace from both color customization
   * objects and resets the opencode.theme setting to its default.
   */
  async reset(target: vscode.ConfigurationTarget): Promise<void> {
    const workbench = vscode.workspace.getConfiguration("workbench")
    const editor = vscode.workspace.getConfiguration("editor")
    const opencode = vscode.workspace.getConfiguration("opencode")

    const colorCurrent = this.readExistingValue(workbench, "colorCustomizations", target)
    const tokenCurrent = this.readExistingValue(editor, "tokenColorCustomizations", target)

    const colorNext = this.removeNamespace(colorCurrent)
    const tokenNext = this.removeNamespace(tokenCurrent)

    await workbench.update("colorCustomizations", colorNext, target)
    await editor.update("tokenColorCustomizations", tokenNext, target)
    await opencode.update("theme", { preset: "cli-default", overrides: {} }, target)
  }

  /**
   * Reads the existing value for a configuration key from a specific target
   * using config.inspect(). Falls back to the globalValue for WorkspaceFolder
   * targets if the target-specific value is missing.
   */
  private readExistingValue(
    config: vscode.WorkspaceConfiguration,
    key: string,
    target: vscode.ConfigurationTarget
  ): Record<string, unknown> {
    const inspected = config.inspect<Record<string, unknown>>(key)
    if (!inspected) return {}

    switch (target) {
      case vscode.ConfigurationTarget.Global:
        return inspected.globalValue ?? {}
      case vscode.ConfigurationTarget.Workspace:
        return inspected.workspaceValue ?? {}
      case vscode.ConfigurationTarget.WorkspaceFolder:
        return inspected.workspaceFolderValue ?? inspected.workspaceValue ?? {}
      default:
        return {}
    }
  }

  /**
   * Deep-merges the provided overrides into the opencodeHarness namespace
   * of the existing customization object. A shallow copy of the existing
   * object is used so the mutation is explicit and safe.
   */
  private mergeNamespace(
    existing: Record<string, unknown>,
    overrides: Record<string, unknown>
  ): Record<string, unknown> {
    const next = { ...existing }
    const namespace = { ...(next[OPENCODE_NAMESPACE] as Record<string, unknown> ?? {}) }

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === null) {
        delete namespace[key]
      } else {
        namespace[key] = value
      }
    }

    if (Object.keys(namespace).length === 0) {
      delete next[OPENCODE_NAMESPACE]
    } else {
      next[OPENCODE_NAMESPACE] = namespace
    }

    return next
  }

  /**
   * Removes the opencodeHarness namespace from a customization object. If the
   * resulting object is empty, returns undefined so VS Code removes the key
   * from the target settings file.
   */
  private removeNamespace(
    existing: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const next = { ...existing }
    delete next[OPENCODE_NAMESPACE]
    return Object.keys(next).length > 0 ? next : undefined
  }
}
