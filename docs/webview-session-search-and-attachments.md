# Webview Session Search and Image Attachments

## Welcome Session Search

- The welcome search field first filters the in-memory recent-session list for quick local feedback.
- Pressing Enter or clicking anywhere in the search wrapper (the icon, the wrapper border, the padding) submits the trimmed query to the extension host with `list_sessions`. Clicks targeted at the inner `<input>` element are passed through so the user can focus and type normally.
  - **Why a wrapper-level click handler?** `.search-icon` carries `pointer-events: none` in CSS, so a browser click on the magnifying-glass glyph delivers the event with `target === wrapper`, not the icon. Matching by `.closest(".search-icon")` therefore never fired in production — the click handler now triggers on any wrapper-targeted click except those landing on the inner input. See `src/chat/webview/ui/welcomeView.ts`.
- The host filters stored local sessions by display title, local id, CLI session id, workspace path, and text blocks.
- With an empty query, the welcome view hides sessions whose backfill hasn't completed (no visible messages yet). With a query present, those sessions are still surfaced if their name matches the query — so a user can find an unbacked-filled CLI session by typing its title. See `renderRecentSessionsList` in `src/chat/webview/main.ts`.
- The Session History modal forwards the same query to `list_server_sessions`; OpenCode server sessions are filtered by the metadata exposed by the SDK list API: id, title, and directory.
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

## New Session Identity

- The webview may create a temporary `session-<8 hex chars>` id so the composer can show the first user message immediately.
- Temporary `session-*` ids are local-only and must not be treated as OpenCode server session ids.
- The host stores temporary sessions as `pendingServerLink` entries without a `cliSessionId`.
- `StreamCoordinator` creates or attaches the real OpenCode session through `SessionManager` before `sendPromptAsync`, then stores the returned `ses_...` id for event routing and recovery.
- Backfill and server-existence checks skip temporary ids because the OpenCode server will return `NotFoundError` for sessions it did not create.
