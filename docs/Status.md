# opencode-harness — Status

**Last Updated:** 2026-06-26
**Version:** v0.4.14

## Highlights (2026-06-26) — Reconnection state sync & UI/UX improvements

**Closed all identified gaps in connection/reconnection handling and improved
context tray / drag-and-drop UX.**

### Reconnection state sync

- **Status bar preserves "running" on reconnect** — `wireRunningIndicator`
  now subscribes to `event_stream_reconnected` / `server_connected` /
  `server_disconnected` events and re-evaluates the streaming count. The
  indicator no longer reverts to "Connected" when sessions are still active.
- **CLI session IDs restored** — `event_stream_reconnected` re-registers
  CLI session IDs from `TabManager` into `SessionStore` so `get_todos` and
  other server-fetch handlers don't silently fail after
  `server_disconnected` invalidated them.
- **Per-tab `server_status` re-pushed** — `reconcileAfterReconnect` now
  pushes `idle` or `thinking` for reconciled tabs; non-candidate tabs get
  `idle` from the reconnect handler.
- **`streaming_state: false` re-pushed** for non-streaming tabs in case the
  webview missed the `server_disconnected` clear.
- **Stale permissions cleared** — `reconnect_sync` clears
  `pendingPermissionBySession` and hides the permission bar.
- **Question bar reconciled** — `reconnect_sync` calls
  `questionBar.repopulateFromMessages()` and `reconcileBar()`.

Files: `src/extension.ts`, `src/chat/ChatProvider.ts`,
`src/chat/handlers/StreamCoordinator.ts`, `src/chat/webview/main.ts`,
`tests/unit/streaming-state-stability.test.mjs`.

### UI/UX improvements

- **Active file safety guards** — `ActiveFileTracker` skips binary files
  and files > 1 MB with a `reason` field for the webview.
- **Folder context type** — `picked_folder` added to `ContextItemType`;
  `WorkspaceFileIndex` now indexes directories.
- **XML/YAML document icons** — extension-based icon fallback via
  `getIconForFile()`.
- **Toggleable context chips** — `ContextChip.onToggle` / `isIncluded`
  with eye/eye-off toggle button.
- **Pill-style document attachments** — compact pill layout for non-image
  attachments.
- **Drag-and-drop overlay reliability** — `isOutsideApp()` check on
  `dragleave`, `forceHideOverlay()`, emergency hide timeout.
- **Diff line numbers** — `getFileHunks` exposes `oldStart` / `newStart`;
  `WebviewEventRouter` initializes counters from hunk positions.
- **Edit/patch/apply tool cards** — `isEditLikeTool` detects by name
  (`edit`, `write`, `patch`, `apply`) in addition to `class: "write"`.

Files: `src/chat/ActiveFileTracker.ts`, `src/chat/WorkspaceFileIndex.ts`,
`src/chat/WebviewEventRouter.ts`, `src/chat/diff/hunkRevertPlan.ts`,
`src/chat/webview/types.ts`, `src/chat/webview/theme.ts`,
`src/chat/webview/icons.ts`, `src/chat/webview/ui/attachments.ts`,
`src/chat/webview/ui/dragDrop.ts`, `src/chat/webview/css/components.css`,
`src/chat/webview/css/layout.css`, `src/chat/webview/fileEditCard.ts`.

Verification: typecheck clean; build clean; unit tests 1966/1966 pass;
eslint clean.

## Highlights (2026-06-24) — Changed-files strip interaction fix

**Fixed the changed-files strip being unclickable.** The strip (`#changed-files-strip`)
was rendered underneath the sticky composer (`#input-area`) because the composer created a
stacking context at z-index 110 while the strip was at z-index 100. Raising the strip would
have blocked the model, mode, and mention dropdowns that lived inside the composer.

Resolution: fixed-position dropdowns are now moved to a root-level `#dropdown-portal`
(`src/chat/webview/index.html`) so they participate in the root stacking order above the
strip. The strip's z-index was raised to `calc(var(--z-sticky) + 20)` (120) so it sits above
the composer but below the portaled dropdowns (150 / 201). The input area's `isolation: isolate`
was removed because it is no longer needed for dropdown containment. Visual regression tests
for the strip and all dropdowns pass; `npm run reinstall` is still needed to load the change
in the VS Code Extension Host.

Files: `src/chat/webview/index.html`, `src/chat/webview/css/layout.css`,
`src/chat/webview/css/context-usage.css`, `tests/visual/chat-context-usage.spec.ts`.

## Highlights (2026-06-23) — AttachedContextItem integration & document attachment support

**Rich context metadata for `send_prompt`.** The webview now tracks all context items
through the `AttachedContextItem` structure (`src/chat/webview/types.ts`) with fields for
`type`, `path`, `languageId`, `lineCount`, `selection`, `isActive`, and `tokenEstimate`.
The `send_prompt` message includes a `contextItems` array alongside the existing
`attachments` field. (`src/chat/webview/ui/attachments.ts`, `sendMessage.ts`, `types.ts`)

Key changes:

- **`AttachmentManager` interface** formalized with `getContextItems()`,
  `clearSentContextItems()`, `syncContextItemsWithPrompt()`, and `getContextSummary()`.
- **`@file:` injection restored** — active file path is prefixed into `sendText` so the
  backend resolves the file content. Paths with spaces are quoted.
- **Quote stripping fixed** in `syncContextItemsWithPrompt` — was only stripping the
  leading quote from `@file:"path with spaces"` tokens; now strips both.
- **Post-send cleanup** — `clearSentContextItems()` removes per-send items (picked files,
  images) while preserving the active file context item for the next send.
- **`isActive` flag consistency** — derived from `isActiveFileIncluded()` which checks both
  the toggle state and the dismissed set, so dismissed files are correctly excluded.
- **Selection in context items** — `updateActiveFileContextItem` now includes `selection`
  data when available.
- **Image/file attachments tracked as context items** — `attachImageBlob`/`attachFileBlob`
  call `addImageAttachment()` in parallel with the legacy `pendingAttachments` array.
  Chip removal also removes the corresponding context item.
- **Document MIME validation** — `attachFileBlob` validates against `ALLOWED_DOCUMENT_MIMES`
  before acceptance; `DOCUMENT_ICONS` renders type-specific emoji icons in attachment chips.
- **Dead code cleanup** — removed unused `AmbiguityInfo` import in `slashCommands.ts`,
  unused `root` variable in `WorkspaceFileIndex.ts`.
- **Verification:** tsc clean; build clean; 1951 tests pass / 0 fail / 1 skipped.

## Highlights (2026-06-21) — context-usage, composer chips, command cards & sidebar

**Dead-wire audit (Phase 1–4).** A top-down sweep for the "handlers exist but the inbound
`VALID_WEBVIEW_TYPES` gate rejects the message" anti-pattern found **six** dead-wired message
types — the whole prompt-template feature (`save_template`/`list_templates`/`delete_template`),
`save_message_as_template`, the changed-files **undo file** button (`undo_file`), and
`revert_all_files`. All are now allowlisted, and a regression guard asserts
handler⊆allowlist so the class can't recur. Also fixed tool-call **compact mode** reading a
static `false` baseline (now reads the live `displayPrefs` pref). (`WebviewEventRouter.ts`,
`messageRenderer.ts`, `displayPrefs.ts`)


Branch `cleanup/extension-refactor`. Webview/UX hardening pass (all changes are in the
webview bundle — require `npm run reinstall` to appear in-app):

- **Context-usage modal actions repaired.** *Compact context* posted an unhandled
  `compact_context` (now `compact_session`) and *Switch model* posted an unhandled
  `open_model_selector` (now a registered host handler that re-posts `open_model_manager`).
  Both previously no-op'd. (`context-usage-dropdown.ts`, `WebviewEventRouter.ts`)
- **Model-aware context bar.** The bar/dropdown recompute percent from `tokens / maxTokens`
  so multi-model sessions stay consistent after a window change. (`ui/tokenCostDisplay.ts`,
  `context-usage-dropdown.ts`)
- **Provider quota counter no longer stuck at "0 tok"** for proxy providers — falls back to
  the active session's cumulative `tokenUsage.total`. (`ui/tokenCostDisplay.ts`)
- **Composer mention chips.** Typed `@file:`/`@folder:`/`@url:`/image mentions now render as
  styled, per-kind chips (basename/hostname labels, image-vs-file icons, full-path tooltip)
  and refresh live on every edit. (`inputHandlers.ts`, `ui/attachments.ts`, `theme.ts`, css)
- **Live bash/command cards were stuck "RUNNING".** The card now sets `data-block-id` so the
  streaming layer can find it, and a dedicated `applyLiveCommandCardUpdate` updates its own
  structure in place (command text, output, status, footer). (`liveCommandCard.ts`,
  `streamHandlers.ts`)
- **Responsive tool cards.** Breakpoints now target the real classes (`.tool-call`,
  `.live-command-card`, …) instead of dead `.tool-card` selectors; command wraps on narrow
  consoles. (`css/messages-responsive.css`, `css/blocks.css`)
- **Sidebar panels.** Panel pin buttons use a pin icon (filled when pinned) instead of a
  star; Todos & Files spacing fixed (collapsed empty status container, first-line alignment);
  leading section icons added. (`index.html`, `css/components.css`, `css/layout.css`)
- **Verification:** tsc clean; mjs unit suite 1196 pass / 0 fail; all touched tsx suites green
  (incl. new tests for the mention parser and live-command-card updater).

## Highlights v0.4.8 (2026-06-20) — MCP command palette + session-title fixes + test-suite repair

- **MCP commands now appear under the MCP filter in the commands palette.**
  `SessionClient.listCommands()` hard-coded `source: "server"` for every entry,
  discarding the server's real `source` (`"command" | "mcp" | "skill"`), so
  MCP-provided commands — though executable — never matched the **MCP** chip in
  the commands modal. It also read `.data` off a response the SDK types as a bare
  `Array<Command>` (yielding `undefined` → an empty list). The method now
  preserves the reported source and accepts both the bare-array and legacy
  `{ location, data }` shapes. (`src/session/SessionClient.ts`)
- **Command-created sessions are no longer all titled "Tab session-".** Webview
  tab IDs are `session-<id>` and `"session-"` is exactly 8 characters, so
  `Tab ${sessionId.slice(0, 8)}` always produced the identical, useless title
  "Tab session-". `CommandExecutionService` now mirrors the normal send path:
  use the tab's own name, otherwise defer to the server's auto-title.
  (`src/chat/CommandExecutionService.ts`)
- **Test suite restored to fully green.** Repaired 16 pre-existing failures
  across 9 files — all brittle source-inspection / behavioural assertions left
  pointing at code that moved or changed shape in prior refactors (the
  `StartPromptConfig` object, `setupTerminalPanel`/`MarkdownWorkerClient`
  extraction, exec→live-command-card rendering, changed-files floating-modal →
  inline-panel). No source changes in that pass; behaviour was verified intact.
- **Verification**: `npm run lint` (tsc) clean; full unit suite green —
  **tsx 4237 pass / 0 fail, mjs 1004 pass / 0 fail**. New behavioural tests for
  both fixes (`tests/unit/session-client-list-commands.test.mjs`,
  `tests/unit/command-exec-session-title.test.mjs`).

## Highlights v0.4.7 (2026-06-20) — IDE warning cleanup + small-webview overflow

- **Cleared remaining IDE warnings** across the chat send-flow, webview renderers,
  and host wiring. Removed unused imports/destructured deps in `ChatProvider.ts`,
  `SessionManager.ts`, `StreamCoordinator.ts`, `composer.ts`, `sendLogic.ts`,
  `sendButton.ts`, `renderer.ts`, and `toolCallRenderer.ts`. Replaced `require()`
  style imports in `ChatProvider.ts` and `WebviewEventRouter.ts` with top-level ESM
  imports of `execSync`.
- **Tightened `any` types** in `composer.ts`, `sendLogic.ts`, `sendMessage.ts`,
  `streamHandlers.ts`, `renderer.ts`, and `toolCallRenderer.ts` with `unknown` /
  narrow structural types.
- **Fixed conversation-history search overflow** on the welcome screen
  (`welcome.css`) and added responsive breakpoints for the composer at `<=320px`
  / `<=280px` in `layout.css` so the send area remains usable in very narrow
  webviews.
- **Verification**: `npm run lint` (tsc) and `npx eslint` on the touched files
  are now clean; relevant webview/host tests pass.

## Highlights v0.4.4 (2026-06-20) — checkpoint restore-point rail

- **Snapshot-bearing parts are now surfaced as a "restore to here" rail** in the
  checkpoint panel. The pure collector in `src/checkpoint/restorePoints.ts` is no
  longer unused: `list_restore_points` derives `RestorePointView[]` from the
  local session messages, and clicking **Restore** calls `session.revert` with the
  exact `messageID` and optional `partID` for that snapshot.
- **Host-side wiring**: `SessionClient.revert(sessionId, messageID, partID?)`
  and `SessionManager.revert` expose the per-part revert coordinate; the
  WebviewEventRouter handles `list_restore_points` and `restore_point`.
- **Webview-side wiring**: `renderRestorePoints` in `fileTracking.ts` renders the
  rail inside the existing checkpoint panel; `buttonSetup.ts` requests restore
  points when the panel opens; `main.ts` receives `restore_points` and
  `restore_point_result` messages. Styling lives in `layout.css`.
- **Message contract documented** in `docs/webview-messages.md` under
  "Restore Points (audit §14.5)".
- **Tests**: `src/chat/webview/ui/restorePoints.test.ts` and
  `src/chat/WebviewEventRouter.restorePoints.test.ts`.

## Highlights v0.3.76 (2026-06-16) — marketplace icon redesign
**Version:** v0.3.76 (includes: opencode CLI auto-install, native local voice input, frontend overhaul, stream/dedicated-bar redesign)
**Audit:** `docs/adrs/2026-05-04-feature-parity-audit.md`
**TechSpec:** `docs/TechSpec.md`

## Highlights v0.3.76 (2026-06-16) — marketplace icon redesign (detail)

- **`media/opencode-icon-256.png` (the icon shown in the VS Code Marketplace
  and Extensions view, per `package.json`'s `icon` field) replaced** — the
  previous asset was a flat black square with a plain white rectangular
  cutout and no depth, which read as visually "too simple" next to other
  marketplace listings.
- New design keeps the **exact existing brand silhouette** (the
  frame-with-rectangular-cutout mark, officially commented as "OpenCode
  mark: single geometric O" in `media/opencode.svg`, also used by
  `media/opencode-activity.svg` and the in-product header logo in
  `src/chat/webview/index.html`) — elevated, not replaced.
- **Palette corrected to match the project's actual established brand
  assets**: `media/opencode-logo.svg` and `media/opencode-wordmark-dark.svg`
  use a neutral warm-charcoal/off-white palette (`#4B4646`/`#B7B1B1`/
  `#F1ECEC`), not blue. The new icon uses a deepened version of that same
  neutral family (a warm charcoal gradient badge with an off-white frame
  mark) instead of introducing an unrelated brand color.
- Added depth via a subtle corner sheen (radial highlight), a recessed
  "well" gradient inside the cutout, and a soft inset shadow/highlight pair
  at the cutout's top edge — flat, single-tone shapes elevated to a
  premium-feeling badge without adding new hues or animation.
- **Background is fully opaque and bakes in its own dark-charcoal backdrop**
  (not transparent), so the icon renders identically regardless of whether
  the surrounding VS Code/Marketplace chrome is in light or dark mode.
  Verified by compositing the rendered PNG over white, dark (`#1e1e1e`), and
  light-gray backdrops — confirmed legible and theme-agnostic in all three.
- Verified legible down to 32px (smallest realistic Extensions-list
  thumbnail size) via nearest-neighbor upscale inspection — the frame
  silhouette remains clearly readable.
- Added `media/opencode-icon.svg` as the editable vector source (the repo's
  existing convention for brand PNGs, e.g. `opencode-logo.svg` alongside its
  PNG exports) so the icon can be regenerated at any resolution in future.
- Out of scope (not touched): `media/opencode-icon-96.png` and
  `media/opencode-apple-touch-icon.png` carry the same dated flat style but
  are currently unreferenced anywhere in the codebase — the user's request
  was specifically about the marketplace/extension-store icon.

## Highlights v0.3.76 (2026-06-16) — streaming UI visual redesign

- **Streaming indicators upgraded from functional to polished**, reusing
  existing design tokens (`--oc-accent-glow`, `--oc-accent-border`) and the
  codebase's established box-shadow "ping ring" idiom (precedent:
  `subagent-highlight-pulse` in `blocks.css`, `message-flash` in
  `messages.css`) rather than inventing new colors or DOM nodes:
  - The assistant role dot and timeline-item dot (`pulse-active` keyframe,
    shared by both) now scale and emit an expanding glow ring instead of a
    flat opacity blink.
  - The streaming message bubble gets an ambient accent-colored box-shadow
    that breathes alongside its existing border-left color shift
    (`bubble-stream-pulse`).
  - Typing-indicator dots (`typing-bounce`) now scale and fade in addition
    to translating, and carry a static glow.
  - The stream cursor and `.streaming-text::after` caret switched from a
    hard `step-end` blink to an `ease-in-out` fade (mirrors VS Code's own
    native caret) and gained a small glow.
  - The previously dead-on-arrival `streaming-pulse` keyframe in
    `animations.css` (used by the tab-bar streaming indicator) had a no-op
    `transform: scale(1)` at both keyframe stops; it now actually scales
    and emits a glow ring.
  - All new `box-shadow`/`transform` properties are covered by existing
    `prefers-reduced-motion` and `forced-colors: active` rules (extended,
    not replaced) so the upgrade degrades safely in both modes.
  - Deliberately **not** touched: `question-bar.css` (interactive control
    surface — kept restrained so motion doesn't compete with clickable
    affordances) and the existing SVG-based premium spinner (already a
    separate, polished system).
  - Verified rendered correctly in a real browser (Playwright +
    `bypassCSP: true`, since the webview's strict CSP otherwise blocks the
    bundled stylesheet outside the extension host) — no regressions, no
    visual breakage.

## Highlights v0.3.76 (2026-06-16) — keyboard-shortcuts modal header fix

- **Keyboard-shortcuts modal header no longer collides with the table's
  sticky column headers.** `.keyboard-shortcuts-content` put `overflow-y:
  auto` directly on the container holding *both* the modal header (title +
  close button) and the shortcuts table, so the header scrolled away with
  the rest of the content. Meanwhile `.keyboard-shortcuts-table thead th`
  is `position: sticky; top: 0`, which sticks relative to the nearest
  scrolling ancestor — the same container — so the column-header row ended
  up sticking right where the modal header had just scrolled out from
  under it, visually overlapping the title and close button. Every other
  modal in this codebase (session history, API key) avoids this by giving
  the header a non-scrolling `.modal-body` sibling; the keyboard-shortcuts
  modal was the one outlier missing that wrapper. Fix:
  `setupKeyboardShortcutsModal` now wraps the table in a `.modal-body` div
  (reusing the existing `flex: 1; overflow-y: auto` rule already used by
  every other modal), and `.keyboard-shortcuts-content` no longer sets its
  own `overflow-y`. New regression coverage in
  `keyboardShortcutsModal.test.ts` asserts the header is not inside the
  scrolling body. Audited every other `position: sticky` usage in the
  webview CSS (sticky search box, sticky bottom composer, sticky diff
  action bar, sticky changed-files summary bar) — none share this bug,
  since each is the sole sticky element in its own scroll container.

## Highlights v0.3.76 (2026-06-16) — multi-tab session-attribution fixes

- **Question bar no longer bleeds across tabs.** Questions arriving via the
  live-stream tool-start path (`streamHandlers.ts` → `onQuestionBlock`) always
  carried an empty `block.sessionId`, because `handleStreamStart` creates the
  streaming `ChatMessage` with no `sessionId` field. `main.ts` called
  `questionBar.addQuestion(block, messageId)` with no third `sid` argument, so
  `addQuestion`'s fallback chain landed on `_activeSessionId` — whichever tab
  the user currently had open — silently misattributing a background tab's
  question to the viewed tab. The same gap existed in
  `questionBar.repopulateFromMessages`, called on tab switch *before*
  `setActiveSession(tabId)` runs for the new tab. Fix: thread the
  already-in-scope tab/session id through both call sites as `addQuestion`'s
  third argument. New regression coverage in `questionBar.session.test.ts`
  and `toolLifecycle.test.ts`.
- **Tab switching no longer snaps back to a stale tab.** `switch_tab` called
  `sessionStore.setActive` unconditionally, which always broadcasts
  `active_session_changed` back to the webview — but the webview already
  applies the switch locally before sending `switch_tab`, so this was a pure
  echo. Under rapid tab switching, a stale echo for an earlier switch could
  arrive after the user had already moved to a third tab, forcing a visible
  snap back to the superseded tab. `SessionStore.setActive` now takes a
  `{ silent: true }` option; the `switch_tab` handler in
  `WebviewEventRouter` uses it so the echo never fires. New regression
  coverage in `SessionStore.test.ts` and `WebviewEventRouter.test.ts`.
- **Permission bar no longer bleeds across tabs.** `permission_request`
  rendered the shared `#permission-bar` for whatever `sid` the host sent,
  with no check against the tab the user was actually viewing — a permission
  raised by a background tab's tool call popped up over the focused tab, and
  clicking Allow/Always/Deny resolved the *background* tab's permission while
  appearing to belong to the viewed one. A second request arriving from
  another tab would also silently overwrite the first tab's still-pending
  one, so switching back showed no bar at all and that tab's stream stayed
  stuck. Fix: a new `pendingPermissionBySession` map tracks one pending
  request per session; `permission_request` records into it unconditionally
  but only renders when the request's session matches the active one;
  `switchTab` restores the switched-to tab's pending request (if any) or
  hides the bar otherwise — mirroring the same per-session pattern already
  used to fix the question bar above. New regression coverage in
  `main.test.ts`; existing `renderer.test.ts` coverage updated to match the
  new shared `respond()` helper.

## Highlights v0.3.63 (2026-06-12) — navigation, wayfinding & Escape safety

Full audit + prioritized plan: `docs/specs/2026-06-12-navigation-audit-and-plan.md`. Architecture: `docs/adrs/ADR-015-navigation-escape-coordinator.md`.

- **Escape never aborts a running task by accident.** A central Escape
  coordinator (`escapeCoordinator.ts`) closes exactly the topmost open overlay
  per press (capture-phase, event consumed) and stops the active stream *only*
  when nothing is open. Replaces 12+ uncoordinated overlay handlers racing the
  destructive host-level `escape → stop` keybinding (now removed;
  `Ctrl+Shift+Escape` remains the always-on stop). Defers to combobox popups,
  unmanaged `aria-modal` dialogs, and text fields. Removed the `F1` hijack
  inside the chat view.
- **"Jump to Running Session" (`opencode-harness.jumpToRunningTask`).** One
  action to reach whatever the agent is doing: 0 running → pointer back to chat,
  1 → jump, several → streaming-first Quick Pick. The connection status-bar item
  shows `$(sync~spin) OpenCode: N running` while any tab streams and clicking it
  jumps there.
- **`OpenCode: View Sessions` is a real switcher again.** Picking a session now
  reveals the chat view and opens it as a tab (was a `setActive` + toast dead
  end). Items gain active/streaming codicons, streaming-first + MRU ordering,
  message count and relative recency. `openStoredSession` (argument-only) hidden
  from the palette.
- **Focus restoration (WCAG 2.4.3).** Keyboard-shortcuts modal now traps Tab and
  returns focus to its invoker; subagent detail Back/Close return focus to the
  originating card.
- **Tests.** `escapeCoordinator.test.ts` (14), `sessionQuickPick.test.ts` (10),
  `keyboardShortcutsModal.dom.test.ts` (4), status-bar tooltip + integration
  command coverage — RED→GREEN committed in sequence.

## Highlights v0.3.63 (2026-06-11) — slash/methodology/skills hardening

Plan + verified gap analysis: `.opencode/plans/2026-06-11-methodology-skills-slash-overhaul.md`. User/dev docs: `docs/slash-commands-and-methodology.md`.

- **Slash registry consolidation.** `LOCAL_SLASH_COMMANDS` gains `aliases`/`usage`/`category`; `/export-md` folded into `/export` as an alias; `/diagnose:generation` now discoverable in the dropdown/palette; `/help` table generated from the registry (`buildHelpTable()`) so it can never drift again; `mentions.ts` uses the shared, alias-aware `dedupServerCommands()`; mention trigger charset accepts `-`/`:`.
- **Slash-during-streaming guard.** `classifyComposerInput()` is the single composer routing decision; command-shaped input typed mid-stream is blocked with a clear error (input preserved) instead of being steer-leaked to the model as literal text.
- **Methodology guidance is now visible and overridable.** `StreamCoordinator` posts `methodology_selected` (was documented but never sent); the webview shows a session-scoped `◆ <label>` chip in the status strip; the VS Code status-bar lightbulb renders the *same* advice that was injected (removed the second, independent classification pass); new `/methodology [on|off]` toggles the now-typed `TabState.methodologyDisabled` (previously an unreachable unsafe-cast read).
- **Honesty cleanups.** Skills-modal toggle copy states it controls *suggestion* only (the opencode server loads skills on its own); removed 8 dead `opencode.methodology.*` settings that configured the never-executing cascade pipeline (only `enabled` remains).
- **Tests.** Registry/alias/help-table/classifier behavioral tests, structural guards for the single-classification-pass and typed opt-out invariants (RED→GREEN committed in sequence).

## Highlights v0.3.31 (2026-06-10) — multi-area bugfix & feature release

- **Subagents no longer stuck "Running".** Run finalize (`markRunComplete`/`markRunCancelled`) now terminalizes all active subagents with the run outcome; SDK `subtask` parts no longer mislabel the parent session as `childSessionId`; webview `restore()` terminalizes stale persisted `subagentActivities` on reload. See addendum in `docs/adrs/2026-06-06-subagent-as-first-class-entity.md`.
- **Subagent "Open session" navigation.** Cards and the detail view expose a one-click "Open session" button (when a child `sessionId` is known) → new `open_subagent_session` message imports the server child session and resumes it as a regular tab.
- **Question bar session isolation hardened.** `submitAllAnswers`, bar visibility, the count badge, submit-enable state and auto-dismiss are all scoped to the active session (another tab's selections can no longer be posted or wiped). `removeQuestion` resolves requestID-only acknowledgements; `updateQuestion` preserves `requestID` when a refreshed block omits it.
- **Token/cost accounting: host is source of truth.** `step_tokens`/final `token_usage` carry cumulative host totals; the webview SETs (`applyTokenUsageTotals`) instead of accumulating a parallel ledger — idempotent under SSE replay, consistent across tab switch/reopen. ADR: `docs/adrs/2026-06-10-token-accounting-host-source-of-truth.md`.
- **Commands tab copy actions fixed.** `navigator.clipboard` is absent in webviews (the old `?.`-chained call threw a TypeError); Copy/Copy-output now round-trip via the new validated `copy_text` message → `vscode.env.clipboard.writeText` + status-bar confirmation. Terminal/Re-run verified end-to-end.
- **Voice setup works on PEP 668 distros (Arch/CachyOS, Debian 12+, Fedora 38+).** Engine install priority: `uv tool install openai-whisper` > `pipx install openai-whisper` > pip (only on non-externally-managed Python) > **runnable uv bootstrap** (system package manager or official installer, then `uv tool install`) > manual hint. The bootstrap tier means "Run Setup" is now offered even before uv/pipx exist — previously the flow dead-ended on "Copy Instructions" on CachyOS. `uv pip install --system` removed (fails under PEP 668). ChatProvider probes `uv`/`pipx` and the stdlib `EXTERNALLY-MANAGED` marker. `commandExists`/spawn fall back to `~/.local/bin` where uv/pipx place `whisper`.
- **Conversation timeline + lazy history.** `more_messages` pages are now inserted into `session.messages` (deduped) and the timeline refreshes immediately; clicking a turn outside the loaded window expands condensed history or chases up to 3 `request_more_messages` pages and scrolls on arrival (`pendingTimelineScroll`); unloaded turns are dimmed (`timeline-item--unloaded`); the toggle gains a header-toolbar twin synced with the settings-menu entry and Ctrl+Alt+T.
- **Changed-files strip/dropdown.** Welcome-screen leak fixed (`refreshChangedFilesVisibility()` re-applies the guard on welcome show/hide). Strip redesigned as a contained widget surface with aggregate `+X −Y` totals (tabular-nums). Dropdown A/M/D badges, per-file stats and hunk lines themed via `--vscode-gitDecoration-*`/diff-editor tokens; stat columns fixed-width right-aligned; summary bar sticky.

## v0.3.29 Highlights (2026-06-09)

- **Streaming clarity & bug fixes.** `maxStreams` now included in capacity state (fixes "X/undefined" tab label). Tool group badges refresh on child state change so "Running" header doesn't persist after all children are "Done". State vocabulary aligned via new `isTerminalState()` in `toolState.ts`. `resetStreamState` clears `isStreaming`. `handleRunActivityUpdate` requires `streamingMessageId` before setting streaming. Duplicate `max-height` removed from tool group panels.
- **Question bar wired up.** The `questionBar.ts` module (HTML, CSS, and logic existed since `ebc0f0e`) is now integrated into the production webview. Questions from the model appear as interactive cards above the composer with option buttons, free-text inputs, multi-select support, submit/skip actions, and per-tab state isolation. `setActiveSession(tabId)` loaded on tab switch; `repopulateFromMessages()` restores pending questions after webview reload.
- **Terminal command display.** CSS for stdout/stderr split layout, exit-code badges (`-ok`/`-error`), scroll-bound terminal output, and overflow protection on tool headers. (`tool-command-output`, `tool-exit-code`, `tool-name`/`tool-header` overflow.)
- **Streaming-vs-done visual differentiation.** Assistant bubble left-border pulse animation during streaming. Running/pending tool calls get an animated accent left-border; completed tools get a static success border. Pulsing dot in the assistant message header during streaming. Composer background tints subtly. Respects `prefers-reduced-motion: reduce`.
- **Model/variant selector overflow.** `.model-selector-btn` capped at `14rem` and `.variant-selector-btn` at `10rem` with `text-overflow: ellipsis`.

## Highlights v0.3.27 (2026-06-09) — stream interruption + UI relocation

- **Stream interruption fixed + permission/question/rate-limit UI relocated** (2026-06-09):
  - **Stream no longer stops on permission/question/rate-limit.** `StreamCoordinator` now tracks `question` tool calls separately from regular tool calls — only removed from `activeToolCallIds` when `answered === true`. New `markQuestionAnswered()` method called from both `WebviewEventRouter` paths. `rate_limit_exhausted` during active stream shows bar only, no inline error card.
  - **Dedicated UI bars.** Interactive controls for questions, permissions, and rate-limits moved from the message stream to `#question-bar` (above input), `#permission-bar` (above input), and `#rate-limit-bar` (below input). Stream shows compact read-only pointers with hints.
  - **Permission requests ephemeral** — no longer persisted in the session transcript.
  - **Permission bar message type fix** — webview sent `permission_response` but host expected `accept_permission`, causing "Unknown webview message type" errors and stream timeouts.
  - **Subagent panel reliability overhaul** — five bugs fixed: (1) panel no longer auto-opens on every activity update, only when a new subagent ID appears; (2) completed subagents no longer stuck showing "Running" — root cause was `normalizeSubagentStatus` mapping unknown → pending/running in three places (webview, RunActivityTracker, ChatProvider), now all map to "unknown" (non-live); (3) detail view no longer overlaps other tab panes — moved inside `#subagent-panel` as a nested pane with `data-view` switching; (4) "Open in editor" button was a no-op placeholder — now creates a dedicated VS Code WebviewPanel in popout mode via `window.__OC_POPOUT__` and renders the subagent detail in a separate editor tab; (5) `activeSubagentCount` no longer counts `"unknown"` as active, preventing run finalization stalls.
  - **System messages redesigned** — orange gradient/emoji/shadow removed; replaced with subtle transparent container and thin left border accent.
  - Shared `.oc-card` model (`css/cards.css`) with severity modifiers (info/success/warning/error/critical/permission); `ErrorDisplay` rewritten class-based with theme SVG icons, collapsed-by-default technical details + Copy, and an in-place Details toggle. `.msg-error` compacted. See `docs/design/cards.md`.
  - Root-cause dedup: activity notices coalesce via `activitySignature`/`decideActivityCoalesce` + `SessionStore.appendOrCoalesceActivity` (`×N` repeat badge); a single generation failure now renders one card (`hasRecentErrorCard` suppresses the generic end-of-stream card; the raw error is no longer echoed in the bottom status).
  - Session-history "More actions" (⋯) menu fixed (new `--z-modal-menu` token so the body-portaled menu stacks above the modal). Context-usage bar can no longer appear on the welcome screen (`isWelcomeVisible` guard in `updateContextBarFromSession`).
  - Tests: `activityCoalesce` (11), `streamEndErrorPolicy` (7), `errorComponents.dom` (8), welcome-guard + modal z-index regressions.

- **Frontend overhaul — tool UX, JSON viewer, web search, error display, a11y** (2026-06-08):
  - **Tool group summary labels** — `buildGroupSummaryLabel()` in `groupSummary.ts` replaces raw class counts with human-readable text: "3 file reads, 1 command, 2 edits" in the collapsed tool group header.
  - **JSON viewer** — `jsonViewer.ts` renders object/array tool args as a collapsible DOM tree (up to 3 levels, Copy JSON button). A 10 KB size guard falls back to truncated plain text for large payloads, preventing DOM bloat on large file-write `content` args.
  - **Web search result cards** — `webSearchRenderer.ts` detects websearch/webfetch/fetch/brave_search/tavily/serper tools and renders structured JSON result arrays as domain+title+snippet cards. Unrecognized formats fall back to plain text (max 2000 chars).
  - **Write-class file action buttons** — "Open", "Copy path", and "Reveal in Explorer" appear inline on write/edit tool summaries. "Reveal in Explorer" wires through a new `reveal_in_explorer` webview message (added to `WebviewMessage` union, validated in `WebviewMessageValidator`, handled in `WebviewEventRouter`).
  - **Error display overhaul** — `handleStreamError` parses JSON error payloads through `mapOpencodeError()` before falling back to raw string. `renderErrorBlock` uses `humanizeErrorCode()` for codes like `QUOTA_EXCEEDED` → "Quota exceeded". Both Retry and Dismiss are always shown.
  - **Thinking block sub-type badges** — `classifyThinkingContent()` heuristic emits "Planning", "Tool selection", or "Reasoning" chip next to the Thinking label.
  - **Subagent keyboard navigation + aggregate stats** — `applyRovingTabindex()` wires ArrowUp/Down/Home/End keyboard nav across subagent cards. `renderAggregateStats()` inserts a `role="status"` stats bar: "3 subagents · 1 running · 2 done · 1m 23s". List has `role="listbox"`, items have `role="option"`.
  - **Semantic status CSS tokens** — `tokens.css` gains `--oc-status-running/success/error/warning/pending/cancelled` and `--oc-surface-elevated`.
  - **Responsive CSS fixes** — `.tool-arg { max-width: min(200px, 40%) }`; diff tables get `overflow-x: auto`; `.tool-file-actions` hides at ≤399px.
  - **New tests** — `jsonViewer.test.ts` (11 tests), `webSearchRenderer.test.ts` (14 tests); `toolGrouping.test.ts` updated for human-readable labels.

- **Native, fully local voice input** — the composer mic now records and transcribes **in the panel, on your machine** — no browser tab, no cloud, no API key (supersedes the ADR-012 browser-helper + OpenAI design). Because a VS Code webview can't access the mic (sandboxed iframe; `SpeechRecognition` is dead in Electron), the host records the default mic with an auto-detected tool (`rec`/sox → `arecord` → `ffmpeg`) and transcribes with a local engine (openai-whisper, or whisper.cpp with a model), both overridable via machine-scoped `opencode.voice.localCommand`/`recordCommand`. Lifecycle states (idle → starting → recording → transcribing → inserted/error), Escape/second-click to stop/cancel, append/replace insert, opt-in `autoSend`, and a graceful "not available" fallback. Capture sits behind injected `Recorder`/`Transcriber` interfaces so the flow is unit-tested with mocks. New settings `opencode.voice.*` (replacing `opencode.voiceInput.*`); removed the OpenAI key command, SecretStorage key, localhost helper server, and `media/voice-helper.html`. See ADR `docs/adrs/ADR-013-native-local-voice-input.md`, `docs/voice-input.md`. (`src/chat/voiceInputCore.ts`, `src/chat/voiceCapture.ts`, `src/chat/VoiceInputService.ts`, `src/chat/webview/voiceInput.ts`)
- **Automatic opencode CLI install** — the CLI is a hard requirement, but VS Code has no install-time hook, so the extension now detects a missing binary on activation and installs it. Default is **prompt-once** (Install / Manual Instructions / Not Now), with the choice remembered to avoid nagging; `opencode.autoInstall` (`prompt`|`auto`|`off`) controls it, and `OpenCode: Install CLI` triggers it on demand. macOS/Linux use the official installer (downloaded → validated → `bash <file>` with `shell:false`, no `curl | bash`; lands in `~/.opencode/bin`); Windows uses npm. See ADR `docs/adrs/2026-05-31-cli-auto-install.md`. (`src/install/`, `src/extension.ts`, `src/commands/misc.ts`)
- **Binary detection probes known install dirs** — `ServerLifecycle.findOpencodeBinary()` falls back from PATH to `~/.opencode/bin/opencode` and other common locations, fixing "installed but not detected" for GUI-launched editors whose PATH doesn't include the installer's directory. (`src/session/ServerLifecycle.ts`, `src/install/installPlan.ts`)

## v0.2.20 Highlights

- **Rate-limit/error-handler hardening** — four Critical-severity bugs closed in `errorHandler.ts` (jitter compounding, weak correlation IDs, repeated `acquireVsCodeApi`, mapper whitelist bypass); NaN-propagation eliminated in `RateLimitMonitor.ts` via `safeParseInt`; sliding-window data loss removed; division-by-zero in `quotaMonitor.ts` now returns `undefined` instead of 100%/`NaN`.
- **Pure-function extraction** — `rateLimitCore.ts` now hosts `safeParseInt`, `parseDuration`, all three rate-limit adapters, and their interfaces, separate from the `vscode`-dependent `RateLimitMonitor` class. Zero-impact on callers via re-exports.
- **Test coverage** — 43 new tests across `RateLimitMonitor.test.ts` (17 tests: helpers + adapters + NaN rejection) and `errorHandler.test.ts` (24 tests: classification, retry, jitter, correlation IDs, history, stats, config).
- **Plan / Build / Auto reliability** — user prompts no longer render as `PROPOSED PLAN`; Plan-mode prose styling is assistant-only. Mode changes are host-acknowledged before the dropdown updates, invalid modes are rejected, Auto warning persistence writes `opencode.autoModeConfirmed`, and the selector exposes tooltips plus `Ctrl/Cmd+Alt+1/2/3` shortcuts.
- **Plan-mode permission guard** — only direct edits/writes to `.opencode/plans/*.md` are allowed in Plan mode. Shell and external-directory permission requests remain rejected even if their pattern mentions a plan file.
- **Changed-Files panel no longer freezes during streaming** — rapid `changed_files_update` events are coalesced into one `requestAnimationFrame` render (was a full `innerHTML` tree rebuild per event); expand/collapse mutates only the affected row; the strip skips unchanged rebuilds; resize is rAF-throttled; previews build via `DocumentFragment`. Review finding: the inline diff accept/reject/apply pipeline is currently unreachable dead code (opencode applies edits server-side) — documented in CHANGELOG, left unwired pending a wire-or-remove decision. (`src/chat/webview/changed-files-dropdown.ts`)
- **"Question from model" block fixed** — model questions now render their text + all answer options and are interactive immediately (mid-stream), not just after `stream_end`. Args are normalized defensively (flat `{question,options}` and Claude-style nested `{questions:[…]}`) by the pure `parseQuestionArgs`; the block refreshes in place as input streams in, is persisted as a real `question` block, and supports multiple question groups + multi-select. Covered by `questionModel.test.ts`, `question-block.test.ts`, and `question-refresh.test.ts`. (`src/chat/webview/questionModel.ts`, `renderer.ts`, `streamHandlers.ts`, `streamEndHandler.ts`, `src/chat/handlers/StreamCoordinator.ts`, `src/session/sdkMessageConverter.ts`)

## v0.2.18 Highlights

- **Frontend streaming correctness** — duplicate persisted assistant messages eliminated (upsert-by-id); `stream_start` is now restartable for a new message id; inter-tool streamed text is no longer dropped at tool boundaries; placeholder removal no longer nukes tool-only turns.
- **Stable-tail streaming render (perf)** — the webview previously re-parsed the entire accumulated buffer on every flush (O(N·k), main thread, cache- and worker-bypassed). A new `LiveTextRenderer` freezes closed markdown blocks (rendered once, cache/worker-eligible) and re-parses only the unstable tail — near-linear, with text selection and `<details>` state surviving mid-stream. See ADR `docs/adrs/2026-05-29-stable-tail-streaming-render.md`.
- **Backfill dedup** — a single `hydrate()` path coalesces concurrent history fetches by `cliSessionId` (no double-fetch across tab-created + session-recovery paths); all pending sessions are processed instead of a fixed `slice(0, 10)`.
- **Branch consolidation** — merged `fix/commands-palette-routing`; resolved leftover merge-conflict markers committed by an earlier botched `show-thinking` merge (ModelManager / main.ts / toolGrouping); fixed a stale renderer streaming-markdown test.
- **Holds:** the syntect→WASM syntax highlighter remains scaffolded-but-inert (activates only when a Rust-enabled CI builds the `.wasm`).

## v0.2.15 Highlights

- **Context window resolves for models the server doesn't report `limit.context` for** — kimi-k2.5, deepseek-v4-flash-free, and most OSS/free-tier models silently lost their context bar in 0.2.13 because the override config was only consulted inside an `if (ctxWindow)` guard. The override now applies regardless, and `onDidChangeConfiguration` re-applies it live without an extension reload.
- **OpenRouter cross-provider fallback** — when our server returns no `limit.context`, the resolver consults a cached catalogue pulled from `https://openrouter.ai/api/v1/models`. Same model weights share the same window regardless of which provider hosts them, so kimi-k2.5 served by any host now resolves to OpenRouter's canonical entry. Catalogue is persisted to `globalState` with a 24h TTL and refreshed in the background; no hand-curated tables.
- **Clickable "set limit ⚙" affordance** — when both the server and OpenRouter come up empty, clicking the per-tab context monitor opens the `Set Context Window Override` dialog directly instead of showing a tooltip.

## v0.2.14 Highlights

- **Tool calls actually group into one row now** — the 0.2.12 CSS work shrank each tool row but consecutive tool calls still stacked one-per-line because (a) `groupConsecutiveToolCalls` treated every non-tool block (including silent SDK lifecycle blocks) as a group-breaker, and (b) the live-streaming append path bypassed the grouper entirely. The grouper now treats `step-start` and normal `step-finish` as transparent, and a new `appendOrFoldToolDOM` helper folds new tools into the prior `details.tool-group` (or wraps the prior single tool + new tool into a fresh group) at append time. The previous tool's live DOM is moved into the group rather than re-rendered, preserving runtime state (args/result/duration) that the update handlers write directly without going through msg.blocks.

## v0.2.13 Highlights

- **Removed the redundant "Step finished (tool-calls) — in:N out:N reasoning:N" chip rendered after every assistant step** — the renderer's normal-completion short-circuit only matched OpenAI-style underscore reasons (`tool_calls`, `end_turn`), but the SDK in practice emits hyphenated variants (`tool-calls`, `end-turn`), so the chip leaked into every step. `renderStepFinishBlock` now normalizes hyphens to underscores before the set lookup. Genuine non-normal finishes (`length`, `content_filter`, abort, errors) still render the chip so the user sees *why* a step ended unusually.

## v0.2.12 Highlights

- **Show-thinking toggle actually hides thinking blocks now** — previously it only collapsed each `<details>`, leaving the summary chip in the layout. The toggle drives a `hide-thinking` body class and CSS removes `.thinking-block` outright (`display: none`). `setupThinkingToggle()` also applies the persisted pref at boot, so a user's prior choice takes effect on the first load instead of requiring a double-click.
- **Codex-style compact tool blocks** — `.tool-call` no longer renders as a bordered card. Only the left accent stripe survives (so tool class is still color-coded), and `.tool-header` is a single-line row at `min-height: var(--size-target-min)` (24 px) with `text-xs` font. Multi-tool turns stack as a tight one-line log instead of a wall of cards.

## v0.2.11 Highlights

- **First prompt from welcome now sends and renders** — fixed the real blank-tab root cause: prompt context-chip updates were passing attachment-only refs into `updateContextChips`, throwing before `send_prompt` was posted. The send flow now renders the optimistic user message, shows the typing indicator, and posts `send_prompt` with the selected model. A Playwright contract test covers the rendered welcome → send path.
- **Model selection reaches pending tabs** — `ensureLocalTab` now refreshes existing tab model/mode state before stream start, so model selections made on the welcome page are reflected in the first prompt.
- **Empty placeholder sessions are transient again** — empty `pendingServerLink` sessions are no longer persisted/restored or exempt from close cleanup; only server imports awaiting backfill (`needsBackfill`) stay exempt while empty.
- **Changed-files UI is active-session scoped** — changed-file updates now refresh chips/todos only for the active session and clear stale chips when switching tabs.
- **Welcome recent-session delete uses the router contract** — recent delete actions post `targetSessionId`, matching `WebviewEventRouter` validation.
- **Send button silently blocked after extension restart (root cause for "messaging fails completely")** — the webview's persisted `vscode.setState()` snapshot preserved `isStreaming: true` for any session whose stream had been orphaned by a prior dropped `message_complete`. On reload, those stale flags inflated `getStreamCapacityState()` to report 3+ active streams; `sendMessage()` then bailed at its `if (streamCapacity.isFull)` guard *before* posting `send_prompt`. The user typed, pressed Enter, and nothing happened — no log line either. Fixed in `src/chat/webview/state.ts`: `restore()` now clears `isStreaming` on every session because no stream can possibly be in progress across a webview reload.
- **Speculative CLI session creation on resume** — `SessionLifecycleService.handleResumeSession` previously called `ensureSession(undefined)` for any tab without a `cliSessionId`, creating a fresh empty server session just to immediately query its 0 messages. Fix: only re-attach when a `cliSessionId` already exists; pending tabs wait for the first prompt to create the session via `StreamCoordinator`.

## v0.2.10 Highlights

- **Fixed silent event drop on first-message session create** — `ChatProvider.handleServerEvent` no longer drops `file_edited`, `tool_*`, or `message_complete` events that arrive in the race window between `session.create` resolving and `setCliSessionId(...)` running. Events are now buffered (5 s TTL, 200/session cap) and replayed on `TabManager.onCliSessionIdRegistered`. See `docs/adrs/ADR-009-pending-event-buffer.md`. This transitively also resolves the "send button stays disabled after first prompt" symptom — the stuck `isStreaming` flag was a downstream effect of the dropped `message_complete` event.
- **Welcome-page search button works again** — the magnifying-glass icon has `pointer-events: none` in CSS, so a click on the glyph delivered the event with `target === wrapper`. The click handler now triggers on any wrapper-targeted click except clicks on the inner input. Queried searches also surface sessions whose backfill has not yet landed, so users can find an unbacked-filled CLI session by name.
- **Image paste hardened** — the paste handler walks `DataTransferItemList` first, then falls back to `DataTransfer.files` (some Linux desktop clipboards put images only there), and skips past same-MIME entries whose `getAsFile()` returned null instead of bailing on the first MIME match. `preventDefault()` only fires once an image actually attaches.
- **Bounded backfill diagnostics** — after the 4-attempt retry budget is exhausted, `needsBackfill` is cleared on the affected sessions so subsequent `sessions_recovered` events stop re-trying and stop logging "Empty response …" lines. Per-tab "not backfilled" diagnostics are suppressed on the steady-state path.

## Test Summary

| Metric | v0.2.6 | v0.2.7 | v0.2.8 | v0.2.10 | v0.2.11 | v0.2.12 | Delta |
|--------|--------|--------|--------|---------|---------|---------|-------|
| Tests | 894 | 1466 | 1466 | 1585 | 1604 | 1746 | +142 |
| Passing | 893 | 1465 | 1466 | 1578 | 1597 | 1739 | +142 |
| Failing | 0 | 1 | 0 | 0 | 0 | 0 | — |
| Skipped | 1 | 7 | 7 | 7 | 7 | 7 | — |
| Typecheck | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Build | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |

The single failing test in v0.2.7 (`main.test.ts › timeline jumps use exact message-list scroll positioning`) was a stale source-grep assertion left over from the extraction of `scrollToTurn`/`scrollMessageToTop` into `src/chat/webview/ui/scrollMarkers.ts`. The test now reads from `scrollMarkersSource` where the implementation actually lives.

## Feature Parity (CLI → Extension) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 1 | Theming | ✅ | forced-colors media query, CLI discovery bugfix, 6 presets (incl. high-contrast-dark/light auto-resolved); light-theme bubble fix; consolidated advanced modal with preset cards, CLI theme search, 6 collapsible sections, live preview swatch; `deriveExtendedTheme` for compact CLI palette schema; workspace-save fallback to Global |
| 2 | Compaction | ✅ | autoCompact (ask/auto/off), snooze with 5% rearm, compact banner |
| 3 | Model Selection | ✅ | Server fetch + globalState cache, provider grouping, per-tab persistence, favorites/recents |
| 4 | Session History | ✅ | Auto-title, rename validation, delete confirmation, Markdown export |
| 5 | Slash Commands | ✅ | Unified autocomplete, 10 local commands, runtime server command routing, custom prompts |
| 6 | Permission Modes | ✅ | 3-mode selector (Plan/Build/Auto), host-acknowledged mode changes, Plan permission policy, assistant-only proposed-plan styling, Auto mode warning persistence, tooltips + `Ctrl/Cmd+Alt+1/2/3` shortcuts |
| 7 | Rate Limits | ✅ | OpenAI/Anthropic/Generic adapters, webview quota bar, VS Code status bar, observed usage fallback, configurable provider limits |
| 8 | Checkpoints | ✅ | VS Code file snapshots for extension-managed diff accepts, 20-checkpoint cap, `WorkspaceEdit` restore; OpenCode server-managed edits revert through `session.revert(messageID)` |
| 9 | UI Reliability | ✅ | Guarded stream finalization, late chunk recovery, right-side conversation timeline, markdown normalization, adaptive RenderQueue, tool deduplication, webview heartbeat, event stream reconnection, "Retry from here", tool grouping + keyboard nav |

## New Features (Extension-Only) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 10 | Navigation Timeline | ✅ | Scroll-tracker sidebar with message bubbles and tool markers |
| 11 | Tool/Skill Persistence | ✅ | Persistent badges for skills and tool calls in message list |
| 12 | Inline CodeLens Actions | ✅ | `InlineActionProvider` — CodeLens (Explain, Refactor, Generate Tests) on functions/classes |
| 13 | Image / Multimodal | ✅ | Clipboard paste → base64, thumbnail renderer, lightbox overlay |
| 14 | Drag & Drop | ✅ | Drop zone with highlight, `@file:` mention insertion |
| 15 | Code Block Actions | ✅ | Copy, Insert at Cursor, Create New File buttons |
| 16 | Message Editing | ✅ | Edit button, input prefill, downstream message clearing |
| 17 | Search in Conversation | ✅ | Ctrl+F bar, highlighting, prev/next navigation, 200ms debounce |
| 18 | Notifications | ✅ | Turn-complete notification when webview unfocused |
| 19 | Prompt Files | ✅ | `.opencode/prompts/*.md`, variable substitution, file watcher |
| 20 | Design Hardening | ✅ | Premium `thinking-pulse` loader, fluid horizontal spacing, optimized tool alignment |
| 21 | Secure Context Attachments | ✅ | Explorer/editor context commands, styled input chips, sensitive-file warnings, prompt-injection checks, read-only context provider |
| 22 | Path-Aware Mentions | ✅ | Debounced file search with path-aware globs and expanded result limit |
| 23 | Unified Session Modal | ✅ | Single list merging local + server sessions, workspace badges, `resume_server_session`, `importOneServerSession` |
| 24 | Changed-Files Chip Bar | ✅ | Backend `SessionStore.addChangedFiles()` persists normalized paths; `changed_files_update` is canonical for chip bar + todos panel, with active-session scoped rendering and `file_edited` merged live |
| 25 | Token & Cost Display | ✅ | `StreamCoordinator.finalizeStream` forwards `AssistantMessage.cost` and `.tokens` to webview on every stream completion |
| 26 | Welcome Dashboard | ✅ | Workspace context row, model name, "Continue last session" + "New session" quick actions, recent sessions sorted by recency, 2×2 prompt-starter grid; host-created empty sessions now open a tab immediately |
| 27 | Header Consolidation | ✅ | Status strip below tab bar (model/tokens/cost); settings overflow menu (`#settings-menu`) with MCP + theme entries; 4-button header; `aria-pressed` on all toggles |
| 28 | CLI Session Sharing | ✅ | `OPENCODE_DATA_DIR`/`XDG_DATA_HOME` passed through env-var allowlist; `recoverSessions` no longer workspace-scoped |
| 29 | Theme Customizer + CLI Theme Parity | ✅ | Webview modal with color pickers + Preview button; 7 override fields incl. user message bg; `--bg-secondary`/`--bg-tertiary` removed from CSS_VAR_MAP to preserve `color-mix()` depth; `.vscode-light` body overrides fix light-theme bubble rendering |
| 30 | Empty Session Cleanup + Restore | ✅ | Empty unused sessions and local `pendingServerLink` placeholders are transient, pruned periodically, deleted on close, and open tabs restore per workspace when enabled; closed historical sessions are not revived on focus sync; server imports awaiting backfill remain exempt |
| 31 | Session Load Performance + Scroll Fixes | ✅ | `resume_session_data` truncated to last 50 msgs + `request_more_messages` pagination; chunked rAF rendering (`CHUNK_SIZE=20`); load-earlier banner; scroll-to-bottom after load; debounced scroll markers + timeline refresh; `content-visibility: auto; contain-intrinsic-size: auto 120px` on messages; `will-change: scroll-position` on message list |
| 32 | Back Button + Modal Focus Traps | ✅ | Back button in header when any modal is open; Tab/Shift+Tab focus cycling within all modals; return-focus-to-trigger on close |
| 33 | Settings Menu Keyboard Nav | ✅ | ArrowUp/Down, Home, End, Escape navigation |
| 34 | Theme Customizer Undo State | ✅ | Save/reset push theme state onto undo stack |
| 35 | Session Recovery Re-push | ✅ | `sessions_recovered` event triggers `pushInitStateToWebview`; process disconnects clear stale server state and emit `server_disconnected` before reconnect |
| 36 | Context Optimization Suggestions | ✅ | `ContextMonitor.generateOptimizationSuggestions()` exposed via webview; WebviewEventRouter now calls it on context_suggestions_request |
| 37 | Skills Performance Tracking UI | ✅ | `SkillInfo` extended with `performanceScore`, `usageCount`, `lastUsed`; skills modal displays metrics when available |
| 38 | Context Optimization UI Display | ⏳ | Backend exposed, pending webview panel integration to display suggestions to users |
| 39 | Skill Usage Recording Integration | ⏳ | ConfidenceScorer infrastructure exists, pending integration with actual skill invocation points (architectural work required) |
| 40 | Skills Modal Wiring Repair | ✅ | Fixed stale-closure on `skillsModalOpen` (`main.ts` passed `skillsModalApi?.open` before the API was constructed) by switching to a thunk so the lookup happens at click time; modal now opens reliably |
| 41 | Skill Preferences Persistence | ✅ | New `SkillPreferencesStore` (`globalState`-backed) persists per-skill enable/disable; `toggle_skill` writes through the store and re-emits `skills_list`; `resolveAllSkills` reflects user preference on every list |
| 42 | Methodology ↔ Skills Integration | ✅ | `MethodologyAdvisor` now accepts a `skillHinter`; `ChatProvider` wires `SkillTriggerEngine.getTriggeredSkills(text)` (filtered by enabled skills) into the addendum so the model receives a `Relevant skills: …` line on every classified prompt |
| 43 | Voice Input Browser Helper | ✅ | Mic button opens a tokenized localhost helper in the user's default browser via `asExternalUri`/`openExternal`; browser mode posts final Web Speech text, OpenAI mode posts audio to the host for SecretStorage-backed transcription |

## Deferred (P2 — High Effort / Niche)

| # | Feature | Reason |
|---|---------|--------|
| 18 | Workspace Indexing | Very High effort — needs persistent embedding index, server-side support |
| 38 | Context Optimization UI Display | Backend exposed via WebviewEventRouter, pending webview panel integration to display suggestions |
| 39 | Skill Usage Recording Integration | ConfidenceScorer infrastructure exists, requires architectural work to identify and integrate with actual skill invocation points |

## Architecture

22 components across 4 layers:

- **Extension Host**: ChatProvider, TabManager, SessionStore, SessionManager, StreamCoordinator, MessageRouter, DiffHandler, ChunkBatcher, ContextEngine, ContextMonitor (with optimization suggestions), ModelManager, RateLimitMonitor, CheckpointManager, ThemeManager, PromptManager, SessionExporter, InlineActionProvider, TerminalBridge, CliDiagnostics, DiffApplier, EventNormalizer
- **Webview**: State, Renderer, DOM, Tabs, Model Dropdown, Mentions, Stream, Scroll Anchor, Theme, Recent Sessions, Search, Slash Autocomplete, Skills Modal (with performance metrics display)
- **Communication**: @opencode-ai/sdk (REST + SSE over localhost)
- **Server**: opencode serve (HTTP, multi-session)
