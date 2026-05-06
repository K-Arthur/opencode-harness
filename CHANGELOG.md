# Changelog

All notable changes to the **OpenCode Harness** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unified session identity (ADR-007)** — Server-issued session IDs are now the canonical key for sessions in `SessionStore`. CLI-created sessions are imported automatically when the extension connects to the server, so the chat panel and the `opencode` CLI no longer maintain parallel session pools. Pre-existing local sessions with a `cliSessionId` are rekeyed in place by a one-shot, idempotent migrator on `SessionStore.load`. (`src/session/SessionStore.ts`, `src/session/sessionMigration.ts`, `src/extension.ts`)
- **Continue Last Session command** — `opencode-harness.continueLastSession` activates the most-recent session and opens the chat panel. Falls back to `newSession` when no sessions exist. (`src/commands/session.ts`)
- **Choose History Session command** — `opencode-harness.chooseHistorySession` shows a quick-pick over the union of local + server sessions. Selecting an unbacked server session triggers a `withProgress` backfill of full message history before activation. (`src/commands/session.ts`)
- **Attach to Remote Server command + settings** — `opencode-harness.attachRemote` prompts for a URL and optional bearer token, persists them to `opencode.serverUrl` / `opencode.serverAuthToken`, and reconnects `SessionManager` against the remote endpoint without spawning a local binary. (`src/commands/session.ts`, `src/session/SessionManager.ts`, `package.json`)
- **Session-start git baseline** — When a fresh session is created, the extension now snapshots a baseline git ref via `CheckpointManager.snapshot(sessionId, "baseline")`, giving "restore to session start" a defined target. Cheap no-op when the working tree is clean. (`src/extension.ts`)
- **`SessionStore.onSessionCreated` event** — Decouples the baseline-checkpoint hook from the store. (`src/session/SessionStore.ts`)
- **`SessionStore.importServerSessions` / `migrateLocalIdsToServerIds` / `promotePendingServerLink` / `applyBackfilledMessages`** — Public API for the unified-identity flow, exercised by 15 new behavioral tests in `src/session/sessionMigration.test.ts`.
- **`SessionManager.setRemoteServer` / `isRemote`** — Switch between local-spawn and remote-attach without restarting the extension. Bearer auth supersedes the local Basic-auth path in `authHeader`. (`src/session/SessionManager.ts`)

### Changed
- **`sessions_recovered` handler now imports** — Previously only re-linked already-known sessions on reconnect. Now imports any server session the local store does not yet know about, surfacing CLI-only sessions in the picker. (`src/extension.ts`)
- **`SessionStore.create(name, opts)`** — Second argument is now `CreateSessionOptions` (`{ id?, cliSessionId?, pendingServerLink? }`); the legacy `create(name, idString)` signature is preserved for backward compatibility.
- **Empty-session pruning exemptions** — Sessions marked `needsBackfill` (imported from server, history not yet fetched) or `pendingServerLink` (created offline, awaiting promotion) are exempt from empty-session filtering and stale-session pruning.

### Fixed
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
- **CheckpointManager concurrency** — `snapshotLock` prevents concurrent git operations; stash rollback on failure
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