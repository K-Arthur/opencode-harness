import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Feature Manifest Guardrail — structural contract test.
 *
 * Asserts that package.json and index.html remain in sync with
 * tests/FEATURE_MANIFEST.md. If a future refactor accidentally deletes or
 * renames a command, config key, keybinding, menu entry, view, or webview UI
 * element, this test fails immediately.
 *
 * This test runs in pure Node (no VS Code) and is part of the fast unit suite.
 */

const root = path.join(import.meta.dirname, "..", "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const indexHtml = readFileSync(
  path.join(root, "src", "chat", "webview", "index.html"),
  "utf8",
)

// ── Extract package.json contributions ──────────────────────────────────

const pkgCommands = new Set(pkg.contributes.commands.map((c) => c.command))
const pkgConfigKeys = new Set(Object.keys(pkg.contributes.configuration.properties))
const pkgKeybindings = pkg.contributes.keybindings
const pkgCommandPalette = pkg.contributes.menus.commandPalette
const pkgEditorContext = pkg.contributes.menus["editor/context"] ?? []
const pkgExplorerContext = pkg.contributes.menus["explorer/context"] ?? []
const pkgViews = pkg.contributes.views
const pkgViewContainers = pkg.contributes.viewsContainers
const pkgActivationEvents = pkg.activationEvents

// ── Manifest expectations (single source of truth) ──────────────────────
// These arrays mirror tests/FEATURE_MANIFEST.md. If the manifest and this
// test drift, that is itself a bug — keep them in sync.

const EXPECTED_COMMANDS = [
  "opencode-harness.openChat",
  "opencode-harness.newSession",
  "opencode-harness.toggleFocus",
  "opencode-harness.explainCode",
  "opencode-harness.refactorCode",
  "opencode-harness.generateTests",
  "opencode-harness.insertMention",
  "opencode-harness.captureTerminal",
  "opencode-harness.rollback",
  "opencode-harness.showRateLimits",
  "opencode-harness.selectModel",
  "opencode-harness.setContextWindowOverride",
  "opencode-harness.checkCli",
  "opencode-harness.installCli",
  "opencode-harness.listSessions",
  "opencode-harness.openStoredSession",
  "opencode-harness.deleteSession",
  "opencode-harness.renameSession",
  "opencode-harness.exportConversation",
  "opencode-harness.importConversationJson",
  "opencode-harness.previewTheme",
  "opencode-harness.clearTestSessions",
  "opencode-harness.continueLastSession",
  "opencode-harness.chooseHistorySession",
  "opencode-harness.attachRemote",
  "opencode-harness.addFileToSession",
  "opencode-harness.addSelectionToSession",
  "opencode-harness.stop",
  "opencode-harness.quickChat",
  "opencode-harness.generateAgentsMd",
  "opencode-harness.openCommandsPalette",
  "opencode-harness.clearSession",
  "opencode-harness.showCost",
  "opencode-harness.showHelp",
  "opencode-harness.cycleMode",
  "opencode-harness.setBuildMode",
  "opencode-harness.setPlanMode",
  "opencode-harness.setAutoMode",
  "opencode-harness.setDefaultMode",
  "opencode-harness.setupVoiceInput",
  "opencode-harness.retryLast",
  "opencode-harness.nextTab",
  "opencode-harness.prevTab",
  "opencode-harness.openSettings",
  "opencode-harness.jumpToRunningTask",
  "opencode-harness.suppressKey",
  "opencode-harness.reviewFileChanges",
  "opencode-harness.acceptFileChanges",
  "opencode-harness.rejectFileChanges",
  "opencode-harness.sendProblemToOpencode",
]

const EXPECTED_CONFIG_KEYS = [
  "opencode.binaryPath",
  "opencode.autoInstall",
  "opencode.serverUrl",
  "opencode.serverAuthToken",
  "opencode.mcpServers",
  "opencode.chat.fontSize",
  "opencode.chat.fontFamily",
  "opencode.theme",
  "opencode.theme.switchWorkbenchTheme",
  "opencode.model",
  "opencode.contextWindowOverride",
  "opencode.rateLimits",
  "opencode.rateLimitWarningThreshold",
  "opencode.rateLimitCriticalThreshold",
  "opencode.inlineSuggestions.enabled",
  "opencode.inlineSuggestions.triggerDelay",
  "opencode.autoCompact",
  "opencode.autoCompactThreshold",
  "opencode.autoCompactPerModelThreshold",
  "opencode.sessions.emptySessionTtlMinutes",
  "opencode.sessions.cleanupIntervalMinutes",
  "opencode.sessions.maxSessions",
  "opencode.sessions.persistMaxMessages",
  "opencode.sessions.restoreOpenTabs",
  "opencode.debugLogging",
  "opencode.toolOutput.renderAnsi",
  "opencode.tdd.enabled",
  "opencode.sadd.enabled",
  "opencode.methodology.enabled",
  "opencode.sessions.maxConcurrentStreams",
  "opencode.streaming.ttfbTimeoutMs",
  "opencode.sessions.maxTabs",
  "opencode.sessions.processStrategy",
  "opencode.sessions.processIdleTimeoutMinutes",
  "opencode.defaultMode",
  "opencode.modeModels",
  "opencode.roleModels",
  "opencode.masking.enabled",
  "opencode.masking.maxPromptTokens",
  "opencode.masking.reserveTokens",
  "opencode.masking.exclude",
  "opencode.voice.enabled",
  "opencode.voice.autoSend",
  "opencode.voice.language",
  "opencode.voice.insertMode",
  "opencode.voice.maxRecordingSeconds",
  "opencode.voice.model",
  "opencode.voice.localCommand",
  "opencode.voice.recordCommand",
  "opencode.agentGaze.enabled",
]

const EXPECTED_KEYBINDING_COMMANDS = [
  "opencode-harness.quickChat",
  "opencode-harness.toggleFocus",
  "opencode-harness.newSession",
  "opencode-harness.insertMention",
  "opencode-harness.stop",
  "opencode-harness.openCommandsPalette",
  "opencode-harness.nextTab",
  "opencode-harness.prevTab",
  "opencode-harness.retryLast",
  "opencode-harness.suppressKey",
]

const EXPECTED_PALETTE_COMMANDS = [
  "opencode-harness.showRateLimits",
  "opencode-harness.checkCli",
  "opencode-harness.installCli",
  "opencode-harness.previewTheme",
  "opencode-harness.clearTestSessions",
  "opencode-harness.openStoredSession",
  "opencode-harness.suppressKey",
  "opencode-harness.reviewFileChanges",
  "opencode-harness.acceptFileChanges",
  "opencode-harness.rejectFileChanges",
  "opencode-harness.sendProblemToOpencode",
]

const EXPECTED_EDITOR_CONTEXT_COMMANDS = [
  "opencode-harness.explainCode",
  "opencode-harness.refactorCode",
  "opencode-harness.generateTests",
  "opencode-harness.addSelectionToSession",
]

const EXPECTED_EXPLORER_CONTEXT_COMMANDS = [
  "opencode-harness.addFileToSession",
]

// "problems/context" is NOT a valid VS Code menu contribution point — VS Code
// does not expose a context menu for Problems-panel markers, so any entry there
// is silently dropped (the bug that made "Send to OpenCode" never appear). The
// action is now surfaced via a CodeActionProvider registered in src/extension.ts.

const EXPECTED_ACTIVATION_EVENTS = [
  "onStartupFinished",
  "onView:opencode-harness.chatView",
]

const EXPECTED_VIEW_IDS = ["opencode-harness.chat"]
const EXPECTED_VIEW_CONTAINER_IDS = ["opencode-harness"]

// Webview UI element IDs that must be present in index.html.
const EXPECTED_UI_ELEMENT_IDS = [
  // Header
  "timeline-toggle-header-btn",
  "history-btn",
  "skills-btn",
  "settings-btn",
  // Settings menu
  "todos-toggle-btn",
  "activity-toggle-btn",
  "tasks-toggle-btn",
  "terminal-toggle-btn",
  "subagents-toggle-btn",
  "checkpoint-toggle-btn",
  "timeline-toggle-btn",
  "thinking-toggle-menu-item",
  "mcp-btn",
  "provider-panel-btn",
  "perm-config-btn",
  "theme-customizer-btn",
  "shortcuts-help-btn",
  "prompt-stash-toggle-btn",
  // Modals
  "skills-modal",
  "commands-modal",
  "session-modal",
  // Side panels
  "todos-panel",
  "activity-panel",
  "tasks-panel",
  "terminal-panel",
  "subagent-panel",
  "checkpoint-panel",
  // Status strip
  "status-model",
  "status-cost",
  "status-tokens",
  "context-usage",
  "quota-bar",
  "status-methodology",
  "status-route",
  "status-masking",
  "status-branch",
  // Input area
  "prompt-input",
  "mention-dropdown",
  "slash-autocomplete",
  "voice-input-status",
  // Bottom bar — left
  "mention-btn",
  "commands-palette-btn",
  "attach-btn",
  "voice-input-btn",
  "instructions-gear-btn",
  "dir-toggle-btn",
  // Bottom bar — right
  "mode-dropdown-btn",
  "mode-opt-plan",
  "mode-opt-build",
  "mode-opt-auto",
  "model-selector-btn",
  "variant-selector-btn",
  "steer-mode-queue",
  "steer-mode-interrupt",
  "send-btn",
  "send-queue-count",
  // Welcome
  "welcome-view",
  "welcome-continue-btn",
  "welcome-new-btn",
  "welcome-temp-btn",
  "welcome-search-input",
  "welcome-recent-sessions",
  "welcome-shortcuts-btn",
  // Overlay bars
  "question-bar",
  "question-bar-submit",
  "permission-bar",
  "permission-bar-actions",
  "changed-files-strip",
  "changed-files-panel",
  "instructions-editor",
]

// ── Tests ───────────────────────────────────────────────────────────────

describe("Feature Manifest — commands", () => {
  for (const cmd of EXPECTED_COMMANDS) {
    it(`package.json declares command "${cmd}"`, () => {
      assert.ok(pkgCommands.has(cmd), `Missing command in package.json: ${cmd}`)
    })
  }

  it("no unexpected extra commands in package.json", () => {
    const extras = [...pkgCommands].filter((c) => !EXPECTED_COMMANDS.includes(c))
    assert.deepEqual(extras, [], `package.json has commands not in manifest: ${extras.join(", ")}. Update tests/FEATURE_MANIFEST.md.`)
  })
})

describe("Feature Manifest — configuration keys", () => {
  for (const key of EXPECTED_CONFIG_KEYS) {
    it(`package.json declares config key "${key}"`, () => {
      assert.ok(pkgConfigKeys.has(key), `Missing config key in package.json: ${key}`)
    })
  }

  it("no unexpected extra config keys in package.json", () => {
    const extras = [...pkgConfigKeys].filter((k) => !EXPECTED_CONFIG_KEYS.includes(k))
    assert.deepEqual(extras, [], `package.json has config keys not in manifest: ${extras.join(", ")}. Update tests/FEATURE_MANIFEST.md.`)
  })
})

describe("Feature Manifest — keybindings", () => {
  it("every expected keybinding command has at least one binding", () => {
    for (const cmd of EXPECTED_KEYBINDING_COMMANDS) {
      const bindings = pkgKeybindings.filter((k) => k.command === cmd)
      assert.ok(bindings.length > 0, `Missing keybinding for command: ${cmd}`)
    }
  })

  it("every keybinding maps to a declared command", () => {
    const missing = pkgKeybindings.filter((k) => !pkgCommands.has(k.command))
    assert.deepEqual(missing, [], `Keybindings reference undeclared commands: ${missing.map((m) => m.command).join(", ")}`)
  })
})

describe("Feature Manifest — command palette menus", () => {
  const paletteCommands = new Set(pkgCommandPalette.map((m) => m.command))
  for (const cmd of EXPECTED_PALETTE_COMMANDS) {
    it(`command palette includes "${cmd}"`, () => {
      assert.ok(paletteCommands.has(cmd), `Missing command palette entry: ${cmd}`)
    })
  }
})

describe("Feature Manifest — editor context menu", () => {
  const editorCommands = new Set(pkgEditorContext.map((m) => m.command))
  for (const cmd of EXPECTED_EDITOR_CONTEXT_COMMANDS) {
    it(`editor/context includes "${cmd}"`, () => {
      assert.ok(editorCommands.has(cmd), `Missing editor/context entry: ${cmd}`)
    })
  }
})

describe("Feature Manifest — explorer context menu", () => {
  const explorerCommands = new Set(pkgExplorerContext.map((m) => m.command))
  for (const cmd of EXPECTED_EXPLORER_CONTEXT_COMMANDS) {
    it(`explorer/context includes "${cmd}"`, () => {
      assert.ok(explorerCommands.has(cmd), `Missing explorer/context entry: ${cmd}`)
    })
  }
})

describe("Feature Manifest — problems action surfacing", () => {
  it("does not use the invalid problems/context menu point", () => {
    assert.ok(
      !("problems/context" in pkg.contributes.menus),
      'problems/context is not a real VS Code menu id; "Send to OpenCode" must be surfaced via a CodeActionProvider, not this menu',
    )
  })
  it("still declares the sendProblemToOpencode command for the code action to invoke", () => {
    const commandIds = new Set(pkg.contributes.commands.map((c) => c.command))
    assert.ok(
      commandIds.has("opencode-harness.sendProblemToOpencode"),
      "sendProblemToOpencode command must remain declared so the Quick Fix can invoke it",
    )
  })
})

describe("Feature Manifest — activation events", () => {
  for (const event of EXPECTED_ACTIVATION_EVENTS) {
    it(`package.json declares activation event "${event}"`, () => {
      assert.ok(
        pkgActivationEvents.includes(event),
        `Missing activation event: ${event}`,
      )
    })
  }
})

describe("Feature Manifest — views & view containers", () => {
  it("declares the opencode-harness view container", () => {
    const containerIds = pkgViewContainers.activitybar.map((v) => v.id)
    for (const id of EXPECTED_VIEW_CONTAINER_IDS) {
      assert.ok(containerIds.includes(id), `Missing view container: ${id}`)
    }
  })

  it("declares the opencode-harness.chat webview", () => {
    const viewIds = pkgViews["opencode-harness"].map((v) => v.id)
    for (const id of EXPECTED_VIEW_IDS) {
      assert.ok(viewIds.includes(id), `Missing view: ${id}`)
    }
  })
})

describe("Feature Manifest — webview UI elements", () => {
  for (const elemId of EXPECTED_UI_ELEMENT_IDS) {
    it(`index.html contains element id="${elemId}"`, () => {
      // Match id="..." or id='...' — handles both quote styles.
      const re = new RegExp(`id=["']${elemId}["']`)
      assert.ok(re.test(indexHtml), `Missing UI element in index.html: id="${elemId}"`)
    })
  }
})

// ── Anti-Staleness Contract (FM-ANTISTALE-*) ────────────────────────────
// These tests assert the presence of the live-state re-derivation patterns
// documented in tests/FEATURE_MANIFEST.md §11. They do not execute the
// webview; they guard against future refactors removing the anti-staleness
// plumbing.

const mainTs = readFileSync(path.join(root, "src", "chat", "webview", "main.ts"), "utf8")
const tabSwitcherTs = readFileSync(path.join(root, "src", "chat", "webview", "tabSwitcher.ts"), "utf8")
const modelDropdownTs = readFileSync(path.join(root, "src", "chat", "webview", "model-dropdown.ts"), "utf8")
const chatProviderTs = readFileSync(path.join(root, "src", "chat", "ChatProvider.ts"), "utf8")
const sessionManagerRegistryTs = readFileSync(path.join(root, "src", "session", "SessionManagerRegistry.ts"), "utf8")
const cliDiagnosticsTs = readFileSync(path.join(root, "src", "diagnostics", "CliDiagnostics.ts"), "utf8")
const cssFiles = ["messages.css", "components.css", "layout.css", "context-usage.css", "cards.css"].map((f) =>
  readFileSync(path.join(root, "src", "chat", "webview", "css", f), "utf8"),
)
const cssSource = cssFiles.join("\n")

function getHandlerBlock(source, type) {
  const marker = `["${type}"`
  const idx = source.indexOf(marker)
  assert.ok(idx >= 0, `${marker} handler must exist`)
  const rest = source.slice(idx + marker.length)
  const nextTuple = rest.search(/\],\s*\[/)
  return nextTuple === -1 ? rest : rest.slice(0, nextTuple)
}

describe("Feature Manifest — anti-staleness contract", () => {
  it("FM-ANTISTALE-001: context_usage handler preserves actual readings against empty updates", () => {
    const block = getHandlerBlock(mainTs, "context_usage")
    assert.ok(block.includes("const existingUsage = sess?.contextUsage"), "handler must inspect prior usage")
    assert.ok(block.includes("contextUsageHasFill(existingUsage)"), "handler must detect valid prior fill")
    assert.ok(block.includes("contextUsageHasFill(incomingUsage)"), "handler must detect empty incoming fill")
    assert.ok(
      block.includes("!contextUsageHasFill(incomingUsage) && contextUsageHasFill(existingUsage)"),
      "handler must keep existing when incoming has no fill and existing does",
    )
  })

  it("FM-ANTISTALE-002: switchTab re-derives context usage from the active session", () => {
    assert.ok(tabSwitcherTs.includes("ctxDropdownApi?.updateUsage"), "switchTab must update context dropdown")
    assert.ok(tabSwitcherTs.includes("updateContextUsageBar"), "switchTab must update context usage bar")
  })

  it("FM-ANTISTALE-003: context_window_unknown hides the context bar when the window is unknown", () => {
    const block = getHandlerBlock(mainTs, "context_window_unknown")
    assert.ok(block.includes("contextUsage.classList.add(\"hidden\")"), "handler must hide the context usage bar")
    assert.ok(block.includes("updateContextUsageBar(0, usage.tokens, 0)"), "handler must show indeterminate usage when fill exists")
  })

  it("FM-ANTISTALE-004: ChatProvider re-pushes command list on MCP and prompt changes", () => {
    assert.ok(chatProviderTs.includes("pushCommandListToWebview()"), "ChatProvider must define pushCommandListToWebview")
    assert.ok(
      chatProviderTs.includes("refreshCommandListQuietly()"),
      "ChatProvider must define refreshCommandListQuietly for MCP/tool changes",
    )
    assert.ok(
      chatProviderTs.includes("this.promptManager.onChanged(() => this.pushCommandListToWebview())"),
      "prompt changes must trigger a command list refresh",
    )
  })

  it("FM-ANTISTALE-005: command_list handler updates all consumers from the same payload", () => {
    const block = getHandlerBlock(mainTs, "command_list")
    assert.ok(block.includes("cachedRemoteCommands ="), "command_list must update cached remote commands")
    assert.ok(block.includes("commandsModal.updateServerCommands(remoteCommands)"), "command_list must update commands modal")
    assert.ok(block.includes("mention.updateServerCommands(commandSuggestions)"), "command_list must update mentions")
  })

  it("FM-ANTISTALE-006: model_update handler does not clobber the active session's model", () => {
    const block = getHandlerBlock(mainTs, "model_update")
    assert.ok(block.includes("setGlobalModel"), "model_update must update global model")
    assert.ok(block.includes("setCurrentModel"), "model_update must update dropdown UI")
    assert.ok(!block.includes("setSessionModel"), "model_update must NOT call setSessionModel")
  })

  it("FM-ANTISTALE-007: model dropdown re-syncs selection by data-model-id", () => {
    assert.ok(modelDropdownTs.includes("function setCurrentModel"), "model dropdown must define setCurrentModel")
    assert.ok(modelDropdownTs.includes("dataset.modelId"), "setCurrentModel must read canonical model id from data-model-id")
    assert.ok(modelDropdownTs.includes('classList.toggle("selected"'), "setCurrentModel must toggle selected class")
  })

  it("FM-ANTISTALE-008: CSS applies word/overflow containment to dynamic text containers", () => {
    const rules = ["overflow-wrap: anywhere", "word-break: break-word", "word-break: break-all", "max-width: 100%"]
    const present = rules.filter((r) => cssSource.includes(r))
    assert.ok(present.length >= 3, `CSS must contain at least 3 of ${rules.join(", ")}; found ${present.length}`)
  })

  it("FM-ANTISTALE-009: font and direction config changes are pushed to the webview", () => {
    assert.ok(chatProviderTs.includes("pushChatFontConfigToWebview"), "ChatProvider must push font config")
    assert.ok(chatProviderTs.includes("pushChatDirectionToWebview"), "ChatProvider must push direction config")
    assert.ok(chatProviderTs.includes('type: "chat_font_config"'), "ChatProvider must post chat_font_config")
    assert.ok(chatProviderTs.includes('type: "chat_dir_config"'), "ChatProvider must post chat_dir_config")
  })

  it("FM-ANTISTALE-010: per-tab spawn creates a unique OPENCODE_DATA_DIR", () => {
    assert.ok(sessionManagerRegistryTs.includes("OPENCODE_DATA_DIR"), "spawn must set OPENCODE_DATA_DIR")
    assert.ok(sessionManagerRegistryTs.includes("mkdtempSync"), "spawn must create a unique temp directory")
  })

  it("FM-ANTISTALE-011: Windows .cmd/.ps1 wrappers fall back to opencode in PATH", () => {
    assert.ok(cliDiagnosticsTs.includes(".cmd"), "CliDiagnostics must mention .cmd wrappers")
    assert.ok(cliDiagnosticsTs.includes(".ps1"), "CliDiagnostics must mention .ps1 wrappers")
    assert.ok(cliDiagnosticsTs.includes('return "opencode"'), "CliDiagnostics must fall back to opencode in PATH")
  })
})
