/**
 * Theme engine integration tests (TDD).
 *
 * These tests run inside the VS Code Extension Development Host via
 * @vscode/test-cli and exercise the real vscode workspace APIs.
 */

import assert from "node:assert/strict"
import { describe, it, before } from "mocha"
import * as vscode from "vscode"

const EXTENSION_ID = "koarthur.opencode-harness"
const OPENCODE_NAMESPACE = "opencodeHarness"

describe("OpenCode Harness — Theme Engine", function () {
  this.timeout(30000)

  let extension: vscode.Extension<unknown> | undefined
  let themeManager: {
    applyOverrides: (overrides: Record<string, string>, target: vscode.ConfigurationTarget) => Promise<void>
    activateTheme: (theme: { preset?: string; marketTheme?: string }) => Promise<void>
  } | undefined

  before(async () => {
    extension = vscode.extensions.getExtension(EXTENSION_ID)
    if (extension && !extension.isActive) {
      await extension.activate()
    }
    const api = (extension?.exports as { themeManager?: typeof themeManager }) ?? {}
    themeManager = api.themeManager
  })

  // ── Helpers ─────────────────────────────────────────────────────

  async function resetWorkbenchCustomizations(target: vscode.ConfigurationTarget): Promise<void> {
    const workbench = vscode.workspace.getConfiguration("workbench")
    await workbench.update("colorCustomizations", undefined, target)
    await workbench.update("tokenColorCustomizations", undefined, target)
  }

  // ── Test Case 1: Merge preservation ───────────────────────────

  describe("applyOverrides merge preservation", () => {
    it("retains unrelated pre-existing keys inside workbench.colorCustomizations", async function () {
      if (!themeManager) {
        this.skip()
        return
      }

      const target = vscode.ConfigurationTarget.Global
      const workbench = vscode.workspace.getConfiguration("workbench")
      const unrelated = {
        "statusBar.background": "#123456",
        "terminal.background": "#abcdef",
      }

      await resetWorkbenchCustomizations(target)
      await workbench.update("colorCustomizations", unrelated, target)

      await themeManager.applyOverrides(
        { accentColor: "#ff00ff", panelBg: "#000000" },
        target
      )

      const after = workbench.inspect("colorCustomizations") ?? { globalValue: {} }
      const merged = (after.globalValue ?? {}) as Record<string, unknown>
      assert.equal(merged["statusBar.background"], "#123456")
      assert.equal(merged["terminal.background"], "#abcdef")
      const namespace = (merged[OPENCODE_NAMESPACE] ?? {}) as Record<string, string>
      assert.equal(namespace.accentColor, "#ff00ff")
      assert.equal(namespace.panelBg, "#000000")
    })
  })

  // ── Test Case 2: Invalid theme fallback ───────────────────────────

  describe("invalid theme fallback", () => {
    it("warns and falls back to the active color theme kind when a market theme is not installed", async function () {
      if (!themeManager) {
        this.skip()
        return
      }

      const beforeKind = vscode.window.activeColorTheme.kind
      const warnings: (string | vscode.MessageItem)[] = []
      const originalShowWarning = vscode.window.showWarningMessage
      vscode.window.showWarningMessage = async (message: string) => {
        warnings.push(message)
        return undefined
      }

      try {
        await themeManager.activateTheme({
          marketTheme: "this-theme-does-not-exist-12345",
        })

        assert.ok(warnings.length > 0, "Expected a warning message for missing theme")
        assert.ok(
          typeof warnings[0] === "string" && warnings[0].includes("this-theme-does-not-exist-12345"),
          "Warning should name the missing theme"
        )
        assert.equal(vscode.window.activeColorTheme.kind, beforeKind)
      } finally {
        vscode.window.showWarningMessage = originalShowWarning
      }
    })
  })

  // ── Test Case 3: Workspace isolation boundaries ───────────────────

  describe("workspace isolation", () => {
    it("applies workspace-scoped overrides without touching global settings", async function () {
      if (!themeManager) {
        this.skip()
        return
      }

      const globalTarget = vscode.ConfigurationTarget.Global
      const workspaceTarget = vscode.ConfigurationTarget.Workspace
      const workbench = vscode.workspace.getConfiguration("workbench")

      await resetWorkbenchCustomizations(globalTarget)
      await resetWorkbenchCustomizations(workspaceTarget)
      await workbench.update(
        "colorCustomizations",
        { "editor.background": "#111111" },
        globalTarget
      )

      await themeManager.applyOverrides(
        { accentColor: "#00ff00" },
        workspaceTarget
      )

      const inspected = workbench.inspect("colorCustomizations") ?? { globalValue: {}, workspaceValue: {} }
      const afterGlobal = (inspected.globalValue ?? {}) as Record<string, unknown>
      const afterWorkspace = (inspected.workspaceValue ?? {}) as Record<string, unknown>

      assert.equal(afterGlobal["editor.background"], "#111111")
      assert.equal((afterGlobal[OPENCODE_NAMESPACE] as Record<string, string> | undefined)?.accentColor, undefined)
      assert.equal((afterWorkspace[OPENCODE_NAMESPACE] as Record<string, string> | undefined)?.accentColor, "#00ff00")
    })
  })
})
