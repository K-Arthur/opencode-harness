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

Unknown server command errors are converted to short user-facing messages instead of raw
JSON or `[object Object]` output.

## Context Chips & Timeline

- Input context from `@file:`, `@folder:`, URL, problems, terminal, and pasted images
  renders as colored chips above the prompt input.
- The conversation timeline is a right-side `conversation-timeline` aside toggled from the
  header button. It reserves message-list padding only while visible.

## Tests

The relevant coverage lives in:

- `src/chat/webview/stream.test.ts` for late chunk recovery and tool-call finalization.
- `src/chat/webview/messages-css.test.ts` for markdown density, overflow, focus, and control transitions.
- `src/chat/webview/renderer.test.ts` for sanitizer and external-link hardening.
- `src/chat/webview/mentions.test.ts` and `src/chat/ChatProvider.test.ts` for slash command
  routing and dropdown structure.
- `tests/visual/messages.spec.ts` for message layout behavior in the current app shell.
