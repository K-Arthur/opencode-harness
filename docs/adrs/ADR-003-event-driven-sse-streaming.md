# ADR-003: Event-Driven Architecture with SSE Streaming

**Status:** Accepted

## Context

The opencode agent performs long-running operations (thinking, code generation, tool execution). We need a mechanism to provide real-time visibility into agent state without blocking the UI.

## Decision

We will use **Server-Sent Events (SSE)** for real-time agent state updates:
- Server exposes `/event` SSE stream per session
- `StreamCoordinator` manages per-tab SSE streams
- No polling: all agent state updates are pushed via events
- Event types include: `thinking`, `diff`, `response`, `done`, `error`

## Alternatives Considered

1. **WebSocket bidirectional**: Rejected because we only need server→client streaming; client→server uses REST.

2. **Long-polling**: Rejected because SSE is more efficient for one-way streaming and is natively supported by browsers.

3. **REST polling with status endpoint**: Rejected because polling creates latency and unnecessary requests.

## Consequences

**Positive:**
- Real-time visibility into agent state (no polling latency)
- Native browser support for SSE (EventSource API)
- Simple protocol: server pushes events, client listens
- Multiple event types allow granular UI updates

**Negative:**
- SSE connection management (reconnect logic needed)
- `StreamCoordinator` must handle stream lifecycle per tab
- Connection failures require graceful error handling

**Mitigations:**
- Auto-reconnect logic with exponential backoff in `StreamCoordinator`
- Stream health checks with timeout handling
- User-friendly error messages when stream fails

## Event Types

| Event Type | Purpose |
|-----------|---------|
| `thinking` | Agent is processing (show thinking state in UI) |
| `diff` | Code diff generated (route to `DiffHandler`) |
| `response` | Agent text response (display in chat) |
| `done` | Stream complete (update UI state) |
| `error` | Stream error (show error, offer retry) |

## References

- Architecture Spec Section 1.2: Design Principles (Event-driven)
- `StreamCoordinator.ts`: SSE stream management
- OpenAPI spec: `/event` SSE endpoint
