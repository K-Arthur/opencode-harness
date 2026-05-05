import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "main.ts"), "utf8")

describe("main.ts", () => {
  it("declares acquireVsCodeApi", () => {
    assert.ok(source.includes("declare const acquireVsCodeApi"))
  })

  it("defines getVsCodeApi function", () => {
    assert.ok(source.includes("function getVsCodeApi()"))
  })

  it("uses IIFE pattern", () => {
    assert.ok(source.includes("(function ()"))
  })

  it("has init function", () => {
    assert.ok(source.includes("function init()"))
  })

  it("handles error boundary", () => {
    assert.ok(source.includes('"error-boundary"'))
  })

  it("has slash command handlers", () => {
    assert.ok(source.includes('"/clear"'))
    assert.ok(source.includes('"/model"'))
    assert.ok(source.includes('"/help"'))
  })

  it("sends webview_ready message", () => {
    assert.ok(source.includes('"webview_ready"'))
  })

  it("manages scroll anchors per tab", () => {
    assert.ok(source.includes("scrollAnchors"))
  })

  it("has concurrent streaming limit of 3", () => {
    assert.ok(source.includes(">= 3"))
  })

  it("init_state checks for .tab-panel not vscode-tab-panel", () => {
    assert.ok(source.includes("tab-panel"), "must use .tab-panel class")
    assert.ok(!source.includes("vscode-tab-panel"), "must not use vscode-tab-panel")
  })

  it("closeTab shows welcome view when no sessions remain", () => {
    assert.ok(source.includes("showWelcomeView"), "must show welcome view when no sessions remain")
    assert.ok(!source.includes('createInitialTab("Default")'), "must not create default tab")
  })

  it("renderRecentSessionsList excludes active session", () => {
    assert.ok(source.includes("s.id !== activeId"))
  })

  it("setupButtons does not add duplicate newTabBtn listener", () => {
    // The listener is added in tabs.ts createTabBar, not in setupButtons
    const setupButtonsMatch = source.match(/els\.newTabBtn\.addEventListener/g)
    assert.ok(setupButtonsMatch === null || setupButtonsMatch.length <= 1,
      "newTabBtn should have at most one click listener")
  })

  it("drag_drop_handler_prevents_default_on_dragover", () => {
    assert.ok(source.includes('inputArea.addEventListener("dragover"'))
    assert.ok(source.includes("e.preventDefault()"))
  })

  it("drag_drop_handler_inserts_at_file_mentions", () => {
    assert.ok(source.includes("@file:"))
    assert.ok(source.includes("dataTransfer?.files"))
  })

  it("slash_command_autocomplete_triggers_on_leading_slash", () => {
    // Leading slash detection triggers autocomplete popover
    assert.ok(source.includes("updateSlashAutocomplete"))
    assert.ok(source.includes('startsWith("/")'))
    assert.ok(source.includes("slashAutocomplete"))
  })

  it("slash_command_mid_message_does_not_trigger", () => {
    // Multi-line safety: only trigger if / is first character of entire input
    assert.ok(source.includes('startsWith("/")'))
    assert.ok(source.includes('includes("\\n")'))
  })

  it("slash_unknown_shows_error_not_crash", () => {
    // Unknown command shows inline error rather than crash
    assert.ok(source.includes("Unknown command"))
  })

  it("mode_selector_disabled_during_stream", () => {
    assert.ok(source.includes("isStreaming"))
    assert.ok(source.includes(".disabled = isStreaming"))
    assert.ok(source.match(/if \(active\?\.isStreaming\) return/))
  })

  it("plan_mode_replaces_accept_with_approve_and_apply", () => {
    assert.ok(source.includes("mode: session.mode"))
    assert.ok(source.includes("renderMessage(msg, { mode"))
  })

  it("mode_persisted_per_tab_in_session_store", () => {
    assert.ok(source.includes("setSessionMode"))
    assert.ok(source.includes("active.mode"))
  })
})
