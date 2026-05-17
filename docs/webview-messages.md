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

- Local commands live in `LOCAL_COMMANDS` in `src/chat/webview/mentions.ts`.
- The dropdown is triggered only when `/` is the first character before the cursor.
- Rows use `command-item` markup with an SVG icon, monospace command label, and muted
  description text.
- The webview handles UI-only commands such as `/model`, `/new`, `/export`, `/compact`,
  `/queue`, and `/commands` directly.
- The host intercepts `/clear`, `/cost`, `/continue`, and `/help` before server dispatch.
- Custom prompt commands resolve after local commands.
- Runtime OpenCode server commands are forwarded without the leading slash, because the
  OpenCode server command API expects names like `init` or `review`, not `/init`.

Server and skill/prompt commands are proactively loaded on webview boot via `list_commands`,
so the inline dropdown is populated immediately without requiring the user to type
`/commands` first.

### Commands Palette

The commands palette is a full-screen overlay modal (`#commands-modal`) accessible via:

1. **`>_` button** in the input bottom bar (left of the `@` button)
2. **`Ctrl+Shift+/`** keybinding (when chat view is focused)
3. Typing `/commands` in the prompt input
4. VS Code Command Palette → "OpenCode: Open Commands Palette"

Opening the commands palette automatically hides the inline slash dropdown to prevent
both UIs from being visible simultaneously.

### Host-to-Webview State Messages

- `push_all_state`: Host tells the webview to perform a full state sync. The webview
  responds by sending `request_state_sync` (debounced at 300ms).
- `push_visible_state`: Same as `push_all_state` — triggers a debounced state sync.

These replace the previous behavior where these messages were logged as "unknown host
message type" and silently dropped.

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
- The conversation timeline is a right-side `conversation-timeline` aside toggled from the
  header button. It reserves message-list padding only while visible.

## Changed Files

Changed-file state is synchronized from the extension host:

- `changed_files_update`: `{ type, sessionId, files: Array<{ path: string; added: number; removed: number }> }`
  is the canonical state message. The webview replaces the session's changed-file list with
  this payload, re-renders the chip bar, and updates the todos panel changed-files section.
- `file_edited`: `{ type, sessionId, file }` is retained as a live incremental event for
  compatibility and immediate feedback. It merges through the same dedupe path as
  `changed_files_update`.
- The frontend clears changed files on stream start for the active turn, then expects the
  backend store to re-sync any subsequent file events for that session.
- Open buttons post `{ type: "open_file", path }`; the extension host resolves relative paths
  against the session workspace first, then open VS Code workspace folders, and supports
  `#L12` line fragments.

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

## Tests

The relevant coverage lives in:

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
- `tests/visual/messages.spec.ts` for message layout behavior in the current app shell.
