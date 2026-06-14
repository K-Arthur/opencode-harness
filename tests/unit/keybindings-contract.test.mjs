import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "package.json"), "utf8"))
const keybindings = pkg.contributes.keybindings
const commands = new Set(pkg.contributes.commands.map((c) => c.command))
const palette = pkg.contributes.menus.commandPalette

function bindingsFor(key) {
  return keybindings.filter((k) => k.key === key)
}

describe("keybinding contributions", () => {
  it("every keybinding maps to a declared command", () => {
    const missing = keybindings.filter((k) => !commands.has(k.command))
    assert.deepEqual(missing, [], `keybindings reference undeclared commands: ${missing.map((m) => m.command)}`)
  })

  it("declares the suppressKey command and hides it from the command palette", () => {
    assert.ok(commands.has("opencode-harness.suppressKey"), "suppressKey must be a declared command")
    const hidden = palette.find((m) => m.command === "opencode-harness.suppressKey")
    assert.ok(hidden && hidden.when === "false", "suppressKey must be hidden from the command palette")
  })

  // These chords are VS Code / OS defaults (Alt+1/2/3 = openEditorAtIndex,
  // Ctrl+W = close editor, Ctrl+T = show all symbols, Ctrl+Tab = editor nav,
  // Ctrl+K = chord, Ctrl+Shift+T = reopen closed editor, Ctrl+Shift+M = problems).
  // The chat webview handles them itself, so each must be suppressed while the
  // chat is focused or the workbench will ALSO act on the forwarded key.
  const CONFLICTING_KEYS = [
    "alt+1", "alt+2", "alt+3",
    "alt+shift+tab",
    "ctrl+shift+m", "ctrl+shift+t",
    "ctrl+t", "ctrl+w",
    "ctrl+tab", "ctrl+shift+tab",
    "ctrl+k",
  ]

  for (const key of CONFLICTING_KEYS) {
    it(`suppresses the VS Code default for "${key}" while the chat is focused`, () => {
      const suppressor = bindingsFor(key).find((k) => k.command === "opencode-harness.suppressKey")
      assert.ok(suppressor, `"${key}" must have a suppressKey binding`)
      assert.equal(
        suppressor.when,
        "opencodeHarness.chatFocused",
        `"${key}" suppressor must be gated on the reliable chat-focus context key`,
      )
    })
  }

  it("does not double-bind cycleMode (the webview owns the cycle keystroke)", () => {
    const cycle = keybindings.filter((k) => k.command === "opencode-harness.cycleMode")
    assert.equal(cycle.length, 0, "cycleMode must not have a contributed keybinding that double-fires with the webview handler")
  })

  it("chat-focused command keybindings accept the reliable context key (focusedView is unreliable for webviews)", () => {
    const chatCommands = ["opencode-harness.stop", "opencode-harness.openCommandsPalette", "opencode-harness.nextTab", "opencode-harness.prevTab", "opencode-harness.retryLast"]
    for (const cmd of chatCommands) {
      const kb = keybindings.find((k) => k.command === cmd)
      assert.ok(kb, `${cmd} must keep a keybinding`)
      assert.match(kb.when, /opencodeHarness\.chatFocused/, `${cmd} must gate on the reliable chat-focus context key`)
    }
  })
})
