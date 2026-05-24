# Changelog

All notable changes to the **OpenCode Harness** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.16] - 2026-05-23

### Fixed
- **Streaming text/tool interleave disorder** — text chunks that arrived before a tool call were being rendered all at once after the stream completed instead of appearing live. Two root causes:
  1. `handleToolStart` cleared `state.currentBlockBuffer` and `state.currentBlockEl` before the RenderQueue had flushed its pending text chunks. Any RAF-scheduled or 50ms-fallback flush fired after the clear, found no current element, and created a spurious empty text block. Fix: `finalizeCurrentTextBlock()` is now called first (converting the live streaming element to a finalized markdown block with the full buffer), then the buffer/element refs are cleared. Both the RenderQueue callback and the RAF `doUpdate` path gained matching guards that bail when the buffer is empty, preventing spurious empty block creation.
  2. `insertStreamingTextAfterLastBlock()` placed the new text element at the bubble tail rather than after the last tool/diff block. Fix: the helper now scans `bubble.children` in reverse to find the last `details.tool-call`, `details.tool-group`, `.diff-block`, or `.skill-badge` element and inserts the text element immediately after it using `insertBefore`. A new text block entry is pushed to `msgObj.blocks` and `state.currentBlockIndex` is updated so subsequent chunks accumulate in the right slot.
  3. `handleDiff` was not finalizing the current text block before appending a diff block, causing the same visual reordering. Fix: `finalizeCurrentTextBlock()` call added at the start of `handleDiff`.
  (`src/chat/webview/streamHandlers.ts`)
- **Chat bar streaming state not session-scoped** — opening a new tab while another session was streaming showed the "Stop" button in the new (idle) tab. Root cause: `createNewTab()` called the CSS-only `switchToTab()` but not the full `switchTab()` sync path, so `updateSendButton()` never ran for the new tab. Fix: explicit `updateSendButton()` call added to `createNewTab()`. (`src/chat/webview/main.ts`)
- **Context usage shown in two places simultaneously** — the per-tab `.context-monitor` bar inside each tab panel and the `#context-usage` status strip were both updated by the `context_usage` handler, producing two visible context displays at once. Fix: the handler now routes exclusively to the toolbar `#context-usage-btn` dropdown via `ctxDropdownApi.updateUsage()` and no longer touches the per-tab bar. The `context_window_known` handler was similarly updated. (`src/chat/webview/main.ts`)
- **Context usage lost on session switch** — switching tabs wiped the context usage display because `SessionState` had no field to persist the data between switches. Fix: `SessionState.contextUsage` field (`{ percent, tokens, maxTokens }`) added; the `context_usage` handler writes to it and `switchTab()` restores it via `ctxDropdownApi.updateUsage()` when activating a session that already has stored usage data. (`src/chat/webview/types.ts`, `src/chat/webview/main.ts`)

### Changed
- **Changed-files display: chip bar → toolbar dropdown** — the inline `.changed-file-chip` strip rendered inside each tab's message list area has been replaced by a `#changed-files-btn` toolbar button (with `#cf-count-badge` file count) that opens a floating `#changed-files-dropdown` panel. The dropdown groups files by directory, shows per-file diff stats via a mini summary bar, supports sorting (alpha / most-changed) and compact mode, and dispatches `file_diff_response` requests per file for inline diff preview. The old inline chip rendering path (`renderChangedFilesList` in `fileTracking.ts`) is now inert (`changedFilesList: null` in deps) — all updates go through `cfDropdownApi.updateChangedFiles()` on `changed_files_update` messages. (`src/chat/webview/changed-files-dropdown.ts`, `src/chat/webview/main.ts`)

### Tests
- `tests/webview/streaming-interleave.spec.ts` — 3 Playwright tests verifying streaming text/tool interleave at the DOM level: text before a tool is finalized (loses `streaming-text` class) when the tool starts; text after a tool is positioned as the last child of the bubble; new-tab chat bar shows idle state even when another session is streaming.
- `src/chat/webview/stream-interleave.test.ts` — 9 unit tests (source-structure assertions) confirming `finalizeCurrentTextBlock` ordering in `handleToolStart`, `handleDiff`, the guard conditions, and `insertStreamingTextAfterLastBlock` insertion semantics.
- `tests/webview/chat-e2e.spec.ts` — updated two tests to drive the new `#changed-files-btn` / `#cf-count-badge` / `#cf-dropdown-tree` dropdown UI via `changed_files_update` messages (previously tested the now-inert `.changed-file-chip` strip). Updated context usage test to check the toolbar `#context-usage-btn` and `.cup-summary-text` instead of the removed `.context-monitor` bar.

## [0.2.15] - 2026-05-23

### Fixed
- **Context window now resolves for models the opencode server doesn't report `limit.context` for** — the 0.2.13 fix only papered over the bug. The `opencode.contextWindowOverride` setting was only consulted inside an `if (ctxWindow)` guard, so when the server returned no window (kimi-k2.5, deepseek-v4-flash-free, most OSS / free-tier models) the override was silently ignored. `ChatProvider.applyContextWindowFor` now applies the override regardless, plus reacts live to `onDidChangeConfiguration` so a new override value takes effect without an extension reload. (`src/chat/ChatProvider.ts`)
- **Session history duplicate rows** — legacy local-keyed sessions that already pointed at a server session through `cliSessionId` are now merged into the server-keyed record during migration/recovery. The Session History modal also dedupes by `cliSessionId || id` as a defensive UI layer and prefers the server title for synced rows. (`src/session/sessionMigration.ts`, `src/session/SessionStore.ts`, `src/chat/webview/sessionListRenderer.ts`)
- **Session renaming now uses the OpenCode SDK/server** — local renames call `SessionManager.updateSessionTitle()` / SDK `client.session.update`, and incoming `session.updated` SSE events apply server titles back into the local cache. (`src/session/SessionManager.ts`, `src/session/EventNormalizer.ts`, `src/extension.ts`, `src/commands/session.ts`)

### Added
- **Cross-provider context-window fallback via OpenRouter's `/api/v1/models`** — when the opencode server doesn't report `limit.context` for a model, `resolveContextWindow` now consults a cached catalogue from OpenRouter. Same model weights typically share the same window regardless of which provider hosts them, so kimi-k2.5 served by any host hits OpenRouter's canonical `200_000` entry. The catalogue is fetched on first model-refresh, persisted to `globalState` with a 24h TTL, and refreshed in the background. Resolution order: server → OpenRouter → user override → unknown. No hand-curated tables; no provider drift.
- **Clickable "set limit ⚙" affordance on the per-tab context monitor** — when both the server and OpenRouter come up empty, the monitor row now reads `N tok · set limit ⚙` and clicking it opens the `Set Context Window Override` dialog directly. Previously the user got a tooltip that told them to find the command in the palette.
- **`open_context_window_override_dialog` webview message type** — routes the click above through the established webview-event-router validation path.
- **Search inside the Session History modal** — the modal now includes a search field that filters cached local/synced sessions immediately and refreshes server-only results through `list_server_sessions` with the active query. (`src/chat/webview/ui/sessionModal.ts`, `src/chat/webview/sessionListRenderer.ts`)

### Tests
- New `src/model/openRouterMetadata.test.ts` — 9 behavioral tests covering payload parsing, short-id cross-provider lookup, case-insensitive matching, cache-freshness TTL, and graceful degradation on missing/junk data.
- Extended `src/model/contextWindowResolver.test.ts` with 5 tests pinning the OpenRouter fallback path: cache consultation, short-id fallback, server-still-wins, miss-then-log behaviour, happy-path silence.
- Updated `src/chat/webview/theme.test.ts` to assert the new "set limit" hint and `needs-override` click marker.
- Added focused regression coverage for session identity/title/search: duplicate local/server merge, SDK-backed title update, `session.updated` normalization, modal dedupe, server-title precedence, and modal search.

## [0.2.14] - 2026-05-23

### Fixed
- **Tool calls now actually group into a single codex-style row** — the 0.2.12 CSS work shrank each tool row but consecutive tool calls still stacked one per line. Two root causes:
  1. `groupConsecutiveToolCalls` treated every non-tool block as a group-breaker, so SDK lifecycle blocks (`step-start`, normal `step-finish`) split runs of tools into single-element groups. The grouper now treats these silent lifecycle blocks as transparent: they don't break tool runs and don't reset the last tool name/class. Visible non-tool blocks (text, diffs, errors, abnormal step-finish) still legitimately break grouping.
  2. The live-streaming append path (`handleToolStart`) was bypassing the grouper entirely — every new tool was appended directly to the bubble. A new helper `appendOrFoldToolDOM` now folds the new tool into the prior `details.tool-group` (or wraps the prior single tool + the new tool into a fresh group) at append time, so the codex-style grouped view shows live, not just after stream end. The previous tool's live DOM is moved into the group rather than re-rendered, preserving runtime state (args panel, result panel, duration, error class) that `handleToolUpdate` / `handleToolEnd` write directly without updating `msg.blocks`.

### Tests
- New `src/chat/webview/toolGrouping.test.ts` — 8 behavioral tests for the grouper covering: three consecutive tools across step-finish blocks → one group of 3; step-start transparency; hyphenated normal-finish reasons; text breaks grouping; abnormal step-finish breaks grouping; lifecycle blocks preserved in output; tools-then-lifecycle-tail.
- Extended `tests/visual/compact-tool-blocks.spec.ts` with a "three consecutive tools render as ONE folded tool-group" assertion that pins the visible DOM shape so a future regression in `appendOrFoldToolDOM` is caught in the browser layer.
- Updated `src/chat/webview/stream.test.ts` to accept either the direct `renderBlock(toolBlock)` call or the new `appendOrFoldToolDOM` indirection.

## [0.2.13] - 2026-05-22

### Fixed
- **Redundant "Step finished (tool-calls) — in:N out:N reasoning:N" chip rendered after every assistant step** — `NORMAL_FINISH_REASONS` listed the OpenAI-style underscore forms (`tool_calls`, `end_turn`, …) but the opencode SDK actually emits hyphenated variants (`tool-calls`, `end-turn`, …), so the normal-completion short-circuit never matched and every step rendered a clutter chip beneath each tool row. `renderStepFinishBlock` now normalizes the reason by replacing `-` with `_` before the set lookup, so both shapes suppress the chip. The chip still renders for genuinely unusual finishes (`length`, `content_filter`, `abort`, errors). (`src/chat/webview/renderer.ts`)

## [0.2.12] - 2026-05-22

### Fixed
- **Show-thinking toggle did not actually hide thinking blocks** — Unchecking *Settings → Show thinking* previously only flipped each `<details>` element closed, which still left the summary chip in the layout. The toggle now drives a `hide-thinking` body class that CSS uses to `display: none` every `.thinking-block` outright. `setupThinkingToggle()` also applies the persisted preference at boot, so a user's prior choice takes effect immediately instead of after a double-click. (`src/chat/webview/dom.ts`, `src/chat/webview/main.ts`, `src/chat/webview/css/components.css`)

### Changed
- **Codex-style compact tool blocks** — `.tool-call` no longer renders as a bordered card; only the left accent stripe remains so tool class is still color-coded at a glance. `.tool-header` is a single-line row at `min-height: var(--size-target-min)` (24 px) with `text-xs` font. Multi-tool turns that previously rendered as a wall of cards now stack tightly as a one-line log. Expanded args/result panels still get their full styling on click. (`src/chat/webview/css/blocks.css`)

### Tests
- 6 new source-string assertions across `dom.test.ts`, `messages-css.test.ts`, `main.test.ts`. Updated `tests/visual/thinking-toggle.spec.ts` to assert full block invisibility (not just body collapse) and the `hide-thinking` body class. New `tests/visual/compact-tool-blocks.spec.ts` pins row height ≤ 28 px and the flat-not-card border shape.

## [Unreleased]

### Fixed
- **Context usage counter hidden when server doesn't report limit.context** — The extension previously hid the context usage bar entirely when the opencode server didn't provide a context window limit. Now shows tokens-only display with a helpful tooltip when the limit is unknown, and users can manually set an override via the new `opencode.contextWindowOverride` setting or `OpenCode: Set Context Window Override` command. The root cause was CLI auto-fetch on startup which couldn't extract context windows; this was removed so models are now only fetched from the server (which provides full metadata). (`src/extension.ts`, `src/chat/webview/theme.ts`, `src/chat/webview/context-usage-panel.ts`, `package.json`, `src/commands/model.ts`)
- **Duplicate context usage display surfaces** — Removed the status-strip `#context-usage` element, leaving only the per-tab `.context-monitor` element to avoid duplicate displays. (`src/chat/webview/index.html`, `src/chat/webview/context-usage-panel.ts`)
- **Context monitor panel had no way to open it** — The per-tab context-monitor element is now clickable (with keyboard support) to open the full context monitor panel with history graph and cost summary. (`src/chat/webview/tabs.ts`, `src/chat/webview/main.ts`)

### Added
- **`opencode.contextWindowOverride` configuration** — Users can now manually set a context window override via Settings UI when the server doesn't report one. (`package.json`)
- **`OpenCode: Set Context Window Override` command** — Quick command palette access to set or clear the context window override. (`src/commands/model.ts`, `package.json`)

### Performance
- **Parallelized session restoration backfill** — `backfillRecoveredSessions` previously fetched recent session message histories from the local opencode server one at a time via a serial `for...await` loop, taking ~50s to restore 10 sessions on cold start (initial sweep ~9s + four retry rounds for slow lazy-loaded sessions). The loop now runs in chunks of `BACKFILL_CONCURRENCY=5` via `Promise.allSettled`, dropping cold-start restoration to ~15-20s while keeping local-server load bounded. Per-session writes are keyed by `session.id` and the `backfillInProgress` Set is concurrency-safe, so no shared state mutates unsafely. (`src/chat/ChatProvider.ts`)

### Build / Tooling
- **Modern on-demand activation** — `package.json` now declares `"activationEvents": []`, the modern empty-array form that lets VS Code infer activation from `contributes.commands`/`contributes.views` rather than relying on legacy `onCommand:` strings. Without this field, activation behavior is undefined under recent VS Code versions. (`package.json`)
- **`.vscode/extensions.json`** — Recommends `dbaeumer.vscode-eslint` and `connor4312.esbuild-problem-matchers` for contributors so the watch task surfaces esbuild errors in the Problems panel correctly. (`.vscode/extensions.json`)

### Fixed
- **First prompt from welcome created a blank tab and never sent** — The prompt input's context-chip refresh was wired with attachment-only element refs and then cast to full `ElementRefs`, so typing or clearing a prompt could throw inside `updateContextChips` before `send_prompt` was posted. The attachment manager now renders chips through the full webview refs, and `updateContextChips` safely skips rendering if the chip container is unavailable. (`src/chat/webview/main.ts`, `src/chat/webview/theme.ts`)
- **Welcome-page model choice did not reliably reach first prompt** — Existing pending tabs now refresh their model/mode in both `ChatProvider.ensureLocalTab` and `SessionLifecycleService.ensureLocalTab` before prompt streaming starts. (`src/chat/ChatProvider.ts`, `src/chat/SessionLifecycleService.ts`)
- **Empty local placeholder sessions could survive reload/close** — Empty `pendingServerLink` sessions are no longer persisted, restored, or exempt from close cleanup. Only server-imported sessions waiting for backfill (`needsBackfill`) remain exempt while empty. (`src/session/SessionStore.ts`)
- **Recent-session delete used the wrong webview contract** — The welcome recent-session delete action now posts `targetSessionId`, matching `WebviewEventRouter` validation. (`src/chat/webview/main.ts`, `src/chat/webview/types.ts`)
- **Changed-files UI leaked stale state across tabs** — Changed-file chip/todos rendering is now scoped to the active session and clears when switching to a session with no changed files. (`src/chat/webview/main.ts`, `src/chat/webview/ui/fileTracking.ts`)
- **Session messages permanently stale after resume** — Six interrelated bugs caused messages to remain stale after resuming a session:
  - **Fix A**: `handleResumeSession` now always fetches fresh messages from the server on resume, regardless of local message count. Previously skipped backfill if `messages.length > 0`. (`src/chat/SessionLifecycleService.ts`)
  - **Fix C**: Increased `BACKFILL_RETRY_DELAYS_MS` from `[1500, 4000]` to `[1500, 4000, 8000, 16000]` (4 retries over ~30s) to accommodate slow server lazy-loading. (`src/chat/ChatProvider.ts`)
  - **Fix D**: Removed destructive `closeTab()` + `applyBackfilledMessages(id, [])` on empty backfill response. Now logs and preserves state for retry. (`src/chat/SessionLifecycleService.ts`)
  - **Fix E**: `request_more_messages` handler now falls through to server fetch when local messages are exhausted, instead of returning an empty slice. (`src/chat/WebviewEventRouter.ts`)
  - **Fix F**: Added `refresh_session_messages` message handler for explicit webview-triggered message refresh, with `session_messages_refreshed` response. (`src/chat/WebviewEventRouter.ts`, `src/chat/webview/main.ts`)
- **`backfillTabIfNeeded` skipped stale sessions** — The method returned early if `session.messages.length > 0`, preventing re-backfill of stale sessions. Now only skips when `needsBackfill !== true`. (`src/chat/ChatProvider.ts`)
- **Inline slash dropdown transparency** — The mention/commands dropdown background was 94% opaque (`color-mix`), causing text behind it to bleed through. Changed to fully opaque `var(--oc-editor-bg)`. (`src/chat/webview/css/components.css`)
- **Commands modal z-index inconsistency** — `.commands-modal` used fallback `1000` while the `--z-modal` token is `300`. Fixed fallback to `300` for consistency with other modals. (`src/chat/webview/css/components.css`)
- **Slash commands not available on first load** — Server and skill/prompt commands were only loaded when the user typed `/commands`. Now `list_commands` is sent on boot, pre-populating the inline dropdown and commands modal immediately. (`src/chat/webview/main.ts`)
- **Command execution fails with "Session not found"** — Running a server command on a freshly created tab (no server session yet) caused `NotFoundError` because `tab.cliSessionId` was undefined. `CommandExecutionService.handleExecuteCommand` now calls `sessionManager.ensureSession()` to create a server session on-demand before executing remote commands. (`src/chat/CommandExecutionService.ts`)
- **`push_all_state` / `push_visible_state` unhandled** — These host messages were logged as "unknown host message type" and dropped. The webview now handles them by triggering a debounced state sync. (`src/chat/webview/main.ts`)
- **Commands modal and inline dropdown can both be visible** — Opening the commands modal now hides the inline mention dropdown. (`src/chat/webview/commands-modal.ts`)

### Added
- **Browser-level send-flow regression** — Playwright now covers welcome → type prompt → click send → local user message render → typing indicator → `send_prompt` posted with selected model, with browser/page error capture around the flow. (`tests/visual/webview-contract.spec.ts`)
- **Commands palette button** — A `>_` terminal-style button in the input bottom bar (left of the `@` button) opens the commands palette modal with one click. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`)
- **`Ctrl+Shift+/` keybinding** — Opens the commands palette when the chat view is focused. (`package.json`)
- **`CommandExecutionService` test suite** — 7 source-inspection tests covering class export, handleExecuteCommand method, server session ensure flow, cliSessionId persistence, error handling, and custom prompt routing. (`src/chat/CommandExecutionService.test.ts`)
- **Session message freshness test suite** — 6 regression tests covering: handleResumeSession always refreshes, backfillTabIfNeeded respects needsBackfill, retry budget has 4 delays, no destructive closeTab on empty backfill, request_more_messages server fallback, and refresh_session_messages handler. (`src/chat/ChatProvider.test.ts`, `src/chat/SessionLifecycleService.test.ts`)

### Added
- **Canonical changed-file sync** — `SessionStore.addChangedFiles()` now normalizes, deduplicates, persists, and replays changed files from both `file.edited` and `session.diff` SDK events. The webview treats `changed_files_update` as the canonical state message for the chip bar and todos panel, while `file_edited` remains a live incremental event. (`src/session/SessionStore.ts`, `src/session/eventHandlers/*`, `src/chat/ChatProvider.ts`, `src/chat/webview/main.ts`)
- **VS Code-safe diff checkpoints** — Extension-managed diff accepts now capture explicit file snapshots before applying the edit. Snapshots are restored with `WorkspaceEdit` and VS Code filesystem APIs instead of git branches/stashes. (`src/checkpoint/CheckpointManager.ts`, `src/chat/SessionLifecycleService.ts`, `src/chat/handlers/DiffHandler.ts`)
- **Session-aware file opener** — Changed-file chips, todo-panel file buttons, diff open actions, and direct `open_file` webview messages now route through one extension-host resolver that handles `#L12`, prefers the session workspace, checks workspace containment, and reports clear missing-file errors. (`src/chat/WebviewEventRouter.ts`)
- **Back button and modal focus management** — A back button appears in the header when any modal is open (model manager, theme customizer, mode warning, MCP config, session modal). All modals now have proper focus trapping (Tab/Shift+Tab cycle within) with return-focus-to-trigger-element on close. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`)
- **Settings menu keyboard navigation** — ArrowUp/Down, Home, End, and Escape navigation within the settings overflow menu. (`src/chat/webview/main.ts`)
- **Theme customizer undo/redo snapshots** — Save and reset actions push the current theme state onto an undo stack for potential undo/redo support. (`src/chat/webview/main.ts`)
- **`sessions_recovered` event handling** — `ChatProvider` re-pushes init state to the webview when session recovery completes, ensuring the webview reflects all restored sessions. (`src/chat/ChatProvider.ts`)

### Added
- **True High Contrast presets (`high-contrast-dark` / `high-contrast-light`)** — Replaced the fake HC preset (which was structurally identical to `cli-default`) with two fully hardcoded presets: black/white/yellow for dark HC and white/black/red-blue for light HC. Auto-resolved from `vscode.window.activeColorTheme.kind` via the new `resolveEffectivePreset()` method. Users with existing `opencode.theme.preset = "high-contrast"` settings keep working via the alias. (`src/theme/ThemeManager.ts`)
- **Adaptive RenderQueue** — New `RenderQueue` class buffers streaming text chunks and flushes via `requestAnimationFrame` (primary) with a 50ms `setTimeout` fallback for hidden webview contexts where rAF pauses. Prevents per-chunk DOM writes from causing layout thrashing during high-token-rate streams. (`src/chat/webview/renderQueue.ts`)
- **Webview heartbeat (`stream_ping`/`stream_ack`)** — Extension host sends a sequenced ping every 5s during active streams; webview replies with `stream_ack` including the last rendered chunk sequence. If 2+ pings are missed, `force_rerender` is sent with the full accumulated text snapshot. (`src/chat/handlers/StreamCoordinator.ts`, `src/chat/ChatProvider.ts`, `src/chat/webview/main.ts`)
- **Event stream liveness tracking** — `SessionManager` records `lastRawEventAt`, `lastNormalizedEventAt`, `lastRawEventType`, and `lastNormalizedEventType` on every SDK event. On unexpected stream close, logs the last seen event and schedules reconnection with exponential backoff (1s→2s→4s→8s→16s→30s). Fires `event_stream_reconnected` to trigger session reconciliation. (`src/session/SessionManager.ts`)
- **`reconcileAfterReconnect`** — On `event_stream_reconnected`, `ChatProvider` iterates active streaming tabs and calls `StreamCoordinator.reconcileAfterReconnect`, which fetches the latest server-side messages and posts `force_rerender` to restore UI state. (`src/chat/ChatProvider.ts`, `src/chat/handlers/StreamCoordinator.ts`)
- **Chunk batching** — `appendToolStart` and `appendChunk` batch small text chunks for 50ms before posting to the webview, reducing `postMessage` overhead for fast-token streams. (`src/chat/handlers/StreamCoordinator.ts`)
- **"Retry from here" button** — When a stream ends with `retryable: true` (timeout, hard_timeout, error), a "Retry from here" button appears below the partial output. Clicking it sends `retry_stream` to the extension host, which sends a continuation prompt preserving partial context. (`src/chat/webview/main.ts`, `src/chat/handlers/StreamCoordinator.ts`)
- **Tool group collapsing** — Consecutive tool calls with the same name are grouped into a single expandable row (e.g., "read 12 files · all done"). Expands to show individual tool rows with full details. (`src/chat/webview/renderer.ts`, `src/chat/webview/css/blocks.css`)
- **Tool elapsed timer** — Running/pending tools display a live elapsed-time counter (updated every 1s). Completed tools show duration and output size (chars/KB, line count). (`src/chat/webview/renderer.ts`, `src/chat/webview/main.ts`, `src/chat/webview/css/blocks.css`)
- **Tool keyboard navigation** — Arrow keys navigate between tool rows, Home/End jump to first/last tool within a message list. (`src/chat/webview/streamHandlers.ts`)
- **`deriveExtendedTheme` static method** — Derives all 51 `OpencodeTheme` fields from the CLI's compact 16-field schema (`palette` + `overrides`) using deterministic `color-mix()` formulas. Called automatically when `applyThemeContent` detects a `palette` key in the theme block. Enables all CLI themes (tokyonight, catppuccin, gruvbox, dracula, …) to render correctly in the webview. (`src/theme/ThemeManager.ts`)
- **Consolidated advanced theme modal** — Replaced the minimal 7-field customizer with a single advanced modal featuring: 4 preset cards with color swatches, searchable CLI theme list (populated via `list_cli_themes` message), 6 collapsible sections (Messages, Syntax, Diff, Tools, Markdown, Advanced covering 44 fields), live preview swatch that updates per-keystroke without mutating the chat, and bidirectional color picker ↔ text input sync. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/dom.ts`, `src/chat/webview/css/layout.css`)
- **`list_cli_themes` message handler** — Webview can request the discovered CLI theme list; `ChatProvider` responds with `{ type: "cli_themes_list", themes }` via the public `discoverCliThemes()` method. (`src/chat/ChatProvider.ts`, `src/theme/ThemeManager.ts`)
- **HC CSS tokens** — `tokens.css` now declares `.vscode-high-contrast` (dark) and `.vscode-high-contrast-light` (light) body-level overrides with the same hardcoded values as the new TS presets, ensuring CSS fallback matches the injected variables. (`src/chat/webview/css/tokens.css`)

### Changed
- **Diff preview and revert contract** — Diff preview now uses a registered read-only virtual document provider plus `vscode.diff`; accepted diff metadata is retained so `revert_diff` restores the exact accepted edit instead of relying on an empty backup path. (`src/diff/DiffApplier.ts`, `src/chat/handlers/DiffHandler.ts`, `src/chat/WebviewEventRouter.ts`)
- **`ThemePreset` union extended** — Added `"high-contrast-dark"` and `"high-contrast-light"` to the union type and `BUILT_IN_PRESETS` record. Both `loadConfig` (ThemeManager) and `normalizeThemeConfig` (ChatProvider) accept the new IDs. (`src/theme/ThemeManager.ts`, `src/chat/ChatProvider.ts`)
- **Tool lifecycle deduplication** — `ToolPartHandler` now generates stable tool IDs (preferring `part.id` > `part.callID` > `messageID:tool`) and emits `tool_start` only once per stable ID. Pending→running transitions produce `tool_update`, not a second `tool_start`. Redundant events when nothing changed are suppressed. (`src/session/eventHandlers/ToolPartHandler.ts`)
- **StreamCoordinator tool tracking** — `appendToolStart` deduplicates by stable tool ID; `maybeFinalizeStream` reconciles pending tools from server state before deciding to finalize; stale pending tools are closed with a `stale` status after a 2-second grace window. (`src/chat/handlers/StreamCoordinator.ts`)
- **Settings menu: "Quick-pick preset" entry removed** — The VS Code QuickPick preset switcher button was removed from the settings overflow menu (Command Palette `opencode-harness.previewTheme` command remains). The consolidated modal is now the single entry point. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`)
- **`ThemeManager.discoverCliThemes()` made public** — Was `private`; now accessible to `ChatProvider` for the `list_cli_themes` response. (`src/theme/ThemeManager.ts`)
- **`ThemeManager` CSS_VAR_MAP: `--bg-secondary` and `--bg-tertiary` removed** — These tokens were mapped to the flat `panelBg` value, overriding the `color-mix()` depth layering that `tokens.css` computes for visual hierarchy. They are now owned entirely by the CSS layer. (`src/theme/ThemeManager.ts`)

### Fixed
- **OpenCode SDK file event normalization** — `file.edited` now reads `properties.file`; `session.diff` reads `properties.diff[].file` with additions/deletions and forwards normalized file-change data even after stream state changes. (`src/session/eventHandlers/FileEditHandler.ts`, `src/session/eventHandlers/SessionDiffHandler.ts`, `src/chat/ChatProvider.ts`)
- **Frontend changed-file registration drift** — `changed_files_update` now feeds the same dedupe path used by live `file_edited` events and updates the todos panel's changed-files view alongside the chip bar. (`src/chat/webview/main.ts`, `src/chat/webview/types.ts`)
- **`handleUpdateThemeConfig` fails without workspace** — Was always writing to `ConfigurationTarget.Workspace`, throwing when no workspace folder is open. Now falls back to `ConfigurationTarget.Global` when `vscode.workspace.workspaceFolders` is `undefined`. (`src/chat/ChatProvider.ts`)
- **Light-theme user message bubble rendered dark** — Added a comprehensive `.vscode-light` body override block to `tokens.css` for `--user-message-bg`, `--oc-user-msg-bg`, `--bg-code`, `--oc-tool-bg`, diff background opacities, and all shadow tokens. (`src/chat/webview/css/tokens.css`)
- **Duplicate tool calls** — The first tool call no longer appears as an empty JSON object placeholder. `ToolPartHandler` uses stable tool IDs and suppresses redundant `tool_start` emission for already-started tools. (`src/session/eventHandlers/ToolPartHandler.ts`)
- **Streaming completion for long tasks** — Added event stream reconnection with reconciliation, chunk inactivity timeout routed through `maybeFinalizeStream`, hard watchdog (10 min), and `force_rerender` heartbeat recovery. The stream no longer stops mid-generation for long-running coding tasks. (`src/session/SessionManager.ts`, `src/chat/handlers/StreamCoordinator.ts`)
- **Streaming glitches** — Replaced per-chunk DOM writes with an adaptive `RenderQueue` that batches via `requestAnimationFrame` + 50ms `setTimeout` fallback, preventing layout thrashing during high-token-rate streams. (`src/chat/webview/renderQueue.ts`, `src/chat/webview/streamHandlers.ts`)

### Welcome dashboard
- **Welcome dashboard** — Welcome screen now shows workspace folder name + current model in a context row, a "Continue last session" quick-action button (hidden when no sessions exist), and a "New session" button. Recent sessions sorted by last-activity time (not message count) and capped at 3. Prompt starters displayed in a 2-column grid. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/messages.css`, `src/chat/ChatProvider.ts`)
- **Status strip** — A thin strip below the tab bar shows the active session's model name, token count, and cost. Populated on `model_update`, `token_usage`, and `cost_update` events; hidden when the welcome view is displayed. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/layout.css`)
- **Settings overflow menu** — The settings button now opens a popover menu (`#settings-menu`, `role="menu"`) containing "Manage MCP servers" and "Preview theme". Closes on Escape, outside click, or item selection. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/layout.css`)
- **Workspace name in `init_state`** — `ChatProvider.pushInitStateToWebview` now includes `workspaceName` (the first VS Code workspace folder name), consumed by the webview to populate the welcome context row. (`src/chat/ChatProvider.ts`)

### Changed
- **Single conversation timeline** — Removed the `#turn-nav` Prev/Next + dropdown turn navigator. The right-sidebar `.conversation-timeline` is now the sole navigation aid. Timeline items have WCAG keyboard navigation (ArrowUp/Down/Home/End) and a `role="navigation"` + `aria-label` outer element. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/messages.css`)
- **Header streamlined** — `cost-display` and `token-display` moved out of the header into the new status strip. `files-toggle-btn` is now hidden (changed-files panel auto-shows). `mcp-btn` moved into the settings overflow menu. Header retains four buttons: history, checkpoint toggle, timeline toggle, settings. (`src/chat/webview/index.html`)
- **`recoverSessions` no longer workspace-scoped** — Previously filtered out sessions not in the current workspace directory. Now shows sessions from all workspaces so CLI-created sessions are visible on reconnect. (`src/session/SessionManager.ts`)

### Fixed
- **Model selector silent no-op on welcome screen** — `onSelect` callback previously wrapped all state updates inside `if (active)`, so selecting a model before any session existed was silently dropped. Global state updates (`setGlobalModel`, `setCurrentModel`, `syncModelViews`) now run unconditionally; the `postMessage` with `sessionId` only fires when a session is active. (`src/chat/webview/main.ts`)
- **CLI sessions invisible to extension** — Extension's spawned `opencode serve` excluded `OPENCODE_DATA_DIR` and `XDG_DATA_HOME` from its env-var allowlist, causing the server to use a different data directory than the CLI. Both vars are now passed through. (`src/session/SessionManager.ts`)

### Added
- **Unified session modal** — Replaced LOCAL/SERVER two-tab session picker with a single list that merges local and server sessions. All sessions are clickable; server-only sessions are imported on demand via the new `resume_server_session` webview message. (`src/chat/webview/main.ts`, `src/chat/ChatProvider.ts`)
- **`SessionStore.importOneServerSession(serverId, title?, directory?)`** — Idempotent method that creates a local session entry from a server session ID with `needsBackfill: true` and `workspacePath` from the server session's directory. Returns the existing entry if already imported. (`src/session/SessionStore.ts`)
- **`resume_server_session` handler** — `ChatProvider` now handles webview requests to resume a server-only session. Calls `importOneServerSession`, resumes the session, and offers "Open Folder" if the session directory differs from the current VS Code workspace. (`src/chat/ChatProvider.ts`)
- **Workspace folder change listener** — When VS Code adds a workspace folder while the server is running, an information message offers to restart the server in the new workspace directory. (`src/extension.ts`)
- **Changed-files chip bar now populates** — Frontend accumulates individual `file_edited` events into `session.changedFiles` with deduplication, re-rendering the chip bar live for the active tab. (`src/chat/webview/main.ts`)
- **Token & cost display wiring** — `StreamCoordinator.finalizeStream` now posts `cost_update` and `token_usage` messages to the webview after fetching the finalized server message, using `AssistantMessage.cost` and `.tokens` from the `@opencode-ai/sdk`. (`src/chat/handlers/StreamCoordinator.ts`)
- **`list_server_sessions` shows all workspaces** — Removed the current-workspace filter so CLI-created sessions from other projects are visible in the session modal. Sessions include an `isCurrentWorkspace` flag for UI badging. (`src/chat/ChatProvider.ts`)
- **Workspace badges** — Session modal items show a filled dot (current workspace), hollow dot (other workspace), or dimmed dot (local-only) next to the session title. (`src/chat/webview/main.ts`, `src/chat/webview/css/layout.css`)

### Fixed
- **`restore_checkpoint` always returned `ok: true`** — Handler now captures the boolean return value from `CheckpointManager.restore()` and posts `ok: false` on failure. Duplicate success toast removed. (`src/chat/ChatProvider.ts`)

### Added
- **Unified session identity (ADR-007)** — Server-issued session IDs are now the canonical key for sessions in `SessionStore`. CLI-created sessions are imported automatically when the extension connects to the server, so the chat panel and the `opencode` CLI no longer maintain parallel session pools. Pre-existing local sessions with a `cliSessionId` are rekeyed in place by a one-shot, idempotent migrator on `SessionStore.load`. (`src/session/SessionStore.ts`, `src/session/sessionMigration.ts`, `src/extension.ts`)
- **Continue Last Session command** — `opencode-harness.continueLastSession` activates the most-recent session and opens the chat panel. Falls back to `newSession` when no sessions exist. (`src/commands/session.ts`)
- **Choose History Session command** — `opencode-harness.chooseHistorySession` shows a quick-pick over the union of local + server sessions. Selecting an unbacked server session triggers a `withProgress` backfill of full message history before activation. (`src/commands/session.ts`)
- **Attach to Remote Server command + settings** — `opencode-harness.attachRemote` prompts for a URL and optional bearer token, persists them to `opencode.serverUrl` / `opencode.serverAuthToken`, and reconnects `SessionManager` against the remote endpoint without spawning a local binary. (`src/commands/session.ts`, `src/session/SessionManager.ts`, `package.json`)
- **Session-start baseline hook** — Fresh sessions still call `CheckpointManager.snapshot(sessionId, "baseline")`, but extension-local checkpoints now require explicit file paths; baseline-without-files is a no-op rather than a git ref. (`src/extension.ts`, `src/checkpoint/CheckpointManager.ts`)
- **`SessionStore.onSessionCreated` event** — Decouples the baseline-checkpoint hook from the store. (`src/session/SessionStore.ts`)
- **`SessionStore.importServerSessions` / `migrateLocalIdsToServerIds` / `promotePendingServerLink` / `applyBackfilledMessages`** — Public API for the unified-identity flow, exercised by 15 new behavioral tests in `src/session/sessionMigration.test.ts`.
- **`SessionManager.setRemoteServer` / `isRemote`** — Switch between local-spawn and remote-attach without restarting the extension. Bearer auth supersedes the local Basic-auth path in `authHeader`. (`src/session/SessionManager.ts`)

### Changed
- **`sessions_recovered` handler now imports** — Previously only re-linked already-known sessions on reconnect. Now imports any server session the local store does not yet know about, surfacing CLI-only sessions in the picker. (`src/extension.ts`)
- **`SessionStore.create(name, opts)`** — Second argument is now `CreateSessionOptions` (`{ id?, cliSessionId?, pendingServerLink? }`); the legacy `create(name, idString)` signature is preserved for backward compatibility.
- **Empty-session pruning exemptions** — Only sessions marked `needsBackfill` (imported from server, history not yet fetched) are exempt from empty-session filtering and stale-session pruning. Empty local placeholders marked `pendingServerLink` are transient until they receive a user message.

### Fixed
- **Plan mode now prevents edits** — Replaced `mode` parameter with `tools` field in server API calls. Plan mode sets `tools: { file_edit: false }` to disable file edits (server uses tool permissions via `tools` field, not `mode` parameter). Build/auto modes pass `tools: undefined` (server default enables file edits). Updated `StreamCoordinator.ts` (tools config), `SessionManager.ts` (`sendPrompt()` and `sendPromptAsync()` accept `tools?` parameter), `ChatProvider.ts` (maps server tools config to extension modes). All 578 tests pass.
- **Critical: Stream handler methods lost on object spread** — `createStreamHandlersForTab` used `...stream` spread on a `StreamSession` class instance. JavaScript class methods live on the **prototype**, not as own properties, so spread silently discarded all handler methods (`handleStreamStart`, `handleStreamChunk`, `handleStreamEnd`, `handleServerStatus`). Replaced with `Object.assign(Object.create(Object.getPrototypeOf(stream)), stream, { overrides })` to preserve the prototype chain. (`src/chat/webview/main.ts`)
- **Critical: Extension crash on startup (`sessionStore.list() on undefined`)** — `initConnectionStatusBar` was called at line 80 with `sessionStore` as a parameter, but `sessionStore = new SessionStore(...)` wasn't created until line 83. Moved `initConnectionStatusBar` after session store creation. (`src/extension.ts`)
- **Critical: Session/chat history lost tool calls and special blocks** — `handleStreamEnd` replaced the entire `msgObj.blocks` array with blocks from `finalizeStream`'s `partsToBlocks`, which only handles `text` and `tool` types. Thinking blocks, diffs, permission requests, and other non-text/tool content were silently dropped on finalization. Changed to **merge** server blocks into existing real-time blocks: text content is updated, tool-call blocks are added/updated, all other block types are preserved. (`src/chat/webview/streamHandlers.ts`)
- **Critical: Streaming response never rendered live** — Three compounding bugs fixed:
  1. **`ensureSession` replaced messages array mid-stream** — `existing.messages = session.messages` orbanned the stream handler's array reference. Changed to in-place mutation (`length = 0; push(...)`) so both the handler and state manager share the same array. (`src/chat/webview/state.ts`)
  2. **`loadSessions` created entirely new arrays** — `{ ...s }` spread created new `messages` arrays for all sessions on `init_state`, invalidating every active stream handler. Added `messages: existing ? existing.messages : s.messages` to preserve the reference. (`src/chat/webview/state.ts`)
  3. **`handleStreamEnd` had no fallback rendering** — If the stream handler's `reRenderMessage` failed (due to the above array mismatch or missing DOM element), the response blocks traveled all the way from the server to the webview but were never inserted into the DOM. Added `addMessage()` fallback that force-removes the empty streaming placeholder and renders blocks unconditionally. (`src/chat/webview/main.ts`)
- **Critical: Empty model `""` sent to server** — When no model was previously selected, `sendMessage` sent `model: ""`. The server received `undefined` model and timed out (TTFB timeout) instead of responding. Three-part fix: added `getCurrentModel()` to model dropdown for reliable model tracking, `sendMessage` now rejects if no model is selected, `send_prompt` handler falls back to `modelManager.model`. (`src/chat/webview/model-dropdown.ts`, `src/chat/webview/main.ts`, `src/chat/ChatProvider.ts`)
- **Critical: `ModelManager._current` never auto-selected** — Defaulted to `""` and only changed on explicit `setModel()`. Added auto-select of the first available model after `refreshModels`. (`src/model/ModelManager.ts`)
- **rAF-only streaming update didn't fire in background** — `requestAnimationFrame` pauses when the webview tab isn't focused. Added `setTimeout(50ms)` fallback so streaming text always updates even in background panels. (`src/chat/webview/streamHandlers.ts`)
- **ChunkBatcher flush logs invisible** — Used `console.log` (developer console only) instead of the output channel. Added optional `log` callback. (`src/chat/ChunkBatcher.ts`)
- **DeltaHandler silent drops** — Added diagnostics that log when `message.part.delta` is dropped and why, including all known `messageRoles` for debugging event ordering issues. (`src/session/eventHandlers/DeltaHandler.ts`, `src/session/eventHandlers/TextPartHandler.ts`)
- **Stream messageId mismatch between stream_start and stream_end** — Initial `stream_start` used the SDK session ID (`ses_...`) as the messageId prefix, but the message-transition `stream_end` used the raw SDK message ID (`msg_...`) without the `resp-` prefix. This caused `handleStreamEnd` to fail finding the stored message, leaving the streaming buffer unconsumed and logging "empty response". Fixed by adding `resp-${prevId}` prefix to match. (`src/chat/handlers/StreamCoordinator.ts`)
- **handleStreamEnd ID fallback for message lookup** — When `messageId` from `stream_end` doesn't match any stored message AND `state.streamingMessageId` has a different value (due to the initial stream_start using a different ID format), both `handleStreamEnd` and `reRenderMessage` now fall back to `state.streamingMessageId` for DOM and message lookups. (`src/chat/webview/streamHandlers.ts`)

### Security
- **FallbackHandler noisy `console.warn` removed** — The `FallbackHandler` at the end of the handler chain logged `"Unhandled SDK event type"` for events like `message.part.updated` that were already handled by preceding handlers (TextPartHandler, ToolPartHandler). Since the normalizer loop intentionally doesn't break for `message.part.updated`, the FallbackHandler always matched and warned. Removed the misleading warning. (`src/session/eventHandlers/FallbackHandler.ts`)
- **Webview source maps disabled** — `sourcemap: false` in webview esbuild config to prevent CSP violation (`connect-src 'none'` blocks source map loading). Extension host source maps retained for debugging. (`esbuild.js`)
- **PII scrubbing** — All output channel messages are now redacted for sensitive patterns (Bearer tokens, API keys, passwords, GitHub tokens, Slack tokens, AWS access keys) before being written to the log. Implemented via `OutputChannelService.scrub()`.
- **`process.env` allowlist extended** — `CliDiagnostics.ts` and `ModelManager.ts` now use the same allowlist pattern as `SessionManager.ts` (PATH, HOME, USERPROFILE, etc.) instead of passing the full environment. Prevents API key leakage to spawned child processes.
- **Explicit `shell: false`** — Added to remaining `spawn()` calls in `SessionManager.ts` (server process) and `ModelManager.ts` (CLI fetch) that were relying on the default. Eliminates regression risk.
- **`.vscodeignore` exclusions** — Added `.env*` and `package-lock.json` to prevent secret leakage in the packaged VSIX.
- **Auto-generated `OPENCODE_SERVER_PASSWORD`** — Server now generates a cryptographically random password per start, passed as `--password` flag + `OPENCODE_SERVER_PASSWORD` env var + `Authorization: Bearer` header on all SDK client requests. (P04)
- **Idempotency keys** — Every `sendPromptAsync` and `sendPrompt` call now includes an `Idempotency-Key` header to prevent duplicate processing on retry. (P04)
- **Narrowed retry policy** — `isRetryableError` regex tightened to remove overly broad `/socket/i` pattern, added `/enotfound/i`, `/enetunreach/i`. (P04)
- **Server session auth verification** — Stored-port reuse now verifies authentication via an SDK API call before reconnecting. (P04)
- **Respect user-configured `OPENCODE_SERVER_PASSWORD`** — If set in the parent environment, it's used instead of generating one. (P04)
- **Perf debug logging gated** — `console.debug` render timing now guarded behind `window.__opencodeDebug` flag. (P10)

### Streaming & Performance
- **TTFB timeout** — Separate 30-second time-to-first-byte timeout added; emits user-actionable `stream_end` with `reason: "ttfb_timeout"`. (P02)
- **Completion timeout reset on chunk** — 60-second completion timeout resets on each chunk to prevent false timeouts during active streaming. (P02)
- **`stream_end` reason field** — `reason` and `partial` fields now forwarded to webview; user sees "Response was cut off (timeout)" or "Model took too long to start" instead of silent placeholder removal. (P02, P07)
- **rAF-batched streaming** — `handleStreamToken` now batches DOM `textContent` updates via `requestAnimationFrame` to avoid per-token layout thrashing. (P09)
- **content-visibility: auto** — Added to `.message` elements for virtual rendering; off-screen messages skip layout/paint. (P09)
- **DocumentFragment batching** — `resume_session_data` builds message list via `DocumentFragment` instead of calling `appendChild` per message. (P09)
- **Scroll markers** — Positioned marker dots in the message list scrollbar gutter for user messages; click-to-jump with flash animation. (P09)
- **Jump-to-bottom button** — Sticky button appears when user scrolls >300px from bottom; wired to stream start, tab switch, and session resume. (P09)
- **Jump-to-bottom button fix** — Removed duplicate CSS that forced `display: flex` (button was always visible). Button now correctly defaults to `display: none` and only shows via `.visible` class. Added initial scroll-position evaluation so the button isn't shown when already at bottom on chat start. (P09)

### Session Management
- **Always start on welcome page** — `init_state` handler no longer auto-switches to an active session. Tab UI is created for restored sessions but welcome view is always shown, letting the user pick a session from the recent sessions list. (`src/chat/webview/main.ts`)
- **`pushInitStateToWebview` skips empty sessions** — Only sends sessions with at least one message to the webview on init. Previously sent the active session even if empty (e.g., a stale "Default" session), which caused the welcome page to be suppressed. (`src/chat/ChatProvider.ts`)
- **`SessionStore.load()` skips all empty sessions on restore** — Previously restored empty sessions that were marked as active. Now skips ALL sessions with zero messages regardless of active status. Previously baked "Default" session creation removed from `extension.ts`. (`src/session/SessionStore.ts`, `src/extension.ts`)
- **Archive/unarchive** — Sessions can be archived (hidden from default list view) and unarchived. `list()` now takes `includeArchived` parameter. (P03)
- **Typed `onDidChangeSession` events** — `SessionChangeEvent` with `kind` discriminator (`deleted`, `renamed`, `archived`, etc.). ChatProvider subscribes to keep webview + server in sync. (P03)
- **Server-side delete on local delete** — Deleting an extension session now also calls `sessionManager.deleteSession(cliSessionId)` to clean up server state. (P03)
- **Cross-layer cleanup** — `clearAll()` now supports dry-run with per-category counts (empty, test-named, orphaned, archived, corrupted). Produces JSON backup log before deletion. (P03)
- **Resume re-attaches server session** — `handleResumeSession` is now async and calls `ensureSession(cliSessionId)` to re-attach without creating duplicate server sessions. (P03)
- **`session_deleted` message handling** — Webview handler removes DOM tab/panel and updates state. (P03)
- **MAX_SESSIONS prune fix** — Prune loop no longer breaks on active session; sorts once, iterates correctly. (P03)

### UI & Controls
- **Edit message state consistency** — `edit_message_prefill` now also truncates webview state's `messages` array via `.splice()`, keeping it consistent with the session store. (P07)
- **Revert button** — Assistant messages now have a revert button (undo icon) that calls `sessionManager.revertMessage()`. (P07)
- **Checkpoint created indicator** — `diff_result` includes `checkpointCreated` flag; webview shows "Checkpoint saved" system message. (P07)
- **Edit button uses cached vscode API** — Instead of calling `acquireVsCodeApi()` on every click, uses `opts?.postMessage` from `RenderOptions`. (P07)
- **Avatars removed from messages** — Both user and assistant avatars removed. User/model differentiation uses distinct background colors, bubble styles, and role label coloring (user gets accent, model gets foreground). Cleaned up `OC_LOGO_SVG` and `USER_AVATAR_SVG` imports.
- **Unified mode dropdown replaces three separate buttons** — `Plan`, `Auto`, `Build` modes now in a single dropdown with per-mode SVG icons, colored backdrops using VS Code theme tokens (`--vscode-debugIcon-startForeground`, `--vscode-testing-iconPassed`, `--vscode-debugIcon-continueForeground`). WCAG AA compliant with proper `aria-haspopup`, `aria-expanded`, `role="listbox"`, keyboard navigation, and forced-colors support.
- **Mode sizing consistency** — `.mode-dropdown-btn` updated to match `.model-selector-btn` dimensions (`min-height: var(--size-target-comfortable)`, matching padding, border-radius, and font-size).
- **Auto mode warning improved, Build warning removed** — Warning modal now only shows when switching from Plan to Auto. Build mode switches immediately. Warning modal UI improved with accent-colored checkbox and danger-colored confirm button.
- **Context chip styling enhanced** — Stronger backdrop using `var(--vscode-badge-background/foreground)` tokens, paperclip indicator, subtle shadow, larger touch target (`min-height: 26px`).
- **Mention chip styling enhanced** — Per-kind colors using theme variables, subtle shadows, bold weight, `@` prefix via `::before` pseudo-element.
- **Attachment chip styling enhanced** — Larger thumbnails (56×56), hover scale effect, accent border on hover, paperclip indicator, layered remove button with red hover.
- **Stop button fixed** — `sendMessage()` now correctly calls `abortStream()` when streaming instead of `enqueuePrompt(text)`, so the stop button actually aborts generation.
- **Edit message button fixed** — Added missing `sessionId: msg.sessionId` to `edit_message` payload so `ChatProvider` handler can route it.
- **Revert message button fixed** — Added missing `sessionId: msg.sessionId` to `revert_message` payload.
- **Manage models modal close button** — Moved from absolute-positioned overlay into the modal header as part of a flex row alongside the connect button, eliminating overlap.
- **Markdown rendering safeguard** — `handleStreamEnd` now renders markdown directly into the streaming text element via `innerHTML = sanitizeHtml(renderMarkdown(text))` before calling `reRenderMessage`, ensuring `**bold**` never appears literally even if the re-render lookup fails.
- **`.markdown-content strong`** — Increased from `font-weight: 600` to `700` for more visible bold rendering.

### Prompt Queue (P08)
- **Per-tab queue** — Each tab gets its own `PromptQueue` instance. Items auto-advance on `stream_end` (unless aborted).
- **Queue states** — `queued → sending → streaming → completed | failed`
- **Image attachments in queue** — `QueueItem` includes `attachments: Attachment[]`; queued prompts preserve pasted images.
- **Queue UI** — Chips with state badges, click-to-edit on queued items, retry on failed items, clear-all when >1 queued, hint text below input.
- **Tab-close cleanup** — Queue cleared on tab close.
- **Slash command** — `/queue` shows queue status.

### Slash Commands (P06)
- **Duplicate implementation removed** — `SLASH_COMMANDS` array, `renderSlashAutocomplete`, `updateSlashAutocomplete`, `hideSlashAutocomplete`, `selectSlashItem` all removed from `main.ts`.
- **Single source of truth** — `LOCAL_COMMANDS` in `mentions.ts` is the sole slash command registry.
- **SVG icons** — All command icons use SVG constants from `icons.ts` (COMMAND_SVG, BRAIN_SVG, etc.) instead of emoji codepoints.
- **Server commands use GEAR_SVG** — `updateServerCommands` now uses `GEAR_SVG` instead of `\u2699` emoji.

### Accessibility (P05, P10)
- **Aria-labels on all controls** — Added `aria-label` to `model-selector-btn` and `variant-selector-btn`.
- **Focus trap** — Session modal now traps Tab cycling and restores focus on close.
- **Reduced motion** — `prefers-reduced-motion` media query disables all animations.
- **High contrast** — `forced-colors` media query with CanvasText/ButtonText system keywords.

### Regression Testing (P11)
- **14 regression suites** covering all 22 main user flows: activation, streaming, persistence, tabs, slash commands, edit, diff/checkpoint, archive/delete, security, performance, queue, accessibility, packaging.
- **Test data builders** — `buildMessage()`, `buildSession()`, `buildQueueItem()`, `buildServerEvent()` for use in tests.
- **Streaming timeout regression suite** (P02-fix) — 19 new behavioral tests verifying TTFB timeout, completion timeout, double-finalize guard, session-scoped error routing, placeholder cleanup, and concurrency-limit state reset.

### Fixed
- **Critical: EventNormalizer silently dropped all chunks when `message.part.delta` arrived before `message.updated`** — The normalizer required `messageRoles.get(messageId) === "assistant"`, but the role is only set by `message.updated`. If the server sent chunks before the role event (common in fast responses), all chunks were silently discarded and the user saw "no output of any sort". Changed `isAssistantMessage` to assume unknown message IDs are assistant messages (the SSE stream only carries assistant parts). (P02-fix)
- **Critical: Double `finalizeStream` race** — Both `message_complete` and `server_status idle` could call `finalizeStream()` concurrently, causing duplicate assistant messages and DOM corruption. Added `finalizingTabs` Set atomic guard. (P02-fix)
- **Critical: `postRequestError` missing sessionId** — Errors were routed to the first streaming tab, breaking multi-tab error attribution. `postRequestError` now accepts and forwards `sessionId`. (P02-fix)
- **Critical: Unknown session `server_error` silently dropped** — If a server event arrived for an unmapped `cliSessionId`, the error was logged but never shown to the user. Now falls back to the active tab. (P02-fix)
- **Critical: Assistant placeholder orphaned on early error** — If `sendPromptAsync` threw before the first chunk, the empty assistant placeholder persisted forever in the DOM and message array. `startPrompt` now emits `stream_end` with `reason: "error"` before `postRequestError`, and the webview removes empty placeholders. (P02-fix)
- **Critical: Concurrency limit leaves webview stuck** — When `canStartStreaming()` rejected, the webview stayed in `isStreaming = true` with a disabled send button. Now emits `prompt_rejected` to reset webview state. (P02-fix)
- **Critical: `attach_image` handler was a no-op** — The webview message handler for image attachments only called `log.info()` and never invoked `handleAttachImage()`. Pasted/screenshot images were silently dropped. Now correctly attached as user messages with base64 data.
- **Critical: `tab!` non-null assertion in server events** — `handleServerEvent()` used `tab!` which would crash if a server event arrived for an unknown CLI session (e.g., after manual server restart). Changed to `tab ?? undefined` with safe optional dispatch.
- **Critical: Checkpoints never created (rollback broken)** — `CheckpointManager.snapshotBeforeAction()` was never called from any production code path. The rollback command always showed "No checkpoints available." Now wired into `ChatProvider.handleAcceptDiff()` so every accepted diff creates a pre-action checkpoint.
- **Unhandled promise rejections** — Added `process.on("unhandledRejection")` handler to the extension host. Added `.catch()` to 4 void promise call sites: `extension.ts` model refresh on connect, `ChatProvider.ts` abort on close, `StreamCoordinator.ts` watchdog finalize, `StreamCoordinator.ts` timeout finalize.
- **Activation failure handling** — Wrapped `activate()` in a top-level try/catch. Shows a user-facing error message with "Reload Window" action if activation fails.
- **Inline code action handlers** — Wrapped `explainCode`/`refactorCode`/`generateTests` handlers in try/catch with user-friendly error messages. Added missing `await` on `executeCommand` and `sendPromptToWebview`.
- **Active streams not aborted on panel close** — `onDidDispose` now iterates all streaming tabs and calls `streamCoordinator.abort()` for each. Previously, closing the chat panel left server-side sessions running, consuming compute and tokens.
- **`ChatProvider.dispose()` completeness** — Added disposal of `MessageRouter`, `ChatCommands`, `AutoCompactor`, `ChatFileOps`, `DiffApplier`, and `WebviewContent` with `?.dispose()` stubs.
- **ESLint config dependency** — `eslint-config-prettier` was referenced in `.eslintrc.json` but not installed. Installed as dev dependency.

### Changed
- **Paste listener scoped to input** — Changed from `document.addEventListener("paste", ...)` to `els.promptInput.addEventListener("paste", ...)`. Prevents intercepting paste operations in search input, modals, and other elements.
- **`activate()` error resilience** — Now uses top-level try/catch with user-facing error message and "Reload Window" option. Previously, any constructor throw would show a generic VS Code activation error.
- **`sendPromptAsync` timeout finalize** — Now explicitly caught with `.catch()` instead of fire-and-forget `void`.
- **`finalizeStream` watchdog/timeout calls** — Now explicitly caught with `.catch()` for safe error logging.

### Added
- **`opencode.debugLogging` setting** — New boolean configuration (default: false) gates debug output in the extension channel. When enabled, `debug()` messages appear alongside info/warn/error output.
- **`docs/approved-packages.md`** — Dependency registry documenting all approved runtime and dev dependencies with their purposes.
- **`docs/configuration.md` documentation** — Added `opencode.debugLogging` setting reference.
- **Tab panel ARIA roles** — Dynamically created tab panels now get `role="tabpanel"`, `id="panel-{id}"`, and `aria-labelledby="tab-{id}"`. Tab buttons get `aria-controls="panel-{id}"` and `id="tab-{id}"`.
- **`aria-label` on chip remove buttons** — Added to `.context-chip-remove` ("Remove context chip") and `.attachment-chip-remove` ("Remove attachment").
- **`aria-label` on model manager close** — All icon buttons now have proper `aria-label` attributes.
- **`FileReader.onerror` handler** — Added to image paste handler in webview. Reports failure to console.
- **Model dropdown sync on tab switch** — `switchTab()` now updates the model dropdown to reflect the active session's model.
- **Global unhandledRejection handler** — Registered at activation to catch any unhandled promise rejections in the extension host.

### Accessibility
- **`mode-btn:focus-visible` standardized** — Changed from `1px solid var(--vscode-focusBorder)` with `-2px` offset to `2px solid var(--color-accent)` with `2px` offset, matching the global focus-visible ring standard.
- **Touch target sizes** — Enlarged `.attachment-chip-remove` from 18×18px to 24×24px, `.model-manager-toggle` height from 20px to 24px, `.context-chip-remove` pseudo-element inset from -4px to -5px. All now meet WCAG 2.5.5 minimum.
- **Tab `tabpanel` ARIA** — Added `role="tabpanel"` to all dynamically created tab content panels with proper `aria-labelledby` linking back to the controlling tab.
- **Custom property validation** — `applyThemeVars` logs warnings for non-`--` prefixed keys and blocked CSS values (cats already existed, warnings added for debugging).

### Webview
- **Init failure handling** — `webview_ready` message is now only posted when `init()` succeeds. On failure, a `webview_error` message is sent to the extension host so it can show a reload prompt.

## [0.2.0] - 2026-05-04

### Added
- **Premium 12-Phase UI Redesign** — Complete visual overhaul of the webview chat interface:
  - **Design System** (`tokens.css`): Unified `--color-accent`, tool-specific colors (read/write/exec/error/meta), background layers (92%/84% steps), shadow/z-index tokens
  - **Message Bubbles**: User bubbles with tail accent, assistant full-width with left border, turn spacing (8px consecutive / 20px role change), avatars on first message only, relative timestamps ("just now", "5 min ago")
  - **Tool Calls**: Class-colored cards with summary rows (icon + name + key argument + status pill + duration), expandable input/output panels with syntax-highlighted JSON
  - **Input Area**: Clean container with `:focus-within` accent glow, `field-sizing: content` textarea (44px–168px), send/stop button crossfade, mention chips with overflow ellipsis
  - **Connected Tab Bar**: Active tab bleeds into panel, streaming indicator with pulsing dot, APG keyboard navigation (Arrow/Home/End/Tab)
  - **Welcome Screen**: Real `opencode-wordmark-dark.svg` (120px), tagline "Your intelligent coding assistant", vertical prompt starter cards with hover lift
  - **Diff Blocks**: Sticky action bar with backdrop blur, Accept (filled primary) / Discard (ghost error) / Open File (ghost tertiary), accepted/discarded state chips with auto-collapse
  - **Motion Design**: Single-source `animations.css` — `message-enter`, `cursor-blink`, `streaming-pulse`, `badge-pop`, `press-effect`, stagger utilities
  - **Accessibility**: `focus-visible` rings (2px solid, offset 2px), 24×24 touch targets, `prefers-reduced-motion` blanket override, `forced-colors: active` Highlight override, skip link
  - **Colour Contrast**: WCAG 2.2 AA verified across all token combinations
  - **Responsive Layout**: Message bubbles `min(82%, 520px)`, tab bar horizontal scroll, graceful collapses at 220px sidebar
- **Model Manager Panel** (`model-manager.ts`): Modal overlay with search, provider grouping, toggle switches per model, "Connect provider" button. Filters dropdown to enabled models only. Keyboard support (Escape to close).
- **Premium Icon Set** (`icons.ts`): Centralized 30+ SVG icons with consistent 1.5px stroke, rounded caps/joins, `viewBox="0 0 24 24"`. Imported by `renderer.ts`, `stream.ts`, `main.ts`, `model-dropdown.ts`.
- **61 real behavioral tests** — replacing text-grep pattern. Covers SessionStore, EventNormalizer, DiffApplier, mode normalization, and map size limiting with actual function calls and assertions.
- **Empty session filtering** — `SessionStore.flush()` now skips sessions with zero messages. Sessions without interactions are no longer persisted to `globalState`.

### Fixed (continued)
- **All buttons stopped working** — `requireElement("recent-sessions")` threw because the element was removed from the static HTML template during `vscode-tabs` replacement. Changed to `optionalElement` with null guards. The crash prevented `setupButtons()` from ever running.
- **Empty sessions persisted** — `create()` called `save()` immediately, writing empty sessions to `globalState`. Now `flush()` filters sessions with no messages before persisting.

### Breaking
- **All `@vscode-elements/elements` components removed** — replaced with plain HTML elements:
  - `vscode-tabs` → custom `<div id="tab-bar">` + `<div id="tab-panels">`
  - `vscode-tab-header` / `vscode-tab-panel` → `.tab-btn` / `.tab-panel`
  - `vscode-button` → `<button class="icon-btn">`, `<button class="send-btn">`, `<button class="abort-btn">`, `<button class="suggestion-card">`
  - `vscode-progress-ring` → CSS `.typing-spinner` with `@keyframes spin`
  - `bundled.js` (vscode-elements bundle) removed from build
  - `TOOLKIT_BASE_CSS` updated to reference plain HTML selectors
  - esbuild no longer copies `bundled.js` to dist

### Fixed
- **Tab bar layout** — replaced `vscode-tabs` (Shadow DOM, unstyleable) with custom tab bar using plain `<button>` elements. Tabs render left-to-right at the top of the webview. Newest/active tab is leftmost.
- **No tabs on startup** — welcome screen shown first; tabs created only on user action (send, new, resume)
- **Tab close button** — event delegation on custom tab bar, all close buttons work including dynamically created ones
- **Welcome screen never removed** — `stream.ts` was looking for `.welcome-message` (wrong class); fixed to `.welcome-container`
- **Model response not shown** — `sendMessage()` now calls `createTabUI()` to ensure a tab panel exists before sending a prompt
- **Skill badge spam** — `skill_load` events changed from full chat messages to compact `skill_indicator` pills that auto-remove after 3 seconds
- **Mention dropdown out of bounds** — positioned above the textarea (`bottom: calc(100% + 4px)`) instead of below
- **Model dropdown out of bounds** — `position: absolute` with `max-height: 320px` and `overflow-y: auto`
- **Mode toggle styling** — plain `<button>` elements with `.active` class, VS Code theme color variables, proper `role="radio"` ARIA
- **Send button styling** — plain `<button>` with VS Code theme colors, streaming spinner via CSS `::after`
- **Abort button styling** — plain `<button>` with error color, proper hover states
- **Toolkit imports** — removed dead `import "./toolkit"` from main.ts
- **Test files** — updated all text-grep tests to match new code
- **Abort button merged into send button** — removed separate `#abort-btn` element; stop functionality toggles via `.stopping` class on send button. Fixes crash from `requireElement("abort-btn")` throwing when element didn't exist.

### Added
- **Session history modal** — proper overlay with backdrop blur, click-outside-to-close, Escape key support. Lists all saved sessions with name, message count, date, and cost. Click to resume.
- **Custom tab bar** — horizontal flex layout, active tab has accent-colored bottom border, streaming tab has animated green pulsing dot, close button fades in on hover
- **Typing spinner animation** — CSS-only spinner replaces `vscode-progress-ring`
- **`switchToTab()` and `removeTabContent()`** — added to tabs.ts for managing plain HTML tab panels
- **`setupSessionModal()`** — modal lifecycle management in main.ts

### Removed
- `@vscode-elements/elements` `bundled.js` from esbuild copy step
- `bundled.js` `<script>` tag from index.html
- `vscode-button`, `vscode-tab-header`, `vscode-tab-panel`, `vscode-progress-ring` from HTML/CSS/JS
- `TOOLKIT_BASE_CSS` vscode component references
- Dead `import "./toolkit"` from main.ts
- `bundled.js` URI resolution from WebviewContent.ts

### Security
- `.env` and `coverage/` added to `.gitignore` to prevent accidental secret commits
- `process.env` filtered to allowlist (PATH, HOME, LANG, etc.) before passing to child processes — prevents API key leakage
- CSS custom property injection blocked: `applyThemeVars` validates keys start with `--` and blocks `url()`/`expression()` values
- CSP nonces now use `crypto.randomBytes(32)` instead of `Math.random()` (non-cryptographic)
- Binary path validation added to `ModelManager.fetchModelsFromCli()` — matches `CliDiagnostics.resolveBinaryPath()` pattern

### Fixed
- **Critical: Circular self-import** in `SessionRepository.ts` — imported `OpenCodeSession` from itself instead of `SessionStore`
- **Critical: Dead code** `ChatService.ts` removed — never called server, zero consumers, caused compilation error
- **Critical: Global `promptInFlight` lock** replaced with per-tab `promptsInFlight Set` — multi-tab concurrent streaming now works
- **Critical: `EventNormalizer` unbounded memory** — 7 internal Maps now trimmed at 10,000 entries each
- **Critical: `sendPromptAsync` retried ALL exceptions** — now only retries network/timeout errors, business logic errors fail immediately
- **Critical: `DiffHandler.accept()` double-apply race** — atomic `acceptingDiffs` Set prevents concurrent accept on same diff
- **Critical: Webview HTML template crash** — fallback error page rendered when `index.html` is missing or corrupted
- **Critical: Floating promises** — `.catch()` added to 6 `void this.finalizeStream(...)` calls
- **Critical: Stream limit race condition** — streaming slot reserved synchronously before async context gathering
- **Critical: Orphaned placeholder messages** — `handleRequestError` removes placeholder created by `handleStreamStart`
- **Critical: `SessionStore` memento corruption** — schema validation (`isValidSession`) added on `globalState` load
- **Critical: `noUncheckedIndexedAccess` enabled** — fixed 40 potential `undefined` access crashes across 20 files
- **Build/Plan mode buttons** — incorrectly used `setAttribute("appearance", ...)` which is ignored by `<vscode-button>`; now uses `.secondary = boolean` property and proper `--vscode-button-*` CSS custom properties
- **RateLimitMonitor config listener** — now stored as `configListener` and properly disposed
- **CheckpointManager concurrency** — `snapshotLock` prevents concurrent snapshot/restore operations without mutating git branches or stashes
- **TabManager max tabs** — capped at 20 to prevent unbounded memory growth
- **NaN cost values** — validated with `Number.isFinite()` in `update_cost` handler
- **`StreamCoordinator.buildContextText`** — typed from `any` to proper `ContextShape` interface

### Added
- Behavioral unit tests for mode normalization (13 tests, actual function-calling)
- Enhanced integration tests covering mode validation, webview payload format, send button rules, extension lifecycle
- CI workflow expanded to 3 jobs (typecheck+unit, integration with xvfb, visual with Playwright)
- `ContextShape` interface for type-safe context package processing

### Changed
- Unit test count: 363 (was 372 — ChatService test removed with dead code)
- Type check: zero errors (was 3 compilation + 40 noUncheckedIndexedAccess)

## [0.1.0] - 2026-05-04

### Added
- Slash commands: /clear, /model, /cost, /new, /export, /compact, /continue, /help
- Export conversation as Markdown (via command palette or /export slash command)
- Compact conversation support (/compact - sends summarization prompt)
- Continue from last message (/continue - re-sends last user message)
- Activation events for lazy loading (extension no longer activates on startup)
- Defensive null guards in DOM element lookup (optionalElement helper)

### Changed
- User messages are now persisted to SessionStore immediately on send (no more lost messages on webview reload)
- Plan/Build mode toggle redesigned as proper button group with visual active state
- Status bar cleaned up: removed duplicate Model, Context Monitor, and CLI Diagnostics items
- Marketplace category "AI" changed to "Machine Learning" for compliance
- Version bumped to 0.1.0

### Removed
- Speculative diff detection (code fences no longer create phantom "edited file" banners)
- SessionTreeProvider (dead code - never registered)
- SkillManager instantiation (dead code - never wired up)
- Duplicate webview element references (newChatBtn, recentList, viewAllSessionsBtn)
- Old session picker HTML section (replaced by dynamic renderRecentSessions)

### Fixed
- Webview initialization crash: `viewAllSessionsBtn` element ID missing from HTML
- webview_ready not being posted on init failure (now guarded with try/catch)
- SessionStore.save() now wrapped in try/catch to prevent silent failures
- Mode toggle CSS now uses .mode-toggle-group div for reliable layout

## [0.0.1] - 2026-05-03

### Added
- Initial release of the OpenCode VS Code extension harness
- Chat sidebar with streaming AI responses via OpenCode CLI
- Multi-tab session management with persistent history
- Model picker with provider/model selection (no server restart needed)
- Agent mode toggle (Normal / Plan / Build)
- Inline CodeLens actions (Explain, Refactor, Generate Tests)
- `@mention` context system for files, symbols, and terminals
- Diff preview with accept/reject in chat
- Permission request handling for CLI tool calls
- Theme integration with VS Code (dark, light, high-contrast)
- CLI theme file discovery (`~/.config/opencode/themes/`)
- Session tree view for browsing saved conversations
- Context usage monitoring with progress bar
- Rate limit monitoring and warnings
- Checkpoint/rollback support
- URI handler for deep links (`vscode://opencode-harness?prompt=...`)
- Keyboard shortcuts for common actions
- Configurable settings (binary path, theme, model, context options)

### Security
- Binary path validation (absolute paths only, shell metacharacters rejected)
- `shell: false` on all `child_process.spawn` calls
- Path traversal protection in CLI theme name resolution
- Input validation on all webview messages
- Content Security Policy configured in webview
- No hardcoded secrets or credentials

### Fixed
- Missing commands in Command Palette (`openChat`, `toggleFocus`, `insertMention`, `showRateLimits`)
- CSS theming fallbacks for all 19 custom properties
- ThemeManager synchronous file system reads replaced with 30s TTL cache
- Undefined CSS value filtering to prevent literal "undefined" injection
- Error boundaries on all command handlers to prevent unhandled promise rejections
- Race condition guard on concurrent `SessionManager.start()` calls
- Graceful server shutdown with SIGTERM → SIGKILL fallback
