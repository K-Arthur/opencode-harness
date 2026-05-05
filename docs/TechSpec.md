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
│  │ Inline        │ │ Skill         │ │ Checkpoint    │   │
│  │ Actions       │ │ Manager       │ │ Manager       │   │
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
- **Testing**: Playwright (E2E), ts-jest (unit)
- **Build**: esbuild, npm

### Data Flow
1. User opens chat panel → Extension activates ChatProvider with TabManager
2. First chat open → Extension starts opencode server (`opencode serve`)
3. User sends message in webview → MessageRouter routes to appropriate handler
4. Extension calls opencode server via SDK → REST API or SSE stream
5. Server streams agent state via SSE → StreamCoordinator manages per-tab streams
6. Agent generates code changes → DiffHandler creates diff → presented in webview
7. User reviews diff → applies via VS Code's undoable edit API (transactional)

## API Contracts

### opencode Server Endpoints (via SDK)
- `POST /chat` - Send message to agent
- `GET /chat/stream` - SSE stream for real-time agent state
- `GET /sessions` - List active sessions
- `POST /sessions` - Create new session (for new tab)
- `DELETE /sessions/:id` - Close session (soft-close preserves history)

### Internal Extension APIs
- `SessionManager` - Manages server lifecycle, session persistence
- `TabManager` - Handles multi-tab concurrency (max 3)
- `StreamCoordinator` - Manages per-tab SSE streams
- `MessageRouter` - Routes webview messages to handlers
- `DiffHandler` - Tracks and presents code diffs

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
- **Preview command**: `opencode-harness.previewTheme` opens a QuickPick with all 4 presets + discovered CLI themes; applies live.
- **forced-colors**: `accessibility.css` uses `ButtonText`, `ButtonFace`, `CanvasText`, `Canvas`, `LinkText`, `GrayText` system color keywords.
- **Settings schema**: `package.json` documents all 20+ overridable theme properties.

### Compaction
- **autoCompact enforcement**: Reads `opencode.autoCompact` (`ask`/`auto`/`off`) dynamically at the 80% threshold.
- **Snooze**: "Remind me later" snoozes for 10 minutes or until context grows another 5%.
- **In-progress state**: Webview shows a system banner during compaction; input is disabled.

### Model Selection
- **Server fetch + cache**: `ModelManager` fetches from server; falls back to `globalState` cache; static fallback on total failure.
- **Provider grouping**: QuickPick groups models by provider with separator headers.
- **Per-tab persistence**: Model stored in `TabManager` + `SessionStore`; restored on session resume.

### Session History
- **Auto-title**: First user message generates a title (first sentence, truncated at 40 chars).
- **Rename validation**: Non-empty, max 80 chars, no path separators.
- **Delete confirmation**: Modal confirmation; streaming sessions are aborted first.
- **Export**: Markdown format with tool calls in `<details>` blocks, diffs in fenced code blocks, timestamps.

### Rate Limit Monitoring
- **Countdown**: Real-time `setInterval` countdown when exhausted; fires `onReset` event at zero.
- **Auto-re-enable**: Send button automatically re-enables when rate limit resets.
- **Binding constraint**: Status bar shows `min(tokensRemaining/tokensLimit, requestsRemaining/requestsLimit)`.

### Checkpoints
- **20-checkpoint cap**: Oldest checkpoints are pruned per session when the cap is exceeded.
- **Pre-action snapshot**: `snapshotBeforeAction` creates a checkpoint before any write tool call.

### Inline Suggestions (Feature 9)
- **InlineCompletionProvider**: Registered for all file patterns (`**`); shows ghost-text completions as the user types.
- **Configurable**: `opencode.inlineSuggestions.enabled` (boolean, default `true`) and `opencode.inlineSuggestions.triggerDelay` (number, default `300`ms).
- **Debounced**: CancellationToken-aware; prefix (up to 2000 chars before cursor) + suffix context sent for completion.

### Image & Multimodal (Feature 10)
- **Clipboard paste**: Webview listens for `paste` events; detects image clipboard data, encodes to base64 via `FileReader`.
- **Image rendering**: `renderImageBlock` renders clickable thumbnails (max 400×300px) with full-size lightbox overlay.
- **Server integration**: Images sent as `attach_image` messages via `postMessage`; persisted in `SessionStore`.

### Drag & Drop (Feature 11)
- **Drop zone**: `dragover`/`dragleave`/`drop` handlers on the input area with blue border highlight.
- **File path extraction**: Reads `dataTransfer.files`, builds `@file:path` mentions, inserts via `insertTextAtCursor`.

### Code Block Actions (Feature 12)
- **Copy**: Clipboard write with "Copied!" feedback state (existing, verified).
- **Insert at Cursor**: Sends `insert_at_cursor` message → `handleInsertAtCursor` replaces active editor selections with code.
- **Create New File**: Sends `create_file_from_code` → `showSaveDialog` → `workspace.fs.writeFile` → opens document.

### Message Editing (Feature 13)
- **Edit button**: Only on user messages, visible on hover; posts `edit_message` with message ID and text.
- **Downstream clearing**: `SessionStore.truncateMessages()` removes all messages after the edited one.
- **In-place editing**: `edit_message_prefill` loads original text into input, clears downstream UI elements.

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
- **8 built-in commands**: `/clear`, `/model`, `/cost`, `/new`, `/export`, `/compact`, `/continue`, `/help`.
- **Autocomplete popover**: Triggered on `/` as first character only; multi-line safe; filters as user types; Enter/Escape keyboard nav.
- **Custom commands**: Prompt files from Feature 16 appear alongside built-in commands.
- **Server handlers**: `/clear` truncates messages + creates new CLI session; `/cost` fetches from server; `/continue` resumes most recent closed session; `/help` renders markdown table.

### Permission Modes (Feature 6 — Enhanced)
- **3 modes**: Plan (review before apply), Auto (apply without asking), Normal (ask per action).
- **Mode selector**: Button group in webview header; disabled during streaming; updates immediately.
- **Plan mode enforcement**: Diffs show "Review" label; accept button becomes "Approve & Apply".
- **Auto mode warning**: One-time confirmation with "Don't show again" persisted to `globalState`.

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

### Component Inventory (Post-Parity Audit)

| Component | File | Purpose |
|-----------|------|---------|
| `ChatProvider` | `src/chat/ChatProvider.ts` | Webview orchestrator, message routing, compaction, mode management |
| `TabManager` | `src/chat/TabManager.ts` | Multi-tab state (max 3 concurrent streams) |
| `SessionStore` | `src/session/SessionStore.ts` | Persistent session storage in VS Code globalState |
| `SessionManager` | `src/session/SessionManager.ts` | opencode server lifecycle, SDK client, session CRUD |
| `SessionExporter` | `src/session/SessionExporter.ts` | Markdown export of session conversations |
| `StreamCoordinator` | `src/chat/handlers/StreamCoordinator.ts` | Per-tab SSE streaming with watchdog |
| `MessageRouter` | `src/chat/handlers/MessageRouter.ts` | Webview-to-handler message dispatch |
| `DiffHandler` | `src/chat/handlers/DiffHandler.ts` | Diff tracking, accept/reject lifecycle |
| `ContextEngine` | `src/context/ContextEngine.ts` | Workspace context gathering (files, git, diagnostics) |
| `ContextMonitor` | `src/monitor/ContextMonitor.ts` | Token usage tracking, autoCompact threshold |
| `ModelManager` | `src/model/ModelManager.ts` | Model list from server, caching, QuickPick |
| `RateLimitMonitor` | `src/monitor/RateLimitMonitor.ts` | Rate limit headers, countdown, status bar |
| `CheckpointManager` | `src/checkpoint/CheckpointManager.ts` | Git worktree snapshots, rollback |
| `ThemeManager` | `src/theme/ThemeManager.ts` | Theme presets, CLI theme files, CSS variable injection |
| `PromptManager` | `src/prompts/PromptManager.ts` | Custom slash commands from `.opencode/prompts/*.md` |
| `InlineCompletionProvider` | `src/inline/InlineCompletionProvider.ts` | Ghost-text tab completions |
| `InlineActionProvider` | `src/inline/InlineActionProvider.ts` | CodeLens actions (Explain, Refactor, Generate Tests) |
| `SkillManager` | `src/skills/SkillManager.ts` | Skill loading and execution |
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
