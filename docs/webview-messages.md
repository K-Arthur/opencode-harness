# Webview Message Rendering

The chat webview renders assistant output incrementally. Text deltas may arrive after a
`stream_end` event, especially when the server finalizes tool blocks before the final text
chunk has been flushed. The webview should recover those late chunks into the most recent
assistant message for the active tab instead of dropping them.

## Streaming Contract

- `stream_start` creates or reuses the visible assistant placeholder.
- `stream_chunk` appends text to the active streaming message.
- If `stream_chunk` arrives after stream state was cleared, the chunk is appended to the
  most recent assistant message in that tab and persisted.
- `stream_end` finalizes unresolved tool-call blocks so completed responses do not remain
  visually stuck in a running state.

### Text/Tool Interleave Invariants

When a `stream_tool_start` event arrives mid-stream (i.e. `state.currentBlockBuffer` is non-empty):

1. **Finalize first** — `finalizeCurrentTextBlock()` must be called before clearing any buffer/element state. This converts the live `streaming-text` element to a finalized `msg-text markdown-content` block with non-streaming markdown rendering.
2. **Guard deferred flushes** — the RenderQueue callback and the RAF `doUpdate` path must both bail early (`return`) when `state.currentBlockBuffer.trim()` is empty after a tool-start clear, to prevent creating spurious empty text blocks.
3. **Post-tool text positioning** — `insertStreamingTextAfterLastBlock()` must splice the new text element immediately after the last `details.tool-call`, `details.tool-group`, `.diff-block`, or `.skill-badge` using `bubble.insertBefore(textEl, insertAfter.nextSibling)`, not `bubble.appendChild()`. It must also push a new `createTextBlock("")` entry to `msgObj.blocks` and update `state.currentBlockIndex` so subsequent chunks accumulate correctly.
4. **Diff blocks** — `handleDiff` must call `finalizeCurrentTextBlock()` before appending a diff element, for the same ordering guarantee.

The `stream-interleave.test.ts` (source-structure assertions) and `streaming-interleave.spec.ts` (Playwright DOM assertions) pin these invariants.

### Tool Group Labels

Tool groups summarize the full run of grouped tool calls. If every child has the same tool
class, the group may use that class and name. If children contain mixed classes, the summary
uses `tools`, applies `tool-call--mixed`, and keeps the type breakdown visible (for example
`(1 read, 1 write, 1 exec)`). Child rows retain their individual classes.

## First Prompt Send Flow

The welcome-page prompt path is covered as a first-class contract:

1. User types into `#prompt-input`; context chips update through the full webview element refs.
2. Send button enables from prompt text or attachments.
3. Clicking send creates a local placeholder tab only if no active session exists.
4. The optimistic user message renders into the active tab before the host round-trip.
5. The webview posts `send_prompt` with the selected model, message id, mode, text, and attachments.
6. The typing indicator remains visible until stream events or request errors resolve the turn.

The context-chip renderer must never throw from a partial element-ref object. If chip
containers are unavailable, it logs and skips chip rendering so prompt submission can continue.

## Plan Mode Rendering

Plan-mode visual treatment is role-aware:

- User messages always render as normal user prompts, even when their text contains
  headings like "Proposed plan", numbered steps, or task-review instructions.
- Assistant text may receive the `PROPOSED PLAN` treatment only when the session mode is
  `plan` and the prose shape looks like a plan.
- Diff review affordances remain separate from text styling: Plan-mode diffs show the
  review label and "Approve & Apply" action, while Build and Auto use the normal diff flow.

## Markdown Styling

Markdown is rendered with `markdown-it`, sanitized through DOMPurify, and constrained for
the narrow VS Code side-panel viewport. The message styles intentionally keep rhythm compact:

- Streamed text is normalized before render so split chunks like `1.` followed by a blank
  line and item text become a normal ordered-list item.
- Markdown uses standard soft line wrapping (`breaks: false`) instead of converting every
  newline to a hard break.
- Headings `h1` through `h6` are styled explicitly with zero letter spacing.
- Paragraphs, lists, nested lists, blockquotes, and task lists use short vertical margins.
- Fenced code blocks scroll horizontally instead of clipping long lines.
- Tables remain usable in narrow panes with horizontal overflow.
- Links have visible hover and keyboard-focus states; external links open outside the webview
  with `target="_blank"` and `rel="noopener noreferrer"`.

## Slash Commands

Slash commands use the same mention dropdown surface as `@` context mentions:

- Local commands live in `LOCAL_SLASH_COMMANDS` in `src/chat/webview/slash-commands.ts`.
  `mentions.ts` and the commands palette both adapt this registry so command labels and
  descriptions stay in sync.
- The dropdown is triggered when `/` starts the current token, either at the beginning of
  the input or after whitespace.
- Rows use `command-item` markup with an SVG icon, monospace command label, and muted
  description text.
- The webview handles UI-only commands such as `/model`, `/new`, `/export`, `/compact`,
  `/queue`, and `/commands` directly.
- Typed local slash commands and local commands selected from the commands palette route
  through the same webview dispatcher in `composer.ts`.
- The host intercepts `/clear`, `/cost`, `/continue`, and `/help` before server dispatch.
- Custom prompt commands resolve after local commands.
- Runtime OpenCode server commands are forwarded without the leading slash, because the
  OpenCode server command API expects names like `init` or `review`, not `/init`.

Server, MCP, skill, and custom prompt commands are proactively loaded on webview boot via
`list_commands`, so the inline dropdown is populated immediately without requiring the user
to type `/commands` first. The host sends custom prompt commands with `isCustom: true`;
the webview keeps them in inline slash suggestions while rendering them under the commands
palette's Custom filter instead of the Server filter.

### Commands Palette

The commands palette is a full-screen overlay modal (`#commands-modal`) accessible via:

1. **`>_` button** in the input bottom bar (left of the `@` button)
2. **`Ctrl+Shift+/`** keybinding (when chat view is focused)
3. Typing `/commands` in the prompt input
4. VS Code Command Palette → "OpenCode: Open Commands Palette"

Opening the commands palette automatically hides the inline slash dropdown to prevent
both UIs from being visible simultaneously.

The host-to-webview `command_list` payload is partitioned before it reaches the modal:

- `isCustom: true` entries update `commandsModal.updatePromptCommands(...)`.
- Other entries update `commandsModal.updateServerCommands(...)`, preserving `source`
  values such as `mcp` and `skill` for badges and filters.
- Inline slash suggestions receive the combined command list so custom prompt commands
  remain discoverable while typing.

### Host-to-Webview State Messages

- `push_all_state`: Host tells the webview to perform a full state sync. The webview
  responds by sending `request_state_sync` (debounced at 300ms).
- `push_visible_state`: Same as `push_all_state` — triggers a debounced state sync.
- `mode_change_result`: Host acknowledgement for a `change_mode` request. When
  `accepted` is false, the payload carries the previous mode so the webview can keep the
  visible selector in sync after invalid payloads or cancelled Auto-mode confirmation.

These replace the previous behavior where these messages were logged as "unknown host
message type" and silently dropped.

### Context And Token Usage

Context-window fill and API token spend are separate concepts:

- `context_usage`: `{ type, sessionId, percent, tokens, maxTokens, breakdown? }`
  describes the current context-window fill for one session. The webview persists the
  payload on the addressed session and updates the visible bar/dropdown only when
  `sessionId` matches the active tab. Background-session updates must never repaint the
  active tab's context bar.
- `context_window_known`: `{ type, sessionId, maxTokens, source }` resolves the denominator
  for one session. If the target session is active, the webview hides the override chip and
  re-computes the visible percentage from that session's stored context fill.
- `context_window_unknown`: `{ type, sessionId, modelId }` shows the override affordance only
  for the active target session. Unknown-window events for background sessions are ignored
  by the visible UI.
- `token_usage`: `{ type, sessionId, usage }`, where `usage` is
  `{ prompt, completion, total, reasoning?, cacheRead?, cacheWrite? }`, records API token
  spend. The webview accepts legacy `tokens` payloads defensively, but the canonical wire
  contract is `usage`.

The backend sends session-scoped context events from `ContextMonitor`/`ChatProvider`.
`ContextMonitor.setTokenLimit()` must not emit sessionless stale usage. Final SDK usage in
`StreamCoordinator` is an accumulation fallback only; full-history summaries from session
backfill replace the stored session summary.

### Remote Command Execution

When a slash command targets a server session that doesn't exist yet (e.g., first command
on a freshly created tab), `CommandExecutionService` calls `sessionManager.ensureSession()`
to create a server session on-demand before executing the command. The resulting
`cliSessionId` is persisted on both the `TabManager` tab and the `SessionStore` session.

Unknown server command errors are converted to short user-facing messages instead of raw
JSON or `[object Object]` output.

## Context Chips & Timeline

- Input context from `@file:`, `@folder:`, URL, problems, terminal, and pasted images
  renders as colored chips above the prompt input.
- Attachment-owned prompt helpers must call `updateContextChips` with the full webview
  `ElementRefs`; passing attachment-only refs will omit `contextBar`/`contextChips` and
  break the prompt send path.
- The conversation timeline is a right-side `conversation-timeline` aside toggled from the
  header button. It reserves message-list padding only while visible.

## Changed Files

Changed-file state is synchronized from the extension host:

- `changed_files_update`: `{ type, sessionId, files: Array<{ path: string; added: number; removed: number }> }`
  is the canonical state message. The webview replaces that session's changed-file list with
  this payload. It re-renders the chip bar and todos panel only when the update belongs to
  the active session, preventing stale changed-file chips from leaking across tabs.
- `file_edited`: `{ type, sessionId, file }` is retained as a live incremental event for
  compatibility and immediate feedback. It merges through the same dedupe path as
  `changed_files_update`.
- OpenCode `file.edited` SSE events can be sessionless. The host must resolve those global
  file events to a live or active tab before posting `file_edited`/`changed_files_update`; the
  webview should never receive or persist changed files under an empty session id.
- The compact `#changed-files-strip` is the primary visible surface. It appears from
  `changed_files_update` and opens the full `#changed-files-dropdown`, which must stay within
  the webview viewport and scroll internally.
- The frontend clears changed files on stream start for the active turn, then expects the
  backend store to re-sync any subsequent file events for that session.
- Open buttons post `{ type: "open_file", path }`; the extension host resolves relative paths
  against the session workspace first, then open VS Code workspace folders, and supports
  `#L12` line fragments.

## Session Deletion & Empty Sessions

- Local session delete/archive messages use `targetSessionId`, matching
  `WebviewEventRouter` validation and the unified session modal contract.
- Empty local placeholder sessions (`pendingServerLink`) are transient. They are not persisted
  or restored until a user message exists, and closing an empty placeholder deletes it.
- Empty server-imported sessions waiting for history (`needsBackfill`) remain exempt while the
  extension retries backfill.

## Diff & Checkpoint Messages

- `diff_result`: `{ type, sessionId, blockId, ok, message?, checkpointCreated? }`.
- `checkpoint_list`: checkpoint objects include `id`, `sessionId`, `messageId`, `createdAt`,
  `filesChanged`, and optional `action`.
- `checkpoint_restored`: `{ type, sessionId, checkpointId, ok, error? }`.
- `revert_diff` restores the accepted extension-managed diff metadata captured during
  `accept_diff`. Server-side message rollback uses the OpenCode `session.revert(messageID)`
  flow and reports through `revert_result`.

## Session Message Freshness

Session messages can become stale when the server lazy-loads conversations from disk after the
extension has already restored local state. Six fixes address this:

1. **Always refresh on resume**: `handleResumeSession` fetches fresh messages from the server on
   every resume, regardless of local message count. It no longer skips backfill when
   `messages.length > 0`.

2. **`backfillTabIfNeeded` respects `needsBackfill` flag**: The method no longer uses
   `messages.length > 0` as a standalone early-return guard. Sessions with existing messages are
   re-backfilled when `needsBackfill === true`.

3. **Extended retry budget**: `BACKFILL_RETRY_DELAYS_MS` is `[1500, 4000, 8000, 16000]` (4 retries
   over ~30 seconds) to accommodate slow server lazy-loading.

4. **No destructive close on empty backfill**: When the server returns 0 messages during
   resume, the session state is preserved (not cleared and not closed) so that retries can
   succeed once the server finishes loading.

5. **`request_more_messages` server fallback**: When the webview requests earlier messages and
   local state is exhausted (no more messages to paginate), the handler falls through to a
   server fetch via `getSessionMessages`, applies any new data, and returns the fresh slice.

6. **`refresh_session_messages` handler**: New webview-to-host message that explicitly requests a
   full message refresh from the server. The host responds with `session_messages_refreshed`
   containing the updated message list.

### Messages

- Webview → Host: `{ type: "refresh_session_messages" }` — triggers a full server fetch for the
  active session's messages.
- Host → Webview: `{ type: "session_messages_refreshed", sessionId, messages, totalCount }` —
  contains the refreshed message array. The webview re-renders the message list.

## Question Tool Block

The `question` tool lets the model ask the user a multiple-choice or free-text question inline. It displays as an interactive block within the assistant message bubble.

### Rendering

A question block is rendered in two phases:

1. **Streaming phase** — `stream_tool_start` with `name: "question"` and `args: { question, options, allowFreeText }` renders the block immediately via `appendStreamingToolBlock` → `renderBlock`. The DOM is populated with options (`.question-option`) and optionally a textarea (`.question-freetext`). During streaming, the block's answer submission is silently dropped because `postMessage` from `acquireVsCodeApi()` is not available in the streaming handler chain — interactivity is deferred until `stream_end`.

2. **Re-render phase** — `stream_end` with a `blocks` entry of `type: "question"` triggers `reRenderMessage` → `renderMessage` → `renderBlock`. At this point `postMessage` is threaded through `RenderOptions`, making option clicks and textarea submits functional. Answers post `{ type: "question_answer", sessionId, value, source, toolCallId }` back to the host.

### Host-to-Webview Messages

- `stream_tool_start`: `{ type: "stream_tool_start", sessionId, toolCall: { id, name: "question", class: "meta", state: "running", args: { question: string, options: string[], allowFreeText: boolean } } }` — renders the question block during streaming.
- `stream_end`: `{ type: "stream_end", sessionId, messageId, blocks: Array<{ type: "question", id, toolCallId, sessionId, text, options, allowFreeText }> }` — finalizes the question block with full interactivity.

### Webview-to-Host Messages

- `question_answer`: `{ type: "question_answer", sessionId: string, value: string, source: "option" | "freetext", toolCallId: string }` — posted when the user clicks an option or submits the textarea. The `source` field distinguishes pre-defined options from free-text input.

### toolCallId Contract

The `toolCallId` (the tool call's `id` from `stream_tool_start`) flows through three layers:

1. **Question block** — stored on the `QuestionBlock` interface and included in the `stream_end` blocks payload.
2. **User message metadata** — `WebviewEventRouter` copies `toolCallId` into the user message block's metadata for downstream correlation.
3. **StreamCallbacks** — `StreamCoordinator.startPrompt` receives `toolCallId` via the `StreamCallbacks` interface and logs it for observability.

### Accessibility

The question block implements these ARIA attributes:
- Outer wrapper: `role="form"`, `aria-label="Question from model"`
- Options container: `role="group"`, `aria-label="Answer options"`
- Textarea: `aria-label="Type a custom answer"`, `maxlength="10000"`

After the user answers, all inputs are disabled (buttons get `disabled`, textarea gets `readonly` + `disabled`) to prevent double-submits.

### Edge Cases

- **Double-click**: Option clicks use `dispatchEvent` (not `click()`) so the second click is rejected by the `disabled` guard before the DOM toggle propagates.
- **XSS**: Question text and options are escaped via `textContent` assignment scoped to `.question-block` — HTML injection is blocked.
- **Empty submit**: Textarea submit with empty/whitespace-only input is silently dropped.
- **Options-only mode**: When `allowFreeText: false`, the textarea is not rendered; only option buttons are shown.
- **Free-text-only mode**: When `options` is empty, only the textarea and submit button are rendered.

## Tests

The relevant coverage lives in:

- `tests/webview/question-block-e2e.spec.ts` for 17 E2E tests covering static render, edge cases, accessibility, streaming phase, and message contract.
- `src/chat/webview/question-block.test.ts` for 5 unit tests covering messageId correlation, empty fallback, maxlength, and aria-labels.
- `src/chat/WebviewEventRouter.questionAnswer.test.ts` for 11 integration tests covering routing, validation, double-submit guard, toolCallId forwarding, error handling, and observability.
- `src/chat/webview/stream.test.ts` for late chunk recovery and tool-call finalization.
- `src/chat/webview/messages-css.test.ts` for markdown density, overflow, focus, and control transitions.
- `src/chat/webview/renderer.test.ts` for sanitizer and external-link hardening.
- `src/chat/webview/mentions.test.ts` and `src/chat/ChatProvider.test.ts` for slash command
  routing and dropdown structure.
- `src/chat/CommandExecutionService.test.ts` for server session ensure flow and
  remote command execution edge cases.
- `src/chat/SessionLifecycleService.test.ts` for session resume message freshness.
- `src/chat/ChatProvider.test.ts` for backfill retry budget, stale session handling, and
  `refresh_session_messages` / `request_more_messages` server fallback.
- `src/chat/handlers/StreamCoordinator.test.ts`, `src/monitor/ContextMonitor.test.ts`, and
  `tests/webview/message-contract.test.ts` for final SDK usage accumulation,
  session-scoped context monitor updates, and the canonical `token_usage.usage` contract.
- `tests/webview/chat-e2e.spec.ts` for cross-tab context usage isolation.
- `src/chat/webview/main.test.ts` and `src/chat/webview/theme.test.ts` for prompt context-chip
  wiring, safe webview ids, changed-file scoping, and missing-chip-container hardening.
- `src/session/SessionStore.test.ts` for empty placeholder cleanup and persistence rules.
- `tests/visual/webview-contract.spec.ts` for the rendered welcome send flow and message
  contracts between the webview and host.
- `tests/visual/input.spec.ts` for rendered input affordances and send-button enablement.
- `tests/visual/messages.spec.ts` for message layout behavior in the current app shell.
