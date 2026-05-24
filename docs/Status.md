# opencode-harness — Status

**Last Updated:** 2026-05-23
**Version:** v0.2.16 (Streaming text/tool interleave + UI centralization)
**Audit:** `docs/adrs/2026-05-04-feature-parity-audit.md`
**TechSpec:** `docs/TechSpec.md`

## v0.2.16 Highlights

- **Streaming text/tool interleave fixed** — text chunks streamed before a tool call are now finalized immediately when the tool starts (`finalizeCurrentTextBlock` before clearing buffer), rendered live during streaming (not bunched up at end), and positioned correctly before/between tool elements. Spurious empty blocks from deferred RAF flushes after buffer clear are guarded. Diff blocks also finalize text first. New `stream-interleave.test.ts` and `streaming-interleave.spec.ts` cover the DOM behavior.
- **Changed-files chip bar → toolbar dropdown** — the inline chip strip (`changed-file-chip`) is replaced by a `#changed-files-btn` toolbar button with a count badge opening a floating panel. Files are grouped by directory, show diff stat bars, support sort/compact modes, and load per-file inline diffs on demand.
- **Context usage centralized to single toolbar dropdown** — the per-tab `.context-monitor` bar and `#context-usage` status strip are replaced by a single `#context-usage-btn` toolbar button. Usage data persists per-session in `SessionState.contextUsage` and is restored on tab switch.
- **Chat bar session-scoped** — `createNewTab()` now calls `updateSendButton()` so new idle tabs never inherit the "Stop" button state from a concurrently streaming session.

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

| Metric | v0.2.12 | v0.2.14 | v0.2.15 | v0.2.16 | Delta |
|--------|---------|---------|---------|---------|-------|
| Unit tests | 1746 | 1877 | 1877 | 1877 | — |
| Passing | 1739 | 1870 | 1870 | 1870 | — |
| Failing | 0 | 0 | 0 | 0 | — |
| Skipped | 7 | 7 | 7 | 7 | — |
| Playwright E2E | 8 | 14 | 14 | 14 | — |
| Typecheck | ✅ | ✅ | ✅ | ✅ | — |
| Build | ✅ | ✅ | ✅ | ✅ | — |

The single failing test in v0.2.7 (`main.test.ts › timeline jumps use exact message-list scroll positioning`) was a stale source-grep assertion left over from the extraction of `scrollToTurn`/`scrollMessageToTop` into `src/chat/webview/ui/scrollMarkers.ts`. The test now reads from `scrollMarkersSource` where the implementation actually lives.

## Feature Parity (CLI → Extension) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 1 | Theming | ✅ | forced-colors media query, CLI discovery bugfix, 6 presets (incl. high-contrast-dark/light auto-resolved); light-theme bubble fix; consolidated advanced modal with preset cards, CLI theme search, 6 collapsible sections, live preview swatch; `deriveExtendedTheme` for compact CLI palette schema; workspace-save fallback to Global |
| 2 | Compaction | ✅ | autoCompact (ask/auto/off), snooze with 5% rearm, compact banner |
| 3 | Model Selection | ✅ | Server fetch + globalState cache, provider grouping, per-tab persistence, favorites/recents |
| 4 | Session History | ✅ | Auto-title, rename validation, delete confirmation, Markdown export |
| 5 | Slash Commands | ✅ | Unified autocomplete, 10 local commands, runtime server command routing, custom prompts |
| 6 | Permission Modes | ✅ | 3-mode selector (Plan/Auto/Normal), plan enforcement, auto mode warning |
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
| 24 | Changed-Files Toolbar Dropdown | ✅ | Backend `SessionStore.addChangedFiles()` persists normalized paths; `changed_files_update` drives `#changed-files-btn` toolbar button with count badge and floating dropdown panel (file tree, diff stats, sort/compact, inline diff via `file_diff_response`). Old inline chip strip removed. |
| 25 | Token & Cost Display | ✅ | `StreamCoordinator.finalizeStream` forwards `AssistantMessage.cost` and `.tokens` to webview on every stream completion |
| 26 | Welcome Dashboard | ✅ | Workspace context row, model name, "Continue last session" + "New session" quick actions, recent sessions sorted by recency, 2×2 prompt-starter grid; host-created empty sessions now open a tab immediately |
| 27 | Header Consolidation | ✅ | Status strip below tab bar (model/tokens/cost); settings overflow menu (`#settings-menu`) with MCP + theme entries; 4-button header; `aria-pressed` on all toggles |
| 28 | CLI Session Sharing | ✅ | `OPENCODE_DATA_DIR`/`XDG_DATA_HOME` passed through env-var allowlist; `recoverSessions` no longer workspace-scoped |
| 29 | Theme Customizer + CLI Theme Parity | ✅ | Webview modal with color pickers + Preview button; 7 override fields incl. user message bg; `--bg-secondary`/`--bg-tertiary` removed from CSS_VAR_MAP to preserve `color-mix()` depth; `.vscode-light` body overrides fix light-theme bubble rendering |
| 30 | Empty Session Cleanup + Restore | ✅ | Empty unused sessions and local `pendingServerLink` placeholders are transient, pruned periodically, deleted on close, and non-empty open tabs restore per workspace when enabled; server imports awaiting backfill remain exempt |
| 31 | Session Load Performance + Scroll Fixes | ✅ | `resume_session_data` truncated to last 50 msgs + `request_more_messages` pagination; chunked rAF rendering (`CHUNK_SIZE=20`); load-earlier banner; scroll-to-bottom after load; debounced scroll markers + timeline refresh; `content-visibility: auto; contain-intrinsic-size: auto 120px` on messages; `will-change: scroll-position` on message list |
| 32 | Back Button + Modal Focus Traps | ✅ | Back button in header when any modal is open; Tab/Shift+Tab focus cycling within all modals; return-focus-to-trigger on close |
| 33 | Settings Menu Keyboard Nav | ✅ | ArrowUp/Down, Home, End, Escape navigation |
| 34 | Theme Customizer Undo State | ✅ | Save/reset push theme state onto undo stack |
| 35 | Session Recovery Re-push | ✅ | `sessions_recovered` event triggers `pushInitStateToWebview` |
| 36 | Context Optimization Suggestions | ✅ | `ContextMonitor.generateOptimizationSuggestions()` exposed via webview; WebviewEventRouter now calls it on context_suggestions_request |
| 37 | Skills Performance Tracking UI | ✅ | `SkillInfo` extended with `performanceScore`, `usageCount`, `lastUsed`; skills modal displays metrics when available |
| 38 | Context Optimization UI Display | ⏳ | Backend exposed, pending webview panel integration to display suggestions to users |
| 39 | Skill Usage Recording Integration | ⏳ | ConfidenceScorer infrastructure exists, pending integration with actual skill invocation points (architectural work required) |
| 40 | Skills Modal Wiring Repair | ✅ | Fixed stale-closure on `skillsModalOpen` (`main.ts` passed `skillsModalApi?.open` before the API was constructed) by switching to a thunk so the lookup happens at click time; modal now opens reliably |
| 41 | Skill Preferences Persistence | ✅ | New `SkillPreferencesStore` (`globalState`-backed) persists per-skill enable/disable; `toggle_skill` writes through the store and re-emits `skills_list`; `resolveAllSkills` reflects user preference on every list |
| 42 | Methodology ↔ Skills Integration | ✅ | `MethodologyAdvisor` now accepts a `skillHinter`; `ChatProvider` wires `SkillTriggerEngine.getTriggeredSkills(text)` (filtered by enabled skills) into the addendum so the model receives a `Relevant skills: …` line on every classified prompt |

## Deferred (P2 — High Effort / Niche)

| # | Feature | Reason |
|---|---------|--------|
| 17 | Voice Input | Niche (P2), requires Web Speech API or VS Code speech extension |
| 18 | Workspace Indexing | Very High effort — needs persistent embedding index, server-side support |
| 38 | Context Optimization UI Display | Backend exposed via WebviewEventRouter, pending webview panel integration to display suggestions |
| 39 | Skill Usage Recording Integration | ConfidenceScorer infrastructure exists, requires architectural work to identify and integrate with actual skill invocation points |

## Architecture

22 components across 4 layers:

- **Extension Host**: ChatProvider, TabManager, SessionStore, SessionManager, StreamCoordinator, MessageRouter, DiffHandler, ChunkBatcher, ContextEngine, ContextMonitor (with optimization suggestions), ModelManager, RateLimitMonitor, CheckpointManager, ThemeManager, PromptManager, SessionExporter, InlineActionProvider, TerminalBridge, CliDiagnostics, DiffApplier, EventNormalizer
- **Webview**: State, Renderer, DOM, Tabs, Model Dropdown, Mentions, Stream, Scroll Anchor, Theme, Recent Sessions, Search, Slash Autocomplete, Skills Modal (with performance metrics display)
- **Communication**: @opencode-ai/sdk (REST + SSE over localhost)
- **Server**: opencode serve (HTTP, multi-session)
