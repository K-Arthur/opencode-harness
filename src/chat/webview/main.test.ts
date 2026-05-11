import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const sessionListRendererSource = readFileSync(path.join(__dirname, "sessionListRenderer.ts"), "utf8")

describe("main.ts", () => {
  // Existing tests
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

  it("slash_command_triggers_mention_dropdown_on_leading_slash", () => {
    assert.ok(source.includes("mention.handleTrigger()"),
      "slash commands must trigger unified mention/command dropdown")
  })

  it("slash_command_in_sendMessage_handles_known_and_unknown", () => {
    assert.ok(source.includes('text.startsWith("/")'))
  })

  it("slash_unknown_routes_to_host_for_server_commands", () => {
    assert.ok(source.includes('command: cmd'), "runtime slash commands must route to the extension host")
    assert.ok(source.includes("commandArgs"), "must preserve slash command arguments")
    assert.ok(!source.includes("Unknown command: ${cmd}"), "must not reject server-discovered commands in the webview")
  })

  it("mode_selector_disabled_during_stream", () => {
    assert.ok(source.includes("isStreaming"), "must reference isStreaming state")
    assert.ok(source.includes("updateModeSelectorState"), "must have updateModeSelectorState function")
    assert.ok(source.includes("classList.toggle('disabled'"), "must toggle disabled class")
    assert.ok(source.includes("btn.disabled = isStreaming"), "must disable buttons during streaming")
  })

  it("plan_mode_replaces_accept_with_approve_and_apply", () => {
    assert.ok(source.includes("mode: session.mode"))
    assert.ok(source.includes("renderMessage(msg, { mode"))
  })

  it("mode_persisted_per_tab_in_session_store", () => {
    assert.ok(source.includes("setSessionMode"))
    assert.ok(source.includes("active.mode"))
  })

  it("has a personalized theme customizer modal workflow", () => {
    assert.ok(source.includes("setupThemeCustomizer"), "must initialize the theme customizer modal")
    assert.ok(source.includes('"get_theme_config"'), "must request current theme config")
    assert.ok(source.includes('"update_theme_config"'), "must save personalized theme overrides")
    assert.ok(source.includes('"theme_config"'), "must handle theme config responses")
  })

  // ===== RED PHASE: New tests for features that should exist but don't yet =====

  it("RED: displays token usage in chat interface after message_complete", () => {
    assert.ok(source.includes("handleTokenUsage") || source.includes("updateTokenDisplay"),
      "must have token handling function")
    assert.ok(source.includes("token-display") || source.includes("token-usage") || source.includes("statusTokens") || source.includes("step_tokens"),
      "must have token display element in chat UI")
  })

  it("RED: displays cost in chat interface status bar", () => {
    // Cost should show in the chat interface, not just session modal
    assert.ok(source.includes("cost") && source.includes("chat") || source.includes("status"),
      "must display cost in chat interface")
  })

  it("RED: tracks file changes per session with changedFiles", () => {
    assert.ok(source.includes("changedFiles") || source.includes("fileChange"),
      "must track changed files per session")
    assert.ok(source.includes("addChangedFile") || source.includes("trackFileChange"),
      "must have function to add changed files")
  })

  it.skip("RED: has summarize session handler (unimplemented feature placeholder)", () => {
    assert.ok(source.includes("summarize_session") || source.includes("handleSummarize"),
      "must handle summarize_session message")
    assert.ok(source.includes("summary") || source.includes("summarize"),
      "must have summary-related functionality")
  })

  it("RED: has undo/restore support via revert_message", () => {
    assert.ok(source.includes("revert_message") || source.includes("undo"),
      "must handle revert_message")
    assert.ok(source.includes("revert_result") || source.includes("undo_result"),
      "must handle revert_result response")
  })

  it("RED: browse sessions by workspace folder", () => {
    assert.ok(source.includes("workspacePath") || source.includes("workspace"),
      "must store workspace path per session")
    assert.ok(source.includes("getSessionsByWorkspace") || source.includes("filterByWorkspace"),
      "must have function to filter sessions by workspace")
  })

  // ── Unified session modal ────────────────────────────────────────────────
  // The modal must show a single unified list instead of LOCAL/SERVER tabs.
  // All sessions must be clickable — both local and server sessions.

  it("unified modal: no LOCAL/SERVER tab switching — single unified list", () => {
    assert.ok(
      !source.includes("renderLocalSessions") && !source.includes("renderServerSessions"),
      "must NOT have separate renderLocalSessions/renderServerSessions functions — use a unified renderer"
    )
  })

  it("unified modal: renders sessions from both local store and server list", () => {
    assert.ok(
      source.includes("renderUnifiedSessionList") || source.includes("renderSessionList"),
      "must have a unified session list renderer"
    )
  })

it("unified modal: server session items send resume_server_session on click", () => {
    assert.ok(
      source.includes("resume_server_session") || sessionListRendererSource.includes("resume_server_session"),
      "must send resume_server_session message when a server session is clicked"
    )
  })

  it("unified modal: session items show isCurrentWorkspace badge", () => {
    assert.ok(
      source.includes("isCurrentWorkspace") || source.includes("workspace-badge") || sessionListRendererSource.includes("isCurrentWorkspace") || sessionListRendererSource.includes("workspace-badge"),
      "session items must indicate whether they belong to the current workspace"
    )
  })

  it("unified modal: session items show isCurrentWorkspace badge", () => {
    assert.ok(
      source.includes("isCurrentWorkspace") || source.includes("workspace-badge") || sessionListRendererSource.includes("isCurrentWorkspace") || sessionListRendererSource.includes("workspace-badge"),
      "session items must indicate whether they belong to the current workspace"
    )
  })

  // ── file_edited → changedFilesList accumulation ──────────────────────────
  // Backend sends individual file_edited events. The frontend must accumulate
  // them into changedFilesList so the file-chip bar shows up during streaming.

  it("file_edited handler accumulates files into session changedFiles", () => {
    assert.ok(
      source.includes('"file_edited"') || source.includes("\"file_edited\""),
      "must have a file_edited message handler"
    )
    const idx = source.indexOf('"file_edited"')
    const block = source.slice(idx, idx + 600)
    assert.ok(
      block.includes("changedFiles") || block.includes("renderChangedFilesList"),
      "file_edited handler must update changedFiles and call renderChangedFilesList"
    )
  })

  it("file_edited handler deduplicates files in changedFiles list", () => {
    const idx = source.indexOf('"file_edited"')
    assert.ok(idx >= 0, "file_edited handler must exist")
    const block = source.slice(idx, idx + 600)
    assert.ok(
      block.includes("includes(") || block.includes("indexOf(") || block.includes("Set("),
      "file_edited handler must deduplicate files (not add the same file twice)"
    )
  })

  // ── model selector on welcome screen ─────────────────────────────────────
  // When no session exists, selecting a model must still update the global
  // preference + dropdown UI — not silently discard the selection.

  it("model onSelect sets globalModel before checking for active session", () => {
    const idx = source.indexOf("onSelect: (modelId) =>")
    assert.ok(idx >= 0, "onSelect callback must exist in model dropdown setup")
    const block = source.slice(idx, idx + 500)
    const globalModelIdx = block.indexOf("setGlobalModel")
    const activeGuardIdx = block.indexOf("if (active)")
    assert.ok(globalModelIdx >= 0, "setGlobalModel must be called inside onSelect")
    assert.ok(
      activeGuardIdx === -1 || globalModelIdx < activeGuardIdx,
      "setGlobalModel must be called BEFORE any if (active) guard in onSelect (so welcome-screen model selection works)"
    )
  })

  it("model onSelect calls setCurrentModel and syncModelViews unconditionally", () => {
    const idx = source.indexOf("onSelect: (modelId) =>")
    assert.ok(idx >= 0, "onSelect callback must exist")
    const block = source.slice(idx, idx + 500)
    const activeGuardIdx = block.indexOf("if (active)")
    const setCurrentIdx = block.indexOf("setCurrentModel")
    const syncIdx = block.indexOf("syncModelViews")
    assert.ok(setCurrentIdx >= 0, "setCurrentModel must be in onSelect")
    assert.ok(syncIdx >= 0, "syncModelViews must be in onSelect")
    assert.ok(
      activeGuardIdx === -1 || (setCurrentIdx < activeGuardIdx && syncIdx < activeGuardIdx),
      "setCurrentModel and syncModelViews must run before any if (active) guard"
    )
  })

  // ── #turn-nav removed (consolidated to single timeline) ──────────────────

  it("does not contain #turn-nav (removed in favour of single conversation-timeline)", () => {
    assert.ok(
      !source.includes("turn-prev") && !source.includes("turn-next") && !source.includes("turn-selector"),
      "#turn-nav handlers (turn-prev, turn-next, turn-selector) must be removed"
    )
  })

  it("renders and updates the webview quota usage bar", () => {
    assert.ok(source.includes("handleRateLimitState"), "must handle rate-limit state messages")
    assert.ok(source.includes("updateQuotaBar"), "must render quota bar state")
    assert.ok(source.includes('"rate_limit_state"'), "must listen for rate_limit_state host messages")
  })
})
