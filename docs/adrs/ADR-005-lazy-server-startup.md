# ADR-005: Auto-Start Server on Activation with Port Management

**Status:** Accepted (Supersedes Lazy Server Startup)

## Context

The OpenCode server should be ready immediately when the user opens the chat panel. Previously, we used lazy startup (server started on first prompt), which caused the "Disconnected" status to appear after every VS Code reload and injected confusing "No server commands available" messages into chat history.

## Decision

We will use **Auto-Start Server on Activation** with port persistence and reuse:
- Server starts automatically when the extension activates (not lazy startup)
- Port management algorithm:
  1. Check `globalState` for last known port
  2. Attempt health check on stored port (reuse if healthy)
  3. If unreachable: find free port via `findFreePort()`
  4. Spawn `opencode serve --port {n} --hostname 127.0.0.1`
  5. Poll `/global/health` every 250ms until response (max 10s timeout)
  6. Create SDK client with `createOpencodeClient({ baseUrl })`
  7. Store port in `globalState` for next session
  8. Clear stored port on disconnect

## Alternatives Considered

1. **Lazy startup (start on first prompt)**: Rejected because it caused "Disconnected" status after reload and chat history spam with "No server commands available" messages.

2. **Fixed port (4096 always)**: Rejected because port may be in use by another process.

3. **Random port each time**: Rejected because we want to reuse the same port when possible (faster startup) and prevent orphaned processes.

## Consequences

**Positive:**
- Extension is ready immediately after activation (no "Disconnected" status)
- No more chat history spam with misleading system messages
- Port persistence prevents orphaned server processes
- Health checks ensure server is ready before accepting requests
- Port conflict resolution (automatically finds free port)

**Negative:**
- Slightly slower extension activation (server startup time)
- Port management logic adds complexity to `SessionManager`
- Health check polling with timeout handling

**Mitigations:**
- Server startup errors are caught and logged as warnings (don't block activation)
- `globalState` persistence avoids port scanning on every startup
- 10-second timeout with clear error message if server fails to start

## References

- Architecture Spec Section 2.2: SessionManager port management algorithm
- `SessionManager.ts`: `start()` method with port management and `setStoredPort()`
- `extension.ts`: Auto-start call and port persistence via `globalState`
- `globalState.update('opencode-server-port', port)` for persistence
