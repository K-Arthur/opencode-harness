# ADR-005: Lazy Server Startup with Port Management

**Status:** Accepted

## Context

The opencode server doesn't need to run until the user actually wants to chat. We also need to handle port conflicts and server restarts gracefully.

## Decision

We will use **Lazy Server Startup** with automatic port management:
- Server starts when user **first opens a chat tab** (not at extension activation)
- Port management algorithm:
  1. Check workspace state for last known port
  2. Try health check on that port
  3. If unreachable: find free port via `net.createServer().listen(0)`
  4. Spawn `opencode serve --port {n} --hostname 127.0.0.1`
  5. Poll `/global/health` every 200ms until response (max 5s timeout)
  6. Create SDK client with `createOpencodeClient({ baseUrl })`
  7. Store port in workspace state for next session

## Alternatives Considered

1. **Start server at extension activation**: Rejected because many users may never open the chat panel.

2. **Fixed port (4096 always)**: Rejected because port may be in use by another process.

3. **Random port each time**: Rejected because we want to reuse the same port when possible (faster startup).

## Consequences

**Positive:**
- Faster extension activation (no waiting for server startup)
- Port conflict resolution (automatically finds free port)
- Persistence: same port reused across VS Code sessions
- Health checks ensure server is ready before accepting requests

**Negative:**
- First chat open has latency (server startup time)
- Port management logic adds complexity to `SessionManager`
- Health check polling with timeout handling

**Mitigations:**
- Show "Starting opencode server..." progress indicator on first chat open
- Workspace state persistence avoids port scanning on every startup
- 5-second timeout with clear error message if server fails to start

## References

- Architecture Spec Section 2.2: SessionManager port management algorithm
- `SessionManager.ts`: `start()` method with port management
- VS Code API: `workspace.getConfiguration()` for state persistence
