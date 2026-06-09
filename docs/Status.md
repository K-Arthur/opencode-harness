# opencode-harness — Status

**Last Updated:** 2026-06-09
**Version:** v0.2.23 (+ Unreleased: opencode CLI auto-install, native local voice input, frontend overhaul, stream/dedicated-bar redesign)
**Audit:** `docs/adrs/2026-05-04-feature-parity-audit.md`
**TechSpec:** `docs/TechSpec.md`

## Unreleased Highlights

- **Stream interruption fixed + permission/question/rate-limit UI relocated** (2026-06-09):
  - **Stream no longer stops on permission/question/rate-limit.** `StreamCoordinator` now tracks `question` tool calls separately from regular tool calls — only removed from `activeToolCallIds` when `answered === true`. New `markQuestionAnswered()` method called from both `WebviewEventRouter` paths. `rate_limit_exhausted` during active stream shows bar only, no inline error card.
  - **Dedicated UI bars.** Interactive controls for questions, permissions, and rate-limits moved from the message stream to `#question-bar` (above input), `#permission-bar` (above input), and `#rate-limit-bar` (below input). Stream shows compact read-only pointers with hints.
  - **Permission requests ephemeral** — no longer persisted in the session transcript.
  - **Permission bar message type fix** — webview sent `permission_response` but host expected `accept_permission`, causing "Unknown webview message type" errors and stream timeouts.
  - **Subagent panel reliability overhaul** — three bugs fixed: (1) panel no longer auto-opens on every activity update, only when a new subagent ID appears; (2) completed subagents no longer stuck showing "Running" — reconciled via `subagentReconciler.ts` when server drops them from snapshot; (3) detail view no longer overlaps other tab panes — moved inside `#subagent-panel` as a nested pane with `data-view` switching. Completed subagents are collapsed by default, capped at 10, with a "Clear completed" button. `mark_subagent_read` is now posted on click.
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
- **Changed-Files dropdown no longer freezes during streaming** — rapid `changed_files_update` events are coalesced into one `requestAnimationFrame` render (was a full `innerHTML` tree rebuild per event); expand/collapse mutates only the affected row; the strip skips unchanged rebuilds; resize is rAF-throttled; previews build via `DocumentFragment`. Review finding: the inline diff accept/reject/apply pipeline is currently unreachable dead code (opencode applies edits server-side) — documented in CHANGELOG, left unwired pending a wire-or-remove decision. (`src/chat/webview/changed-files-dropdown.ts`)
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
