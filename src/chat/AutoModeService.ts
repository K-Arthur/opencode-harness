import * as vscode from "vscode"

export interface AutoModeDeps {
  context: vscode.ExtensionContext
}

export class AutoModeService {
  private readonly AUTO_MODE_CONFIRMED_KEY = "opencode.autoModeConfirmed"

  constructor(private deps: AutoModeDeps) {}

  hasAutoModeConfirmed(): boolean {
    return this.deps.context.globalState.get<boolean>(this.AUTO_MODE_CONFIRMED_KEY, false)
  }

  async setAutoModeConfirmed(value: boolean): Promise<void> {
    await this.deps.context.globalState.update(this.AUTO_MODE_CONFIRMED_KEY, value)
  }

  async showAutoModeConfirmation(_sessionId: string): Promise<boolean> {
    const DONT_SHOW = "Don't show again"
    const PROCEED = "Proceed"
    const CANCEL = "Cancel"

    const result = await vscode.window.showWarningMessage(
      "Auto mode will apply all changes without asking.",
      { modal: true },
      PROCEED,
      DONT_SHOW,
      CANCEL,
    )

    if (result === DONT_SHOW) {
      await this.deps.context.globalState.update(this.AUTO_MODE_CONFIRMED_KEY, true)
      return true
    }
    return result === PROCEED
  }
}
