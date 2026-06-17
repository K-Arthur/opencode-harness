# OpenCode VS Code Extension — Scalability Roadmap

**Date:** 2026-06-17
**Target:** Predictable performance under 10-50 sessions, 5-20 concurrent streams, large conversations.

---

## Guiding Principles

1. **Stability before speed.** No optimization that increases crash risk.
2. **Measure before optimizing.** Instrument first, then act on data.
3. **Incremental delivery.** Each milestone delivers independently verifiable improvement.
4. **Backward compatible.** Existing users must not be disrupted.
5. **Configurable, not hardcoded.** Power users control their own limits.

---

## Phase 0: Instrumentation (Weeks 1-2) — PREREQUISITE

> **If you can't measure it, you can't improve it.**

### 0.1 Activation Latency Tracking

| File | Change | Effort |
|------|--------|--------|
| `src/extension.ts` | Add `performance.mark()` at activation start/end, log to output channel | Trivial |
| `src/session/ServerLifecycle.ts` | Add timing for server start phases (binary find → spawn → health check → ready) | Small |
| `src/session/SessionLifecycleService.ts` | Add timing for session resume phases (ensure → create tab → backfill → push messages) | Small |

### 0.2 Message Latency Metrics

| File | Change | Effort |
|------|--------|--------|
| `src/chat/handlers/StreamCoordinator.ts` | Track P50/P95 for: send→accept, accept→first chunk, first chunk→completion | Small |
| `src/chat/ChatProvider.ts` | Add event dispatch latency tracking (SSE arrival → webview post) | Small |
| `src/session/SessionClient.ts` | Track REST call latencies (sendPrompt, getSessionMessages, etc.) | Small |

### 0.3 Memory Tracking

| File | Change | Effort |
|------|--------|--------|
| `src/chat/TabManager.ts` | Log tab count, stream count, buffer sizes every 60s when streaming | Small |
| `src/session/SessionStore.ts` | Log session count, message count, approximate memory every 60s | Small |
| `src/chat/handlers/StreamCoordinator.ts` | Log active map sizes (activeToolCallIds, toolActivityAt, deferredChunks, etc.) | Small |

### 0.4 Event Throughput

| File | Change | Effort |
|------|--------|--------|
| `src/session/SseSubscriber.ts` | Count events/sec, log once per 10s | Small |
| `src/chat/HostMessageBatcher.ts` | Log batch sizes, chunk flush frequencies | Small |

### 0.5 Webview Rendering

| File | Change | Effort |
|------|--------|--------|
| `src/chat/webview/main.ts` | Add `renderMessage` timing distribution (not just >50ms warning) | Small |
| `src/chat/webview/timeline.ts` | Log timeline refresh duration | Small |
| `src/chat/webview/renderer.ts` | Log diff render timing, LLM block count | Small |

**Phase 0 Deliverable:** `/metrics` debug command that dumps all buffered metrics to output channel.
**Est. Total Effort:** 1 week
**Verification:** Run 5 concurrent streams for 5 minutes, verify metrics appear in output channel.

---

## Phase 1: Immediate Wins (Weeks 2-4)

### 1.1 Configurable Limits (B7, B8)

```
opencode.sessions.maxTabs: 20 → configurable (range 1-100, default 20)
opencode.sessions.maxSessions: 50 → configurable (range 10-200, default 50)
opencode.sessions.persistMaxMessages: 200 → configurable (range 50-500, default 200)
```

| File | Change | Effort |
|------|--------|--------|
| `src/chat/TabManager.ts` | Read `opencode.sessions.maxTabs` from config, clamp 1-100 | Trivial |
| `src/session/SessionStore.ts` | Read `opencode.sessions.maxSessions` and `opencode.sessions.persistMaxMessages` from config | Trivial |
| `package.json` | Add configuration contributions | Trivial |

### 1.2 Warm Server on Activation (B20)

| File | Change | Effort |
|------|--------|--------|
| `src/extension.ts` | Call `ensureServerReady()` during `activate()` instead of deferring to first webview resolve | Small |
| `src/session/ServerLifecycle.ts` | Add `warmup()` method: start server but don't fail if it takes >5s | Small |

**Risk:** If server fails to start during activation, don't block activation — fall back to lazy start.
**Verification:** First prompt after window reload completes in <2s (no server startup latency).

### 1.3 HostPromptQueue Priority System (B9)

| File | Change | Effort |
|------|--------|--------|
| `src/chat/HostPromptQueue.ts` | Add `priority: "normal" | "high"` field. `dequeue()` returns highest-priority first, then FIFO within priority | Small |
| `src/chat/webview/sendLogic.ts` | Allow user to mark prompt as high-priority (keyboard shortcut, UI indicator) | Small |

### 1.4 Paginated Session Message Fetch (B4)

| File | Change | Effort |
|------|--------|--------|
| `src/session/SessionClient.ts` | Add `getSessionMessages(sessionId, { limit, before })` with pagination params | Small |
| `src/chat/SessionLifecycleService.ts` | Fetch in pages of 50, display immediately, fetch more in background | Small |

**Phase 1 Deliverable:** Power user configuration working, measurable latency improvement.
**Est. Total Effort:** 2 weeks
**Verification:** 
- `maxTabs` config respected when creating tabs
- First prompt after cold start: <2s
- High-priority queued prompt sent before low-priority
- Resume with 500 messages: ~200ms initial render, background fetch completes in <5s

---

## Phase 2: Resilience Improvements (Weeks 4-7)

### 2.1 Multi-SSE Connection Architecture (B2)

Current: Single `GET /global/event` connection for all sessions.
Target: One SSE connection per active session (or per N sessions).

| File | Change | Effort |
|------|--------|--------|
| `src/session/SseSubscriber.ts` | Support multiple concurrent SSE subscriptions, keyed by session ID | Medium |
| `src/chat/ChatProvider.ts` | Route events from per-session SSE to specific tab | Small |
| `src/session/SessionManager.ts` | Create SseSubscriber per active session on `ensureSession()` | Medium |

**Design:** Each session subscribes to `GET /global/event?session=<id>`. If the server doesn't support per-session SSE, fall back to single connection.
**Risk:** Requires server-side support for session-scoped SSE.

### 2.2 StreamCoordinator Consolidation (B5)

Current: 35+ per-tab maps with independent lifecycle.
Target: Single `StreamRun` object per active stream, consolidating all tracking state.

| File | Change | Effort |
|------|--------|--------|
| `src/chat/handlers/StreamCoordinator.ts` | Create `ActiveStreamContext` class holding: messageId, toolCallIds, toolActivity, heartbeat seq, chunk seq, deferred chunks, TTFB timer, stuck handler, callbacks. Replace 15+ individual maps with one `Map<string, ActiveStreamContext>`. | Medium |
| `src/chat/handlers/StreamCoordinatorTypes.ts` | Define `ActiveStreamContext` interface | Small |

**Benefits:** 
- Clear ownership: one object per stream, disposed atomically on cleanup
- Fewer Map lookups (one `get()` instead of 15+)
- Easier to reason about stream lifecycle

### 2.3 Session Unloading (B14)

Current: Inactive sessions stay in SessionStore Map indefinitely.
Target: LRU-based unloading: serialize to disk, keep metadata in Map, fetch messages on activation.

| File | Change | Effort |
|------|--------|--------|
| `src/session/SessionStore.ts` | Add `unload(id)` — serialize messages to disk, keep metadata. `load(id)` — deserialize from disk. LRU eviction policy based on `lastActiveAt`. | Medium |
| `src/chat/SessionLifecycleService.ts` | Call `load()` on tab creation, `unload()` on tab close (with 5min delay for re-activation). | Small |

**Benefits:** 50 sessions × ~200 messages × ~500 bytes avg = ~5MB saved when all but 5 are inactive.

### 2.4 Incremental SessionStore Persistence (B15)

Current: Full session Map serialized on every save. 500ms debounce means 500ms data loss window.
Target: Write-ahead log (WAL) for mutations, periodic full snapshot.

| File | Change | Effort |
|------|--------|--------|
| `src/session/SessionStore.ts` | Add append-only WAL for mutations (`appendMessage`, `updateCost`, etc.). On `flush()`, replay WAL into full snapshot. WAL provides crash recovery with <1 message loss. | Medium |

**Phase 2 Deliverable:** Resilience under multi-tab scenarios, reduced memory footprint.
**Est. Total Effort:** 3 weeks
**Verification:** 
- Kill SSE connection for one session; other sessions unaffected
- Unload 45 of 50 sessions; memory drops proportionally
- Kill extension host mid-stream; after restart, at most 1 message lost

---

## Phase 3: Process Isolation (Weeks 7-11)

### 3.1 ADR-010 Implementation (B1, B3)

Current: Single `opencode serve` process.
Target: Process pool per active session, as defined in ADR-010.

| File | Change | Effort |
|------|--------|--------|
| `src/session/SessionProcessManager.ts` | Implement `SessionProcessManager` interface: spawn/kill/restart processes, health monitoring, port allocation from pool | Large |
| `src/utils/portPool.ts` | Port pool with atomic reservation (already exists, may need extension) | Small |
| `src/session/ServerLifecycle.ts` | Replace single process with process pool: `spawnForSession(sessionId)`, `killForSession(sessionId)` | Large |
| `src/session/SessionManager.ts` | Per-session `V2OpencodeClient` instead of shared. Per-session SSE subscription instead of global. | Large |
| `src/chat/ChatProvider.ts` | Route server events from per-session SSE connections (simpler than current demux) | Medium |

**Process Pool Strategy:** 
- Pool of N processes (N = active session count, capped at `maxSessions`)
- LRU eviction: idle sessions (>5min no activity) are killed; messages persisted to SessionStore
- Health monitoring: crash → `TabRestorationState` created → auto-resume on next activation
- Port allocation: `portPool.reserve()` → `portPool.release()`

**Risk:**
- Memory overhead: ~50MB per process × 10 active sessions = 500MB
- Port exhaustion: 1000+ ports needed for >100 active sessions
- Integration test complexity increases significantly

**Mitigation:**
- Progressive rollout: feature-flag protected (`opencode.sessions.processIsolation`)
- Default off for existing users, opt-in for power users
- Process pool size configurable (`opencode.sessions.maxProcesses`)

### 3.2 Concurrent Stream Scheduling (B17)

With process isolation, each session has its own process. Stream scheduling becomes per-process, not per-tab.

| File | Change | Effort |
|------|--------|--------|
| `src/chat/TabManager.ts` | Add `activeStreamWeight` per tab (based on recency + priority). `canStartStreaming()` uses weighted capacity check instead of hard limit. | Medium |
| `src/chat/HostPromptQueue.ts` | Weight-based dequeue: highest weight queued item wins, not strict FIFO. | Small |

**Phase 3 Deliverable:** True process isolation, crash resilience, weighted stream scheduling.
**Est. Total Effort:** 4 weeks
**Verification:**
- Kill one session's process; other sessions continue unaffected
- Session auto-restores on next tab activation (process + SSE + backfill)
- 10 concurrent sessions across 10 processes; verify memory budget

---

## Phase 4: Webview Performance (Weeks 11-13)

### 4.1 Timeline Incremental Rendering (B10)

| File | Change | Effort |
|------|--------|--------|
| `src/chat/webview/timeline.ts` | Replace `replaceChildren()` with DOM diffing: insert new turns, remove deleted turns, update changed turns. Use `requestAnimationFrame` for batching. | Medium |

### 4.2 Diff Sparse Re-render (B11)

| File | Change | Effort |
|------|--------|--------|
| `src/chat/webview/renderer.ts` | Cache side-by-side DOM; toggle swaps visibility instead of rebuild. Cache word-diff results per-hunk instead of recomputing on toggle. | Medium |

### 4.3 Systematic DOM Listener Cleanup (B12)

| File | Change | Effort |
|------|--------|--------|
| `src/chat/webview/renderer.ts` | Audit all inline `addEventListener` calls. Add cleanup functions returned by renderers, called on DOM removal. Use `AbortController` per element group for batch cleanup. | Small |

### 4.4 Message Handler Type Safety (B18)

| File | Change | Effort |
|------|--------|--------|
| `src/chat/webview/main.ts` | Replace `Map<string, MsgHandler>` with typed dispatch using discriminated union. Use `satisfies` or type-narrowing to ensure exhaustiveness. | Small |

**Phase 4 Deliverable:** Responsive timeline at 100+ turns, smooth diff toggles.
**Est. Total Effort:** 2 weeks
**Verification:**
- 500-turn conversation: timeline refresh <5ms
- 500-line diff: side-by-side toggle <16ms (one frame)
- No growth in event listeners over session lifetime

---

## Phase 5: Advanced Features (Weeks 13+)

### 5.1 Git Worktree Support (B17)

| File | Change | Effort |
|------|--------|--------|
| `src/session/SessionProcessManager.ts` | `spawnSession()` accepts `worktreePath` parameter. Creates git worktree if needed. Sets `OPENCODE_WORKSPACE` env var. | Large |
| `src/session/SessionStore.ts` | Store `worktreePath` per session. Clean up worktrees on session delete. | Medium |
| `src/chat/TabManager.ts` | Show worktree indicator in tab bar when tab uses isolated worktree. | Small |

### 5.2 Pre-fetch Background Tab Sessions (B24)

| File | Change | Effort |
|------|--------|--------|
| `src/chat/SessionLifecycleService.ts` | On tab switch, check if adjacent tabs need backfill. Pre-fetch in background with lower priority than active tab. | Medium |

### 5.3 Circuit Breaker for Provider Failures

| File | Change | Effort |
|------|--------|--------|
| `src/session/SessionClient.ts` | Add circuit breaker pattern: after N failures in M seconds, stop sending to that provider for cooldown period. Surface state in status bar. | Small |

### 5.4 Auto-save for Active Streams

| File | Change | Effort |
|------|--------|--------|
| `src/chat/handlers/StreamCoordinator.ts` | Periodically persist partial stream state (every 30s during active streams). On crash recovery, offer to resume from last checkpoint. | Medium |

**Phase 5 Deliverable:** Multi-agent isolation via worktrees, proactive session management, provider resilience.
**Est. Total Effort:** 4 weeks

---

## Total Effort Summary

| Phase | Weeks | Cumulative | Key Outcome |
|-------|-------|------------|-------------|
| 0: Instrumentation | 1 | 1 | Can measure everything |
| 1: Immediate Wins | 2 | 3 | Configurable, faster, prioritized |
| 2: Resilience | 3 | 6 | Multi-SSE, consolidated state, session unloading |
| 3: Process Isolation | 4 | 10 | ADR-010, crash resilience, weighted scheduling |
| 4: Webview Perf | 2 | 12 | Responsive timeline, fast diffs, clean DOM |
| 5: Advanced | 4 | 16 | Worktrees, background pre-fetch, circuit breakers |
| **Total** | **16 weeks** | | |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Server doesn't support per-session SSE (Phase 2) | Medium | High — blocks B2, B3 | Fall back to single SSE with health-aware routing |
| Process pool OOM (Phase 3) | Medium | High — crashes all processes | Configurable pool size; memory monitoring; auto-evict idle |
| StreamCoordinator consolidation breaks streaming (Phase 2) | Medium | High — streaming broken for all users | Feature flag; parallel implementation with A/B test |
| Worktree support complex git edge cases (Phase 5) | High | Medium — some operations fail in worktrees | Documented limitations; fallback to non-worktree mode |
| Instrumentation overhead (Phase 0) | Low | Low — <1% overhead | Sampling at 10s intervals, buffered writes |

---

## Verification Gates

Each phase must pass before proceeding:

| Phase | Gate |
|-------|------|
| 0 | All metrics visible in output channel; no perf regression in benchmarks |
| 1 | Config settings respected; first-prompt latency <2s; priority queue verified |
| 2 | Kill SSE: other sessions unaffected; 50-session memory <5MB inactive; WAL recovery <1 message lost |
| 3 | Kill process: auto-restore on tab activation; 10 concurrent processes memory <1GB; stream isolation verified |
| 4 | 500-turn timeline refresh <5ms; 500-line diff toggle <16ms; listener count stable over session lifetime |
| 5 | Worktree isolation verified with concurrent edits; circuit breaker triggers after 3 failures; pre-fetch visible in background |

---

## Appendix: Quick Start — What to Do Right Now

If you can only do one thing from each phase today:

1. **Instrumentation:** Add `performance.mark()` at activation start/end in `extension.ts` (5 lines).
2. **Immediate Win:** Make `MAX_TABS` configurable via `vscode.workspace.getConfiguration("opencode").get("sessions.maxTabs")` (1 line change).
3. **Resilience:** Create `ActiveStreamContext` type to consolidate 3 most-used maps (messageId, toolCallIds, callbacks) as a proof of concept.
4. **Process Isolation:** Write test that spawns 2 `opencode serve` processes on different ports, connects to both, verifies isolation.
5. **Webview:** Profile timeline `replaceChildren()` with 1000 turns — quantify the bottleneck before optimizing.
6. **Advanced:** Prototype `git worktree add` integration for one session in isolation.
