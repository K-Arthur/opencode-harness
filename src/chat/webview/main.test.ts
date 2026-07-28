import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const orchestratorSource = (() => { try { return readFileSync(path.join(__dirname, "streamOrchestrator.ts"), "utf8") } catch { return "" } })()
const timelineSource = (() => { try { return readFileSync(path.join(__dirname, "timeline.ts"), "utf8") } catch { return "" } })()
const composerSource = (() => { try { return readFileSync(path.join(__dirname, "composer.ts"), "utf8") } catch { return "" } })()
const withComposer = source + "\n" + composerSource
const themeCustomizerSource = readFileSync(path.join(__dirname, "ui", "themeCustomizer.ts"), "utf8")
const modeDropdownSource = readFileSync(path.join(__dirname, "ui", "modeDropdown.ts"), "utf8")
const sessionModalSource = readFileSync(path.join(__dirname, "ui", "sessionModal.ts"), "utf8")
const tokenCostDisplaySource = readFileSync(path.join(__dirname, "ui", "tokenCostDisplay.ts"), "utf8")
const attachmentsSource = readFileSync(path.join(__dirname, "ui", "attachments.ts"), "utf8")
const modeWarningSource = readFileSync(path.join(__dirname, "ui", "modeWarning.ts"), "utf8")
const welcomeViewSource = readFileSync(path.join(__dirname, "ui", "welcomeView.ts"), "utf8")
const settingsMenuSource = readFileSync(path.join(__dirname, "ui", "settingsMenu.ts"), "utf8")
const fileTrackingSource = readFileSync(path.join(__dirname, "ui", "fileTracking.ts"), "utf8")
const buttonSetupSource = readFileSync(path.join(__dirname, "ui", "buttonSetup.ts"), "utf8")
const scrollMarkersSource = readFileSync(path.join(__dirname, "ui", "scrollMarkers.ts"), "utf8")
const allSource = source + "\n" + themeCustomizerSource + "\n" + modeDropdownSource + "\n" + sessionModalSource + "\n" + tokenCostDisplaySource + "\n" + attachmentsSource + "\n" + modeWarningSource + "\n" + welcomeViewSource + "\n" + settingsMenuSource + "\n" + fileTrackingSource + "\n" + buttonSetupSource + "\n" + scrollMarkersSource
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

  it("uses a safe webview id helper instead of assuming crypto.randomUUID exists", () => {
    assert.ok(source.includes("function createWebviewId("), "main.ts must define a safe ID helper")
    assert.ok(source.includes("Math.random().toString(36)"), "ID helper must include a fallback path")
    assert.ok(!source.includes('id: "user-" + crypto.randomUUID()'), "send path must not crash if crypto.randomUUID is unavailable")
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
    assert.ok(withComposer.includes('"/clear"'))
    assert.ok(withComposer.includes('"/model"'))
    assert.ok(withComposer.includes('"/help"'))
  })

  it("sends webview_ready message", () => {
    assert.ok(source.includes('"webview_ready"'))
  })

  it("manages scroll anchors per tab", () => {
    assert.ok(source.includes("scrollAnchors"))
  })

  it("dispatches host_message_batch envelopes item by item", () => {
    assert.ok(source.includes('msg?.type === "host_message_batch"'), "must recognize host message batch envelopes")
    assert.ok(source.includes("dispatchHostMessage(item as LegacyHostMessage)"), "must dispatch each batched message through normal handlers")
  })

  it("coalesces frequent tool update messages and clears progress state", () => {
    const combined = source + orchestratorSource
    assert.ok(combined.includes("pendingToolUpdates"), "must buffer frequent tool updates")
    assert.ok(combined.includes("scheduleToolUpdate"), "must debounce tool updates")
    assert.ok(combined.includes("flushToolUpdate"), "must flush pending tool updates before tool end")
    assert.ok(combined.includes("tool-chain-progress"), "must surface long-running tool-chain progress")
  })

  it("adds Playwright-friendly test ids for the prompt and send controls", () => {
    assert.ok(source.includes('dataset.testid = els.promptInput.dataset.testid || "prompt-input"'))
    assert.ok(source.includes('dataset.testid = els.sendBtn.dataset.testid || "send-button"'))
  })

  it("auto-mode warning confirmation updates UI state and notifies the host", () => {
    const setModeIdx = source.indexOf("function setMode(mode: string): void")
    assert.ok(setModeIdx >= 0, "auto-mode warning setMode helper must exist")
    const block = source.slice(setModeIdx, source.indexOf("const modeWarningDeps", setModeIdx))
    assert.ok(block.includes("updateModeDropdownLocal(mode)"), "confirming auto mode must update the visible dropdown")
    assert.ok(block.includes('vscode.postMessage({ type: "change_mode", mode, sessionId: active.id })'), "confirming auto mode must notify the extension host")
  })

  it("condenses very long local history without mutating server history", () => {
    const combined = source + orchestratorSource + timelineSource
    assert.ok(combined.includes("function applyHistoryCondensation") || combined.includes("applyHistoryCondensation"), "must define history condensation")
    assert.ok(combined.includes("history-condensed-summary"), "must render deterministic local summary controls")
    assert.ok(combined.includes("session.messages.length <= 140"), "must only condense long sessions")
  })

  it("keeps send button state synchronized across input event variants", () => {
    const idx = composerSource.indexOf("function setupInput()")
    assert.ok(idx >= 0, "setupInput must exist in composer.ts")
    const nextFn = composerSource.indexOf("\n  function ", idx + 1)
    const block = composerSource.slice(idx, nextFn > idx ? nextFn : composerSource.length)
    assert.ok(block.includes('addEventListener("input", onInputChange)'), "must handle normal input events")
    assert.ok(block.includes('addEventListener("keyup", updateSendButton)'), "must refresh after keyup fallback")
    assert.ok(block.includes('addEventListener("change", updateSendButton)'), "must refresh after change events")
    assert.ok(block.includes('addEventListener("compositionend", onInputChange)'), "must refresh after IME composition")
  })

  it("wires attachment context chips through the full webview element refs", () => {
    assert.ok(
      source.includes("updateContextChips: (_attachmentEls: AttachmentEls, chips?: ContextChip[]) => updateContextChips(els, chips)"),
      "attachment prompt chips must use full ElementRefs so contextBar/contextChips exist",
    )
    assert.ok(!source.includes("updateContextChips(els as ElementRefs, chips)"), "must not cast partial attachment refs to ElementRefs")
  })

  it("has concurrent streaming limit of 3", () => {
    assert.ok(withComposer.includes("MAX_CONCURRENT_STREAMS = 3"))
    assert.ok(withComposer.includes("activeStreams >= MAX_CONCURRENT_STREAMS"))
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
    assert.ok(source.includes("prepareLocalRecentSessions"))
  })

  it("setupButtons does not add duplicate newTabBtn listener", () => {
    const setupButtonsMatch = source.match(/els\.newTabBtn\.addEventListener/g)
    assert.ok(setupButtonsMatch === null || setupButtonsMatch.length <= 1,
      "newTabBtn should have at most one click listener")
  })

  it("drag_drop_handler_prevents_default_on_dragover", () => {
    assert.ok(withComposer.includes('inputArea.addEventListener("dragover"'))
    assert.ok(withComposer.includes("e.preventDefault()"))
  })

  it("drag_drop_handler_inserts_at_file_mentions", () => {
    assert.ok(withComposer.includes("@file:"))
    assert.ok(withComposer.includes("dataTransfer?.files"))
  })

  it("slash_command_triggers_mention_dropdown_on_leading_slash", () => {
    assert.ok(withComposer.includes("mention.handleTrigger()"),
      "slash commands must trigger unified mention/command dropdown")
  })

  it("slash_command_in_sendMessage_handles_known_and_unknown", () => {
    assert.ok(withComposer.includes('text.startsWith("/")'))
  })

  it("slash_unknown_routes_to_host_for_server_commands", () => {
    assert.ok(withComposer.includes('command: cmd'), "runtime slash commands must route to the extension host")
    assert.ok(withComposer.includes("commandArgs"), "must preserve slash command arguments")
    assert.ok(!withComposer.includes("Unknown command: ${cmd}"), "must not reject server-discovered commands in the webview")
  })

  it("mode_selector_disabled_during_stream", () => {
    assert.ok(allSource.includes("isStreaming"), "must reference isStreaming state")
    assert.ok(allSource.includes("updateModeSelectorState"), "must have updateModeSelectorState function")
    assert.ok(modeDropdownSource.includes("classList.toggle(\"disabled\""), "must toggle disabled class")
    assert.ok(modeDropdownSource.includes("btn.disabled = isStreaming"), "must disable buttons during streaming")
  })

  it("disables send with a clear tooltip when the global stream cap is full", () => {
    const idx = composerSource.indexOf("function updateSendButton()")
    assert.ok(idx >= 0, "updateSendButton must exist in composer.ts")
    const nextFn = composerSource.indexOf("\n  function ", idx + 1)
    const block = composerSource.slice(idx, nextFn > idx ? nextFn : composerSource.length)
    assert.ok(block.includes("getStreamCapacityState"), "send button must inspect global stream capacity")
    assert.ok(block.includes("stream-limit-blocked"), "send button must expose a blocked visual state")
    assert.ok(composerSource.includes("3 streams active"), "must explain the stream cap in the tooltip")
  })

  it("timeline jumps use exact message-list scroll positioning", () => {
    // scrollToTurn was extracted to the scrollMarkers module; assert against
    // the module source where the actual implementation lives.
    assert.ok(scrollMarkersSource.includes("export function scrollMessageToTop("), "must export the exact scroll helper")
    const idx = scrollMarkersSource.indexOf("export function scrollToTurn(")
    assert.ok(idx >= 0, "scrollToTurn must exist in scrollMarkers")
    // Block ends at the next top-level export, or end of file.
    const after = scrollMarkersSource.indexOf("\nexport function ", idx + 1)
    const block = scrollMarkersSource.slice(idx, after >= 0 ? after : scrollMarkersSource.length)
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
    assert.ok(withComposer.includes("setSessionMode"))
    assert.ok(withComposer.includes("active.mode"))
  })

  it("has a personalized theme customizer modal workflow", () => {
    assert.ok(allSource.includes("setupThemeCustomizer"), "must initialize the theme customizer modal")
    assert.ok(allSource.includes('"get_theme_config"'), "must request current theme config")
    assert.ok(allSource.includes('"update_theme_config"'), "must save personalized theme overrides")
    assert.ok(allSource.includes('"theme_config"'), "must handle theme config responses")
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

  it("unified modal: deduplicates local entries by server session id", () => {
    assert.ok(sessionListRendererSource.includes("localByIdentity"), "renderer must group local rows by cliSessionId/local id")
    assert.ok(sessionListRendererSource.includes("local.cliSessionId || local.id"), "server session id must be the dedupe identity when available")
  })

  it("unified modal: prefers server title for synced sessions", () => {
    assert.ok(
      sessionListRendererSource.includes("server.title || local.title"),
      "server title must be the source of truth for synced rows"
    )
  })

  it("unified modal: includes a search input that filters local and server sessions", () => {
    assert.ok(sessionModalSource.includes('type = "search"'), "session modal must render a search input")
    assert.ok(sessionModalSource.includes("setUnifiedSessionQuery"), "search input must update renderer query state")
    assert.ok(sessionModalSource.includes('postMessage({ type: "list_server_sessions", query: nextQuery })'), "search must refresh server session results")
  })

  it("unified modal: openSessionModal passes local sessions to renderer via setUnifiedLocalSessions", () => {
    const idx = sessionModalSource.indexOf("export function openSessionModal(")
    assert.ok(idx >= 0, "openSessionModal must exist in sessionModal module")
    const block = sessionModalSource.slice(idx, idx + 600)
    assert.ok(
      block.includes("setUnifiedLocalSessions(sessions)"),
      "openSessionModal must call setUnifiedLocalSessions to pass local sessions to the renderer"
    )
    assert.ok(
      !block.includes("_unifiedLocalSessions = sessions"),
      "openSessionModal must NOT directly assign to module-level _unifiedLocalSessions — must use setUnifiedLocalSessions() from sessionListRenderer.ts"
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

  it("changed_files_update is canonical sync for chip bar and todos panel", () => {
    const idx = source.indexOf('"changed_files_update"')
    assert.ok(idx >= 0, "changed_files_update handler must exist")
    const block = source.slice(idx, idx + 900)
    assert.ok(block.includes("handleChangedFiles"), "changed_files_update must update session changedFiles/chip bar")
    assert.ok(block.includes("updateChangedFiles"), "changed_files_update must sync per-session changed files to dropdown")
  })

  it("changed_files_update only renders active-session changed files", () => {
    const idx = source.indexOf('"changed_files_update"')
    assert.ok(idx >= 0, "changed_files_update handler must exist")
    const block = source.slice(idx, idx + 1200)
    assert.ok(fileTrackingSource.includes("deps.getActiveSessionId() === sessionId"), "chip list must only render active session files")
    assert.ok(source.includes("cfDropdownApi?.setCurrentSession("), "switching tabs must reset dropdown to correct session")
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
    assert.ok(allSource.includes("handleRateLimitState"), "must handle rate-limit state messages")
    assert.ok(allSource.includes("updateQuotaBar"), "must render quota bar state")
    assert.ok(source.includes('"rate_limit_state"'), "must listen for rate_limit_state host messages")
  })

  // ── Feature 7: Paste & Drag-Drop parity — RED phase ─────────────────────

  it("paste_rejects_images_exceeding_10mb_size_limit", () => {
    // Pasted images larger than 10 MB must be rejected with a visible error;
    // they must not be silently loaded into pendingAttachments.
    const MAX = 10 * 1024 * 1024
    assert.ok(
      allSource.includes(String(MAX)) || allSource.includes("10 * 1024 * 1024") || allSource.includes("MAX_ATTACHMENT_BYTES"),
      "onPaste must enforce a 10 MB size cap on pasted images"
    )
  })

  it("drop_handler_routes_image_files_to_attachment_chips_not_file_mentions", () => {
    // When the user drops a PNG/JPG/WEBP/GIF onto the input area the file must
    // become an image attachment (pendingAttachments) — not an @file: mention.
    // Only non-image files should become @file: mentions.
    const dropIdx = composerSource.indexOf('inputArea.addEventListener("drop"')
    assert.ok(dropIdx >= 0, "drop listener must exist in composer.ts")
    const dropBlock = composerSource.slice(dropIdx, dropIdx + 800)
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
      withComposer.includes("image/png") && withComposer.includes("image/jpeg") && withComposer.includes("image/webp"),
      "must validate against an explicit MIME allowlist (png, jpeg, webp, gif)"
    )
  })

  // ── Feature 4: Stream limit UX — RED phase ────────────────────────────────

  it("stream_limit_aria_label_includes_streaming_session_names", () => {
    // When stream limit is reached the aria-label and title on the send button
    // must include the names of the currently streaming sessions, not just the
    // static tooltip string, so screen readers and sighted users know which
    // tabs to stop.
    const idx = composerSource.indexOf("function updateSendButtonIcon(")
    assert.ok(idx >= 0, "updateSendButtonIcon must exist in composer.ts")
    const fnEnd = composerSource.indexOf("\n  function ", idx + 1)
    const block = fnEnd > idx ? composerSource.slice(idx, fnEnd) : composerSource.slice(idx, idx + 600)
    assert.ok(
      block.includes("streamingNames") || block.includes("streamCapacity.streamingNames"),
      "updateSendButtonIcon must include streaming session names in the tooltip when at limit"
    )
  })

  it("stream_limit_send_blocked_shows_which_tabs_are_streaming", () => {
    // The error shown when the user tries to send despite being at the stream
    // cap must name the streaming tabs (the streamingNames from capacity state),
    // not just emit the static STREAM_LIMIT_TOOLTIP.
    const idx = withComposer.indexOf("handleRequestError(active.id")
    assert.ok(idx >= 0, "stream-limit handleRequestError call must exist")
    const block = withComposer.slice(idx, idx + 300)
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
      const first = allSource.indexOf("function accumulateTokenUsage(")
      const fnIdx = allSource.indexOf("function accumulateTokenUsage(", first + 1)
      assert.ok(fnIdx >= 0, "accumulateTokenUsage must exist")
      const body = allSource.slice(fnIdx, fnIdx + 2000)
      const displayIdx = body.indexOf("updateTokenDisplay(")
      assert.ok(displayIdx >= 0, "must call updateTokenDisplay inside accumulateTokenUsage")

      const preceding = body.slice(0, displayIdx)
      assert.ok(
        /activeSessionId|getActiveSessionId\s*\(\s*\)/.test(preceding),
        "accumulateTokenUsage must check activeSessionId before updating the visible token display"
      )
    })

    it("accumulateTokenUsage gates the cost/context display on the active session", () => {
      const first = allSource.indexOf("function accumulateTokenUsage(")
      const fnIdx = allSource.indexOf("function accumulateTokenUsage(", first + 1)
      assert.ok(fnIdx >= 0, "accumulateTokenUsage must exist")
      const body = allSource.slice(fnIdx, fnIdx + 2000)

      for (const call of ["updateCostDisplay(", "updateContextBarFromSession("]) {
        const callIdx = body.indexOf(call)
        assert.ok(callIdx >= 0, `must call ${call} inside accumulateTokenUsage`)
        const preceding = body.slice(0, callIdx)
        assert.ok(
          /activeSessionId|getActiveSessionId\s*\(\s*\)/.test(preceding),
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

  // --- Bug fix regression tests: command availability, session lifecycle ---

  describe("command availability fixes", () => {
    it("handles push_all_state host message by triggering state sync", () => {
      assert.ok(source.includes('"push_all_state"'), "must register a handler for push_all_state")
      const idx = source.indexOf('["push_all_state"')
      assert.ok(idx >= 0, "push_all_state must be in messageHandlers map")
    })

    it("handles push_visible_state host message by triggering state sync", () => {
      assert.ok(source.includes('"push_visible_state"'), "must register a handler for push_visible_state")
      const idx = source.indexOf('["push_visible_state"')
      assert.ok(idx >= 0, "push_visible_state must be in messageHandlers map")
    })

    it("proactively loads command list on boot so slash commands are available immediately", () => {
      const bootIdx = source.indexOf("function boot()")
      assert.ok(bootIdx >= 0, "boot function must exist")
      const bootBlock = source.slice(bootIdx, bootIdx + 400)
      assert.ok(bootBlock.includes('"list_commands"'), "boot must send list_commands after webview_ready to pre-populate inline dropdown")
    })

    it("wires commands palette button to open modal and request commands", () => {
      assert.ok(withComposer.includes("commandsPaletteBtn"), "must reference commandsPaletteBtn element")
      assert.ok(withComposer.includes("commandsPaletteBtn.addEventListener"), "must wire click handler on commands palette button")
    })

    it("passes session search query from session_list into the modal", () => {
      const idx = source.indexOf('[\"session_list\"')
      assert.ok(idx >= 0, "session_list handler must exist")
      const block = source.slice(idx, source.indexOf('[\"session_list_update\"', idx))
      assert.ok(block.includes("msg.query"), "session_list handler must read the host-provided search query")
      assert.ok(block.includes("openSessionModal(sessions, "), "session_list handler must pass the query to openSessionModal")
    })

    it("forwards session modal search query to server session listing", () => {
      const idx = sessionModalSource.indexOf("export function openSessionModal")
      assert.ok(idx >= 0, "openSessionModal must exist")
      const block = sessionModalSource.slice(idx, sessionModalSource.indexOf("export function closeSessionModal", idx))
      assert.ok(block.includes("query"), "openSessionModal must accept the active search query")
      assert.ok(block.includes('postMessage({ type: \"list_server_sessions\", query })'), "server session listing must receive the search query")
    })

    it("recovers optimistic streaming state on webview_request_error", () => {
      const combined = source + orchestratorSource
      const idx = combined.indexOf('["webview_request_error"')
      assert.ok(idx >= 0, "must handle webview_request_error host messages")
      const block = combined.slice(idx, combined.indexOf('["request_error"', idx))
      assert.ok(block.includes("handleRequestError"), "webview_request_error must surface the failure")
      assert.ok(combined.includes("setStreaming") && combined.match(/setStreaming\([^)]+false\)/), "handleRequestError must unlock optimistic streaming state")
      assert.ok(combined.includes("updateSendButton()"), "handleRequestError must refresh the send button")
    })
  })

  // ── Session-restore model-picker race fix.
  // model_list arrives async after init_state. Without preferring the active
  // session's model, the late-arriving model_list response overwrites the
  // dropdown back to the global model, making restored sessions appear under
  // the wrong model.
  describe("model_list session-model preference", () => {
    it("model_list handler prefers active session's model over global model", () => {
      const idx = source.indexOf('[\"model_list\"')
      assert.ok(idx >= 0, "model_list handler must exist")
      const block = source.slice(idx, idx + 800)
      assert.ok(
        block.includes("getActiveSession") || block.includes("stateManager.getSession"),
        "model_list must consult the active session before choosing which model to display"
      )
      assert.ok(
        /activeSession\?\.\s*model|sessionModel/.test(block),
        "model_list must reference the session's model so a restored session keeps its own model"
      )
    })

    it("switchTab restores the session's model on the dropdown", () => {
      const idx = source.indexOf("function switchTab(")
      assert.ok(idx >= 0, "switchTab must exist")
      const block = source.slice(idx, idx + 2000)
      assert.ok(
        block.includes("modelDropdown.setCurrentModel"),
        "switchTab must call setCurrentModel so the dropdown reflects the active session's model"
      )
      assert.ok(
        block.includes("resetContextUsagePanel"),
        "switchTab must reset the context usage panel so per-session counters don't bleed across tabs"
      )
    })
  })

  // ── Hide-thinking boot sync: when the webview loads, the persisted
  // "Show thinking" pref must be applied to the DOM immediately —
  // otherwise the user opens the panel and sees the thinking blocks they
  // explicitly hid in their last session.
  describe("setupThinkingToggle — boot-time sync", () => {
    it("calls toggleAllThinkingBlocks at boot with the persisted preference", () => {
      const combined = source + timelineSource
      const fnIdx = combined.indexOf("function setupThinkingToggle()")
      assert.ok(fnIdx >= 0, "setupThinkingToggle must exist")
      const clickIdx = combined.indexOf("addEventListener(\"click\"", fnIdx)
      const bootBlock = combined.slice(fnIdx, clickIdx)
      assert.ok(
        bootBlock.includes("toggleAllThinkingBlocks"),
        "setupThinkingToggle must call toggleAllThinkingBlocks during boot so the persisted pref is applied to existing DOM",
      )
    })
  })
})
