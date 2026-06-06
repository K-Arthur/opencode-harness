# ADR-014: Immutable Local Session Key (supersedes the rekey decision in ADR-007)

**Status:** Accepted (2026-06-06)

**Supersedes:** ADR-007 §1 ("Server session ID is the canonical session ID" — the part that rekeys the `SessionStore` map under the server id) and ADR-007 §2 step 2 (canonicalize local rows under the server id on import). The rest of ADR-007 (bidirectional import, remote attach, session-start baseline, the new commands) stands.

## Context

ADR-007 declared the opencode **server** session id (`ses_…`) the canonical key and had the `SessionStore` map **rekeyed** to it — at load (`SessionStore.migrateLocalIdsToServerIds()`, run in the constructor) and on every server connect/reconnect (`SessionStore.importServerSessions()` → `mergeServerSessions()`, fired by the `sessions_recovered` event). ADR-007's implementation note claimed: *"No change to webview protocol — the webview already keys by session ID, so the rekey is transparent to it."*

**That claim was false.** Three layers key session state independently and the rekey was never propagated to two of them:

| Layer | Keyed by | Set when |
|---|---|---|
| `SessionStore` map | `session.id` | create / import |
| `TabManager` (`tabs`, `activeTabId`, persisted `openTabs`) | `tab.id` | `createTab(id, …)` |
| Webview (`state.sessions[id]`, DOM `data-tab-id`, `streamHandlers`, `scrollPositions`) | `session.id` | `createSession()` → `session-<8hex>` |

For a session created in the extension, all three start equal to the webview-minted `session-<8hex>` id. The opencode server id is server-generated and only learned **after** the first prompt (`SessionManager.ensureSession` → `session.create`). It is stored in the separate `cliSessionId` **field** (`SessionStore.updateCliSessionId`, which correctly does *not* rekey) and indexed for SSE routing in `TabManager.cliSessionIndex` (`cliSessionId → tab`).

When `mergeServerSessions`/`migrateLocalIdsToServerIds` then rekeyed the store entry from `session-<8hex>` to `ses_…`, only the store moved. The `TabManager` tab and the webview kept `session-<8hex>`. The store entry was now divorced from its own still-open, possibly-streaming tab.

### Observed failure modes (all one root cause)

- **Messages appear only after reopening a session.** Live SSE still rendered (routing uses `cliSessionId` via `cliSessionIndex`, which was unaffected), but every persistence call keyed by the tab id — `appendMessage(tabId)`, `getContextUsage(tabId)`, `updateContextUsage`, etc. — silently no-oped because `sessions.get("session-<8hex>")` was now `undefined`. Reopening the session from the picker fetched the transcript fresh from the server under `ses_…`, "magically" fixing it.
- **Duplicated sessions.** The next webview message for `session-<8hex>` hit `ensureLocalTab → SessionStore.ensure("session-<8hex>")`, which created a **new empty** entry — now two rows for one server session (`session-<8hex>` empty + `ses_…` with history).
- **Failed continuation after a question/answer.** `question_answer` routes through `ensureLocalTab(sessionId)` + `appendMessage(sessionId)` with the webview tab id; after a rekey those hit the recreated empty row while the server prompt went to `ses_…`.
- **Incorrect restoration / stale active session after reload.** On the next launch the constructor migrator rekeyed `session-<8hex>` → `ses_…`, but the webview and `TabManager` restored `session-<8hex>` from their own persisted state. `pushInitStateToWebview` could not resolve the tab to a store row.

The trigger is routine: it fires for **any** extension-created session that has sent at least one prompt, on the next server reconnect (network blip, server restart) or extension/window reload.

## Decision

**The `SessionStore` map key is immutable for the life of a session.** It is the session's *local* identity and is shared verbatim by `SessionStore`, `TabManager.tab.id`, and the webview. It is assigned exactly once at creation and is **never** changed by import, migration, or reconnect.

**`cliSessionId` is the one and only canonical opencode link.** It is the server-generated `ses_…` id, treated as opaque (clients cannot choose it — opencode issue #12916). It is the only value sent to the server (`session.prompt`, `session.get`, `session.messages`) and the only value matched against the SSE `event.sessionID`. The `cliSessionId → tab` mapping for routing lives in `TabManager.cliSessionIndex`.

Concretely:

1. `mergeServerSessions` (import-on-(re)connect): when an existing local row already resolves to the imported server id, **reaffirm `cliSessionId` and sync server-driven fields only — never delete/move the key.** Dedup is by `cliSessionId`, so no duplicate row is created and no rekey is needed.
2. `migrateLocalIdsToServerIds` (load): **never rekey a solo entry.** It is reduced to collapsing *genuine legacy duplicates* — two pre-ADR-014 rows that already resolve to the same `cliSessionId` — into one. `MigrationResult.rekeyed` is retained in the shape for compatibility and is always `0`.
3. `updateCliSessionId` keeps its existing (correct) field-only behavior and now logs the link `localKey → cliSessionId` and warns if the local key is missing (a divergence tripwire).
4. `promotePendingServerLink` (pure helper) still rekeys, but **it has no caller** — offline→online promotion happens through `updateCliSessionId` (field-only). If it is ever wired up, it MUST also rekey `TabManager` and post a `session_id_changed` message to the webview. This is noted in code.

## Why not "propagate the rekey to all three layers" instead?

That is the ADR-007-faithful alternative: emit `session_rekeyed {from,to}`, have `TabManager.rekeyTab` and a webview `session_id_changed` handler remap their keyed state. Rejected as the primary fix because the rekey fires **mid-stream** (on reconnect), and the webview would have to atomically remap live DOM (`data-tab-id`), `streamHandlers`, `scrollPositions`, timers, and `sessionOrder` while a stream is writing into them — high risk of introducing new streaming corruption, and hard to verify without a real DOM. Keeping the key immutable removes the need for any cross-layer remap: nothing ever diverges, so there is nothing to reconcile. Unifying the key bought no functional benefit because `cliSessionId` already provides the server link and SSE routing.

## Consequences

**Positive**
- The three layers can never disagree about a session's identity; the entire class of "rekey drift" bugs is structurally impossible.
- No mid-stream webview remap, so zero new streaming risk.
- Live rendering and persistence now use the *same* key, so streamed output survives reconnect/reload without reopening.

**Negative / neutral**
- Extension-created sessions stay keyed by `session-<8hex>` in `globalState` forever (cosmetic; never user-visible — the picker shows titles, and the server link is `cliSessionId`). CLI-imported sessions are still keyed by the server id (they have no local counterpart at import time), so the key space is mixed — which is fine, because nothing assumes `key === cliSessionId`.
- **Legacy already-diverged state is not auto-healed.** A user whose `globalState` was rekeyed to `ses_…` by a pre-ADR-014 build while their webview kept `session-<8hex>` will still see that one stale row until they reopen it from the picker. New divergence cannot occur. (A heal-on-restore pass is listed as a future improvement.)

## Verification

- Pure-function regression tests: `src/session/sessionIdentityLifecycle.test.ts` (create→prompt→reconnect→reload keeps one stable key; no duplicate ever spawned) and updated `src/session/sessionMigration.test.ts` (import/migrate reaffirm `cliSessionId` without rekeying; legacy duplicate still collapses).
- `tsc --noEmit` clean; full unit suite green.
- Manual flows that must be re-checked in a live Extension Development Host are listed in `docs/session-identity.md` (§Manual QA).

## References
- ADR-007 (Unified Session Identity) — the decision this revises.
- ADR-009 (Pending Event Buffer) — the other half of robust SSE routing; unaffected.
- opencode issue #12916 — confirms session ids are server-generated and not client-settable.
- `src/session/sessionMigration.ts`, `src/session/SessionStore.ts`, `src/chat/TabManager.ts`, `src/chat/handlers/StreamCoordinator.ts`, `src/chat/SessionLifecycleService.ts`.
