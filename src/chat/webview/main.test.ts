import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const sessionListRendererSource = readFileSync(path.join(__dirname, "sessionListRenderer.ts"), "utf8")
const messagesCss = readFileSync(path.join(__dirname, "css", "messages.css"), "utf8")

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
    assert.ok(source.includes("MAX_CONCURRENT_STREAMS = 3"))
    assert.ok(source.includes("activeStreams >= maxStreams"))
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

  it("disables send with a clear tooltip when the global stream cap is full", () => {
    const idx = source.indexOf("function updateSendButton()")
    assert.ok(idx >= 0, "updateSendButton must exist")
    const block = source.slice(idx, source.indexOf("function updateSendButtonIcon", idx))
    assert.ok(block.includes("getStreamCapacityState"), "send button must inspect global stream capacity")
    assert.ok(block.includes("stream-limit-blocked"), "send button must expose a blocked visual state")
    assert.ok(source.includes("3 streams active — wait or stop another tab first"), "must explain the stream cap in the tooltip")
  })

  it("timeline jumps use exact message-list scroll positioning", () => {
    assert.ok(source.includes("function scrollMessageToTop("), "must have exact scroll helper")
    const idx = source.indexOf("function scrollToTurn(")
    assert.ok(idx >= 0, "scrollToTurn must exist")
    const block = source.slice(idx, source.indexOf("/* ─── CONVERSATION TIMELINE", idx))
    assert.ok(block.includes("scrollMessageToTop(msgList, target)"), "timeline jumps must use the message list scroller directly")
    assert.ok(!block.includes("scrollIntoView"), "timeline jumps must not rely on scrollIntoView/focus side effects")
  })

  it("does not virtualize chat messages because it destabilizes trackpad scrolling", () => {
    assert.ok(
      !/\.message\s*\{[^}]*content-visibility:\s*auto/s.test(messagesCss),
      "message bubbles must stay fully painted while scrolling/streaming"
    )
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

  it("unified modal: openSessionModal passes local sessions to renderer via setUnifiedLocalSessions", () => {
    const idx = source.indexOf("function openSessionModal(")
    assert.ok(idx >= 0, "openSessionModal must exist")
    const block = source.slice(idx, idx + 300)
    assert.ok(
      block.includes("setUnifiedLocalSessions(sessions)"),
      "openSessionModal must call setUnifiedLocalSessions to pass local sessions to the renderer"
    )
    assert.ok(
      !block.includes("_unifiedLocalSessions = sessions"),
      "openSessionModal must NOT directly assign to module-level _unifiedLocalSessions in main.ts — must use setUnifiedLocalSessions() from sessionListRenderer.ts"
    )
  })

  it("session_list_update handler uses setUnifiedLocalSessions, not direct assignment", () => {
    const idx = source.indexOf('"session_list_update"')
    assert.ok(idx >= 0, "session_list_update handler must exist")
    const block = source.slice(idx, idx + 200)
    assert.ok(
      block.includes("setUnifiedLocalSessions(sessions)"),
      "session_list_update must call setUnifiedLocalSessions to pass local sessions to the renderer"
    )
    assert.ok(
      !block.includes("_unifiedLocalSessions"),
      "session_list_update must NOT reference _unifiedLocalSessions directly — must use setUnifiedLocalSessions so sessionListRenderer.ts can read them in buildUnifiedSessionItems"
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

  // ── Feature 7: Paste & Drag-Drop parity — RED phase ─────────────────────

  it("paste_rejects_images_exceeding_10mb_size_limit", () => {
    // Pasted images larger than 10 MB must be rejected with a visible error;
    // they must not be silently loaded into pendingAttachments.
    const MAX = 10 * 1024 * 1024
    assert.ok(
      source.includes(String(MAX)) || source.includes("10 * 1024 * 1024") || source.includes("MAX_ATTACHMENT_BYTES"),
      "onPaste must enforce a 10 MB size cap on pasted images"
    )
  })

  it("drop_handler_routes_image_files_to_attachment_chips_not_file_mentions", () => {
    // When the user drops a PNG/JPG/WEBP/GIF onto the input area the file must
    // become an image attachment (pendingAttachments) — not an @file: mention.
    // Only non-image files should become @file: mentions.
    const dropIdx = source.indexOf('addEventListener("drop"')
    assert.ok(dropIdx >= 0, "drop listener must exist")
    const dropBlock = source.slice(dropIdx, dropIdx + 800)
    // Drop handler must branch on image MIME (via ALLOWED_IMAGE_MIMES or direct type check)
    // and call the shared attachImageBlob helper (which pushes to pendingAttachments)
    assert.ok(
      (dropBlock.includes("ALLOWED_IMAGE_MIMES") || dropBlock.includes("image/")) &&
      (dropBlock.includes("attachImageBlob") || dropBlock.includes("pendingAttachments")),
      "drop handler must detect image files and route them to attachment chips via attachImageBlob or pendingAttachments"
    )
  })

  it("paste_and_drop_enforce_image_mime_allowlist", () => {
    // Only png, jpeg, webp, and gif must be accepted as image attachments.
    // Other image/* subtypes (e.g. image/tiff, image/bmp) should be rejected.
    assert.ok(
      source.includes("image/png") && source.includes("image/jpeg") && source.includes("image/webp"),
      "must validate against an explicit MIME allowlist (png, jpeg, webp, gif)"
    )
  })

  // ── Feature 4: Stream limit UX — RED phase ────────────────────────────────

  it("stream_limit_aria_label_includes_streaming_session_names", () => {
    // When stream limit is reached the aria-label and title on the send button
    // must include the names of the currently streaming sessions, not just the
    // static tooltip string, so screen readers and sighted users know which
    // tabs to stop.
    const idx = source.indexOf("function updateSendButtonIcon(")
    assert.ok(idx >= 0, "updateSendButtonIcon must exist")
    const fnEnd = source.indexOf("\n  function ", idx + 1)
    const block = fnEnd > idx ? source.slice(idx, fnEnd) : source.slice(idx, idx + 600)
    assert.ok(
      block.includes("streamingNames") || block.includes("streamCapacity.streamingNames"),
      "updateSendButtonIcon must include streaming session names in the tooltip when at limit"
    )
  })

  it("stream_limit_send_blocked_shows_which_tabs_are_streaming", () => {
    // The error shown when the user tries to send despite being at the stream
    // cap must name the streaming tabs (the streamingNames from capacity state),
    // not just emit the static STREAM_LIMIT_TOOLTIP.
    const idx = source.indexOf("handleRequestError(active?.id")
    assert.ok(idx >= 0, "stream-limit handleRequestError call must exist")
    const block = source.slice(idx, idx + 300)
    assert.ok(
      block.includes("streamingNames"),
      "request error on stream-limit must include streamingNames in the detail"
    )
  })

  it("stream_counter_badge_shows_active_count_not_only_when_full", () => {
    // The stream counter in the tab bar should read "N/3 streaming" whenever
    // N > 0, not just when N === 3.  This lets users see at a glance how many
    // slots are in use before hitting the cap.
    const tabsSource = readFileSync(path.join(__dirname, "tabs.ts"), "utf8")
    const idx = tabsSource.indexOf("streamCapacity")
    assert.ok(idx >= 0, "tabs.ts renderTabs must accept streamCapacity")
    // Counter must gate on activeStreams > 0, not only isFull
    assert.ok(
      tabsSource.includes("activeStreams > 0"),
      "stream counter must be rendered when activeStreams > 0 — not only when isFull"
    )
  })

  // ── Batch 2d: tab-aware token/cost counter ────────────────────────────────
  describe("tab-aware usage counter", () => {
    it("uses opencode-reported cost instead of browser-side provider pricing tables", () => {
      assert.ok(
        !source.includes("PRICING_2026"),
        "webview must not maintain a hard-coded provider pricing table; opencode reports authoritative cost"
      )
      assert.ok(
        !source.includes("function calcCost("),
        "webview must not recompute cost from generic OpenAI/Anthropic-style rates"
      )
      assert.ok(
        !source.includes("session.cost = computedCost"),
        "token updates must not overwrite opencode-reported cost with a browser estimate"
      )
    })

    it("accumulateTokenUsage gates the visible token display on the active session", () => {
      const fnIdx = source.indexOf("function accumulateTokenUsage(")
      assert.ok(fnIdx >= 0, "accumulateTokenUsage must exist")
      // Slice a generous window covering the whole function body
      const body = source.slice(fnIdx, fnIdx + 2000)
      const displayIdx = body.indexOf("updateTokenDisplay(")
      assert.ok(displayIdx >= 0, "must call updateTokenDisplay inside accumulateTokenUsage")

      // Look at the lines immediately preceding the updateTokenDisplay call —
      // there must be a guard that compares sessionId to the active session.
      const preceding = body.slice(0, displayIdx)
      assert.ok(
        /activeSessionId|getActiveSession\s*\(\s*\)/.test(preceding),
        "accumulateTokenUsage must check activeSessionId before updating the visible token display"
      )
    })

    it("accumulateTokenUsage gates the cost/context display on the active session", () => {
      const fnIdx = source.indexOf("function accumulateTokenUsage(")
      assert.ok(fnIdx >= 0, "accumulateTokenUsage must exist")
      const body = source.slice(fnIdx, fnIdx + 2000)

      // Both updateCostDisplay and updateContextBarFromSession produce
      // visible side effects that must not bleed from an inactive tab.
      for (const call of ["updateCostDisplay(", "updateContextBarFromSession("]) {
        const callIdx = body.indexOf(call)
        assert.ok(callIdx >= 0, `must call ${call} inside accumulateTokenUsage`)
        const preceding = body.slice(0, callIdx)
        assert.ok(
          /activeSessionId|getActiveSession\s*\(\s*\)/.test(preceding),
          `${call} must be gated on the active session inside accumulateTokenUsage`
        )
      }
    })

    it("switchTab refreshes the visible counter from the new tab's stored tokenUsage", () => {
      // Lock in: switchTab must pull token/cost data from the tab being
      // activated so a previously-displayed tab's totals don't bleed in.
      const fnIdx = source.indexOf("function switchTab(")
      assert.ok(fnIdx >= 0, "switchTab must exist")
      const body = source.slice(fnIdx, fnIdx + 2000)
      assert.ok(body.includes("updateTokenDisplay("), "switchTab must call updateTokenDisplay")
      assert.ok(
        body.includes(".tokenUsage") || body.includes("selectDisplayedUsage("),
        "switchTab must source token data from the tab being activated"
      )
      assert.ok(
        body.includes("updateCostDisplay("),
        "switchTab must refresh cost display for the new tab"
      )
    })
  })
})
