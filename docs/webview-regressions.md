# Webview Regression Notes

## Streaming Text/Tool Interleave (v0.2.17)

Text chunks streamed before and between tool calls must appear live and stay correctly ordered relative to tool elements. Three distinct failure modes were fixed:

**Problem 1 — Text finalized late, appears all at once.** `handleToolStart` cleared `state.currentBlockBuffer` and `state.currentBlockEl` before the RenderQueue or RAF flush had committed the pending text. The deferred flush fired, found no current element, called `insertStreamingTextAfterLastBlock`, and created a new block — but by then the flush had nothing to render (the buffer was empty). The text accumulated in the buffer never became a finalized markdown block until the whole stream ended, so it appeared to "blink in" at the end.

**Fix**: `finalizeCurrentTextBlock(state, els, messages)` is now called at the top of `handleToolStart`, before any state is cleared. This immediately converts the live streaming `<div class="streaming-text">` element to a finalized `<div class="msg-text markdown-content">` with full markdown rendering. The RenderQueue callback and RAF `doUpdate` path both have a matching guard (`if (!state.currentBlockBuffer.trim()) return`) that skips execution when the buffer was already cleared, preventing spurious empty-block creation.

**Problem 2 — Post-tool text positioned at bubble tail, not after last tool.** `insertStreamingTextAfterLastBlock` appended the new text element with `bubble.appendChild()`, placing it after any existing trailing children (e.g. diff blocks, skill badges) rather than immediately after the last tool element.

**Fix**: The helper now scans `bubble.children` in reverse for the last element matching `details.tool-call, details.tool-group, .diff-block, .skill-badge` and uses `bubble.insertBefore(textEl, insertAfter.nextSibling)` to splice the new text element into the correct position. A new `createTextBlock("")` entry is pushed to `msgObj.blocks` and `state.currentBlockIndex` is set to track it.

**Problem 3 — Diff blocks cut live text.** `handleDiff` appended the diff element without first finalizing any in-progress text block, producing the same visual reordering.

**Fix**: `finalizeCurrentTextBlock(state, els, messages)` call added at the start of `handleDiff`.

## Session-Scoped Chat Bar (v0.2.17)

Opening a new tab while another session is streaming previously showed the "Stop" button in the new (idle) tab. Root cause: `createNewTab()` called only `switchToTab()` (which only applies CSS `active` class to the tab panel) without calling `updateSendButton()`. The send button therefore retained whatever streaming state the previously-active tab had left. Fix: explicit `updateSendButton()` call added to `createNewTab()` immediately after `switchToTab`.

## Context Usage Singleton (v0.2.17)

Context usage was visible in two places simultaneously — the per-tab `.context-monitor` bar (inside each `tab-panel`) and the `#context-usage` status strip below the tab bar — because the `context_usage` message handler updated both. Additionally, switching tabs wiped the displayed usage because `SessionState` had no field to hold it between switches.

**Fix**: The canonical context usage UI is the status-strip `#context-usage` control with `#context-usage-dropdown` panel (`context-usage-dropdown.ts`). The `context_usage` and `context_window_known` handlers route to `ctxDropdownApi.updateUsage()` and update the status strip for the active target session only. `SessionState` carries transient `contextUsage` UI state for tab switches, while `SessionStore.contextUsage` is the durable host owner restored through `init_state` and `resume_session_data`.

The `.context-monitor` bar remains in the DOM but stays `hidden` at all times. Unknown context windows are surfaced through the status-strip override chip instead of a fabricated denominator.

## Tool Call Reduction

Assistant turns render all tool calls through one grouped `details.tool-group` row. The group is collapsed by default, including when the turn contains a single SDK `tool` block, and expanding it reveals the individual tool details.

Runtime SDK tool blocks can arrive as `type: "tool"`; legacy blocks may arrive as `tool_call` or `tool-call`. The webview tool type guard accepts all three shapes so canonical server history and live stream output follow the same grouped UI path.

## Conversation Timeline Snippets

Timeline snippets prefer visible text from `message.blocks`, but runtime and recovered messages may also carry text on `message.text`, `message.content`, `message.message`, or `message.parts[]`. The snippet extractor checks those fallbacks before using the generic user fallback, which prevents real user turns from showing as `Sent a message`.

## Context Status Strip

The status strip keeps separate DOM children for model, context, tokens, and cost. Context rendering updates the existing `#context-label` and `#context-progress-bar` nodes instead of replacing the whole strip with text. Zero-token sessions and unknown context windows remain hidden until useful context data is available.

The context usage detail surface is a fixed-position dropdown anchored to `#context-usage`. It must collision-check against the webview viewport, clamp width on narrow panes, set a usable `max-height`, and scroll internally instead of rendering behind the header or outside the viewport. The same positioning contract applies to the changed-files dropdown anchored to `#changed-files-strip`.

`context_usage` messages with missing or zero fill are treated as empty fallback data. They must not clear an existing non-zero reading for the target session. Repeated `init_state` hydration should skip unchanged message DOM, restore saved message-list scroll position, and avoid auto-scrolling to bottom unless the user is opening a never-visited tab or live stream content is appended.

`#status-strip` and `#changed-files-strip` are interactive controls above the sticky composer. Their stacking order must stay above `#input-area`; otherwise narrow panes can show the controls while the textarea intercepts clicks.

## Changed Files Strip

OpenCode's event list includes both `file.edited` and `session.diff`; observed OpenCode 1.15.x `file.edited` payloads can be global and omit `sessionID`. The extension attributes those sessionless file edits to the sole live stream, or to the active tab when no live stream is available, before updating `SessionStore.addChangedFiles()` and posting `changed_files_update`. Empty `session.diff` arrays do not clear existing changed-file state.

The visible changed-files strip is driven by `changed_files_update`, not only by old per-file chips. A live edit must make `#changed-files-strip` visible and clicking the strip must show the viewport-safe inline `#changed-files-panel` above the message input.

## Active-File Pill Disappears On Composer Focus (v0.4.20)

The pill above the composer that shows the currently-open editor kept vanishing as soon as the user clicked into the chat input. Root cause: focusing the webview/sidebar fires `vscode.window.onDidChangeActiveTextEditor(undefined)` because a webview is not a `TextEditor`. The old handler treated `undefined` as "no file open" and posted `active_file: { path: null }`, hiding the pill — even though the user's file was still open one panel over (`visibleTextEditors` still listed it).

**Fix** (`ActiveFileTracker.ts`): cache the last non-undefined editor as `lastKnownEditor` and resolve the file to post through a `bestEditor()` cascade — `lastKnownEditor → window.activeTextEditor → visibleTextEditors[0]`. The `onDidChangeActiveTextEditor` handler only posts `path: null` (hides the pill) when **all** `visibleTextEditors` are gone; when a non-editor panel grabs focus it leaves the pill on the last known file. `repost()` (invoked from the `webview_ready` handler) uses the same cascade so the pill also appears on first open, including the case where clicking the sidebar is what triggered `resolveWebviewView` (making `activeTextEditor` undefined at capture time).

## File Mention Chips Not Rendered On Insert (v0.4.20)

Picking a file from the `@` mention dropdown inserted raw `@file:path` text into the composer with no styled chip. `insertMention()` dispatches a `window` `oc-input-changed` event, but the listener in `inputHandlers.ts` only called `autoResizeTextarea()` + `updateSendButton()` — it never re-rendered chips. (Manually *typing* `@file:` worked because `onInputChange`, bound to the `input` event, already called `updatePromptContextChips()`.)

**Fix**: the `oc-input-changed` listener now also calls `attachmentManager.updatePromptContextChips()` and `attachmentManager.syncContextItemsWithPrompt()`. The chip pipeline is: `oc-input-changed` → `updatePromptContextChips()` → `parsePromptMentions()` (regex `@(file|folder|url|problems|terminal):…`) → `updateContextChips(els, chips)` renders into `#context-chips` and un-hides `#context-bar`.

## Emoji Rendered As Literal Escape Text (v0.4.20)

The mention dropdown's file row showed the literal string `U0001F4C4` instead of a file glyph. The source used `"\U0001F4C4"` — capital `\U` is **not** a valid JavaScript unicode escape (only lowercase `\u{…}` / `\uXXXX` are), so the string was emitted verbatim. All webview emoji (mention file icon, context-chip eye/eye-off toggle, recent-session indicators) were replaced with inline SVG from `icons.ts` to avoid both the escape hazard and platform emoji inconsistency.

## Estimated Usage Regresses Actual Reading (v0.4.20)

The status-strip context bar jumped backwards mid-session (e.g. to `165` tokens) after showing a correct high count. Stream start/end boundary emits in `StreamCoordinator` post `context_usage` with `source: "estimated"` and the monitor's heuristic count, which can be far below the last API-reported `actual`. The `keepExisting` guard in the `context_usage` handler originally only blocked **zero-fill** updates.

**Fix** (`main.ts` `context_usage` handler): `keepExisting` now also holds when an incoming `estimated` value is lower than a stored `actual` value (`estimatedRegressesActual`). An `estimated` update is only allowed through when it is *higher* than the stored actual — meaning the session genuinely grew between API responses. This is distinct from the post-compaction reset (v0.4.15), which intentionally clears all cached usage.

## Checkpoint Panel

An empty checkpoint response leaves the panel open and shows `No checkpoints yet`. This makes the toolbar action visibly responsive even when the active session has not produced restorable checkpoints.

## Mixed Tool Groups

Grouped tool-call summaries must represent the whole group, not just the first child tool. A group containing read, write, and exec calls renders as `tools` with `tool-call--mixed` styling and the breakdown `(1 read, 1 write, 1 exec)`. Individual child rows keep their original read/write/exec classes.

## E2E Test Fragility (2026-06)

A recurring pattern: an agent refactors a webview UI surface (changed-files strip, question bar, error banners) and commits the source change without updating the Playwright selectors. The next time the tree is reset or another agent touches the same area, the webview E2E suite fails on stale selectors. The failures are then “fixed” again by another agent, often by weakening assertions or skipping the suite, which hides real regressions.

**Root causes observed:**

- Tests relying on implementation-detail selectors (e.g., `.rate-limit-notice`, `.msg-error`) instead of canonical IDs (`#rate-limit-bar`, `#global-status-banner`).
- UI changes committed without the matching test update.
- Test fixes left uncommitted and lost to the next `oc-ckp-*` checkpoint reset.
- Suites that genuinely hang because the underlying message contract changed (e.g., question bar population) being skipped permanently rather than investigated.

**Prevention:**

- Any change to `src/chat/webview/*` DOM or message contract must include the corresponding `tests/webview/*` update in the same branch.
- Prefer stable selectors: `id` for unique elements, `data-testid` for components, class names only for styling.
- Run `npx playwright test --project=chromium-webview` before committing webview work.
- If a suite must be skipped, use `test.describe.skip` with a comment that names the follow-up issue, and do not leave it skipped across multiple releases.
