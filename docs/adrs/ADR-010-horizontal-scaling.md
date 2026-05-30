# ADR-010: Horizontal Scaling & Process Isolation

**Date:** 2026-05-30
**Status:** Proposed (phase-2 target)

## Context

The extension currently runs all AI sessions through a single `opencode serve` process. All 3 concurrent streams share one Node.js process. A CLI crash kills all active tabs.

### Current Architecture
- Single `SessionManager` → single `opencode serve` child process
- `StreamCoordinator` manages up to 3 concurrent streams in-process
- All tabs share one SSE connection to the server
- No fault isolation between tabs

### Limitations
1. **Single point of failure:** CLI crash = all tabs die
2. **No memory isolation:** One long stream can starve others
3. **No horizontal scaling:** Can't distribute across cores
4. **Merge conflict density:** 3-5 person team sees 2:1 conflict-to-value ratio on shared streaming code

## Decision

### Phase 1 (Completed — ADR-010a)
Break dependency cycles and decompose god functions so the codebase CAN be split:
- Cycle elimination via `StreamCoordinatorTypes`, `syntaxHighlighter`, `streamShared`, `PromptSender` interface
- `createComposer` decomposed from complexity 219 into 5 focused modules
- `ChatProvider` decomposed from 136 methods into 9 service classes

### Phase 2 (Target)
Introduce a `SessionProcessManager` abstraction that can manage multiple `opencode serve` processes:

```typescript
interface SessionProcessHandle {
  readonly id: string
  readonly status: 'running' | 'crashed' | 'stopped'
  readonly pid?: number
  start(config: SessionConfig): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  onCrash: Event<void>
}

interface SessionProcessManager {
  spawnSession(config: SessionConfig): Promise<SessionProcessHandle>
  killSession(id: string): Promise<void>
  listActive(): SessionProcessHandle[]
  onSessionCrash: Event<{ id: string; handle: SessionProcessHandle }>
}
```

### Crash Resilience (Phase 1.5 — Now)
Persist active session state to disk so tabs survive CLI crashes:
- `SessionStore` already persists to `globalState`
- Add `TabRestorationState` that records streaming tabs + their last known message IDs
- On reconnect after crash, auto-restore tabs and offer to resume interrupted streams

## Consequences

### Positive
- Tab isolation: one tab's crash doesn't affect others
- Horizontal scaling: can run on multiple cores
- Independent restart: can restart one tab's server without killing all
- Better merge dynamics: separate process modules mean fewer conflicts

### Negative
- More memory per tab (separate process overhead)
- More complex lifecycle management
- Need inter-process communication layer

### Risks
- `opencode serve` may not support multiple instances on same port
- SQLite session DB may have write contention with multiple processes
- Need to coordinate port allocation for multiple server instances
