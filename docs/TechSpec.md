# Tech Spec: OpenCode Harness

## Overview
OpenCode Harness is a VS Code extension that integrates the opencode AI coding agent into the editor. It follows a Client-Server model where the extension acts as a client to the opencode HTTP server, communicating via the `@opencode-ai/sdk` package using REST API calls and SSE event streams.

## Architecture

### System Diagram
```
┌──────────────────────────────────────────────────────┐
│                  VS Code Extension Host                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Chat          │ │ TabManager   │ │ Session       │  │
│  │ Provider      │◄┤ (concurrency)│ │ Store         │  │
│  │ (orchestrator)│ └──────────────┘ │ (persistence) │  │
│  └──────┬───────┘ ┌──────────────┐ └──────────────┘  │
│         │           │ StreamCoord. │                    │
│         │           │ (per-tab      │                    │
│         │           │  streaming)   │                    │
│         ▼           └──────┬───────┘                    │
│  ┌──────────────┐         │                            │
│  │ MessageRouter│◄────────┘                            │
│  │ (webview msg  │                                      │
│  │  routing)     │                                      │
│  └──────┬───────┘                                      │
│         │           ┌──────────────┐ ┌──────────────┐   │
│         └──────────►│ DiffHandler  │ │ WebviewContent│   │
│                     │ (diff track) │ │ (HTML/CSS)    │   │
│                     └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Context       │ │ Model         │ │ Rate Limit    │   │
│  │ Engine        │ │ Manager       │ │ Monitor       │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Inline        │ │ Skill         │ │ Checkpoint    │   │
│  │ Actions       │ │ Manager       │ │ Manager       │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐                    │
│  │ Terminal      │ │ Theme         │                    │
│  │ Bridge        │ │ Manager       │                    │
│  └──────────────┘ └──────────────┘                    │
└────────────────────────────┼────────────────────────────┘
                              │ @opencode-ai/sdk
                              ▼
                  ┌───────────────────┐
                  │ opencode serve    │
                  │ (HTTP :4096)      │
                  │ REST + SSE        │
                  │ Multi-session     │
                  └───────────────────┘
```

### Tech Stack
- **Runtime**: TypeScript / Node.js
- **Framework**: VS Code Extension API (^1.98.0)
- **SDK**: @opencode-ai/sdk (official opencode SDK)
- **UI**: Webview (HTML/CSS/TypeScript embedded in VS Code extension)
- **Testing**: Playwright (E2E), ts-jest (unit)
- **Build**: esbuild, npm

### Data Flow
1. User opens chat panel → Extension activates ChatProvider with TabManager
2. First chat open → Extension starts opencode server (`opencode serve`)
3. User sends message in webview → MessageRouter routes to appropriate handler
4. Extension calls opencode server via SDK → REST API or SSE stream
5. Server streams agent state via SSE → StreamCoordinator manages per-tab streams
6. Agent generates code changes → DiffHandler creates diff → presented in webview
7. User reviews diff → applies via VS Code's undoable edit API (transactional)

## API Contracts

### opencode Server Endpoints (via SDK)
- `POST /chat` - Send message to agent
- `GET /chat/stream` - SSE stream for real-time agent state
- `GET /sessions` - List active sessions
- `POST /sessions` - Create new session (for new tab)
- `DELETE /sessions/:id` - Close session (soft-close preserves history)

### Internal Extension APIs
- `SessionManager` - Manages server lifecycle, session persistence
- `TabManager` - Handles multi-tab concurrency (max 3)
- `StreamCoordinator` - Manages per-tab SSE streams
- `MessageRouter` - Routes webview messages to handlers
- `DiffHandler` - Tracks and presents code diffs

## Security & Compliance
- Extension does NOT handle API keys directly (opencode server manages auth)
- All communication is local (HTTP on localhost:4096)
- Extension gracefully degrades when server is unavailable
- No telemetry/analytics without user consent
- VS Code's built-in security model is used for webview sandboxing

## Dependencies
| Dependency | Version | Purpose |
|-----------|---------|---------|
| @opencode-ai/sdk | latest | Official SDK for opencode server communication |
| VS Code API | ^1.98.0 | Extension runtime |
| esbuild | latest | Build tool |
| playwright | latest | E2E testing |
| ts-jest | latest | Unit testing |
| @types/vscode | ^1.98.0 | TypeScript definitions |

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| opencode server unavailable | M | H | Graceful degradation, user notification |
| Exceeding 3 concurrent tab limit | L | M | UI disable for new tabs, user warning |
| SSE stream disconnection | M | M | Auto-reconnect logic, stream health checks |
| Diff apply conflicts | L | H | Transactional writes only, VS Code undo API |
| Extension performance degradation | L | M | Webview message batching, worker threads |
