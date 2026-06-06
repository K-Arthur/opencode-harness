# Session Identity & Lifecycle

How session ids flow through the OpenCode Harness extension, what the canonical
ids are, and the invariants you must not break. Read this before touching
`SessionStore`, `TabManager`, `StreamCoordinator`, the webview state, or the SSE
event router. The governing decision is **ADR-014 (immutable local session
key)**, which revises the rekey part of ADR-007.

## The two ids

There are exactly **two** identifiers for a conversation, and they live at
different layers. Do not conflate them.

| Id | Shape | Owner / origin | Mutable? | Used for |
|---|---|---|---|---|
| **Local session key** (`session.id` / `tab.id`) | `session-<8hex>` (extension-created) or `ses_…` (CLI-imported) or a legacy uuid | Minted by the **webview** (`state.ts createSession`) for new sessions; equals the server id for sessions imported from the CLI | **No — immutable for the life of the session** | Keying `SessionStore`, `TabManager.tabs`, webview `state.sessions`, DOM `data-tab-id`, persistence, and **all** host↔webview messages (`sessionId` field) |
| **opencode server session id** (`cliSessionId`) | `ses_…` | **Server-generated** by `session.create`; opaque; clients cannot choose it (opencode #12916) | Set once, then stable | The only value sent to the server (`session.prompt/get/messages`); the only value matched against SSE `event.sessionID`; indexed by `TabManager.cliSessionIndex` for routing |

> **Rule of thumb:** if a value crosses the wire to the opencode server or
> arrives on an SSE event, it is a `cliSessionId`. Everything inside the
> extension and webview is keyed by the **local key**.

## Lifecycle of a session created in the extension

```
Webview                      Extension host                         opencode server
───────                      ──────────────                         ───────────────
createSession()
  id = "session-ab0c12d3"  ─ send_prompt {sessionId:"session-ab0c12d3"} ─►
                             ensureLocalTab("session-ab0c12d3")
                               SessionStore.ensure(...)  key="session-ab0c12d3"
                                                         pendingServerLink=true
                               TabManager.createTab("session-ab0c12d3")
                             StreamCoordinator.startPrompt("session-ab0c12d3")
                               ensureSession(undefined) ──── session.create ───────►
                                                        ◄──── { id:"ses_x" } ───────
                               updateCliSessionId("session-ab0c12d3","ses_x")  ← field only, NO rekey
                               TabManager.setCliSessionId("session-ab0c12d3","ses_x")
                                 cliSessionIndex["ses_x"] = tab
                               session.prompt("ses_x", …) ───────────────────────►
◄─ stream_start {sessionId:"session-ab0c12d3"} ─                     SSE: {sessionID:"ses_x", …}
                             handleServerEvent: cliSessionIndex["ses_x"] → tab
                               dispatch to webview with sessionId = tab.id ("session-ab0c12d3")
◄─ text_chunk {sessionId:"session-ab0c12d3"} ──
```

The local key (`session-ab0c12d3`) is the same string in all three layers from
creation onward. The server id (`ses_x`) lives only in `cliSessionId` and the
routing index. **Neither layer ever renames the other's key.**

## Routing (SSE → webview)

`ChatProvider.handleServerEvent`:

1. `resolveServerEventTab(event)` → `cliSessionIndex.get(event.sessionId)` (the
   server id), falling back to `getTab(event.sessionId)` for the rare case where
   the local key *is* the server id (CLI-imported sessions).
2. If no tab yet (the `session.create` ↔ `setCliSessionId` race window), the
   event is parked in `PendingEventBuffer` and replayed on
   `onCliSessionIdRegistered` (ADR-009).
3. Otherwise it dispatches to the webview using **`tab.id`** (the local key), so
   the webview always sees its own key.

## Invariants (do not break these)

1. **The local key is immutable.** Never call `bySessionId.delete(oldKey)` +
   `set(newKey)` for a *live* session. ADR-014 removed the only two places that
   did (`mergeServerSessions`, `migrateLocalIdsToServerIds`). If you think you
   need to rekey, you actually need to set `cliSessionId` instead.
2. **Link via `cliSessionId`, route via `cliSessionIndex`.** Dedup on import is
   by `cliSessionId`, not by rewriting keys.
3. **Every host→webview message carries the local key in `sessionId`.** The
   webview cannot interpret a `ses_…` id; the host must translate first.
4. **`updateCliSessionId` sets a field; it must never move a map key.**
5. If a future feature genuinely must change a key (e.g. wiring up
   `promotePendingServerLink`), it MUST do all three atomically:
   `SessionStore` rekey → `TabManager.rekeyTab` → post `session_id_changed
   {oldId,newId}` to the webview, and the webview must remap `state.sessions`,
   `sessionOrder`, `scrollPositions`, `streamHandlers`, timers, and the DOM
   `data-tab-id`. Because that is large and stream-unsafe, prefer not to.

## Why this matters (the bug ADR-014 fixed)

Before ADR-014, the server import (fired on **every** reconnect) and the
load-time migrator rekeyed the store entry from `session-<8hex>` to `ses_…`
without telling `TabManager` or the webview. The store then pointed at a key no
open tab used. Symptoms: streamed messages rendered live but were never
persisted (so they "appeared only after reopening"); the next prompt spawned a
duplicate empty row; question/answer continuation wrote to the wrong row; reload
restored a session the store could no longer resolve. One immutable-key rule
makes the whole class impossible.

## Diagnostics

Watch the **OpenCode** output channel:

- `Session link: localKey="…" → cliSessionId="…"` — the moment a local session
  binds to a server session. Should appear once per session, on first prompt.
- `updateCliSessionId: no session for local key "…"` (warn) — a divergence
  tripwire. Must never appear under ADR-014; if it does, a rekey leaked back in.
- `Imported N server session(s), pruned …` — `sessions_recovered` import.
- `setCliSessionId failed: no tab with id "…"` (error) — the ADR-009 race lost a
  tab; events would be dropped (now buffered).
- `Buffered <type> for cliSessionId "…"` — normal during the create↔register
  race; should drain within milliseconds.

## Manual QA (requires a live Extension Development Host — not automatable here)

Run these in VS Code (`code --install-extension opencode-harness-<v>.vsix`, then
reload) and watch the OpenCode output channel for the diagnostics above:

1. **Create → stream → reconnect.** New session, send a prompt, let it stream;
   restart the opencode server mid-stream (or toggle network). The same tab must
   keep rendering and the transcript must persist — **no** new duplicate row in
   the session picker, no need to reopen.
2. **Reload.** With a created+prompted session open, reload the window
   (`Developer: Reload Window`). The same session must restore with its
   transcript; the picker must not show a second copy.
3. **Question/answer.** Trigger a `question` tool call, answer it; the stream
   must continue in the *same* bubble and persist.
4. **Switch during stream.** Start a long response, switch to another tab, switch
   back; neither session's transcript is corrupted.
5. **CLI parity.** Create a session in the `opencode` CLI; it must appear in the
   picker (import), open with its transcript, and accept new prompts that the
   CLI also sees.
