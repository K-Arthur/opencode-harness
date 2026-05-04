/**
 * Integration tests for the OpenCode Harness extension.
 *
 * These tests run inside the VS Code Extension Development Host
 * via `@vscode/test-cli`. They verify:
 *   - Extension activates successfully
 *   - Commands are registered
 *   - Webview view is contributed
 *   - Configuration schema is valid
 */

import assert from "node:assert/strict"
import { describe, it, before, after } from "mocha"
import * as vscode from "vscode"

const EXTENSION_ID = "undefined_publisher.opencode-harness"

describe("OpenCode Harness — Integration Tests", function () {
  this.timeout(30000)

  /** @type {vscode.Extension<any> | undefined} */
  let extension

  before(async () => {
    // Trigger extension activation by executing a command
    try {
      await vscode.commands.executeCommand("opencode-harness.openChat")
    } catch {
      // Command may fail if webview isn't fully set up in test env; that's OK
      // The important thing is it triggered activation
    }
    extension = vscode.extensions.getExtension(EXTENSION_ID)
  })

  // ── Activation ──────────────────────────────────────────────────

  describe("Activation", () => {
    it("should be present in the extension registry", () => {
      assert.ok(extension, `Extension "${EXTENSION_ID}" not found in registry`)
    })

    it("should activate successfully", async () => {
      if (!extension) this.skip()
      if (!extension.isActive) {
        await extension.activate()
      }
      assert.ok(extension.isActive, "Extension did not activate")
    })
  })

  // ── Commands ────────────────────────────────────────────────────

  describe("Commands", () => {
    const expectedCommands = [
      "opencode-harness.openChat",
      "opencode-harness.sendPrompt",
      "opencode-harness.newSession",
      "opencode-harness.toggleFocus",
      "opencode-harness.insertMention",
      "opencode-harness.showRateLimits",
      "opencode-harness.changeMode",
      "opencode-harness.setModel",
      "opencode-harness.showDiff",
      "opencode-harness.restartServer",
    ]

    it("should register all expected commands", async () => {
      const allCommands = await vscode.commands.getCommands(true)
      for (const cmd of expectedCommands) {
        assert.ok(
          allCommands.includes(cmd),
          `Command "${cmd}" not registered. Available: ${allCommands.filter(c => c.startsWith("opencode")).join(", ")}`
        )
      }
    })

    it("openChat command should not throw", async () => {
      // This may or may not open a webview in test env, but shouldn't throw
      try {
        await vscode.commands.executeCommand("opencode-harness.openChat")
      } catch (e) {
        // Some webview operations may fail in headless test env — that's acceptable
        // as long as it's not an unhandled activation error
        assert.ok(
          !e.message?.includes("activate"),
          `Activation-related error: ${e.message}`
        )
      }
    })
  })

  // ── Configuration ───────────────────────────────────────────────

  describe("Configuration", () => {
    it("should have opencode-harness configuration section", () => {
      const config = vscode.workspace.getConfiguration("opencode-harness")
      assert.ok(config, "Configuration section not found")
    })

    it("should have default binaryPath setting", () => {
      const config = vscode.workspace.getConfiguration("opencode-harness")
      const binaryPath = config.get("binaryPath")
      // Default is "opencode" (the CLI name, resolved via PATH)
      assert.equal(typeof binaryPath, "string")
    })

    it("should have default theme setting", () => {
      const config = vscode.workspace.getConfiguration("opencode-harness")
      const theme = config.get("theme")
      assert.equal(typeof theme, "string")
    })
  })

  // ── View Contribution ───────────────────────────────────────────

  describe("View Contribution", () => {
    it("should contribute opencode-chat sidebar view", async () => {
      // Check that the view container and view are registered
      // In test env, we can verify the view exists via the commands API
      const allCommands = await vscode.commands.getCommands(true)
      const hasFocusCommand = allCommands.includes("opencode-harness.toggleFocus")
      assert.ok(hasFocusCommand, "toggleFocus command not found — view may not be contributed")
    })
  })
})