# Webview Message Rendering

The chat webview renders assistant output incrementally. Text deltas may arrive after a
`stream_end` event, especially when the server finalizes tool blocks before the final text
chunk has been flushed. The webview should recover those late chunks into the most recent
assistant message for the active tab instead of dropping them.

## Conversation Editing

The extension provides comprehensive conversation editing capabilities:

### Edit Message
- **User messages**: Click the edit button (pencil icon) in the message header to edit a previous prompt
- **SDK integration**: Uses `session.revert` for server-side revert when available, with client-side fallback
- **Visual feedback**: Edited messages show a left border accent and visual indicators
- **Downstream handling**: Removes all messages after the edited one (truncation)

### Regenerate Response
- **Assistant messages**: Click the regenerate button (refresh icon) to retry the last assistant turn
- **Model selection**: Shift+Click on regenerate button opens model selector for regeneration with different model
- **SDK integration**: Uses `streamCoordinator.retryFromHere` with TTFB timeout detection

### Fork Conversation
- **Turn-based forking**: Click the fork button (branch icon) to create a new session from a specific turn
- **SDK integration**: Uses `session.fork` for server-side forking when available, with client-side fallback
- **Parent tracking**: Forked sessions track `parentSessionId` and `forkedAtTurn` for navigation
- **Session naming**: Forked sessions are named "Original Name (Fork from Turn N)"

### Message Controls
- **Edit button**: User messages have an edit button (pencil icon) for in-place editing
- **Regenerate button**: Assistant messages have a regenerate button (refresh icon) for retry; Shift+Click opens model selector
- **Fork button**: All turns have a fork button (branch icon) for conversation branching at that turn
- **Revert button**: Assistant messages with code changes have a revert button to undo file changes

### Webview Message Types
- `edit_message`: User requests to edit a previous message (triggers edit_message_prefill response)
- `edit_message_prefill`: Host sends original text back to webview to prefill input
- `retry_stream`: User requests to regenerate the last assistant response
- `fork_session`: User requests to fork conversation at a specific turn
- `open_model_selector_for_regen`: User requests model selector for regeneration (Shift+Click)
- `regenerate_with_model`: User selects a model for regeneration
- `log_ambiguity`: Webview signals an ambiguous slash command (multiple sources share the
  same command name) so the host can log it to the output channel. Carries `prefix`,
  `suffix`, and `candidates` (array of `{ name, source, origin }`).

## Streaming Contract

- `stream_start` creates or reuses the visible assistant placeholder.
- `stream_chunk` appends text to the active streaming message.
- `stream_tool_partial` appends live stdout/stderr bytes to an existing bash/exec tool
  card while the command is running.
- If `stream_chunk` arrives after stream state was cleared, the chunk is appended to the
  most recent assistant message in that tab and persisted.
- `stream_end` finalizes unresolved tool-call blocks so completed responses do not remain
  visually stuck in a running state.

### Live Tool Output

Live bash/exec output uses transient webview buffers only. The host sends:

```ts
{
  type: "stream_tool_partial",
  sessionId,
  toolCall: {
    id,
    partialStdout?, partialStderr?,
    stdout?, stderr?, replace?,
    token,
    stdoutLength, stderrLength,
    stdoutLineCount?, stderrLineCount?,
    durationMs?, exitCode?,
  }
}
```

Rules:

- `token` is monotonic per session/tool. The webview drops partials with `token <= lastSeen`.
- `partialStdout` / `partialStderr` are deltas. When `replace: true`, `stdout` and `stderr`
  are full snapshots used to repair a gap or shorter server buffer.
- Final `stream_tool_end` is authoritative. Any partial for a terminal tool is ignored.
- Output is debounced at 100ms before DOM replacement so rapid progress updates coalesce.
- `tool_output_config` pushes `{ renderAnsi }`; ANSI rendering is opt-in through
  `opencode.toolOutput.renderAnsi`, and the default path strips ANSI/control sequences.
- `chat_font_config` pushes `{ fontSize, fontFamily }` from `opencode.chat.fontSize`
  (clamped 8–32) and `opencode.chat.fontFamily`. The webview applies these as
  `--chat-font-size` and `--chat-font-family` CSS custom properties on `:root`,
  consumed by `#prompt-input` and `.markdown-content`. An empty `fontFamily` or
  `fontSize <= 0` clears the custom property so the inherited default applies.
- `chat_dir_config` pushes `{ direction: "ltr" | "rtl" }` from the persisted
  `globalState` key `opencode-harness.chatDirection`. The webview sets the `dir`
  attribute on `<html>` and updates the toggle button's `aria-pressed` state.
  Sent during `pushAllStateToWebview` so the direction survives reloads.
- `opencode_config` pushes `{ config: WorkspaceConfigPayload, status, path }`
  from the workspace `opencode.jsonc` (or `opencode.json`) file. `status` is
  `"ok"`, `"parse_error"`, or `"not_found"`. The webview updates a config
  status badge (gear icon = loaded, warning icon = parse error) and renders
  any workspace `rules`/`instructions` in the instructions editor panel.
  Sent during `pushAllStateToWebview` and whenever the config file changes
  (hot-reloaded via a file system watcher).
- `chat_dir_change` (Webview → Host): The user clicks the LTR/RTL toggle button.
  The webview sets `dir` on `<html>` immediately and posts this message so the
  host persists the choice to `globalState` via `persistChatDirection`.

The bash-card **Cancel** action posts:

```ts
{ type: "cancel_tool", sessionId, toolId, stdout?, stderr?, durationMs? }
```

SDK 1.17.6 has no per-tool abort, so v1 stops live polling, renders a synthetic cancelled
tool result with captured output, and then falls back to the existing whole-stream `abort`.

#### Live command card update contract

Exec/shell tool calls render as standalone `.live-command-card` elements
(`liveCommandCard.ts`) instead of the generic tool card. Two invariants keep them live:

- **Discoverability.** The card sets `data-block-id` (not just `data-tool-id`). The
  streaming update functions locate tool DOM by `[data-block-id]`; without it the card is
  never found and never updated — the symptom being a card stuck on its first render
  ("RUNNING" forever, command showing the tool name like `bash`).
- **Dedicated updater.** `handleToolUpdate` / `handleToolPartial` / `handleToolEnd`
  special-case `.live-command-card` (alongside `.subagent-card`) and route through
  `applyLiveCommandCardUpdate`, which updates the card's own
  `__command` / `__output` / `__status` / `__icon` / `__footer` in place. The generic
  selectors (`.tool-status`, `.tool-result-panel`) do **not** exist on the card, so the
  generic path must not run for it.

#### Responsive tool cards

Tool cards adapt to the message-view container width via container queries in
`css/messages-responsive.css`, keyed on the **real** classes (`.tool-call`,
`.live-command-card`, `.tool-args-panel`, `.tool-result-panel`,
`.live-command-card__output`) — earlier rules targeted non-existent `.tool-card`/`.tool-args`
classes and never applied. On narrow consoles (<400px) the command wraps instead of being
ellipsis-clipped and the working-dir chip is dropped from the header. Output uses
`overflow-wrap: anywhere` so long tokens wrap without shredding every word.

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

## Voice Input Contract

Voice input is a prompt-composer feature. It inserts text into `#prompt-input`
and never posts `send_prompt` on its own (unless `opencode.voice.autoSend` is set,
in which case the webview clicks the existing Send button after insertion).

The microphone is recorded and transcribed entirely in the extension host (the
webview cannot access the mic). The webview is just the UI and drives state via the
`requestId` it generates for each take.

Webview → host:

- `get_voice_settings`: requests the current voice settings. The host answers with
  `voice_settings`.
- `voice_start`: `{ type, requestId }`. The host starts recording the default mic.
- `voice_stop`: `{ type, requestId }`. The host stops recording and transcribes.
- `voice_cancel`: `{ type, requestId }`. The host kills the recorder and discards.

Host → webview:

- `voice_settings`: `{ type, settings }`, where `settings` includes `enabled`,
  `autoSend`, `language`, `insertMode`, `maxRecordingSeconds`, and the runtime
  `available` / `unavailableReason` flags used to gate the button.
- `voice_recording_started`: `{ type, requestId }`. The webview moves to the
  recording state once capture is confirmed.
- `voice_transcribing`: `{ type, requestId }`. The webview shows the transcribing
  state while the local engine runs.
- `voice_transcript`: `{ type, requestId, text }`. The webview inserts the transcript
  only if `requestId` matches the current request, then clears it.
- `voice_error`: `{ type, requestId?, reason, message }`. The webview ignores stale
  request-scoped errors and surfaces current errors in the input-area live region.

All `voice_*` request messages are validated for a non-empty `requestId` (≤120
chars). The host deletes the temporary audio file after every take.

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
- The `@namespace /command` hierarchical syntax (e.g. `@jcodemunch /triage`) is also
  routed through the slash dispatcher. When the dropdown detects `@namespace /`, it
  scopes suggestions to only commands from that server's origin.
- Matched characters in command labels are highlighted with `<mark class="match">`
  elements (accent-colored, bold) in both the inline dropdown and the commands palette.
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
- When a slash command is ambiguous (multiple sources share the same name and no
  namespace was specified), the webview posts a `log_ambiguity` message so the host can
  log the conflict to the output channel.

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

### Expandable Detail Panels

Each command row in the palette can show an expandable detail panel with longer
documentation:

- **Skill/server commands**: the full prompt template from the server's `template`
  field is shown when it's longer than the description. This is the primary use case —
  skill prompts are often multi-paragraph and serve as the skill's documentation.
- **Local commands**: usage hints (`/<cmd> <args>`), aliases, and category are shown.
- **Commands without detail** (e.g. plain server commands with no template): no chevron
  is rendered and the row is not expandable.

The detail panel is toggled by:

1. **Chevron button** (▸/▼) on the right side of the command row
2. **Right Arrow** key — expands the selected row's detail
3. **Left Arrow** key — collapses the selected row's detail

The panel renders the content in a `<pre>` block with `white-space: pre-wrap` for
readable line wrapping. Expanded state persists across re-renders (filter changes,
search queries) via a `Set<string>` of command names.

### State Sync Messages

- `webview_ready`: Webview announces that it can receive host state. The host responds
  directly with `init_state` plus model, theme, rate-limit, and command state.
- `request_state_sync`: Webview requests a fresh visible-state snapshot after a visibility
  or focus change. The host responds directly through `pushVisibleStateToWebview()`.
- `push_all_state` / `push_visible_state`: Legacy host message types retained as a
  defensive webview fallback. Normal restoration must not route through these messages,
  because host → webview → `request_state_sync` ping-pong can delay or repeat restore.
- `mode_change_result`: Host acknowledgement for a `change_mode` request. When
  `accepted` is false, the payload carries the previous mode so the webview can keep the
  visible selector in sync after invalid payloads or cancelled Auto-mode confirmation.
- `open_model_manager`: Host message to open the model manager panel. Optional
  `forRegeneration` flag indicates the panel was opened for model selection during
  regeneration; optional `messageId` identifies the message being regenerated.
  Payload: `{ type, forRegeneration?, messageId? }`.
- `open_model_selector`: Webview→Host request for a plain "switch model" affordance
  (e.g. the **Switch model** action in the context-usage dropdown). The host re-posts
  `open_model_manager` (no regeneration context). Payload: `{ type }`. Previously the
  dropdown posted this type with no host handler, so the button silently no-op'd.
- `plan_complete`: Host notification that the agent wrote a plan document in Plan mode.
  The webview renders a "Planning Complete" banner with "Switch to Build" and "Stay in Plan"
  buttons. The sessionId identifies the tab. Payload: `{ type, sessionId, planName? }`.
- `mode_switch_request`: Webview→Host request to switch a session's mode. Sent when the
  user clicks "Switch to Build" on the plan-complete card. The host normalizes the mode,
  logs the transition, and applies it through the existing `change_mode` flow.
  Payload: `{ type, targetMode, sessionId }`.

These replace the previous behavior where these messages were logged as "unknown host
message type" and silently dropped.

#### Inbound gate: handler ⊆ allowlist (dead-wire prevention)

Webview→host messages are rejected before dispatch unless their `type` is in
`WebviewEventRouter.VALID_WEBVIEW_TYPES` (the gate at the top of `routeMessage`). A handler
registered in the `webviewHandlers` map but **absent from this set is dead** — the message is
dropped before it ever reaches the handler. This silently disabled several features
(`save_template` / `list_templates` / `delete_template` — the `/template` command —
`save_message_as_template`, the changed-files **undo file** button `undo_file`, and
`revert_all_files`) until they were added to the set. A guard test
(`WebviewEventRouter.test.ts` → "dead-wire guard") now asserts that **every** handler-mapped
type is allowlisted, so this class of bug cannot recur. When adding a webview message, add it
to **both** the handler map and `VALID_WEBVIEW_TYPES`.

`update_collapse_config` was the inverse case — posted by the webview with no host handler at
all. Tool-call **compact mode** is a pure UI preference and now lives in webview-local
`displayPrefs` (`getCompactMode`/`setCompactMode`), read by `messageRenderer` when it renders
new tool blocks instead of a static `false` baseline; the dead host post was removed.

#### Focus ownership (the webview decides which tab is visible)

The host's `sessionStore.activeId` is only a **hint**; the webview owns which tab is
visible. Two host channels broadcast the active id, and both are now reconciled through
pure helpers (`src/chat/webview/sessionFocus.ts`) so a background change never steals focus
from the tab the user is reading:

- `active_session_changed`: fired on *every* host-side `setActive` (server-side session-id
  promotion, cleanup, command-palette open). The webview follows it only when doing so is
  safe — when the welcome view is showing, when the current tab no longer exists, or when
  it targets the tab already in focus. It will **not** switch onto a session that is
  mid-stream while the user is viewing a different, valid tab. User-intended opens of a
  session still switch explicitly through `resume_session_data`.
- `init_state` is re-sent on **every** visibility change, not just first load. First
  hydration honours the host's restored `activeSessionId`; every later refresh
  **preserves the user's current tab** (or keeps them on the welcome screen) rather than
  snapping back to the host's active id. The host also only re-includes its active session
  in the restorable set on a refresh if that session still has an open tab
  (`src/chat/restorablePolicy.ts`), so a tab the user closed is never resurrected.

#### Welcome-screen mode selection

The mode selector lives in the input area, which is visible on the welcome screen where no
session is active. Choosing a mode (click, `Ctrl/Cmd+Alt+1/2/3`, `Alt+Shift+Tab`, `Ctrl+Shift+M`, or `Shift+Tab` when the mode button is focused) with no
active session updates a persisted **pending mode** (`state.pendingMode`) and the selector
UI instead of dropping the request. The next session created (`createSession`, new tab,
or first prompt) adopts that mode, which then travels to the host via `send_prompt.mode` /
`create_tab.mode`.

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

**Model-aware percent (multi-model sessions).** The context bar/dropdown always
**recompute** the displayed percentage from `tokens / maxTokens` rather than trusting the
stored `percent`. When a session switches models mid-conversation the window (`maxTokens`)
changes but a previously stored percent can lag; recomputing keeps the percentage, the
`X / Y` denominator, and the fill bar consistent regardless of the current model. The
recompute lives in `updateContextBarFromSession` (`ui/tokenCostDisplay.ts`) and
`normalizeUsage` (`context-usage-dropdown.ts`).

**Provider quota counter (`rate_limit_state`).** The quota bar's observed-usage fallback
shows `state.usedTokens` from the host's per-window rate-limit accumulator. That accumulator
only increments on the SDK final-usage stream path and is `0` for proxy providers that emit
no rate-limit headers (e.g. `opencode-proxy`/mimo). When it is absent/0, the bar falls back
to the active session's known cumulative `tokenUsage.total` so the counter reflects real
usage instead of a permanent "0 tok".

### Active File Tracking & Context Tray

The extension tracks the user's active VS Code editor and surfaces it as context in the
chat webview. This is a three-layer system: host-side tracking, webview-side state, and a
collapsible context tray UI.

#### Host → Webview messages

- `active_file`: `{ type, path: string | null, languageId?, lineCount?, selection? }`.
  Posted by `ActiveFileTracker` whenever the active editor or selection changes. `path` is
  relative to the first workspace folder, or `null` when no editor is open. `selection` is
  `{ startLine, endLine, text }` when the user has a non-empty selection, `null` otherwise.
- `workspace_files`: `{ type, files: string[] }`. Posted by `WorkspaceFileIndex` after
  workspace file refresh (initial load, file create/delete/rename). Contains relative paths
  sorted alphabetically, excluding `node_modules`.

#### Webview → Host messages

- `toggle_active_file`: `{ type, sessionId, include: boolean }`. Posted when the user
  toggles the active file inclusion state. The host records the per-session include/exclude
  preference via `ActiveFileTracker.handleToggleActiveFile()`. The toggle state resets to
  `included` when switching to a different file or starting a new chat session.

#### Send prompt enrichment

When the active file is included (`isActiveFileIncluded()` returns `true` and the file has
not been dismissed), `sendMessage.ts` enriches the `send_prompt` payload:

1. **`@file:` mention injection**: The text is prefixed with `@file:<path>` (quoted if the
   path contains spaces) so the opencode server resolves the file content.
2. **`contextItems` array**: An array of `AttachedContextItem` objects is included in the
   `send_prompt` message. Each item carries rich metadata: `id`, `type`
   (`active_file` | `picked_file` | `image` | `document`), `path`, `languageId`,
   `lineCount`, `selection` (`{ startLine, endLine, text }`), `isActive`, and
   `tokenEstimate`. Only active items of type `active_file` or `picked_file` are sent;
   image and document attachments remain in the existing `attachments` field.

After each send, `clearSentContextItems()` removes per-send items (picked files, images)
from the context item list while preserving the active file entry for the next send.

Dismissed (removed) active files are excluded from the payload — `isActiveFileIncluded()`
checks both the toggle state and the dismissed set. The `isActive` flag on each context
item is derived from `isActiveFileIncluded()`, ensuring consistency between the toggle
UI and the sent payload.

#### Context Tray UI

The context tray (`#context-tray`) is a collapsible bar above the context chips that
summarizes all attached context items:

- **Summary line**: Shows item counts (e.g. "2 files, 1 image · ~1,536 tokens (1%)") and a
  toggle arrow. Click or Enter/Space to expand.
- **Expanded view**: Each item renders as a chip with an inline SVG icon (eye/eye-slash
  for active file, image thumbnail for image, document SVG for document, folder SVG for
  picked file), label, token estimate, and remove button.
- **Token budget bar**: A 2px bar at the bottom showing total estimated tokens as a
  percentage of a 128K budget, animated via `transform: scaleX()`.
- **Multimodal support**: Images support hover-enlarge preview. Documents show line-count
  badges. Extended MIME types for drag-and-drop: bmp, tiff, avif, heic, heif (images);
  text, markdown, csv, html, css, js, json, xml, pdf, yaml, sh (documents).

#### AttachedContextItem model

All context items are tracked through the `AttachedContextItem` structure
(`src/chat/webview/types.ts`):

```ts
interface AttachedContextItem {
  id: string
  type: "active_file" | "picked_file" | "image" | "document"
  path?: string
  languageId?: string
  mimeType?: string
  data?: string
  sizeBytes?: number
  lineCount?: number
  isActive: boolean
  tokenEstimate?: number
  selection?: { startLine: number; endLine: number; text: string }
}
```

The `AttachmentManager` (`ui/attachments.ts`) owns the `contextItems` array and exposes:

- `getContextItems()` — returns a shallow copy of all context items
- `getContextSummary()` — returns `{ fileCount, imageCount, documentCount, totalTokens }`
- `addPickedFile(path)` / `removePickedFile(path)` — sync picked files with `@file:` mentions
- `addImageAttachment(data, mimeType)` / `removeImageAttachment(id)` — track image attachments
- `clearSentContextItems()` — removes per-send items after `send_prompt`, preserves active file
- `syncContextItemsWithPrompt()` — reconciles picked files with `@file:` tokens in the prompt text

Image/file attachments added via `attachImageBlob`/`attachFileBlob` are tracked as context
items in parallel with the legacy `pendingAttachments` array. Removing an attachment chip
also removes the corresponding context item. Document MIME types are validated against
`ALLOWED_DOCUMENT_MIMES` before acceptance.

#### Context-usage dropdown actions (Webview → Host)

The floating context-usage panel (`context-usage-dropdown.ts`) exposes four recovery
actions, each posting an already-registered host message type:

| Button | Message | Handler |
| --- | --- | --- |
| Compact context | `compact_session` | `WebviewEventRouter` → `sessionLifecycle.handleCompactSession` |
| New session | `new_session` | `WebviewEventRouter` |
| Switch model | `open_model_selector` | `WebviewEventRouter` → re-posts `open_model_manager` |
| Set limit | `open_context_window_override_dialog` | `WebviewEventRouter` |

(Before the fix, **Compact context** posted `compact_context` and **Switch model** posted an
unhandled `open_model_selector` with no host handler — both silently no-op'd.)

### Remote Command Execution

When a slash command targets a server session that doesn't exist yet (e.g., first command
on a freshly created tab), `CommandExecutionService` calls `sessionManager.ensureSession()`
to create a server session on-demand before executing the command. The resulting
`cliSessionId` is persisted on both the `TabManager` tab and the `SessionStore` session.

Unknown server command errors are converted to short user-facing messages instead of raw
JSON or `[object Object]` output.

## Session Export & Import

The extension supports exporting and importing conversations via VS Code commands (not webview messages — these are palette-only):

| Command | Format | Direction | File |
|---------|--------|-----------|------|
| `opencode-harness.exportConversation` | Markdown | Export | `SessionExporter.exportMarkdown` |
| `opencode-harness.exportConversationJson` | JSON | Export | `SessionExporter.exportJson` |
| `opencode-harness.exportConversationText` | Plain text | Export | `SessionExporter.exportPlainText` |
| `opencode-harness.copyConversation` | Markdown | Export (clipboard) | `SessionExporter.copyToClipboard` |
| `opencode-harness.importConversationJson` | JSON | **Import** | `SessionImporter.importFromFile` |

The JSON export format (mirrored by import):
```json
{
  "id": "ses_original",
  "name": "My Exported Chat",
  "createdAt": 1000,
  "lastActiveAt": 2000,
  "model": "anthropic/claude-sonnet-4-5",
  "cost": 0.05,
  "messages": [
    { "id": "msg_1", "role": "user", "timestamp": 1100, "blocks": [{ "type": "text", "text": "Hello" }] },
    { "id": "msg_2", "role": "assistant", "timestamp": 1200, "blocks": [...] }
  ]
}
```

Import mints a fresh session id (imports are local copies, not server sessions). Unknown block types pass through unchanged (forward-compatible). The pure parser is `parseSessionExport()` in `src/session/SessionImporter.ts`; the VS Code file-dialog adapter is `importFromFile()`.

## Context Chips & Timeline

- Input context from `@file:`, `@folder:`, URL, problems, terminal, and pasted images
  renders as colored chips above the prompt input.
- Attachment-owned prompt helpers must call `updateContextChips` with the full webview
  `ElementRefs`; passing attachment-only refs will omit `contextBar`/`contextChips` and
  break the prompt send path.
- The conversation timeline is a right-side `conversation-timeline` aside toggled from the
  header button. It reserves message-list padding only while visible.
- The side region (`#side-region`) replaces four standalone panels (Todos, Activity,
  Tasks, Subagents) with a single tabbed panel using `.side-region-tabbar` (`.side-tab`
  buttons) and `.tab-pane` content areas. The active tab is persisted in `sessionStorage`.
  A pin button (`aria-pressed`) prevents auto-close; a single close button hides the
  region. Individual panel modules (todos-panel, activity-panel, tasks-panel,
  subagent-panel) are wired as tab panes via the `SideRegionApi` (`open`, `close`,
  `toggle`, `switchTab`). Panel setup and toggle button wiring live in
  `todoSubagentSetup.ts` (`setupTodoSubagentPanelsImpl`), extracted from `main.ts`.
  Filters (`activityFilter`, `commandFilter`) remain per-session
  and refresh only for the active session.
- `run_activity_update` snapshots carry subagent state. The `subagent_add` message
  includes `childSessionId` (linked OpenCode child session ID) and `error` (failure
  detail when status is `failed`) in the subtask data payload.
  **Payload discipline:** `tool.input`, `tool.result` (full bash/file output), and
  `subagent.inputPrompt` (full prompt text) are stripped before posting — the webview
  never reads them, and without stripping the serialized payload can exceed the
  `HostMessageBatcher`'s 256KB `maxPayloadBytes` limit and be silently dropped.
- Tasks panel terminal actions post `open_terminal`: `{ type, command, cwd?, autorun? }`.
  The host validates the command, opens a VS Code terminal at `cwd` when provided, and sends
  the command with `autorun` controlling whether Enter is submitted.

## Changed Files

Changed-file state is synchronized from the extension host:

- `changed_files_update`: `{ type, sessionId, files: Array<{ path: string; added: number; removed: number; status?: "A" | "M" | "D"; isPlanDocument?: boolean }> }`
  is the canonical state message. The webview replaces that session's changed-file list with
  this payload. It re-renders the chip bar and todos panel only when the update belongs to
  the active session, preventing stale changed-file chips from leaking across tabs.
  The optional `status` field carries the authoritative git classification
  (A=added, M=modified, D=deleted) from `fileStatusClassifier.ts`; when absent the
  frontend falls back to "M" via `_inferStatus()`.
- `file_edited`: `{ type, sessionId, file }` is retained as a live incremental event for
  compatibility and immediate feedback. It merges through the same dedupe path as
  `changed_files_update`.
- `workspace_file_added`: `{ type, sessionId, path }` is emitted alongside
  `changed_files_update` when a file is classified as Added (status "A"). It is a
  no-op signal in the webview today, reserved for future use (e.g. entrance animations).
- `workspace_file_deleted`: `{ type, sessionId, path }` is emitted alongside
  `changed_files_update` when a file is classified as Deleted (status "D"). It is a
  no-op signal in the webview today, reserved for future use (e.g. exit animations).
- `file_diff_response`: `{ type, path, sessionId?, lines: DiffLine[], error?, deleted?, truncated? }`
  carries the per-file diff for the changed-files panel's inline expansion.
  - `deleted: true` indicates the file was deleted — all `lines` are type `"removed"`
    and a "File deleted" banner is rendered above them.
  - `truncated: true` indicates the diff exceeded the 5MB payload cap and was
    truncated to 500 lines; the user is directed to the full VS Code diff editor.
- OpenCode `file.edited` SSE events can be sessionless. The host must resolve those global
  file events to a live or active tab before posting `file_edited`/`changed_files_update`; the
  webview should never receive or persist changed files under an empty session id.
- The compact `#changed-files-strip` is the primary visible surface. It appears from
  `changed_files_update` and opens the inline `#changed-files-panel`, which must stay within
  the webview viewport and scroll internally.
- The strip sits above the composer (`#input-area`) in the stacking order. Fixed dropdowns
  (`#model-dropdown-container`, `#variant-dropdown-container`, `#mention-dropdown`,
  `#slash-autocomplete`, `#mode-dropdown-menu`) are portaled in `#dropdown-portal` so they
  can still render above the strip.
- File rows in the panel carry a `data-status` attribute (`"A"`, `"M"`, or `"D"`)
  for CSS targeting. Deleted files (`data-status="D"`) render with strikethrough and
  reduced opacity on the filename.
- The frontend clears changed files on stream start for the active turn, then expects the
  backend store to re-sync any subsequent file events for that session.
- Open buttons post `{ type: "open_file", path }`; the extension host resolves relative paths
  against the session's `workspacePath` (from the opencode server directory) first,
  then VS Code workspace folders, and supports `#L12` line fragments.
- **Diff review** (`open_changed_file_diff`): `{ type, path, sessionId }` opens a real VS Code
  diff editor comparing the file's session baseline (git SHA at first edit) against its current
  workspace content. The host resolves the path via the session's directory, reads baseline
  content via `SessionBaselineResolver` (SHA → checkpoint → HEAD → empty), and invokes
  `vscode.diff` in the active editor column. Works even when the VS Code window has no workspace folder.
- **Accept changes** (`accept_file_changes`): `{ type, path, sessionId? }` writes the current
  editor/disk content back to disk, effectively accepting all working-tree changes for that
  file. Creates a pre-action checkpoint and shows an "Undo" notification. Dispatched to
  the `opencode-harness.acceptFileChanges` command.
- **Reject changes** (`reject_file_changes`): `{ type, path, sessionId? }` reverts the file to
  its session baseline SHA (or HEAD if no baseline) via `git checkout`. Creates a pre-action
  checkpoint and shows an "Undo" notification. Dispatched to the `opencode-harness.rejectFileChanges` command.
- **User context** (`user_context`): `{ type, text, source? }` is a host→webview message that
  inserts formatted text into the composer prompt. Used by the "Send Problem to OpenCode"
  command to inject diagnostic information (file path, line/column, severity, source, message)
  from the VS Code Problems panel context menu.

### File Status Classification

The host classifies each changed file as Added (A), Modified (M), or Deleted (D) via
`src/chat/diff/fileStatusClassifier.ts`. The classification strategy is layered:

1. **`git status --porcelain -- <path>`** — authoritative XY status codes from git.
   Batched into a single call for multi-file events.
2. **Before/after content inference** (fallback when git status is empty or git is
   unavailable):
   - `git show HEAD:path` succeeds + file exists on disk → **M** (tracked, modified)
   - `git show HEAD:path` succeeds + file does NOT exist → **D** (tracked, deleted)
   - `git show HEAD:path` fails + file exists → **A** (untracked, added)
   - `git show HEAD:path` fails + file doesn't exist → `null` (unknown)

The classifier accepts injected `execSync`/`existsSync` deps for exhaustively
unit-testable behavior (34 tests in `fileStatusClassifier.test.ts`).

## Session Deletion & Empty Sessions

- Local session delete/archive/pin/tag messages use `targetSessionId`, matching
  `WebviewEventRouter` validation and the unified session modal contract.
- Session pinning posts `{ type: "pin_session", targetSessionId, pinned }`; tag edits post
  `{ type: "set_session_tags", targetSessionId, tags }`. Both are extension-local metadata
  persisted by `SessionStore` and surfaced back through `session_list` /
  `session_list_update`.
- Empty local placeholder sessions (`pendingServerLink`) are transient. They are not persisted
  or restored until a user message exists, and closing an empty placeholder deletes it.
- Empty server-imported sessions waiting for history (`needsBackfill`) remain exempt while the
  extension retries backfill.
- Closing the active tab clears the host active-session pointer when no other tab remains.
  Historical sessions stay available in the session list, but they are not reopened by a later
  `request_state_sync` when focus returns to the webview.

## Session Title Propagation

Session titles flow across three surfaces (server / CLI / webview tab strip) via two complementary paths:

### Host → Webview: race-free title push

`SessionStore.setTitleAppliedCallback(cb)` is the DI hook fired **synchronously** from inside
`applyServerTitle`, `setTitle`, and `updateName` the instant a title lands in the store. ChatProvider
wires this in its constructor to post `{ type: "session_title_updated", sessionId, name }` to the
webview, which patches the `.tab-label` in place via `patchTabLabel` (no `innerHTML` wipe, no focus
clobber, no streaming-indicator reset on adjacent tabs).

This bypasses the older `onDidChangeSession` subscriber path (which still fires the legacy
`session_renamed` message for regression safety). The subscriber path was registration-order-
dependent: if `applyServerTitle` ran before ChatProvider's constructor finished wiring its
subscriber, the `renamed` event fired into the void and the webview stayed frozen on
"Untitled session" until manual toggle.

### Server title arrives before cliSessionId is bound

`SessionStore.pendingTitles: Map<cliSessionId, title>` queues titles received from
`session.updated` SSE events that arrive **before** the local session has had its `cliSessionId`
wired (the D1 race). On `updateCliSessionId(id, cli)`, any queued title is flushed via
`queueMicrotask(() => applyServerTitle(cli, queued))` — deferred a microtask so the caller's
own post-bind logic (e.g. pushing `init_state` to the webview) lands first.

### Webview → Server: deduped titles reach the CLI

`WebviewEventRouter.rename_session` calls `SessionStore.setTitle` (not `rename`/`updateName`)
so the new title propagates to the opencode server via `serverTitleUpdater`. Without this, a
webview-local deduped title (e.g. `"Fix bug (2)"`) would never reach the CLI, causing the CLI
tab strip to show the un-deduped `"Fix bug"` — a mismatch when the user resumes the session
from the CLI or a sibling window. Feedback-loop-safe: the server's eventual `session.updated`
echo is no-op'd by `applyServerTitle`'s equality gate.

### Title generation

`extractTitle(text)` and `dedupeTitle(proposed, existingSet)` live in
`src/session/titleExtractor.ts` — a pure module (no vscode imports, deterministic) imported
by **both** the host (`SessionStore`, `sessionUtils`) and the webview (`main.ts`). Replaces
the previous duplicated copies of the naive 37-char-hard-slice that lived in both runtimes
and diverged over time.

- **extractTitle**: strips markdown-header tokens (`#`, `##`), bracketed metadata prefixes
  (`[methodology]`, `[RFC 42]`), and TODO/FIXME/NOTE label separators; takes the first
  sentence; truncates at 40 chars on a word boundary with `…`.
- **dedupeTitle**: appends ` (2)`, ` (3)`, … until unique against the live tab set. Format
  is ASCII (lexicographically stable, survives chat-export paths).
- Three concurrent prompts opening with `"# Role & Objective\n..."` now produce three
  distinct tab labels instead of three visually identical ones.

### CSS tokens

- `--size-tab-label-max` (default `100px`) — drives `.tab-label` ellipsis cutoff, distinct
  from `--size-tab-max` (the whole-button outer cap) so padding + close-button never eat
  into the label budget.
- `--size-tab-label-min` (default `48px`) — single-word titles don't collapse.

## Diff & Checkpoint Messages

- `diff_result`: `{ type, sessionId, blockId, ok, message?, checkpointCreated? }`.
- `checkpoint_list`: checkpoint objects include `id`, `sessionId`, `messageId`, `createdAt`,
  `filesChanged`, and optional `action`.
- `checkpoint_restored`: `{ type, sessionId, checkpointId, ok, error? }`.
- `revert_diff` restores the accepted extension-managed diff metadata captured during
  `accept_diff`. Server-side message rollback uses the OpenCode `session.revert(messageID)`
  flow and reports through `revert_result`.

### Restore Points (audit §14.5)

Snapshot-bearing parts (`snapshot`, `step-start`, `step-finish`) inside the session transcript
can be surfaced as a chronological "restore to here" rail. The host derives restore points from
the local session messages, so the coordinates are available even when the server has not
materialised explicit checkpoint objects.

- `list_restore_points`: `{ type, sessionId }`. Host responds with `restore_points`.
- `restore_points`: `{ type, sessionId, points: RestorePointView[] }`. Each point carries
  `index`, `messageID`, `partID`, `snapshot`, `label`, `kind` (`user-turn` | `step` | `snapshot`),
  and optional `time`.
- `restore_point`: `{ type, sessionId, messageID, partID?, snapshot? }`. Host calls
  `session.revert({ sessionID, messageID, partID })` and reports through `restore_point_result`.
- `restore_point_result`: `{ type, sessionId, messageID, ok, error? }`.

The webview renders the restore points in the checkpoint panel, below the extension-managed
checkpoint list. Clicking **Restore** reverts the session to that snapshot/message boundary.

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

## Activity & Error Card Deduplication

Activity notices (model/agent switched, compaction, provider retry) and error
cards are deduplicated at the host before posting, so a re-delivered event
(SSE reconnect, `PendingEventBuffer` replay) or a multi-surface failure does not
stack duplicate cards in the transcript:

- **Activity**: `ChatProvider.appendActivityBlock` builds a content signature
  (`activitySignature`) and calls `SessionStore.appendOrCoalesceActivity`, which
  collapses an immediately-repeated identical activity into the previous card and
  bumps a `repeatCount` (rendered as a `×N` badge). The host posts the stored
  message (new or updated) and the webview upserts it by id (`upsertMessageById`),
  replacing the existing node in place rather than appending.
- **Error**: the structured error card is canonical; the generic end-of-stream
  "An error occurred…" card is suppressed by `hasRecentErrorCard`
  (`streamEndErrorPolicy.ts`) when an error card already exists, and the raw
  error is no longer echoed into the bottom status indicator.

See `docs/design/cards.md` for the full card system and severity model.

## Question Tool Block

The `question` tool lets the model ask the user one or more multiple-choice or free-text questions. The question block in the assistant transcript renders as a **non-interactive record** (pending chip or answered echo). Interactive option selection and answer submission is handled by the input-area `#question-bar` (`questionBar.ts`).

### Input schema (defensive)

The tool's `args` are normalized by the pure parser `parseQuestionArgs` (`src/session/questionModel.ts`) into a `QuestionGroup[]`. Two shapes are accepted:

- **Flat single question** — `{ question | prompt | message | text, options | choices | select, allowFreeText? }`.
- **Nested groups** (Claude-style) — `{ questions: [ { question, header?, options: (string | { label, description })[], multiSelect? } ] }`.

`parseQuestionArgs` returns `[]` for empty/partial args, which signals callers to keep whatever was already rendered (the tool input often finishes streaming after the block first appears).

### Rendering

The question block renders in one of two visual states:

1. **Pending** (`.question-block--pending`): Shows the question text and a subtle `"Answer in input bar"` chip. The user answers via the `#question-bar` in the input area, not by interacting with the block itself.
2. **Answered** (`.question-block--answered`): Shows the question text, a `"Your answer:"` or `"Selected:"` label, and the user's answer text. The block is rendered at reduced opacity (0.7) and decorated with a green left border to distinguish it visually. The `answer`/`answerSource` fields come from the persisted `QuestionBlock` type.

Both states use the same `.question-block` wrapper with `aria-label="Question from model"`. The wrapper carries `data-block-id` (the tool-call id) so it can be refreshed in place. Neither state includes interactive controls (buttons, textareas, submit) — those live exclusively in the question bar (`questionBar.ts`).

#### Live refresh

When the tool input finishes streaming, `stream_tool_update` (or a duplicate `stream_tool_start`) routes through `refreshQuestionBlock`, which re-parses the args, updates the persisted block, and re-renders the `.question-block` DOM in place — filling in the question text that was empty at start.

`stream_end` carries the persisted `question` block (from the host `blocksBuffer`); `mergeServerBlocks` merges it with the live block (preferring non-empty `groups` so a late/empty copy can't wipe the displayed question), then `reRenderMessage` rebuilds the bubble.

### Host-to-Webview Messages

- `stream_tool_start`: `{ type: "stream_tool_start", sessionId, toolCall: { id, name: "question", class: "meta", state: "running", args } }` — renders the question block during streaming. `args` may be flat or nested (see Input schema); it is often empty at start and filled by a later update.
- `stream_tool_update`: `{ type: "stream_tool_update", sessionId, toolCall: { id, args } }` — refreshes the question block in place as the input streams in.
- `stream_end`: `{ type: "stream_end", sessionId, messageId, blocks: Array<{ type: "question", id, toolCallId, sessionId, groups, text, options, allowFreeText, answered?, answer?, answerSource? }> }` — finalizes the question. `groups` is authoritative; `text`/`options` are the derived single-group view kept for backward compatibility. The `answered`, `answer`, and `answerSource` fields are set from the persisted server state when the question has already been answered.

### Webview-to-Host Messages

- `question_answer`: `{ type: "question_answer", sessionId: string, value: string, source: "option" | "freetext" | "skip" | "response", toolCallId: string, requestID?: string, messageId?: string, structuredAnswers?: string[][] }` — posted by the question bar when the user submits selections or free-text input. The `source` field distinguishes pre-defined options from free-text input. `requestID` is the v2 question request ID for the host to use with `replyToQuestion`. `structuredAnswers` carries one inner array per question group (selected labels in group order) for the v2 session-scoped `question.reply` API (B-edge-1). `messageId` is included for server-side correlation.

### toolCallId Contract

The `toolCallId` (the tool call's `id` from `stream_tool_start`) flows through three layers:

1. **Question block** — stored on the `QuestionBlock` interface (`toolCallId` field) and included in the `stream_end` blocks payload.
2. **User message metadata** — `WebviewEventRouter` copies `toolCallId` into the user message block's metadata for downstream correlation.
3. **Question bar** — `questionBar.ts` uses `toolCallId` as the key to track `QuestionBarItem` state and includes it in `question_answer` for server-side correlation.

### Accessibility

The non-interactive question block implements these ARIA attributes:
- Outer wrapper: `aria-label="Question from model"`
- Answered record: the answer text is rendered as plain text in `.q-answer-text`

The question bar (interactive) implements separate ARIA attributes documented under the Question Bar section below.

### Edge Cases

- **XSS**: Question text and options are escaped via `textContent` assignment scoped to `.question-block` — HTML injection is blocked.
- **Empty question text**: When `groups[0].question` is empty, the `question-text` div renders as blank (still present but empty).
- **Late-arriving question text**: The live refresh path handles empty-at-start question blocks where text streams in after the block first renders.
- **Answered state persistence**: When the server sends back a `question` block with `answered: true`, the block renders as an answered record with the answer text and source label, even if the question bar entry has already been cleared.

### Question Bar (`questionBar.ts`)

The `#question-bar` sits in the input area and provides the interactive UI for answering pending questions. It is managed by `questionBar.ts`.

#### Initialization

`initQuestionBar(postMessage)` is called once during webview boot. It locates the `#question-bar`, `#question-bar-items`, `#question-bar-count`, and `#question-bar-submit` DOM elements and wires the submit button click handler.

#### Question Lifecycle

1. **Adding**: `stream_tool_start` for a `question` tool triggers `addQuestion(block, messageId)`, which creates a `QuestionBarItem` with parsed groups, an empty selections map (`Map<number, Set<string>>`), and `answered: false`. It calls `renderBarItem()` to append the question UI and updates visibility.
2. **Updating**: `updateQuestion(toolCallId, block)` replaces the item's groups and `allowFreeText` flag, re-renders the bar item in place, and refreshes submit state.
3. **Removing**: `removeQuestion(toolCallId)` deletes the item and removes its DOM element (called when the question is no longer relevant, e.g. stream cancelled).
4. **Marking answered**: `markQuestionAnswered(toolCallId)` adds an `"Answered"` badge to the bar item, adds the `.question-bar-item--answered` class, and disables all interaction.
5. **Clearing**: `clearAllQuestions()` removes all items and hides the bar.

#### Rendering

Each `QuestionBarItem` renders as a `.question-bar-item` with:
- **Section header**: The group's `header` text, if present.
- **Question text**: The group's `question` text.
- **Option buttons**: One `.question-bar-option` button per option. Single-select groups use exclusive selection (clicking one deselects others). `multiSelect` groups allow toggling multiple options.
- **Free-text textarea**: A `.question-bar-freetext` textarea with `maxlength="10000"` and placeholder `"Type a custom answer…"`.
- **Answered badge**: When `item.answered`, a green `"Answered"` badge is appended and all inputs are disabled.

#### Querying State

- `hasActiveQuestions()`: Returns `true` if any item is unanswered.
- `getActiveQuestionCount()`: Returns the number of unanswered items. When > 1, the bar displays a count label (e.g. `"3 questions"`).
- `clearAllQuestions()` called from `stream_end` or tab switch resets the bar.

#### Submit Flow

The submit button (`#question-bar-submit`) posts a `question_answer` message to the host for each unanswered item, aggregating group selections (formatted as `"<header|question>: choice[, choice]"`, newline-separated) and free-text into a single `value` string. Multi-group questions use a carousel (prev/next navigation, one card per group); each card has a `Ready` button that marks it for inclusion in the final Submit All. After submission, each item is marked answered and after 600ms — if all items are answered — the bar is automatically cleared.

#### Accessibility

The question bar uses these ARIA attributes:
- Bar container: `role="region"`, `aria-label="Question from model"`
- Options groups: `role="group"`, `aria-label="Answer options"` (or `"Options: <header>"` per group)
- Option buttons: `aria-pressed` reflects selection state
- Free-text textarea: `aria-label="Custom answer"`, `maxlength="10000"`
- Submit button: disabled when no selections or text have been made

#### Edge Cases

- **Double-click**: Option click handlers check `item.answered` before processing, so a second click after submission is rejected.
- **Empty submit**: The submit loop skips items with no selections and no free-text; the submit button is disabled when nothing can be submitted.
- **Multi-question aggregation**: When multiple groups exist, the bar aggregates one selection line per group. If a group has `multiSelect`, chosen options are comma-separated within that line.
- **Stream-end cleanup**: When `stream_end` arrives, the streaming handler calls `clearAllQuestions()` to reset the bar for the next turn.

## PTY Terminal (audit §14.1/§14.2)

Live PTY terminal visibility via the opencode SDK PTY API. The host-side
`PtyService` (`src/terminal/PtyService.ts`) wraps the SDK PTY endpoints; the
webview `terminal-panel.ts` folds `pty.*` lifecycle events + byte chunks into
renderable state via the pure `ptyReducer` from `ptyModel.ts`.

PTY terminals are a **global resource** (not per-chat-session). The `ptyId` is
carried as `sessionId` in lifecycle events, not a chat session id. The panel
shows all PTY sessions regardless of which chat tab is active.

### Capability advertisement

| Direction | Message | Fields | When |
|-----------|---------|--------|------|
| Host → Webview | `terminal_capability` | `ptySupported: boolean` | After `init_state`, once `ptyService.listSessions()` resolves. `false` when the server doesn't expose the PTY API or the probe throws. |
| Host → Webview | `pty_sessions` | `sessions: Array<{ id, title, command, status, pid, exitCode? }>` | Alongside `terminal_capability` when supported, and on `pty_list` requests. |

When `ptySupported === false`, the terminal toggle button stays hidden and the
Tasks panel's polling approximation remains the terminal surface (constitution
rule #6: graceful degradation).

### Lifecycle events (Host → Webview)

| Message | Fields | Source event |
|---------|--------|--------------|
| `pty_created` | `ptyId, pty` | `pty.created` (normalized by `PtyEventHandler`) |
| `pty_updated` | `ptyId, pty` | `pty.updated` |
| `pty_exited` | `ptyId, pty` (with `exitCode`) | `pty.exited` |
| `pty_deleted` | `ptyId` | `pty.deleted` |

The `pty` payload is the raw `PtyInfo`-shaped object (`{ id, title, command,
args, cwd, status, pid, exitCode? }`).

### Output streaming (Host → Webview)

| Message | Fields | When |
|---------|--------|------|
| `pty_output` | `ptyId, data: string` | Each WebSocket message chunk from the PTY. |
| `pty_connected` | `ptyId` | WebSocket established after `pty_connect`. |
| `pty_cancelled` | `ptyId` | After `pty_cancel` removes the session. |
| `pty_error` | `ptyId, error: string` | connect/cancel/list failure. |

### Control messages (Webview → Host)

| Message | Fields | Behavior |
|---------|--------|----------|
| `pty_connect` | `ptyId` | Gets a connect ticket, opens the WebSocket, begins streaming `pty_output`. |
| `pty_cancel` | `ptyId` | Calls `ptyService.removeSession()` — kills the PTY. |
| `pty_send_input` | `ptyId, data: string` | Sends stdin bytes to the PTY. |
| `pty_resize` | `ptyId, rows, cols` | Sets terminal dimensions. |
| `pty_list` | — | Refreshes the session list (host replies with `pty_sessions`). |

### Webview rendering

`setupTerminalPanel(els, deps)` (in `terminal-panel.ts`) renders one card per
PTY session: status dot (running/exited), command, exit code badge, live
runtime (1s refresh), Cancel button, and a bounded stdout view (last 10k
chars, auto-scroll to bottom). The panel auto-connects to all running PTYs on
open so output streams immediately. Escape closes the panel.

State is folded via `ptyReducer` (pure, tested in `ptyModel.test.ts`) — the
panel itself has no domain logic, only rendering + DOM event wiring.

## Development Diagnostics

The webview can emit structured log messages to the host for debugging. These are sent as `webview_log` messages:

```ts
{
  type: "webview_log",
  level: "info" | "warn" | "error",
  message: string,
}
```

### Anti-staleness warnings

Development builds (`process.env.NODE_ENV === "development"`) run a lightweight `devStalenessWarn` helper that logs `[anti-staleness]` warnings when the webview detects stale state. These are no-ops in production because `process` is undefined in the browser webview runtime.

Current checks:

- `context_usage` — warns when an incoming usage update has an older `updatedAt` than the stored session reading.
- `commands-modal` — warns when the server command list shrinks unexpectedly.
- `model-dropdown` — warns when `setCurrentModel` is called with a model id that does not match any rendered option.

See `docs/development/anti-staleness-checklist.md` for the full review checklist and `tests/FEATURE_MANIFEST.md` §11 for the structural contract.

## Tests

The relevant coverage lives in:

- `tests/webview/question-block-e2e.spec.ts` for E2E tests covering static render, edge cases, accessibility, streaming phase, and message contract.
- `src/chat/webview/questionBar.test.ts` for question bar unit tests (show/hide, option rendering, submit aggregation, multi-question state, clear on stream-end).
- `src/session/questionModel.test.ts` for the pure `parseQuestionArgs` normalizer (flat + nested shapes, option-label extraction, empty/partial input). The `src/chat/webview/questionModel.ts` re-export shim was removed since production code imports directly from `src/session/questionModel`.
- `src/chat/webview/question-block.test.ts` for unit tests covering messageId correlation, empty fallback, maxlength, aria-labels, multi-group rendering, and multi-select submit aggregation.
- `src/chat/webview/question-merge.test.ts` for `stream_end` merge survival — ensures the question block is not clobbered into a tool card and late/empty server copies do not wipe displayed groups.
- `src/chat/webview/question-refresh.test.ts` for the live in-place refresh (empty start → args arrive → text/options appear and stay interactive).
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
