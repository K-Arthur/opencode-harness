# ADR-001: Client-Server Architecture with opencode SDK

**Status:** Accepted

## Context

OpenCode Harness needs to integrate the opencode AI coding agent into VS Code. We need to decide how the VS Code extension communicates with the opencode agent.

## Decision

We will use a **Client-Server architecture** where:
- The extension acts as a **client** to the opencode HTTP server
- Communication happens via the official `@opencode-ai/sdk` npm package
- The server exposes a full OpenAPI 3.1 REST API + SSE event stream on a local port (default: 4096)
- The extension does NOT embed or spawn the opencode CLI directly for chat

## Alternatives Considered

1. **Embed opencode CLI directly in extension**: Rejected because it would tie the extension to CLI-specific behavior and make updates harder.

2. **Direct HTTP calls without SDK**: Rejected because the SDK provides typed interfaces and handles SSE streaming complexities.

3. **WebSocket instead of REST + SSE**: Rejected because SSE is simpler for server-to-client streaming, and REST covers client-to-server commands adequately.

## Consequences

**Positive:**
- Provider-agnostic: Extension has zero knowledge of LLM providers (all communication flows through opencode server)
- Clean separation of concerns: Extension handles UI/UX, server handles AI/agent logic
- Typed communication via SDK reduces runtime errors
- Server can be updated independently of extension

**Negative:**
- Requires server process lifecycle management (start/stop/restart logic)
- Network dependency: Extension depends on localhost server being available
- SSE streaming adds complexity to `StreamCoordinator`

**Mitigations:**
- Graceful degradation when server is unavailable (every component handles this case)
- `SessionManager` handles server lifecycle with health checks and auto-restart
- Port management algorithm finds free ports and persists last-known port

## References

- Architecture Spec Section 1.1: High-Level Architecture
- `SessionManager.ts`: Server lifecycle management
- `@opencode-ai/sdk`: Official SDK for server communication
