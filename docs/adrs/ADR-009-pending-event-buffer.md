# ADR-009: Race-tolerant Server-Event Routing via Pending Event Buffer

**Status:** Accepted (2026-05-17)

## Context

The extension subscribes to opencode's global SSE stream (`GET /global/event`) and dispatches each event to a tab using the `event.sessionID → tabId` lookup maintained by `TabManager.cliSessionIndex`. The mapping is populated by `TabManager.setCliSessionId(tabId, cliSessionId)`.

When the user sends the first message in a fresh tab, the flow is:

1. `StreamCoordinator.startPrompt` calls `await sessionManager.ensureSession(...)`.
2. The opencode server creates the session and returns its server ID. Concurrently — sometimes within the same TCP frame — the server begins emitting events (`session.created`, `session.diff`, `message.part.updated`, `tool_start`, …) on the SSE stream.
3. Control returns to `StreamCoordinator`, which calls `tabManager.setCliSessionId(tabId, cliSessionId)`.

Events emitted between steps 2 and 3 reach `ChatProvider.handleServerEvent` before the mapping exists. Prior to this ADR the router dropped them:

```ts
if (!tab && event.sessionId && event.type !== "session_status" && event.type !== "server_connected") {
  log.warn(`Dropping server event ${event.type} for unknown cliSessionId "${event.sessionId}"`)
  return
}
```

In production this manifested as a tab that appeared frozen after the first message: `session_status` (`busy`) was whitelisted and got through, but `message.part.updated`, `file.edited`, `tool_*`, and `message_complete` were dropped. The streaming spinner stayed visible forever because the tab's `isStreaming` flag was only cleared by `message_complete → maybeFinalizeStream → cleanupTab`, which never ran.

A secondary failure mode: `setCliSessionId(tabId, cliSessionId)` silently returned `false` if the tab record was missing (e.g., the tab had been closed during the `await`), with no log line, making this class of bug undiagnosable from the output channel.

## Decision

### 1. Buffer events whose target mapping has not been registered yet

Introduce `src/chat/PendingEventBuffer.ts` — a per-`cliSessionId` FIFO queue with a 5-second TTL and a 200-event-per-session cap. `ChatProvider.handleServerEvent` no longer drops on a missed lookup; it pushes the event to the buffer and returns.

### 2. Replay on registration

`TabManager` exposes a new `onCliSessionIdRegistered` `EventEmitter`. `ChatProvider` subscribes; when a mapping is registered, it drains the buffer for that `cliSessionId` and re-routes each event through the same `handleServerEvent` path. The replay reuses the regular handler dispatch, so no event-type-specific logic duplication is needed.

### 3. Expiry, not infinite buffering

If the mapping never arrives within 5 seconds, the buffer fires a single warn-level log line citing the dropped event count and discards the queue. This bounds memory and surfaces the rare cases where the mapping is genuinely lost (e.g., the tab was closed before `setCliSessionId` ran).

### 4. Loud diagnostics on registration failure

`TabManager.setCliSessionId` now logs at `error` level if `tabs.get(id)` returns undefined, naming both `id` and `cliSessionId`. The previous silent `return false` made the rare "mapping lost" path invisible.

### 5. Bounded backfill spam

Independently, `ChatProvider.scheduleBackfillRetry` now clears `needsBackfill` on the affected sessions after the last retry attempt, and `backfillRecoveredSessions` no longer iterates all tabs to log "not backfilled" diagnostics when there is nothing to backfill. The output channel stays readable after the retry budget is exhausted.

## Alternatives considered

- **Register the mapping before `await`**. Not feasible — the `cliSessionId` only exists after the server responds.
- **Synchronously short-circuit `session.create` with a placeholder ID**. Would require coordinated changes in both the SDK and the server; out of scope.
- **Block SSE event processing until the mapping is registered**. Would couple the SSE pipeline to a single tab's lifecycle and risk head-of-line blocking across unrelated sessions.

## Consequences

- One small new module (`PendingEventBuffer`) with isolated tests (`PendingEventBuffer.test.ts`).
- `ChatProvider.handleServerEvent` becomes idempotent across buffer-then-replay paths (it was already idempotent for direct dispatch).
- Memory cap: 200 events × 5s TTL × N concurrent unregistered sessions is bounded and small in steady state. The cap is configurable for future tuning.
- No behavior change for events whose mapping is registered in time — the buffer is consulted only on the miss path.

## Verification

- Unit: `src/chat/PendingEventBuffer.test.ts` covers FIFO order, per-session isolation, drain semantics, TTL expiry, the per-session cap, the empty-sessionId guard, and `dispose()` cancellation.
- Integration (manual): start a new tab, send a first message, observe no `Dropping server event` warnings in the extension output channel and verify the assistant response renders incrementally to completion.
