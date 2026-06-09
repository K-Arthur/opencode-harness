# ADR 2026-05-23: Streaming Text/Tool Interleave Fix & UI Centralization

## Status
Accepted

## Context

Three related UI reliability problems were identified from user screenshots and logs:

1. **Streaming disorder** — text chunks streamed before a tool call were rendered as a single block *after* the stream completed rather than appearing live and in source order. Tool elements and text elements appeared in the wrong order within the assistant bubble.

2. **Duplicate context usage displays** — `context_usage` messages updated both the per-tab `.context-monitor` bar (inside each `tab-panel`) and the `#context-usage` status strip, producing two visible context bars simultaneously. Switching tabs wiped the displayed data because `SessionState` had no field to carry it.

3. **Chat bar not session-scoped** — opening a new (idle) tab while another session was streaming showed the "Stop" button in the new tab because `createNewTab()` applied only a CSS class switch and never called `updateSendButton()`.

## Decisions

### Streaming Text/Tool Interleave

**Decision**: `handleToolStart` must call `finalizeCurrentTextBlock()` *before* clearing `state.currentBlockBuffer` and `state.currentBlockEl`. `handleDiff` must do the same before inserting the diff element. Both the RenderQueue callback and the RAF `doUpdate` path must guard with `if (!state.currentBlockBuffer.trim()) return` to prevent spurious empty-block creation from deferred flushes that fire after a tool-start clear.

`insertStreamingTextAfterLastBlock()` must use `bubble.insertBefore(textEl, insertAfter.nextSibling)` (scanning in reverse for the last tool/diff/skill element) rather than `bubble.appendChild()`, and must push a `createTextBlock("")` entry to `msgObj.blocks` with an updated `state.currentBlockIndex`.

**Rationale**: The RenderQueue and RAF fallback are asynchronous. Between `handleToolStart` enqueuing and the flush firing, any synchronous state clear makes the deferred update homeless — it creates a new text block with no content. Finalizing synchronously before clearing ensures the pending text is committed to the DOM before any async paths can misfire. The insertion position fix ensures the assistant message reads in source order (text → tool → text) rather than always appending to the tail.

**Alternatives considered**:
- Cancel pending RenderQueue tasks on tool-start — fragile; any cancel logic that misses a flush path reintroduces the bug.
- Re-sequence the whole bubble after stream end — simpler but loses the live progressive rendering quality and would visibly rearrange elements at stream end.

### Context Usage Singleton

**Decision**: The canonical context usage UI is exclusively the `#context-usage-btn` toolbar button with `#context-usage-dropdown` floating panel (`context-usage-dropdown.ts`). The `context_usage` and `context_window_known` message handlers route only to `ctxDropdownApi.updateUsage()`. The per-tab `.context-monitor` element remains in the HTML for now but is always kept `hidden`.

`SessionState` gains a `contextUsage: { percent: number; tokens: number; maxTokens: number }` field. The `context_usage` handler writes to it and `stateManager.save()`. `switchTab()` reads it back and restores the toolbar dropdown on activation.

**Rationale**: The toolbar dropdown pattern (button with badge → floating panel, closeable on Escape/outside-click) is consistent with the `changed-files-dropdown` and follows the Codex/Claude Code toolbar idiom. A floating panel avoids consuming message-list vertical space. Per-session persistence means users retain context state across tab switches, which was previously lost.

**Alternatives considered**:
- Keep per-tab bar, remove status strip — two sources of truth remain; per-tab bar uses message-list space.
- Persist in URL/localStorage — no server sync; session state already uses `stateManager` / `globalState`.

### Changed-Files Toolbar Dropdown

**Decision**: The inline `.changed-file-chip` strip (`renderChangedFilesList` in `fileTracking.ts` driven by `changedFilesList: null` in deps) is deactivated. All `changed_files_update` messages route to `cfDropdownApi.updateChangedFiles()` which powers the `#changed-files-btn` toolbar button with count badge and `#changed-files-dropdown` floating panel.

**Rationale**: The chip strip consumed horizontal space in the tab panel area and cluttered the message list when many files changed. A toolbar button with a count badge (visible at a glance) and floating panel (accessed on demand) follows the same pattern as changed-files UIs in VS Code's Source Control sidebar, GitHub Desktop, and similar tools.

### Session-Scoped Chat Bar

**Decision**: `createNewTab()` adds an explicit `updateSendButton()` call after `switchToTab()`.

**Rationale**: `switchToTab()` is a CSS-only operation (adds `active` class to the panel). It does not update the send button's visual state. `switchTab()` does the full sync but is not appropriate for new-tab creation because it also triggers history/cost/context restores for an existing session. The minimal fix is the explicit `updateSendButton()` call.

## Consequences

- **Positive**: Live streaming reads correctly in source order (text → tool → text → diff → text) with no visual reordering at stream end.
- **Positive**: Context usage visible on all sessions without duplication; survives tab switches.
- **Positive**: New tabs always show the correct idle send button state.
- **Positive**: Changed-files accessible via toolbar without consuming message-list real estate.
- **Neutral**: `.context-monitor` remains in HTML but is always hidden — a future cleanup pass should remove it once CSS/JS dead-code audit confirms no side dependencies.
- **Negative**: `insertStreamingTextAfterLastBlock` is slightly more expensive per call (reverse linear scan of bubble children) — acceptable given typical bubble sizes (< 50 elements).

## Test Coverage

- `src/chat/webview/stream-interleave.test.ts` — 9 source-structure assertions pinning `finalizeCurrentTextBlock` call ordering, guard conditions, `insertStreamingTextAfterLastBlock` semantics, and block index tracking.
- `tests/webview/streaming-interleave.spec.ts` — 3 Playwright DOM tests: text before tool loses `streaming-text` class when tool starts; text after tool is the last bubble child; new-tab chat bar shows idle state during concurrent streaming session.
- `tests/webview/chat-e2e.spec.ts` — updated tests for changed-files dropdown (`#changed-files-btn`, `#cf-count-badge`, `#cf-dropdown-tree`) and context usage toolbar (`#context-usage-btn`, `.cup-summary-text`).
