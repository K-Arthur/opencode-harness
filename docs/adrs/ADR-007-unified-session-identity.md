# ADR-007: Unified Session Identity, Remote Attach, and Session-Start Baseline

**Status:** Accepted (2026-05-06)

## Context

The extension and the `opencode` CLI both connect to the same opencode HTTP server, but they previously kept two parallel session pools:

- **Local `SessionStore`** minted its own UUIDs (`crypto.randomUUID()`) for each session and lazily linked to a server session via `cliSessionId` only when the user sent a prompt.
- **Server-side sessions** (the source of truth for the CLI) lived in opencode's on-disk store, indexed by their own server-issued IDs.

This had three concrete user-visible problems:

1. **Sessions created in the CLI never appeared in the extension.** `SessionManager.recoverSessions()` fetched up to 3 server sessions on connect and fired `sessions_recovered`, but the extension handler only re-linked sessions the local store already knew about. CLI-only sessions stayed invisible.
2. **No remote-server support.** `SessionManager._start()` always spawned a local binary. There was no way to point the extension at a remote opencode server.
3. **No session-start baseline for git-backed undo.** `CheckpointManager` snapshotted per write/per message, but never at session start, so "restore to session start" was not a defined operation.

In addition, three user-requested entry points were missing or incomplete:

- **Continue Last Session** — implicit only; no command.
- **Choose History Session** — picker listed only local sessions; server-only sessions were invisible.
- **Attach to Remote** — not implemented.

## Decision

### 1. Server session ID is the canonical session ID

When the extension creates a new session, it does so by calling `SessionManager.createSession()` first and using the returned server-issued ID as the `SessionStore` key. Local-only IDs are no longer minted by `SessionStore.create()` for the happy path.

Two routes still produce sessions whose ID is locally generated:

- **Offline create** — when the server is not running, the store falls back to `crypto.randomUUID()` and marks the session `pendingServerLink: true`. On next server connect, the session is promoted: a server session is created and the local entry is rewritten under the server ID (one-shot, atomic, with a key migration in the persisted map).
- **Migration** — pre-existing local sessions with a `cliSessionId` are rekeyed to that ID on first load after upgrade.

### 2. Bidirectional session import on connect

`sessions_recovered` is now an import event, not just a re-link event:

1. For every server session the extension does **not** know about, import it: create a local entry keyed by the server ID, backfill `messages` lazily on first activation via `SessionManager.getMessages()`, and surface it in the picker with a "loading…" indicator until the backfill completes.
2. For every local session whose `cliSessionId` matches a server session, no-op (already linked).
3. For every local session whose `cliSessionId` is no longer on the server, leave the local message history intact but clear `cliSessionId` (current behavior).

The recovery cap is raised: instead of `MAX_RECOVERED_SESSIONS = 3` tabs auto-opening, all server sessions are imported into the store but only the most-recent N are surfaced as tabs. The rest live in the history picker.

### 3. Remote attach via `opencode.serverUrl`

A new configuration setting `opencode.serverUrl` (string, machine scope, default `""`) opts into remote-attach mode. When set:

- `SessionManager._start()` skips spawn entirely, parses the URL, and points the SDK at it.
- Health probe runs against `<serverUrl>/global/health`.
- Optional `opencode.serverAuthToken` (string, machine scope, default `""`) is sent as `Authorization: Bearer <token>`. The token is read at start time only and not persisted in tab state.
- `opencode.serverUrl` is validated before remote attach. Invalid URLs fail fast; non-HTTPS remote URLs warn unless they target localhost or loopback.
- On any server-side disconnect, the standard reconnect logic applies but does **not** fall back to local spawn — the user explicitly chose remote.

Local spawn remains the default. There is no automatic discovery.

### 4. Session-start baseline checkpoint

When a session is created (whether by local action, server import, or migration), `CheckpointManager.snapshot(sessionId, "baseline")` is invoked. It is cheap when the working tree is clean (already early-returns) and gives "restore to session start" a defined target. The baseline checkpoint is exempt from `MAX_CHECKPOINTS` pruning.

### 5. New user-facing commands

| Command ID | Behavior |
|---|---|
| `opencode-harness.continueLastSession` | Sets active to the most-recent non-archived session and opens chat. If none exists, behaves like `newSession`. |
| `opencode-harness.chooseHistorySession` | Quick-pick across local + server sessions (deduped by ID). Selecting an unbacked server session triggers backfill with `withProgress`. |
| `opencode-harness.attachRemote` | Prompts for URL + optional token, writes settings, restarts `SessionManager`. |

Existing `newSession` and `openStoredSession` remain.

## Alternatives Considered

1. **Keep dual-ID model, sync via lookup table.** Rejected: adds permanent complexity to every read path and never fixes the "CLI sessions invisible" complaint without also doing the import work. The unified ID does both in one shot.
2. **Versioned schema migration with `_schemaVersion` field on globalState.** Rejected for now: a one-shot rekey-by-`cliSessionId` migrator is sufficient because the store already gracefully drops invalid entries. We will add a schema version field if a second breaking change lands.
3. **Auto-fall-back from remote → local spawn on connect failure.** Rejected: silently switching to a different server would corrupt the user's mental model of which sessions exist where. Surface the failure instead.
4. **Snapshot baseline only when first prompt sent.** Rejected: by the time a prompt is sent, the user may already have edits in flight. Snapshot at create time gives a clean point.

## Consequences

**Positive:**
- Sessions created in the CLI appear in the extension (and vice versa).
- "Restore to session start" becomes a meaningful operation.
- Remote-server workflow unblocks shared-server / cloud-IDE use cases.
- Single source of truth for session IDs eliminates a class of edge cases (re-attach drift, tab-vs-store ID mismatches).

**Negative:**
- One-shot migration touches existing users' globalState. Mitigated by: only rekeying when `cliSessionId` is set and unique; logging every rewrite; preserving original entries if migration fails.
- Backfilling messages from the server on import has latency cost (one HTTP call per imported session). Mitigated by: lazy backfill on first activation, not on import.
- Remote attach exposes a new auth surface. Mitigated by: URL validation, token read from `machine`-scoped config, token never persisted in session state, and `https://` warnings for non-local remote URLs.

**Neutral:**
- `SessionStore.create()` signature gains an optional pre-resolved server ID. Existing call sites without a server ID still work but produce `pendingServerLink: true` entries.

## Implementation notes

- Tests added at the SessionStore boundary (RED phase): import idempotency, migrator rekey-by-cliSessionId, pendingServerLink promotion.
- `extension.ts:172` (`sessions_recovered` handler) becomes the single import entry point. Hash-then-rewrite is performed inside `SessionStore.importServerSessions(serverSessions)`.
- `SessionManager.authHeader` getter is added (currently referenced from `extension.ts:154` but missing).
- No change to webview protocol — the webview already keys by session ID, so the rekey is transparent to it.

## References

- ADR-001 (Client-Server Architecture)
- ADR-005 (Auto-Start Server on Activation with Port Management)
- src/session/SessionStore.ts
- src/session/SessionManager.ts
- src/checkpoint/CheckpointManager.ts
