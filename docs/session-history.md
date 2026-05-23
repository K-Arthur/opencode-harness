# Session History Search

The welcome screen search box provides live access to previous OpenCode sessions.

## Data Flow

- Typing in the welcome search input debounces for 150 ms, then posts `list_sessions` with the trimmed query to the extension host.
- The extension host handles that request in `MessageRouter.handleListSessions`.
- When the OpenCode server is running, the host uses the SDK-backed `SessionManager.listSessions()` path, which calls `client.session.list()`.
- Unknown top-level server sessions are imported into `SessionStore` with `needsBackfill: true`; child/subagent sessions are excluded from the history list.
- The filtered `session_list` response is sent back to the webview and rendered in the welcome recent-sessions area.

## Search Scope

Live search includes all non-archived local sessions plus imported non-subagent server sessions. Results can match:

- session id
- CLI session id
- display name/title
- workspace path
- text message blocks already present locally

The full history modal continues to request `list_server_sessions` so it can show server-only metadata and workspace badges.

## Stale Responses

The webview ignores a `session_list` response when its `query` no longer matches the current welcome search input. This prevents slower responses for older keystrokes from replacing newer search results.

## Fallbacks

The OpenCode SDK/server session list is the primary source of previous sessions. The direct SQLite reader remains a command-level fallback for picker flows when the server is not running; it should not replace the SDK path for live webview search.
