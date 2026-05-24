# Session History Search

The welcome screen search box provides live access to previous OpenCode sessions.

## Data Flow

- Typing in the welcome search input debounces for 150 ms, then posts `list_sessions` with the trimmed query to the extension host.
- The extension host handles that request in `MessageRouter.handleListSessions`.
- When the OpenCode server is running, the host uses the SDK-backed `SessionManager.listSessions()` path, which calls `client.session.list()`.
- Unknown top-level server sessions are imported into `SessionStore` with `needsBackfill: true`; child/subagent sessions are excluded from the history list.
- Session identity is canonicalized around the OpenCode server session id (`ses_...`). Legacy local entries that already point at the same server id through `cliSessionId` are merged into the server-keyed record during migration/recovery.
- The filtered `session_list` response is sent back to the webview and rendered in the welcome recent-sessions area.

## Search Scope

Live search includes all non-archived local sessions plus imported non-subagent server sessions. Results can match:

- session id
- CLI session id
- display name/title
- workspace path
- text message blocks already present locally

The full history modal includes its own search input. It filters local cached rows immediately and forwards the same query to `list_server_sessions` so server-only rows, SDK titles, directories, and workspace badges stay current.

## History Modal Deduplication

The modal renders a single unified list from local `SessionStore` rows plus `SessionManager.listSessions()` results. It uses the server session id as the identity when present:

- local rows are grouped by `cliSessionId || id`
- synced rows are shown once, not once as "local" and again as "server"
- server title is preferred for synced rows; local title is only a fallback
- server-only rows remain clickable and are imported on demand through `resume_server_session`

The store also performs the same consolidation on load/recovery, so the modal-level dedupe is a defensive UI layer rather than the primary data repair mechanism.

## Session Titles

OpenCode server titles are the source of truth for synced sessions. Local rename commands call `SessionStore.setTitle()`, which persists the local cache and propagates to the server via `SessionManager.updateSessionTitle()` / SDK `client.session.update({ path: { id }, body: { title } })`. Incoming `session.updated` SSE events apply `info.title` back into the local cache through `SessionStore.applyServerTitle()`.

## Stale Responses

The webview ignores a `session_list` response when its `query` no longer matches the current welcome search input. This prevents slower responses for older keystrokes from replacing newer search results.

## Fallbacks

The OpenCode SDK/server session list is the primary source of previous sessions. The direct SQLite reader remains a command-level fallback for picker flows when the server is not running; it should not replace the SDK path for live webview search.
