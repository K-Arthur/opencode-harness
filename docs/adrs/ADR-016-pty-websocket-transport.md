# ADR-016: PTY WebSocket Transport (Slice B)

**Date:** 2026-06-16
**Status:** Accepted

## Context

The opencode server manages pseudo-terminal (PTY) sessions for running shell commands. The extension needs to integrate with this PTY subsystem to support features like live shell output, interactive subagent terminals, and the tool execution pipeline.

The opencode server exposes two mechanisms for PTY interaction:

- **REST API** (`POST /pty`, `GET /pty/{id}`, `DELETE /pty/{id}`, `PATCH /pty/{id}`) — manage session lifecycle (create, query, resize, destroy)
- **SSE events** (`pty.created`, `pty.updated`, `pty.exited`, `pty.deleted`) — session-less lifecycle notifications via the existing event stream
- **WebSocket endpoint** (`GET /pty/{id}/connect?ticket=<ticket>`) — real-time bidirectional I/O (stdin → server, stdout/stderr ← server)

## Decision: Slice B (WebSocket)

The PTY subsystem uses **WebSocket** as the primary transport for real-time terminal I/O, with HTTP REST for lifecycle management and SSE for lifecycle events.

**Why not Slice A (HTTP polling):**

The `Pty` type returned by the REST API contains only metadata (`id, title, command, status, pid, exitCode`). It has **no output fields** (stdout, stderr). HTTP polling of `GET /pty/{id}` cannot deliver terminal output — the WebSocket endpoint is the only way to receive live output.

**Why WebSocket:**

1. **Full-duplex** — stdin must flow in while stdout/stderr streams out. SSE or polling can handle one direction; WebSocket handles both.
2. **Real-time** — terminal output must arrive as it's produced, not on a poll interval.
3. **connectToken auth** — the server provides a short-lived single-use ticket (`POST /pty/{id}/connect-token → {ticket, expires_in}`) specifically for authenticating WebSocket upgrades, avoiding credential exposure in the WS URL.
4. **Bidirectional resize** — terminal resize events (`rows, cols`) travel in-band over the WebSocket or via the REST `PATCH` endpoint.

## Implementation

### Files

| File | Purpose |
|------|---------|
| `src/session/ptyTypes.ts` | `PtySessionInfo`, `PtyOutputEvent`, `PtyLifecycleEvent`, `PtyConnectToken`, `PtyService` types |
| `src/session/PtyService.ts` | `PtyService` class — wraps the SDK `client.pty.*` endpoints + WebSocket management |
| `src/session/eventHandlers/PtyEventHandler.ts` | Normalizes `pty.{created,updated,exited,deleted}` SSE events into `OpencodeEvent`s |
| `src/session/SessionManager.ts` | Exposes `ptyService` as a public property, disposes it on stop/cleanup |
| `src/session/eventCoverage.ts` | PTY events are handled by `PtyEventHandler`; unknown `pty.*` sub-events remain safe-ignored via prefix net |

### Flow

1. **Create:** `client.pty.create({command, args, cwd, title})` → `{id, status: "running", pid}`
2. **Connect:** `client.pty.connectToken({ptyID})` → `{ticket, expires_in}`
3. **Stream:** `new WebSocket(ws://host/pty/{id}/connect?ticket=<ticket>)` → bidirectional I/O
4. **Resize:** `client.pty.update({ptyID, size: {rows, cols}})` or in-band WebSocket messages
5. **Destroy:** `client.pty.remove({ptyID})` → closes WebSocket + kills PTY process
6. **Events:** SSE delivers `pty.{created,updated,exited,deleted}` for session-less lifecycle tracking

### PTY Event Classification

`pty.created`, `pty.updated`, `pty.exited`, `pty.deleted` are **handled events** (routed through `PtyEventHandler`). Unknown future `pty.*` sub-events (e.g., `pty.resized`) remain **safe-ignored** via the `SAFE_IGNORED_EVENT_PREFIXES` prefix net in `eventCoverage.ts`.

## Consequences

### Positive
- Real-time bidirectional terminal communication
- Secure auth via short-lived connect tokens
- Lifecycle events decoupled from session context (session-less)
- Reuses existing SSE infrastructure for lifecycle notifications

### Negative
- WebSocket connections require explicit lifecycle management (reconnect, cleanup)
- WebSocket connections don't survive server restarts (must re-create PTY)
- No built-in reconnection for PTY WebSockets (design choice: create new PTY)

### Risks
- WebSocket scalability (only 1 WS per PTY session; acceptable)
- Ticket expiration during long-lived PTY sessions (mitigated by `expires_in` + re-ticketing)
