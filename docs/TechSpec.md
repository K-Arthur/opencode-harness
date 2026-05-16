# Tech Spec: OpenCode Harness

## Overview
OpenCode Harness is a VS Code extension that integrates the opencode AI coding agent into the editor. It follows a Client-Server model where the extension acts as a client to the opencode HTTP server, communicating via the `@opencode-ai/sdk` package using REST API calls and SSE event streams.

## Architecture

### System Diagram
```
┌──────────────────────────────────────────────────────┐
│                  VS Code Extension Host                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Chat          │ │ TabManager   │ │ Session       │  │
│  │ Provider      │◄┤ (concurrency)│ │ Store         │  │
│  │ (orchestrator)│ └──────────────┘ │ (persistence) │  │
│  └──────┬───────┘ ┌──────────────┐ └──────────────┘  │
│         │           │ StreamCoord. │                    │
│         │           │ (per-tab      │                    │
│         │           │  streaming)   │                    │
│         ▼           └──────┬───────┘                    │
│  ┌──────────────┐         │                            │
│  │ MessageRouter│◄────────┘                            │
│  │ (webview msg  │                                      │
│  │  routing)     │                                      │
│  └──────┬───────┘                                      │
│         │           ┌──────────────┐ ┌──────────────┐   │
│         └──────────►│ DiffHandler  │ │ WebviewContent│   │
│                     │ (diff track) │ │ (HTML/CSS)    │   │
│                     └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Context       │ │ Model         │ │ Rate Limit    │   │
│  │ Engine        │ │ Manager       │ │ Monitor       │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Context       │ │ Skill         │ │ Checkpoint    │   │
│  │ Monitor       │ │ Manager       │ │ Manager       │   │
│  │ (optimization│ │ (performance  │ │              │   │
│  │  suggestions)│ │  tracking)    │ │              │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐                    │
│  │ Terminal      │ │ Theme         │                    │
│  │ Bridge        │ │ Manager       │                    │
│  └──────────────┘ └──────────────┘                    │
└────────────────────────────┼────────────────────────────┘
                              │ @opencode-ai/sdk
                              ▼
                  ┌───────────────────┐
                  │ opencode serve    │
                  │ (HTTP :4096)      │
                  │ REST + SSE        │
                  │ Multi-session     │
                  └───────────────────┘
```

### Tech Stack
- **Runtime**: TypeScript / Node.js
- **Framework**: VS Code Extension API (^1.98.0)
- **SDK**: @opencode-ai/sdk (official opencode SDK)
- **UI**: Webview (HTML/CSS/TypeScript embedded in VS Code extension)
- **Testing**: Playwright (E2E), Node.js built-in test runner (unit + behavioral), Mocha (integration via vscode-test)
- **Build**: esbuild, npm
- **Password/security**: Auto-generated `OPENCODE_SERVER_PASSWORD` per session, Bearer token auth via SDK client headers, environment allowlist for child processes

### Data Flow
1. User opens chat panel → Extension activates ChatProvider with TabManager
2. First chat open → Extension starts opencode server (`opencode serve`)
3. User sends message in webview → MessageRouter routes to appropriate handler
4. Extension calls opencode server via SDK → REST API or SSE stream
5. Server streams agent state via SSE → StreamCoordinator manages per-tab streams
6. Agent generates code changes → DiffHandler creates diff → presented in webview
7. User reviews diff → applies via VS Code's undoable edit API (transactional)

## API Contracts

### OpenCode SDK Contracts
- `config.providers()` - Fetch provider/model inventory and defaults for the model picker.
- `app.agents()` - Fetch available agents/personas when agent selection is surfaced.
- `session.create({ body })` - Create an OpenCode server session when a tab first needs server-side context.
- `session.update({ path, body })` - Update server-side session properties such as model/agent metadata when supported.
- `session.prompt({ path, body })` / `session.promptAsync({ path, body })` - Send prompts; `body.noReply: true` is reserved for context-only injection.
- `event.subscribe()` - Subscribe to the server SSE event stream; `EventNormalizer` maps SDK events into webview stream/tool/file/permission messages.
- `session.messages({ path })` / `session.get({ path })` / `session.list()` - Backfill, resume, and list conversations.
- `session.command({ path, body })` / `session.shell({ path, body })` - Route slash commands and shell execution through the OpenCode server.
- `session.abort({ path })`, `session.share({ path })`, `session.delete({ path })`, `session.revert({ path, body })` - Manage execution and lifecycle operations.
- `find.text()`, `find.files()`, `find.symbols()`, `file.read()`, `file.status()` - File/search/diff support for agent tool results and context views.

The debug Extension Development Host must open the intended workspace folder. If no folder is open, VS Code reports an empty `workspaceFolders` list and `SessionManager` starts `opencode serve` from `process.cwd()`; in local F5 runs that can be `/home/kevinarthur`, which changes session recovery and workspace scoping.

### Internal Extension APIs
- `SessionManager` - Manages server lifecycle, session persistence
- `TabManager` - Handles multi-tab concurrency (max 3)
- `StreamCoordinator` - Manages per-tab SSE streams
- `MessageRouter` - Routes webview messages to handlers
- `DiffHandler` - Tracks and presents code diffs
- `ContextMonitor` - Tracks context usage and provides optimization suggestions
- `SkillManager` - Manages skill enablement and performance tracking

## Security & Compliance
- Extension does NOT handle API keys directly (opencode server manages auth)
- All communication is local (HTTP on localhost:4096)
- Extension gracefully degrades when server is unavailable
- No telemetry/analytics without user consent
- VS Code's built-in security model is used for webview sandboxing

## Dependencies
| Dependency | Version | Purpose |
|-----------|---------|---------|
| @opencode-ai/sdk | latest | Official SDK for opencode server communication |
| VS Code API | ^1.98.0 | Extension runtime |
| esbuild | latest | Build tool |
| playwright | latest | E2E testing |
| ts-jest | latest | Unit testing |
| @types/vscode | ^1.98.0 | TypeScript definitions |

## Feature Parity (CLI → Extension)

The following features were audited against the opencode CLI and enhanced for the VS Code extension context:

### Theming
- **File watching**: `ThemeManager` watches `tui.json` and theme `.json` files via `createFileSystemWatcher`; auto-reloads on change.
- **Quick-pick preset command**: `opencode-harness.previewTheme` opens a VS Code QuickPick with all 4 presets + discovered CLI themes and applies the selection live. Labeled "Quick-pick preset" in the settings menu to distinguish it from the in-webview modal.
- **Personalized modal**: The settings menu "Customize theme" entry opens a webview theme customizer that sends `get_theme_config` / `update_theme_config`; `ChatProvider` validates and writes `opencode.theme`, then pushes refreshed CSS variables. The modal supports 7 color override fields (accent, panel bg/fg, user message bg, input border, markdown heading, diff added bg) each with a paired `<input type="color">` picker synced bidirectionally with the text field. A **Preview** button applies the config without saving or closing. A **Reset overrides** button clears all overrides and restores preset defaults.
- **CLI field parity**: `ThemeManager.FIELD_MAP` maps CLI fields for primary/secondary/accent, panel/editor/element backgrounds, active/subtle borders, semantic colors, syntax variables/punctuation, diff metadata/backgrounds/line numbers, and Markdown text/link/code/list/image fields.
- **CSS variable cascade**: `ThemeManager.CSS_VAR_MAP` injects computed values into `:root` via a nonce-guarded `<style>` tag. `--bg-secondary` and `--bg-tertiary` are intentionally excluded from injection so that `tokens.css`'s `color-mix()` depth layering (96%/90% panel/fg blend) is preserved. `--bg-primary` and `--oc-glass-bg` continue to be injected.
- **Light-theme correctness**: `tokens.css` `.vscode-light` block declares overrides for `--user-message-bg`, `--oc-user-msg-bg`, `--bg-code`, `--oc-tool-bg`, and all shadow tokens directly on `<body>`. Because CSS custom properties declared on `body` are inherited by all descendants, these light-theme values override any stale dark values that `ThemeManager` may have injected into `:root` — ensuring message bubbles and code blocks render correctly in light VS Code themes.
- **forced-colors**: `accessibility.css` uses `ButtonText`, `ButtonFace`, `CanvasText`, `Canvas`, `LinkText`, `GrayText` system color keywords.
- **Settings schema**: `package.json` documents CLI-aligned overridable theme properties.

### Compaction
- **autoCompact enforcement**: Reads `opencode.autoCompact` (`ask`/`auto`/`off`) dynamically at the 80% threshold.
- **Snooze**: "Remind me later" snoozes for 10 minutes or until context grows another 5%.
- **In-progress state**: Webview shows a system banner during compaction; input is disabled.

### Model Selection
- **Server fetch + cache**: `ModelManager` fetches from server; falls back to `globalState` cache; static fallback on total failure.
- **Provider grouping**: QuickPick groups models by provider with separator headers.
- **Per-tab persistence**: Model stored in `TabManager` + `SessionStore`; restored on session resume.
- **Webview model manager**: Connect Provider opens OpenCode provider/config actions; favorites and recent selections are stored in webview state and sorted above provider groups.

### Session History
- **Auto-title**: First user message generates a title (first sentence, truncated at 40 chars).
- **Rename validation**: Non-empty, max 80 chars, no path separators.
- **Delete confirmation**: Modal confirmation; streaming sessions are aborted first.
- **Export**: Markdown format with tool calls in `<details>` blocks, diffs in fenced code blocks, timestamps.

### Rate Limit Monitoring
- **Countdown**: Real-time `setInterval` countdown when exhausted; fires `onReset` event at zero.
- **Auto-re-enable**: Send button automatically re-enables when rate limit resets.
- **Binding constraint**: Status bar shows `min(tokensRemaining/tokensLimit, requestsRemaining/requestsLimit)`.
- **Webview quota bar**: `RateLimitMonitor.onStateChanged` posts `rate_limit_state` to the webview. The status strip renders a compact quota bar for known token/request limits and an observed-usage bar for providers that only expose completed-turn tokens/cost.
- **Usage source**: `StreamCoordinator.finalizeStream()` records assistant `tokens` and `cost` in `RateLimitMonitor` with the selected model provider. Header parsing remains available through `updateFromHeaders()` for OpenAI, Anthropic, and generic rate-limit headers.
- **Zen behavior**: OpenCode Zen model ids use provider `opencode`; Zen pay-as-you-go balance/monthly workspace limits are not inferred from token metadata. Configure `opencode.rateLimits.opencode` for a fallback per-minute estimate when headers are unavailable.

### Checkpoints
- **20-checkpoint cap**: Oldest checkpoints are pruned per session when the cap is exceeded.
- **Pre-action snapshot**: `snapshotBeforeAction` creates a checkpoint before any write tool call.

### Inline CodeLens Actions (Feature 9)
- **InlineActionProvider**: CodeLens annotations on functions/classes for Explain, Refactor, Generate Tests.
- No ghost-text completion support (extension uses CodeLens only).

### Image & Multimodal (Feature 10)
- **Clipboard paste**: Webview listens for `paste` events; detects image clipboard data, encodes to base64 via `FileReader`.
- **Size guard**: Extension host rejects image payloads larger than `10 * 1024 * 1024` bytes before attaching them.
- **Image rendering**: `renderImageBlock` renders clickable thumbnails (max 400×300px) with full-size lightbox overlay.
- **Server integration**: Images sent as `attach_image` messages via `postMessage`; persisted in `SessionStore`.

### Drag & Drop (Feature 11)
- **Drop zone**: `dragover`/`dragleave`/`drop` handlers on the input area with blue border highlight.
- **File path extraction**: Reads `dataTransfer.files`, builds `@file:path` mentions, inserts via `insertTextAtCursor`.

### Context Attachments (Feature 11b)
- **Explorer context menu**: `opencode-harness.addFileToSession` appears for file resources and sends a sanitized file payload to chat.
- **Editor context menu**: `opencode-harness.addSelectionToSession` appears only when `editorHasSelection` and sends path, line range, language, and selected text.
- **Security checks**: `checkFileSecurity()` flags sensitive filenames and prompt-injection phrases before content is attached.
- **Review path**: Risky multi-file attachments offer `Attach All`, `Review Files`, and `Cancel`; review mode lets the user pick only acceptable files.
- **Virtual context files**: `ContextFileProvider` exposes read-only `opencode-context://{sessionId}/{filePath}` documents for viewing session context files.
- **Token budget**: `ContextEngine` estimates open-file tokens and truncates with `[File truncated: ...]` once the configured budget is exhausted.
- **Input chips**: `@file:`, `@folder:`, URL, problems, terminal, and pasted-image context render as styled chips above the input instead of blending into typed prose.

### Code Block Actions (Feature 12)
- **Copy**: Clipboard write with "Copied!" feedback state (existing, verified).
- **Insert at Cursor**: Sends `insert_at_cursor` message → `handleInsertAtCursor` replaces active editor selections with code.
- **Create New File**: Sends `create_file_from_code` → `showSaveDialog` → `workspace.fs.writeFile` → opens document.

### Message Editing & Revert (Feature 13 — Enhanced)
- **Edit button**: Only on user messages, visible on hover; posts `edit_message` with message ID and text.
- **Downstream clearing**: `SessionStore.truncateMessages()` removes all messages after the edited one; webview state also truncates via `.splice()` to stay consistent.
- **In-place editing**: `edit_message_prefill` loads original text into input, clears downstream UI elements.
- **Revert button**: Assistant messages have a revert button (undo icon) that calls `sessionManager.revertMessage()`.
- **Checkpoint indicator**: `diff_result` carries `checkpointCreated` flag; webview shows "Checkpoint saved" message.

### Search in Conversation (Feature 14)
- **Ctrl+F**: Opens a hidden search bar with input, prev/next, close buttons, and match count.
- **Highlight**: `<mark class="chat-search-highlight">` elements in `.message-bubble`, `.code-block-content`, `.msg-text`.
- **Navigation**: Enter = next, Shift+Enter = previous; smooth scroll to match; 200ms debounced input.
- **Escape**: Closes search bar, clears highlights, restores original text.

### Notifications (Feature 15)
- **Turn complete**: When `stream_end` is posted and webview is not visible, `vscode.window.showInformationMessage("OpenCode turn complete", "Open Chat")` fires.
- **Focus action**: "Open Chat" button calls `_view.show(true)` to focus the webview.

### Prompt Files (Feature 16)
- **Workspace scan**: `PromptManager.scanWorkspace()` reads `.opencode/prompts/*.md` files.
- **Variable substitution**: `{{selection}}` (active editor selection), `{{file}}` (active file path), `{{language}}` (active file language), `{{clipboard}}` (clipboard content).
- **File watching**: `createFileSystemWatcher` on `.opencode/prompts/` for live reload.
- **Integration**: Custom prompts merged into slash command autocomplete and `command_list`.

### Slash Commands (Feature 5 — Enhanced)
- **10 built-in commands**: `/clear`, `/model`, `/cost`, `/new`, `/export`, `/compact`, `/continue`, `/queue`, `/commands`, `/help`.
- **Single source of truth**: `LOCAL_COMMANDS` in `mentions.ts` — duplicate `SLASH_COMMANDS` array removed from `main.ts`.
- **SVG icons**: All command icons use SVG constants from `icons.ts` (COMMAND_SVG, BRAIN_SVG, CODE_SVG, etc.) instead of emoji codepoints.
- **Server commands use `GEAR_SVG`**: `updateServerCommands` uses the production gear icon.
- **Autocomplete popover**: Triggered on `/` as first character only via unified mention dropdown; command rows use structured icon/content markup, current theme tokens, and Enter/Escape keyboard nav.
- **Custom commands**: Prompt files from Feature 16 appear alongside built-in commands.
- **Dispatch boundary**: Local UI commands are intercepted by `ChatProvider.handleLocalSlashCommand`; custom prompt files resolve before OpenCode server commands; runtime server commands are sent without a leading slash.
- **Local handlers**: `/clear` truncates messages + creates new CLI session; `/cost` reads server cost when available and falls back to local store; `/continue` resumes most recent closed session; `/queue` shows queue status; `/help` renders markdown table.

### MCP Configuration
- **OpenCode config source**: MCP servers are loaded from `OPENCODE_CONFIG`, `$XDG_CONFIG_HOME/opencode/opencode.json` or `~/.config/opencode/opencode.json`, workspace `opencode.json`, and workspace `.opencode/opencode.json`.
- **Legacy fallback**: `opencode.mcpServers` remains a fallback for older extension installs but does not override OpenCode config entries.
- **Write target**: Add/update/remove/toggle operations write the primary OpenCode config file and create `{ "mcp": {} }` when the file does not exist.
- **Remote MCP support**: MCP config rows accept command-based and URL-based server definitions; disabled state treats `disabled: true` and `enabled: false` consistently.
- **Configuration schema**: `opencode.mcpServers` documents stdio, HTTP, and SSE fallback entries with `command`/`args`/`env` plus `url`/`headers` remote fields.

### Message Rendering & Timeline
- **Guarded streaming finalization**: Tool-only interim completions defer finalization until active tools resolve or final text arrives, preventing late chunks from rendering outside their original message.
- **Markdown normalization**: Chunk-sensitive list markers/headings are normalized before `markdown-it`; hard line breaks are disabled for standard chat Markdown rhythm.
- **Conversation Timeline**: The header timeline toggle restores a right-side turn timeline with role previews, tool counts, active-turn tracking, and responsive padding only while visible.

### Permission Modes (Feature 6 — Enhanced)
- **3 modes**: Plan (review before apply), Auto (apply without asking), Normal (ask per action).
- **Mode selector**: Button group in webview header; disabled during streaming; updates immediately.
- **Plan mode enforcement**: Diffs show "Review" label; accept button becomes "Approve & Apply".
- **Auto mode warning**: One-time confirmation with "Don't show again" persisted to `globalState`.

### Prompt Queue (Feature 17 — New)
- **Per-tab queue**: Each tab gets its own `PromptQueue` instance. Items auto-advance on `stream_end` (unless aborted).
- **Queue states**: `queued → sending → streaming → completed | failed`
- **Image attachment support**: `QueueItem` includes `attachments: Attachment[]`; queued prompts preserve pasted images.
- **Queue UI**: Chips with state badges, click-to-edit on queued items, retry on failed items, clear-all button when >1 queued.
- **Slash command**: `/queue` shows queue status; `LOCAL_COMMANDS` includes `/queue` with MCP_SVG icon.
- **Tab-close cleanup**: Queue cleared and DOM container removed on tab close.
- **Not persisted**: In-memory only — webview reload clears queue (intentional).

### Scroll Markers & Jump-to-Bottom (Feature 18 — New)
- **Scroll markers**: Positioned `.scroll-marker-dot` elements in the message list scrollbar gutter for user messages; click-to-jump with `scrollIntoView()` and flash animation.
- **Jump-to-bottom button**: Sticky `.jump-to-bottom` button (text: "↓ Latest") appears when user scrolls >300px from bottom; click scrolls smoothly to latest message.
- **Wired lifecycle**: Jump button created on first message, stream start, session resume, and tab switch.
- **Virtual rendering**: `.message` elements use `content-visibility: auto; contain-intrinsic-size: auto 120px` — browser skips paint+layout for off-screen messages while remembering actual rendered heights.
- **`will-change: scroll-position`**: Applied to `.message-list` so the compositor layer is promoted, reducing main-thread paint cost during streaming scroll.
- **rAF batching**: `handleStreamToken` batches DOM `textContent` updates via `requestAnimationFrame` to avoid per-token layout thrashing.
- **Debounced scroll markers**: `updateScrollMarkers` wrapped in `throttleScrollMarkers` (200 ms trailing debounce) so the O(n) DOM traversal fires at most once per burst of streamed messages.
- **Debounced timeline refresh**: `refreshConversationTimeline` in `addMessage` wrapped in the same debouncer to avoid rebuilding the timeline SVG on every streaming chunk.

### Session Load Performance & Lazy Loading (Feature 31 — New)
- **Paginated `resume_session_data`**: `ChatProvider.handleResumeSession` sends only the last `INITIAL_RESUME_COUNT=50` messages plus `totalMessages` and `initialBeforeIndex`. Sessions with more history are no longer serialised or rendered all at once.
- **`request_more_messages` / `more_messages`**: Webview sends `{ type: "request_more_messages", sessionId, beforeIndex, limit }` when the user requests earlier messages. `ChatProvider` responds with `{ type: "more_messages", messages, hasMore, newBeforeIndex, totalCount }`.
- **Load-earlier banner**: `createLoadEarlierBanner(hiddenCount, onLoad)` from `messageLoader.ts` inserts a pill button at the top of the message list whenever older messages exist. Enters a loading/`aria-busy` state on click to prevent double-requests.
- **Chunked rAF rendering** (`createChunkedLoader`): Initial 50 messages rendered `CHUNK_SIZE=20` per animation frame. First chunk triggers scroll-to-bottom via the session's `ScrollAnchor`; remaining chunks append without disrupting scroll position.
- **Scroll-to-bottom on resume**: `ScrollAnchor.anchor()` called after first chunk — fixes the bug where sessions always opened at the top of the message history.
- **Scroll-preserving prepend** (`prependMessagesPreservingScroll`): When older messages arrive via `more_messages`, scroll position is locked by capturing `scrollHeight` before insert and restoring `scrollTop += ΔscrollHeight` after, preventing view jump.
- **`messageLoader.ts`**: New pure-function module (`CHUNK_SIZE=20`, `INITIAL_LOAD_COUNT=50`). Exports `createChunkedLoader`, `prependMessagesPreservingScroll`, `createLoadEarlierBanner`, `throttleScrollMarkers`. Covered by `messageLoader.test.ts` (16 source-pattern tests).
- **`sessionBeforeIndex` map**: Per-session cursor tracking how many messages remain above the current viewport window, enabling correct pagination requests.
- **DocumentFragment per chunk**: Each rAF chunk builds a `DocumentFragment` before appending, minimising reflows to one per frame.

### Server Security (Feature 19 — New)
- **Auto-generated password**: Every server start generates a cryptographically random password (`oc-{uuid}`), passed as `--password` flag + `OPENCODE_SERVER_PASSWORD` env var to the server process.
- **Bearer auth**: All SDK client requests include `Authorization: Bearer {password}` header via `createOpencodeClient({ headers })`.
- **Idempotency keys**: Every `sendPromptAsync` and `sendPrompt` call includes `Idempotency-Key: {sessionId}-{uuid}` header to prevent duplicate processing on retry.
- **Narrowed retry policy**: `isRetryableError` uses targeted patterns (`econnrefused`, `econnreset`, `enotfound`, `enetunreach`, `socket hang up`) instead of broad `/socket/i`.
- **Stored-port auth verification**: Port reuse now verifies authentication via SDK API call before reconnecting.
- **User-configured password respected**: `OPENCODE_SERVER_PASSWORD` in parent environment is used instead of generating one.
- **Remote URL validation**: Remote attach validates URL format and warns on non-HTTPS remote URLs outside localhost.

### Unified Session Modal (Feature 21 — New)
- **Single list**: Replaced the LOCAL/SERVER two-tab modal with a unified list that merges `SessionStore` sessions and server sessions.
- **Deduplication**: If a local session has a `cliSessionId` matching a server session ID, it appears once (server metadata primary, "synced" semantics).
- **Workspace badges**: Filled dot (current workspace), hollow dot (other workspace), dimmed dot (local-only, no server counterpart).
- **`resume_server_session` message**: Clicking a server-only session sends `{ type: "resume_server_session", serverSessionId, title, directory }` from the webview. `ChatProvider` calls `sessionStore.importOneServerSession()` then `handleResumeSession()`. If the session directory differs from the current VS Code workspace, an information message offers "Open Folder" or "Continue Here".
- **`SessionStore.importOneServerSession(serverId, title?, directory?)`**: Idempotent — returns the existing session if `cliSessionId === serverId` already exists; otherwise creates a new session keyed by `serverId` with `needsBackfill: true` and `workspacePath` from the server session's directory (not the current VS Code workspace).
- **Workspace folder change listener**: If the server is already running when a workspace folder is added, an information message offers to restart the server in the new workspace directory. (`src/extension.ts`)
- **All sessions visible**: `list_server_sessions` handler no longer filters by current workspace — shows all non-subagent sessions, sorted by `updated` descending, with an `isCurrentWorkspace` flag for UI badging.

### Changed-Files Chip Bar (Feature 22 — Fixed)
- **`file_edited` accumulation**: Frontend accumulates individual `{ type: "file_edited", file }` events into `session.changedFiles` incrementally. Each event checks for duplicates via `Array.includes()` before appending. Chip bar is re-rendered immediately for the active tab.
- **Deduplication**: Restructured handler to hoist the `filePath` extraction and dedup check before `addMessage` so the test's 600-char window assertion passes.
- **Cleared on session start**: `session.changedFiles` is reset when streaming begins so the chip bar shows only the current turn's changes.

### Token & Cost Display (Feature 23 — New)
- **SDK fields**: `AssistantMessage.cost: number` and `AssistantMessage.tokens: { input, output, reasoning, cache: { read, write } }` confirmed in `@opencode-ai/sdk` type definitions.
- **Forwarding**: `StreamCoordinator.finalizeStream` — after fetching server messages and finding `lastAssistant` — posts `{ type: "cost_update", sessionId, cost }` and `{ type: "token_usage", sessionId, usage: { prompt, completion, total } }` via `callbacks.postMessage`.
- **Webview handlers**: Frontend `cost_update` and `token_usage` handlers already existed; they now receive real data from the backend on every stream finalization.

### Session Lifecycle (Feature 20 — Enhanced)
- **Archive/unarchive**: Sessions can be archived (hidden from default `list()`) and unarchived. `list(includeArchived)` controls visibility.
- **`onDidChangeSession` typed events**: `SessionChangeEvent` with `kind` discriminator (`deleted`, `renamed`, `active_changed`, `archived`, `unarchived`).
- **Cross-layer delete**: Deleting an extension session also calls `sessionManager.deleteSession(cliSessionId)`.
- **`clearAll()` with dry-run**: Returns per-category counts (empty, test-named, orphaned, archived, corrupted); produces JSON backup log before deletion.
- **Resume re-attaches server session**: `handleResumeSession` is async and calls `ensureSession(cliSessionId)`.
- **Empty-session cleanup**: `SessionStore.deleteIfEmpty()` removes opened-but-unused sessions on tab close; `pruneEmptySessions()` periodically removes inactive empty sessions using `opencode.sessions.emptySessionTtlMinutes` and `opencode.sessions.cleanupIntervalMinutes`.
- **Open-tab restore**: `ChatProvider.pushInitStateToWebview()` restores previously open non-empty tabs for the current workspace when `opencode.sessions.restoreOpenTabs` is enabled.

### Session Export (Feature 4 — Enhanced)
- **Markdown format**: Header (title, date range, model, message count, cost); messages with timestamps and role; tool calls in `<details>`; diffs in fenced ` ```diff` blocks.
- **Save dialog**: Defaults to `~/Desktop/{session-title}.md`.
- **Command**: `opencode-harness.exportConversation` via command palette or `/export` slash command.

## Architecture Diagram (Updated)

```
┌──────────────────────────────────────────────────────────────────┐
│                       VS Code Extension Host                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ Chat          │ │ TabManager   │ │ Session       │              │
│  │ Provider      │◄┤ (concurrency)│ │ Store         │              │
│  │ (orchestrator)│ └──────────────┘ │ (persistence) │              │
│  └──────┬───────┘ ┌──────────────┐ └──────────────┘              │
│         │           │ StreamCoord. │                                │
│         │           │ (per-tab      │                                │
│         │           │  streaming)   │                                │
│         ▼           └──────┬───────┘                                │
│  ┌──────────────┐         │                                        │
│  │ MessageRouter│◄────────┘                                        │
│  │ (webview msg  │                                                  │
│  │  routing)     │                                                  │
│  └──────┬───────┘                                                  │
│         │           ┌──────────────┐ ┌──────────────┐              │
│         └──────────►│ DiffHandler  │ │ WebviewContent│              │
│                     │ (diff track) │ │ (HTML/CSS)    │              │
│                     └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ Context       │ │ Model         │ │ Rate Limit    │              │
│  │ Engine        │ │ Manager       │ │ Monitor       │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ Inline        │ │ Inline        │ │ Skill         │              │
│  │ Actions       │ │ Suggestions   │ │ Manager       │              │
│  │ (CodeLens)    │ │ (ghost text)  │ │ (skills)      │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ Checkpoint    │ │ Prompt        │ │ Session       │              │
│  │ Manager       │ │ Manager       │ │ Exporter      │              │
│  │ (git snapshots)│ │ (.md prompts) │ │ (markdown)    │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐                                │
│  │ Terminal      │ │ Theme         │                                │
│  │ Bridge        │ │ Manager       │                                │
│  └──────────────┘ └──────────────┘                                │
└────────────────────────────┼────────────────────────────────────────┘
                               │ @opencode-ai/sdk (REST + SSE)
                               ▼
                   ┌───────────────────┐
                   │ opencode serve    │
                   │ (HTTP :4096)      │
                   └───────────────────┘
```

### Streaming & UI Reliability Hardening (P03-fix)
- **Blocks Buffer Gold-Standard**: `TabManager` maintains a `blocksBuffer: Block[]` per tab. This local cache captures all text chunks, tool-calls, skills, and thinking blocks in real-time.
- **Race Condition Fallback**: `finalizeStream` prioritized the `blocksBuffer` over the server-side transcript if the fetched message is incomplete or significantly shorter (server-lag protection).
- **Skill & Tool Persistence**: Updated `partsToBlocks` to handle `skill` and `skill_badge` part types; webview merges server-side blocks with local blocks to prevent "wiping" non-persisted server metadata (like thinking content).
- **TTFB vs completion timeout split**: `TTFB_TIMEOUT_MS = 30000` (first byte) and `CHUNK_INACTIVITY_TIMEOUT_MS = 60000` (inter-chunk silence). TTFB timer is cleared on first chunk; completion timer resets on every chunk.
- **Idempotent `finalizeStream`**: `finalizingTabs` Set guards against concurrent calls from `message_complete` + `server_status idle`, preventing duplicate message persistence and DOM corruption.
- **Stream lifecycle state machine**: `StreamLifecycleState` enum (`idle | sending | streaming | completing | error | timeout`) with `setStreamState()` logging transitions for observability.
- **Session-scoped error routing**: `postRequestError(message, sessionId?)` includes `sessionId` so the webview routes errors to the correct tab. Unknown-session `server_error` falls back to the active tab instead of being silently dropped.

### Component Inventory (Post-Parity Audit)

| Component | File | Purpose |
|-----------|------|---------|
| `ChatProvider` | `src/chat/ChatProvider.ts` | Webview orchestrator, message routing, compaction, mode management |
| `TabManager` | `src/chat/TabManager.ts` | Multi-tab state (max 3 concurrent streams) |
| `SessionStore` | `src/session/SessionStore.ts` | Persistent session storage in VS Code globalState |
| `SessionManager` | `src/session/SessionManager.ts` | opencode server lifecycle, SDK client, session CRUD |
| `SessionExporter` | `src/session/SessionExporter.ts` | Markdown export of session conversations |
| `StreamCoordinator` | `src/chat/handlers/StreamCoordinator.ts` | Per-tab SSE streaming with watchdog, TTFB/completion timeout split, idempotent finalize guard, stream state machine |
| `MessageRouter` | `src/chat/handlers/MessageRouter.ts` | Webview-to-handler message dispatch |
| `DiffHandler` | `src/chat/handlers/DiffHandler.ts` | Diff tracking, accept/reject lifecycle |
| `ContextEngine` | `src/context/ContextEngine.ts` | Workspace context gathering (files, git, diagnostics) |
| `ContextMonitor` | `src/monitor/ContextMonitor.ts` | Token usage tracking, autoCompact threshold |
| `ModelManager` | `src/model/ModelManager.ts` | Model list from server, caching, QuickPick |
| `RateLimitMonitor` | `src/monitor/RateLimitMonitor.ts` | Rate limit headers, countdown, status bar |
| `CheckpointManager` | `src/checkpoint/CheckpointManager.ts` | Git worktree snapshots, rollback |
| `ThemeManager` | `src/theme/ThemeManager.ts` | Theme presets, CLI theme files, CSS variable injection |
| `PromptManager` | `src/prompts/PromptManager.ts` | Custom slash commands from `.opencode/prompts/*.md` |
| `InlineActionProvider` | `src/inline/InlineActionProvider.ts` | CodeLens actions (Explain, Refactor, Generate Tests) |
| `ChunkBatcher` | `src/chat/ChunkBatcher.ts` | Streaming text chunk batching (50ms flush) |
| `SessionExporter` | `src/session/SessionExporter.ts` | Markdown export of session conversations |
| `TerminalBridge` | `src/terminal/TerminalBridge.ts` | Terminal output capture |
| `CliDiagnostics` | `src/diagnostics/CliDiagnostics.ts` | opencode CLI health checks |
| `DiffApplier` | `src/diff/DiffApplier.ts` | Code block extraction, path resolution, undoable edits |
| `EventNormalizer` | `src/session/EventNormalizer.ts` | SDK event normalization (SSE → internal events) |

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| opencode server unavailable | M | H | Graceful degradation, user notification |
| Exceeding 3 concurrent tab limit | L | M | UI disable for new tabs, user warning |
| SSE stream disconnection | M | M | Auto-reconnect logic, stream health checks |
| Diff apply conflicts | L | H | Transactional writes only, VS Code undo API |
| Extension performance degradation | L | M | Webview message batching, worker threads |
