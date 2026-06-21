# Webview Session Search and Image Attachments

## Welcome Session Search

- The welcome search field first filters the in-memory recent-session list for quick local feedback.
- Pressing Enter or clicking anywhere in the search wrapper (the icon, the wrapper border, the padding) submits the trimmed query to the extension host with `list_sessions`. Clicks targeted at the inner `<input>` element are passed through so the user can focus and type normally.
  - **Why a wrapper-level click handler?** `.search-icon` carries `pointer-events: none` in CSS, so a browser click on the magnifying-glass glyph delivers the event with `target === wrapper`, not the icon. Matching by `.closest(".search-icon")` therefore never fired in production — the click handler now triggers on any wrapper-targeted click except those landing on the inner input. See `src/chat/webview/ui/welcomeView.ts`.
- The webview prepares welcome recent-session data through `prepareLocalRecentSessions()` / `prepareHostRecentSessions()` in `src/chat/webview/recent-sessions.ts`; `main.ts` only wires state and host messages.
- With an empty query, the welcome view hides sessions whose backfill hasn't completed (no visible messages yet). With a query present, those sessions are still surfaced if their name matches the query — so a user can find an unbacked-filled CLI session by typing its title.
- Recent-session delete buttons emit `recent-session-delete` inside the welcome module. `main.ts` bridges that callback to the stable host message `{ type: "delete_session", targetSessionId }`.
- The Session History modal has its own search input. It filters cached local/synced rows immediately and forwards the query to `list_server_sessions`; OpenCode server sessions are filtered by the metadata exposed by the SDK list API: id, title, and directory.
- The modal deduplicates by canonical session identity (`cliSessionId || id`). A synced session appears once, server title is preferred, and the local title is only a fallback while the server result is loading.
- Empty search clears the welcome recent-session filter without hiding the search input.

## Image Paste and Send

- Pasted image attachments are accepted even before a local active session exists. The first send still lazily creates the session.
- Attachment-only prompts are valid. The webview enables send when text or attachments are present.
- The extension host validates attachment count, MIME type, and size before storing or forwarding payloads.
- Image attachments are forwarded to OpenCode as SDK `file` parts with data URLs so native vision support and the `opencode-easy-vision` plugin can inspect them. The SDK contract (`FilePartInput`, `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`) is `{ type: "file", mime, url }`; the url field is a free-form string and accepts `data:`, `file://`, or `http(s)://` schemes.
- Host-side `webview_request_error` messages are handled by the webview and clear optimistic streaming state, so the send button recovers after rejected or invalid requests.

### Paste robustness

- The paste handler in `src/chat/webview/ui/attachments.ts` walks `DataTransferItemList` first, then falls back to `DataTransfer.files` (some Linux desktop clipboards surface pasted images only via `files`).
- Duplicate same-MIME entries that return `null` from `getAsFile()` are skipped rather than aborting the search — earlier versions silently dropped the real image when a string-typed shadow entry appeared first in `items`.
- `preventDefault()` is only invoked once an image actually attaches, so non-image pastes (text, links) fall through to the textarea's default handling.

### CSP

- The webview CSP (set in `src/chat/WebviewContent.ts`) includes `data:` in `img-src` so base64 image chips render natively without an extra extension-host round trip.

## Mention Chips (`@file:` / `@folder:` / `@url:` / `@problems:` / `@terminal:`)

- Typed mentions are surfaced as styled, per-kind context chips above the composer, not left
  as raw `@file:…` text. `onInputChange` (`inputHandlers.ts`) calls
  `updatePromptContextChips()` on **every** edit so chips appear/update live as the user types
  — previously chips only refreshed when a mention was inserted via the picker, so a
  hand-typed mention stayed as plain text.
- `parsePromptMentions` (`ui/attachments.ts`) derives a clean label per mention: files show
  the basename (and switch to the `image` kind for image extensions so they get an image
  icon), folders get a trailing slash, urls show the hostname, and `problems`/`terminal` get
  friendly labels. The full path/URL is preserved in the chip `title` (hover tooltip); the
  raw token is retained for removal.
- Chips are differentiated by `data-kind` (file/image/folder/url/problems/terminal) with
  per-kind colour and a `::before` SVG icon in `css/components.css`; `theme.ts`
  `updateContextChips` renders the label + tooltip + remove button.

## New Session Identity

- The webview may create a temporary `session-<8 hex chars>` id so the composer can show the first user message immediately.
- Temporary `session-*` ids are local-only and must not be treated as OpenCode server session ids.
- The host stores temporary sessions as `pendingServerLink` entries without a `cliSessionId`.
- `StreamCoordinator` creates or attaches the real OpenCode session through `SessionManager` before `sendPromptAsync`, then stores the returned `ses_...` id for event routing and recovery.
- Backfill and server-existence checks skip temporary ids because the OpenCode server will return `NotFoundError` for sessions it did not create.
- Once a temporary/local session receives a real server id, the server id becomes canonical. Legacy rows with the same `cliSessionId` are merged into the server-keyed record during store migration/recovery.
