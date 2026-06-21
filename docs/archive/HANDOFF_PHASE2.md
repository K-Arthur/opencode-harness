# Phase 2 Handoff — Remaining Tasks

Instructions for continuing the scalability/performance work.

---

## Completed (committed)

| Task | Commit | Verification |
|------|--------|-------------|
| B7: Configurable MAX_TABS | `5d1b013` | 19 structural tests pass |
| B8: Configurable session caps | `5d1b013` | 48 structural tests pass |
| Phase 0: Activation timing | `5d1b013` | Typecheck clean, full suite 3869 pass |

---

## Remaining Tasks

### 1. Phase 0: Stream Message Latency Tracking

**Problem:** No P50/P95 latency tracking for stream messages (send→first chunk→complete). Can't measure improvement without baseline.

**Prompt for next session:**

```
Implement stream message latency instrumentation in StreamCoordinator.

Add performance.now() tracking at these points:
1. startPrompt() — record sendTime
2. When first text_chunk or tool_start arrives — record firstResponseTime
3. On stream_end — record completeTime
4. On finalizeStream — record finalizeTime

Store in a Map<string, { sendTime, firstResponseTime?, completeTime?, finalizeTime? }>
Logged to output channel via logStreamTrace() with latency breakdown on completion.

Files to modify:
- src/chat/handlers/StreamCoordinator.ts

The StreamCoordinator already has traceRun() for state transitions. Add a
per-tab ActiveRunMetrics tracker that captures the timing data and formats
it as: "stream latency: first_chunk=Xms, total=Yms, finalize=Zms, messages=N"

Follow TDD: write structural test in StreamCoordinatorTypes.test.ts or
StreamCoordinator.test.ts that verifies the timing fields exist in the
active run state type.
```

---

### 2. B20: Pre-warm Server on Activation

**Problem:** First prompt after VS Code restart includes ~1-3s server startup latency. Server should start during activation, not on first webview resolve.

**Prompt for next session:**

```
Implement server pre-warm during extension activation instead of lazy start on first webview resolve.

Current flow in extension.ts:
- chatProviderInstance.setServerWarmup() defers server start to first webview resolve
- This means the FIRST message from a user waits for server startup

Target flow:
- During activate(), after sessionManager is created, start the server asynchronously
- If server start fails or is slow, fall back to the existing lazy start
- The warmup should be non-blocking (do not delay activation completion)

Files to modify:
- src/extension.ts — add warmServer() call during activate()

Key constraints:
1. Must not block activation completion (fire-and-forget with error logging)
2. Must not double-start (ensureServerReady is already idempotent)
3. Must still support remote-attach mode (no-op if isRemote)
4. Must respect opencode.serverUrl (don't start local if remote configured)

Implementation sketch:
- Add Promise<boolean> warmServer() function near ensureServerReady()
- Call warmServer() after sessionManager setup, before registerChatProvider
- warmServer() calls ensureServerReady(), catches errors, logs timing
- Add performance.now() timing around the warmup call for instrumentation

Follow TDD:
1. Add behavioral test via esbuild bundling that verifies server is marked
   as started before webview resolve
2. Structural test checking warmServer() call exists in activate()
```

---

### 3. Competitive Research (if desired)

**Prompt for next session:**

```
Continue competitive architecture research from Phase 2 of the scalability report.

Research Cline's multi-agent isolation model in detail:
- Read apps/cli/src/agent.ts from github.com/cline/cline
- Focus on process spawning, isolation, and state management
- Extract patterns applicable to ADR-010 implementation

Research Claude Code's worktree support:
- Test claude --worktree flag to understand the workflow
- Document API surface and failure modes

Return findings as update to docs/research/RESEARCH_REPORT.md
```

---

### 4. Full ADR-010 Implementation (for later)

**Prompt for next session:**

```
Implement ADR-010 horizontal scaling (per-session process isolation).

The SessionProcessManager interface is defined but not wired:
- src/session/SessionProcessManager.ts — interface only
- src/utils/portPool.ts — port pool exists

Implementation plan (from docs/research/SCALABILITY_ROADMAP.md Phase 3):

1. Implement SessionProcessManager with process pool
2. Port allocation via portPool
3. Per-session V2OpencodeClient
4. Per-session SSE subscription
5. Crash→TabRestorationState→auto-resume cycle

Feature gate: opencode.sessions.processStrategy = "shared" | "per-tab"
Default: "shared" (existing behavior)
```

---

## Verification Gate

After implementing any remaining task, run:

```bash
npm run typecheck && npm run test:unit
```

Target: typecheck clean, 3869+ tests pass, 0 failures.
