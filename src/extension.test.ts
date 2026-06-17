import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const extensionSource = readFileSync(path.join(__dirname, "extension.ts"), "utf8")
const rollbackSource = readFileSync(path.join(__dirname, "commands", "rollback.ts"), "utf8")
const themeSource = readFileSync(path.join(__dirname, "commands", "theme.ts"), "utf8")
const sessionSource = readFileSync(path.join(__dirname, "commands", "session.ts"), "utf8")
const modelSource = readFileSync(path.join(__dirname, "commands", "model.ts"), "utf8")
const miscSource = readFileSync(path.join(__dirname, "commands", "misc.ts"), "utf8")
const exportSource = readFileSync(path.join(__dirname, "commands", "export.ts"), "utf8")
const packageJson = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
  contributes?: { keybindings?: Array<{ command?: string; key?: string; when?: string }> }
}

describe("extension.ts", () => {
  it("exports activate function", () => {
    assert.ok(extensionSource.includes("export async function activate(") || extensionSource.includes("export function activate("))
  })

  it("exports deactivate function", () => {
    assert.ok(extensionSource.includes("export function deactivate()"))
  })

  it("creates SessionManager", () => {
    assert.ok(extensionSource.includes("new SessionManager"))
  })

  it("creates ContextEngine with VSCodeWorkspaceAdapter", () => {
    assert.ok(extensionSource.includes("new ContextEngine(adapter)") || extensionSource.includes("new ContextEngine("))
  })

  it("creates ThemeManager", () => {
    assert.ok(extensionSource.includes("new ThemeManager()"))
  })

  it("calls registerCoreCommands with all command modules", () => {
    assert.ok(extensionSource.includes("registerCoreCommands("))
  })

  it("registers opencode-harness.rollback command", () => {
    assert.ok(rollbackSource.includes("opencode-harness.rollback"))
  })

  it("registers opencode-harness.previewTheme command", () => {
    assert.ok(themeSource.includes("opencode-harness.previewTheme"))
  })

  it("registers opencode-harness.captureTerminal command", () => {
    assert.ok(themeSource.includes("opencode-harness.captureTerminal"))
  })

  it("registers opencode-harness.openChat command", () => {
    assert.ok(sessionSource.includes("opencode-harness.openChat"))
  })

  it("registers opencode-harness.newSession command", () => {
    assert.ok(sessionSource.includes("opencode-harness.newSession"))
  })

  it("opens new sessions through the chat provider lifecycle", () => {
    assert.ok(
      extensionSource.includes("openSessionInWebview: (sessionId) => chatProvider.openSessionInWebview(sessionId)"),
      "newSession must open the created session in the webview lifecycle",
    )
  })

  it("targets contributed chat keybindings at the real chat view id (not the stale chatView)", () => {
    const chatCommandKeys = [
      "opencode-harness.stop",
      "opencode-harness.openCommandsPalette",
      "opencode-harness.nextTab",
      "opencode-harness.prevTab",
      "opencode-harness.retryLast",
    ]
    const bindings = (packageJson.contributes?.keybindings ?? []).filter((b) => chatCommandKeys.includes(b.command ?? ""))
    assert.ok(bindings.length >= chatCommandKeys.length, "chat command keybindings must be contributed")
    for (const b of bindings) {
      assert.ok(!/chatView/.test(b.when ?? ""), `${b.command} must not reference the stale chatView id`)
      assert.match(
        b.when ?? "",
        /opencode-harness\.chat\b|opencodeHarness\.chatFocused/,
        `${b.command} must target the real chat view / chat-focus context key`,
      )
    }
    // cycleMode is intentionally NOT a contributed keybinding anymore — the webview
    // owns the Ctrl+Shift+M / Alt+Shift+Tab cycle keystroke; a contributed binding
    // double-fired with the webview handler (cycled by two). See keybindings-contract.
    const cycle = (packageJson.contributes?.keybindings ?? []).filter((b) => b.command === "opencode-harness.cycleMode")
    assert.equal(cycle.length, 0, "cycleMode must not be double-bound as a contributed keybinding")
  })

  it("registers opencode-harness.selectModel command", () => {
    assert.ok(modelSource.includes("opencode-harness.selectModel"))
  })

  it("registers opencode-harness.showRateLimits command", () => {
    assert.ok(miscSource.includes("opencode-harness.showRateLimits"))
  })

  it("registers opencode-harness.checkCli command", () => {
    assert.ok(miscSource.includes("opencode-harness.checkCli"))
  })

  it("registers opencode-harness.exportConversation command", () => {
    assert.ok(exportSource.includes("opencode-harness.exportConversation"))
  })

  it("handles server_connected event", () => {
    assert.ok(extensionSource.includes("server_connected"))
  })

  it("handles server_disconnected event", () => {
    assert.ok(extensionSource.includes("server_disconnected"))
  })

  it("wires SDK-backed session title sync", () => {
    assert.ok(extensionSource.includes("setServerTitleUpdater"), "SessionStore must propagate local renames to the server")
    assert.ok(extensionSource.includes("updateSessionTitle"), "title updater must call the SDK-backed SessionManager method")
    assert.ok(extensionSource.includes('case "session_updated"'), "server title updates must flow back into local cache")
    assert.ok(extensionSource.includes("applyServerTitle"), "session.updated events must update local cached title")
  })

  it("installs removable unhandled rejection diagnostics", () => {
    assert.ok(extensionSource.includes("installUnhandledRejectionDiagnostics"), "activation must install diagnostics")
    assert.ok(extensionSource.includes('process.on("unhandledRejection"'), "must listen for unhandled rejections")
    assert.ok(extensionSource.includes('process.off("unhandledRejection"'), "listener must be disposed on deactivate")
    assert.ok(extensionSource.includes("unhandledRejectionCount"), "must count repeated failures")
  })

  it("handles all added workspace folders in one restart prompt", () => {
    assert.ok(extensionSource.includes("e.added.map"), "workspace folder handler must inspect the full added batch")
    assert.ok(!extensionSource.includes("e.added[0]?.uri.fsPath"), "workspace folder handler must not only use the first folder")
  })

  it("registers inline completions only for code document selectors", () => {
    assert.ok(extensionSource.includes("INLINE_CODE_LANGUAGES"), "must centralize inline code languages")
    assert.ok(extensionSource.includes("codeDocumentSelectors"), "must use language-specific selectors")
    assert.ok(!extensionSource.includes('{ pattern: "**" }'), "inline provider must not register for every file")
  })

  it("spawns the opencode server lazily with pre-warm during activation", () => {
    assert.ok(
      extensionSource.includes("createLazyStarter(() => ensureOpencodeAndStart("),
      "server start must be wrapped in a lazy starter",
    )
    assert.ok(
      extensionSource.includes("setServerWarmup("),
      "the lazy starter must be wired to the chat view warm-up hook",
    )
    // B20: Pre-warm fires ensureServerReady() during activation (non-blocking).
    // The lazy starter is idempotent, so this is safe alongside the chat-view hook.
    assert.ok(
      /void ensureServerReady\(\)/.test(extensionSource),
      "B20: activation must fire ensureServerReady() for server pre-warm",
    )
    assert.ok(
      extensionSource.includes("Server pre-warm completed"),
      "B20: must log pre-warm timing",
    )
    assert.ok(
      extensionSource.includes("Server pre-warm failed"),
      "B20: must handle pre-warm errors gracefully",
    )
    // Pre-warm must be skipped for remote-attach mode
    assert.ok(
      extensionSource.includes("remoteUrl.trim().length === 0"),
      "B20: must skip pre-warm when remote server URL is configured",
    )
  })

  // ── ADR-010: Process pool + registry wiring ───────────────────────────
  it("creates LocalSessionProcessManager and SessionManagerRegistry during activation", () => {
    assert.ok(
      extensionSource.includes("new LocalSessionProcessManager()"),
      "must create LocalSessionProcessManager",
    )
    assert.ok(
      extensionSource.includes("new SessionManagerRegistry(processManager)"),
      "must create SessionManagerRegistry with process manager",
    )
    assert.ok(
      extensionSource.includes("sessionManagerRegistry.setDefaultManager(sessionManager)"),
      "must set the default session manager on the registry",
    )
  })

  it("passes sessionManagerRegistry to ChatProvider", () => {
    assert.ok(
      extensionSource.includes("sessionManagerRegistry"),
      "ChatProvider constructor must receive sessionManagerRegistry",
    )
    assert.ok(
      extensionSource.includes("context.subscriptions.push(processManager)") ||
        extensionSource.includes("subscriptions.push(processManager)"),
      "processManager must be registered as a disposable",
    )
    assert.ok(
      extensionSource.includes("context.subscriptions.push(sessionManagerRegistry)") ||
        extensionSource.includes("subscriptions.push(sessionManagerRegistry)"),
      "sessionManagerRegistry must be registered as a disposable",
    )
  })
})
