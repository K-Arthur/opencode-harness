# ADR-010: Horizontal Scaling & Process Isolation

**Date:** 2026-05-30
**Status:** Complete

## Context

The extension currently runs all AI sessions through a single `opencode serve` process. All concurrent streams share one Node.js process. A CLI crash kills all active tabs.

### Current Architecture
- Single `SessionManager` → single `opencode serve` child process
- `StreamCoordinator` manages concurrent streams in-process
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

### Phase 1.5 (Completed — 2026-05-30)
Crash resilience — tabs survive CLI crashes and offer to resume:
- `TabRestorationState` type captures which tabs were streaming at crash time
- `TabManager.captureStreamingSnapshot()` persists streaming state to `globalState`
- On `server_disconnected`, snapshot is captured before clearing streaming states
- On `event_stream_reconnected`, `stream_interrupted` messages sent to webview for interrupted tabs
- Webview shows "Resume Stream" / "Dismiss" buttons for each interrupted tab
- `resume_stream` handler clears restoration state and calls `retryFromHere`
- `decline_resume` handler clears restoration state without retrying

### Phase 2 (Completed — 2026-05-30)
Multi-process infrastructure is wired into the runtime:

```typescript
// Concrete implementation wrapping N ServerLifecycle instances
class LocalSessionProcessManager implements SessionProcessManager {
  spawnSession(config: SessionConfig): Promise<SessionProcessHandle>
  killSession(id: string): Promise<void>
  listActive(): SessionProcessHandle[]
  getHandle(id: string): SessionProcessHandle | undefined
  readonly onSessionCrash: Event<{ id: string; handle: SessionProcessHandle }>
}

// Tab-to-process routing layer
class SessionManagerRegistry {
  getSessionManager(tabId?: string): SessionManager
  getDefault(): SessionManager
  registerProcess(processId: string, manager: SessionManager): void
  assignTab(tabId: string, processId: string): boolean
}
```

**Key design decision:** SQLite is shared (`~/.local/share/opencode/opencode.db`, WAL mode). Multiple concurrent writers cause `SQLITE_BUSY` or corruption. The default model is shared-process (all tabs → 1 server). Per-process isolation via `OPENCODE_DATA_DIR` is supported when `processStrategy` is set to `"per-tab"`.

### Performance: Configurable Stream Cap
- `opencode.sessions.maxConcurrentStreams` setting (default 5, range 1-10)
- `TabManager` reads the setting instead of hardcoded 3
- Webview receives value via `init_state` and updates runtime via `setMaxConcurrentStreams()`
- Analysis showed the extension can handle 5+ concurrent streams efficiently (per-session chunk batching, O(1) event routing)

## Consequences

### Positive
- Tab isolation via crash resilience: one tab's crash doesn't kill the session
- Configurable stream cap: users can tune based on their hardware
- Multi-process infrastructure ready: can enable per-process isolation when SQLite contention is resolved
- Better merge dynamics: separate process modules mean fewer conflicts

### Negative
- Shared-process model still has single point of failure (mitigated by crash resilience)
- Per-process isolation creates session silos (sessions not visible across processes)
- More complex lifecycle management when per-process mode is enabled

### Risks (Resolved)
- ~~`opencode serve` may not support multiple instances on same port~~ → Confirmed: multiple instances work on different ports
- ~~SQLite session DB may have write contention with multiple processes~~ → Confirmed: WAL mode = 1 writer; addressed via shared-process default
- ~~Need to coordinate port allocation for multiple server instances~~ → Resolved: `PortPool` utility with atomic reservation

### Completed
- `processStrategy` config: `"shared"` (default) or `"per-tab"`
- `SessionManagerRegistry` wired into `extension.ts` and `ChatProvider`
- `StreamCoordinator.startPrompt` resolves per-tab SessionManager via registry
- Per-process `OPENCODE_DATA_DIR` support in `LocalSessionProcessManager`
- Configurable stream cap: `opencode.sessions.maxConcurrentStreams` (default 5)
- Crash resilience: `TabRestorationState`, auto-resume, `stream_interrupted` UI
