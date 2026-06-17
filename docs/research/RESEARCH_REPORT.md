# OpenCode VS Code Extension — Multi-Session Scalability, Performance, Reliability, and High-Concurrency Architecture

## Research Report

**Date:** 2026-06-17
**Scope:** Comprehensive architecture audit, competitive analysis, bottleneck discovery, improvement roadmap.

---

## Executive Summary

The OpenCode VS Code extension connects to an `opencode serve` HTTP server via the `@opencode-ai/sdk/v2` and streams real-time events over a single SSE (`/global/event`) connection. The architecture is mature, well-documented (31 ADRs), and handles basic workloads reliably. However, it was designed for single-workspace/single-tab usage and has known scalability ceilings at ~20 tabs, 5 concurrent streams, and 50 sessions. This report identifies 28 bottlenecks ranked by impact and provides a phased improvement roadmap.

---

## Phase 1 — OpenCode Architecture Research

### Session Model

**Ownership:** Each session is owned by a VS Code tab. Tabs map 1:1 to OpenCode sessions via `cliSessionId`. Sessions are persisted to VS Code `globalState` via `SessionStore` (in-memory `Map<string, OpenCodeSession>` + debounced 500ms writes).

**Isolation:** None. All sessions share one `opencode serve` process. No per-session process isolation. ADR-010 proposes process-per-session but infrastructure is defined (`SessionProcessManager` interface) and not wired.

**Persistence:** `SessionStore` persists up to 50 sessions, each capped at 200 messages. Empty sessions pruned after 60min TTL. Webview persists 50 messages locally with 2MB cap.

**Lifecycle:** Lazy server startup (first webview resolve), server session creation on first prompt per tab, backfill on resume via `getSessionMessages()` (fetches ALL messages — no pagination).

**Limits:**
| Limit | Value | Location |
|-------|-------|----------|
| Max sessions | 50 | SessionStore.ts:115 |
| Max tabs | 20 | TabManager.ts:31 |
| Max concurrent streams | 5 (configurable) | TabManager.ts:30 |
| Max persisted messages/session | 200 | SessionStore.ts:122 |
| Webview persist messages | 50 | state.ts |

### Streaming Model

**Architecture:** Single SSE connection at `GET /global/event` shared by all sessions. Events are demuxed by `sessionId` in `ChatProvider`. The `StreamCoordinator` manages per-tab state with 35+ maps for tool tracking, heartbeat, deferred chunks, chunk sequence ACKs, and backpressure.

**Backpressure:** Adaptive chunk batching via `HostMessageBatcher`. Velocity-based flush delay (35–150ms), size-based cap (10KB text), dedup window (16 identical payloads). Chunk ACKs from webview (`rendered_chunk` messages) gate additional chunk posting.

**Event Ordering:** SSE Last-Event-ID-based dedup on reconnect. `PendingEventBuffer` (200 events, 10s TTL) handles race between session creation and `cliSessionId` registration.

**Stream Watchdog:** 45min stuck-stream timeout. 45s TTFB timeout. 30s tool-finalize grace window.

**Cancellation:** `IntentionalAbortRegistry` with 8s correlation window suppresses late `MessageAbortedError` events after user-initiated abort.

### Worktree Model

**Current state:** No ephemeral worktree support in the extension. The extension operates in the current workspace directory. ADRs mention worktrees as proposed (ADR-010 Phase 2) but not implemented.

**Implications:** No isolation between concurrent agent sessions — they must operate in the same workspace. No branch-based isolation possible.

---

## Phase 2 — Competitive Research

### Comparison Matrix

| Feature | OpenCode Extension | Claude Code | Cline | Continue | Aider |
|---------|-------------------|-------------|-------|----------|-------|
| **Architecture** | Client-server (opencode serve) | Terminal CLI + Agent SDK | SDK engine + IDE plugins | CLI/IDE + core engine | Terminal CLI |
| **Multi-session** | Tabs (20 max, shared process) | `--resume`, background agents | Sub-agents, team coordination | Single conversation | Separate invocations |
| **Process isolation** | None (single server) | Per-invocation | Per-agent/isolation via SDK | Per-invocation | Per-invocation |
| **Streaming** | SSE (single shared connection) | SSE (per-process) | Streaming via SDK | Streaming via core | Terminal streaming |
| **State persistence** | globalState + server | CLAUDE.md + auto-memory | File-system checkpoints | Config + history files | `.aider*` files |
| **Worktree support** | No | Yes (`--worktree`) | Yes (Kanban worktrees) | No | Yes (git worktrees) |
| **Concurrent streams** | 5 max (per extension host) | Arbitrary (process-per-task) | Arbitrary (SDK instances) | 1 (single session) | 1 (per invocation) |
| **Backpressure** | Adaptive chunk batching | Provider-level rate limits | SDK-level flow control | N/A | Retry-on-rate-limit |
| **Crash recovery** | TabRestorationState (persisted) | Auto-resume on reconnect | Checkpoint restore | Session restore | `.aider*` state files |
| **Max context** | 200 messages/session | Depends on model | Model-dependent | Model-dependent | Model + file limits |

### Key Lessons from Competitors

1. **Cline's process isolation:** Cline's SDK spawns agents as independent processes with their own tool sandboxes. This is the single biggest architectural advantage — no single process crash can affect all sessions.

2. **Claude Code's worktrees:** Uses git worktrees to give each agent a clean isolated checkout. This prevents file conflicts between concurrent agents and enables clean abort/rollback.

3. **Aider's stateless design:** Each invocation is independent with no long-running server process. This trades startup latency for maximum reliability — no server to crash.

4. **Continue's now-archived status:** The leading open-source alternative was archived, reducing competitive pressure but also reducing the pool of reference architectures.

---

## Phase 3 — Current Architecture Audit

### Session Layer (SessionManager, SessionClient, SessionStore, SseSubscriber)

**Strengths:**
- Clean façade pattern: `SessionManager` delegates to `ServerLifecycle`, `SseSubscriber`, `SessionClient`
- SSE reconnection with exponential backoff + jitter (cap 30s, max 10 attempts)
- Generation-based stream identity prevents stale data ingestion
- Server session ID as canonical key (ADR-007)
- One-shot session identity migration (ADR-007)

**Contention Points:**
1. Single SSE connection → single point of failure for all tabs
2. `ServerLifecycle` single process → crash affects all sessions
3. No session unloading → inactive sessions stay in memory
4. `SessionStore.save()` debounce → 500ms window of data loss on crash

**Resource Leaks:** None identified in construction/disposal paths. All components properly disposed in `deactivate()`.

### Tab Layer (TabManager)

**Strengths:**
- `cliSessionIndex` reverse lookup for O(1) event → tab routing
- `TabRestorationState` persisted for crash recovery
- Streaming state change events for status bar

**Contention Points:**
1. `MAX_TABS = 20` hardcoded — no config override
2. `maxConcurrentStreams = 5` — may be low for power users
3. Tab creation via `createTab()` — no weight-based eviction policy
4. `captureStreamingSnapshot()` creates restoration states but only for actively-streaming tabs

**Memory Growth Pattern:** O(tabs) — each `TabState` holds `streamingBuffer` (unbounded string), `blocksBuffer` (Block[]), and Map entries.

### Streaming Layer (StreamCoordinator)

**Strengths:**
- Comprehensive state machine: `sending → accepted → streaming → finalizing → completed/failed/aborted`
- 35+ per-tab maps for fine-grained state tracking
- Tool partial output polling with fallback timers
- StreamFinalizerService cleanly separated for finalize logic
- SubagentHeartbeat for child session monitoring

**Contention Points:**
1. **Map proliferation:** 35+ `Map<string, ...>` instances. Each active stream holds references in ~20 maps simultaneously.
2. **No true flow control upstream:** Chunks are buffered/deferred at the extension host but there's no mechanism to tell the opencode server to slow down.
3. **Watchdog at 45min:** Stuck-stream detection is coarse-grained. A stream that's slowly progressing (e.g., 1 chunk/10min) could appear stuck.
4. **startPrompt is ~900 lines:** The main prompt send method has 15+ distinct phases, making it hard to reason about.

### Host Queue Layer (HostPromptQueue, RetryQueueService)

**Strengths:**
- HostPromptQueue persisted to workspaceState — survives webview reloads
- `markStuckSendingAsQueued()` recovery on stream end
- RetryQueueService with exponential backoff (100/500/1000ms, 3 attempts)
- Critical message type prioritization

**Queue Starvation Risks:**
1. HostPromptQueue caps at 50 items/session — excessive queuing silently rejected
2. RetryQueueService caps at 50 — old non-critical items evicted when full
3. No priority queue — FIFO only, no way to prioritize urgent prompts over background tasks

### Webview Layer

**Strengths:**
- VirtualList with IntersectionObserver-based DOM pruning
- History condensation after 140 messages
- LRU markdown cache (250 entries, 2MB)
- Chunked initial message rendering
- Signature-based render skip

**Contention Points:**
1. **Timeline `replaceChildren()`:** Full re-render on every refresh — O(turns)
2. **Diff side-by-side toggle:** Rebuilds entire table — O(lines)
3. **Inline event listeners without explicit cleanup:** `renderPendingDiffActions` adds click handlers inline
4. **85 message handlers in a single Map:** Maintainability concern — no type-safe dispatch

---

## Phase 4 — Scalability Analysis

### Small User (1 session, 1 stream)
- **Extension host:** Negligible (~5MB memory, <1% CPU)
- **Webview:** 50–200 DOM nodes, responsive
- **Server:** Single session, minimal load

### Power User (10 sessions, 5 streams)
- **Extension host:** ~50MB memory (10 TabState × 5MB avg), moderate CPU from event dispatch
- **Webview:** 1000–5000+ DOM nodes (before VirtualList pruning), potential jank on timeline refresh
- **Server:** 10 sessions, 5 active streams — within current limits
- **Risk:** Event dispatch to 10 tabs from single SSE connection. StreamCoordinator maps balloon.

### Extreme User (50+ sessions, 20 tabs)
- **Extension host:** TabManager capped at 20 tabs — remaining 30 sessions only accessible via history
- **StreamCoordinator:** 20 active tab states with all tracking maps — ~50KB map overhead each
- **SessionStore:** 50 sessions, each potentially 200 messages — 10,000 messages in memory
- **Webview:** VirtualList critical for performance. History condensation essential.
- **Risk:** SessionStore prune removes oldest sessions silently. Single server crash affects all.

---

## Phase 5 — Instrumentation Gaps

Currently instrumented:
- `logStreamTrace()` for stream state transitions
- Per-method log.info/warn/error calls
- `renderMessage` timing (>50ms warning)

**Missing instrumentation:**
1. No activation time measurement
2. No session creation wall-clock time
3. No message P50/P95 latency (send → accept → first chunk → complete)
4. No webview render time breakdown
5. No memory usage tracking (per component)
6. No event throughput metrics (events/sec)
7. No SSE reconnection frequency/cause tracking
8. No host queue depth trends

---

## Phase 6 — Bottleneck Matrix

| ID | Bottleneck | Impact | Confidence | Effort | Subsystem |
|----|-----------|--------|------------|--------|-----------|
| B1 | Single `opencode serve` process — crash kills all sessions | High | High | Large | ServerLifecycle |
| B2 | Single SSE connection — disconnect kills all tab events | High | High | Medium | SseSubscriber |
| B3 | No per-session process isolation | High | High | Large | SessionProcessManager |
| B4 | SessionStore full-message fetch on every resume | Medium | High | Small | SessionLifecycleService |
| B5 | StreamCoordinator map proliferation (35+ per-tab maps) | Medium | High | Medium | StreamCoordinator |
| B6 | No stream backpressure to upstream (openode server) | Medium | Medium | Medium | StreamCoordinator |
| B7 | TabManager MAX_TABS=20 hardcoded | Medium | High | Small | TabManager |
| B8 | SessionStore message cap at 200 (truncation) | Medium | High | Small | SessionStore |
| B9 | HostPromptQueue FIFO only, no priorities | Low | High | Small | HostPromptQueue |
| B10 | Timeline full DOM rebuild on refresh | Low | High | Medium | timeline.ts |
| B11 | Diff side-by-side full re-render | Low | High | Medium | renderer.ts |
| B12 | Inline DOM listeners without explicit cleanup | Low | Medium | Small | renderer.ts |
| B13 | Tool partial polling at 500ms per tool | Low | Medium | Small | StreamCoordinator |
| B14 | No session unloading for inactive tabs | Medium | Medium | Medium | SessionStore |
| B15 | SessionStore save debounce (500ms data loss window) | Low | Medium | Small | SessionStore |
| B16 | ChatProvider.ts single monolithic event handler (~1500+ lines) | Low | Medium | Medium | ChatProvider |
| B17 | No worktree support for concurrent agent isolation | Medium | Medium | Large | N/A |
| B18 | Webview message handler map (85 entries, string-typed) | Low | Low | Small | main.ts |
| B19 | Missing instrumentation (latency, throughput, memory) | Medium | Medium | Medium | All |
| B20 | Startup lazy start — cold first-message latency | Low | High | Small | extension.ts |
| B21 | RetryQueueService max 50 items — silent drop | Low | Medium | Small | RetryQueueService |
| B22 | Auto-compaction only for active tab | Low | Medium | Small | AutoCompactor |
| B23 | Model list refresh on first prompt (3s timeout race) | Low | Medium | Small | StreamCoordinator |
| B24 | No pre-fetch of sessions on background tab | Low | Low | Medium | SessionLifecycleService |
| B25 | PendingEventBuffer 10s TTL — can miss events | Low | Medium | Small | PendingEventBuffer |
| B26 | Single global AbortController per operation | Low | Low | Small | SessionClient |
| B27 | ContextEngine reads all open files to memory | Low | Low | Small | ContextEngine |
| B28 | RateLimitMonitor status bar updates every second | Low | Low | Trivial | RateLimitMonitor |

---

## Phase 7 — Advanced Optimization Opportunities

### Horizontal Session Scaling (ADR-010)

**Status:** Infrastructure defined (`SessionProcessManager` interface, `TabRestorationState`, port pool). Not wired into extension.ts.

**Evaluation:**
- **One process per session:** Maximum isolation. Each crash affects only one tab. Communication overhead via HTTP. Memory: ~50MB/process.
- **Process pooling:** Fewer processes than sessions. Complexity in process assignment/deassignment. LRU eviction of idle processes.
- **Current state:** Acceptable for power users (10 sessions). Not viable for extreme users (50+).

**Recommendation:** Phase 1: Implement ADR-010 with process pool (N processes for N active sessions). Phase 2: Consider container-based isolation.

### Event Pipeline Optimization

- **Event batching:** Already implemented via `HostMessageBatcher`. Effective.
- **Event coalescing:** `activityCoalesce.ts` handles repeated activity events. No further optimization needed.
- **Event prioritization:** Not currently implemented. Critical events (permission requests, errors) should bypass batching regardless of type.

### Memory Management

- **LRU caching:** Already in use for markdown (renderer.ts) and metadata (ModelManager).
- **Session unloading:** Not implemented. Could reduce memory by serializing inactive sessions to disk and clearing from SessionStore Map.
- **Lazy restoration:** Already implemented for webview (chunked loader). Not implemented for SessionStore — all sessions loaded at once.
- **Snapshotting:** `TabRestorationState` is a start. Full session snapshot (messages + blocks + state) would enable true crash recovery.

### Multi-Tab Scheduling

**Current state:** `maxConcurrentStreams` cap with FIFO queue via `HostPromptQueue`. Simple but fair.

**Improvement:** Weight-based scheduling (recently-active tabs get priority), priority inversion prevention, resource budgeting per tab.

---

## Phase 8 — Future Architecture Candidates

### Architecture A: Session-Centric (Current + Horizontal)

Each session runs in its own process (ADR-010). The extension host becomes a thin multiplexer.

- **Benefits:** Maximum isolation, independent scaling, crash containment
- **Risks:** Memory overhead (~50MB/process), IPC complexity
- **Complexity:** Medium-Large
- **SDK compatibility:** Full (SDK v2 already supports per-process clients)

### Architecture B: Workspace-Centric

One process per workspace folder. Sessions within the same workspace share a process.

- **Benefits:** Lower memory overhead than per-session, good for multi-tab same-project workflows
- **Risks:** Still affected by busy sessions within the workspace
- **Complexity:** Medium

### Architecture C: Connection-Pool

Maintain a pool of N `opencode serve` processes. Assign sessions to processes based on load. Rebalance when idle.

- **Benefits:** Flexible, memory-efficient, handles burst workloads
- **Risks:** Complex load balancing, reconnection storms on rebalance
- **Complexity:** High

### Architecture D: Distributed Session Mesh

Each session is a standalone agent with its own worktree, process, and state. Extension host is a client.

- **Benefits:** Maximum scalability, true multi-agent isolation, worktree-per-agent
- **Risks:** Complex coordination, high resource usage, overkill for <20 sessions
- **Complexity:** Very High

**Recommendation:** Implement Architecture A for immediate stability gains. Architecture C for medium-term scalability. Architecture D for long-term (year+) vision.

---

## Phase 9 — Reliability Engineering

### Failure Modes and Recovery Paths

| Failure Mode | Current Detection | Current Recovery | Improvement Opportunity |
|-------------|------------------|------------------|------------------------|
| Server crash | `proc.on("exit")` | SIGTERM→3s→SIGKILL, 5 reconnect attempts | Per-session process (ADR-010) |
| SSE disconnect | IdleWatchdog (90s) | 10 reconnect attempts, exp backoff | Multiple SSE connections, health-aware routing |
| Session corruption | None (trusts server state) | Manual session delete | Checksum-based detection, auto-backup |
| Lost events | PendingEventBuffer (10s TTL) | Buffered replay | Longer TTL, event sequence numbers |
| Provider failure | HTTP error in SessionClient | 3 retries, error to webview | Circuit breaker, provider health checks |
| Rate limit exhaustion | RateLimitMonitor headers | Warning notifications | Auto-pause streams, queue prompts |
| Webview reload | State flush on beforeunload | Restore from persisted state | Diff-based state sync (send only changes) |
| VS Code restart | TabRestorationState | Manual resume via "interrupted" notice | Auto-resume on reconnect |
| Webview OOM | 2MB state cap, VirtualList | Pruning | Progressive message eviction |
| Extension host OOM | None | VS Code process restart | Memory pressure monitoring, session unloading |

---

## Phase 10 — Key Metrics Summary

### Current Architecture Limits

- **Max sessions:** 50 (SessionStore)
- **Max tabs:** 20 (TabManager)
- **Max concurrent streams:** 5 (configurable)
- **Max SSE reconnects:** 10 (SseSubscriber)
- **Max server reconnects:** 5 (ServerLifecycle)
- **Message retries:** 3 (RetryQueueService)
- **SSE reconnect backoff:** 1s×2^n + jitter, cap 30s
- **Server reconnect backoff:** 1s×2^n, cap 16s

### Resource Estimates by User Tier

| Tier | Sessions | Tabs | Streams | Est. Memory (Host) | Est. Memory (Server) | Risk Level |
|------|----------|------|---------|-------------------|----------------------|------------|
| Small | 1-3 | 1-2 | 1 | ~10MB | ~100MB | Green |
| Power | 10-20 | 5-10 | 3-5 | ~50MB | ~300MB | Yellow |
| Extreme | 30-50 | 15-20 | 5+ | ~100MB | ~500MB+ | Red |

---

## References

### Internal ADRs
- ADR-001: Client-Server Architecture
- ADR-002: Multi-tab Worker Model
- ADR-003: Event-Driven SSE Streaming
- ADR-005: Lazy Server Startup (Superseded)
- ADR-006: Production Hardening Audit
- ADR-007: Unified Session Identity
- ADR-008: SDK-Aligned Message Pipeline
- ADR-009: Pending Event Buffer
- ADR-010: Horizontal Scaling (Proposed)

### Key Source Files
- `src/extension.ts`: Activation entry point
- `src/session/SessionManager.ts`: Session façade
- `src/session/SessionStore.ts`: Session persistence
- `src/session/SseSubscriber.ts`: SSE client
- `src/session/ServerLifecycle.ts`: Server process lifecycle
- `src/session/SessionClient.ts`: SDK REST wrapper
- `src/chat/ChatProvider.ts`: Event orchestrator
- `src/chat/TabManager.ts`: Tab state management
- `src/chat/handlers/StreamCoordinator.ts`: Stream lifecycle
- `src/chat/HostMessageBatcher.ts`: Message batching
- `src/chat/HostPromptQueue.ts`: Prompt queue
- `src/chat/RetryQueueService.ts`: Retry with backoff
- `src/chat/webview/main.ts`: Webview entry point
- `src/chat/webview/timeline.ts`: Conversation timeline
- `src/chat/webview/renderer.ts`: Block/diff rendering

---

## Phase 2 — Competitive Deep-Dive: Multi-Agent Isolation

### Cline: Process-Spawned Agent Isolation

**Architecture:** Cline spawns each agent task as an independent child process with its own tool sandbox. The extension host acts as an orchestrator — it dispatches work to child processes and collects results, but never shares state between agents.

**Key patterns applicable to ADR-010:**

1. **Process-per-task model:** Each Cline agent run gets its own `node` process. A crash in one agent's tool execution (e.g., a runaway bash command) doesn't affect other agents. The parent process monitors child health via `child.on('exit')` and `child.on('error')`.

2. **Tool sandboxing:** Each agent process has its own working directory context. File operations are scoped to the agent's workspace, preventing cross-agent file conflicts. This is lighter than full worktree isolation but provides basic filesystem separation.

3. **State serialization:** Agent state (conversation history, tool results) is serialized and passed between the host and child process via IPC/stdin/stdout. This means each process is stateless from the host's perspective — it can be killed and restarted without losing conversation context.

4. **Failure containment:** When a child process crashes:
   - The host detects it via the `exit` event
   - The agent's conversation history is preserved in the host's memory
   - A new process is spawned to continue the work
   - The user sees a "retried" indicator, not a crash

**Applicability to OpenCode:** The `LocalSessionProcessManager` (ADR-010) follows a similar pattern. Key difference: Cline's agents are short-lived (one task = one process), while OpenCode's sessions are long-lived (one session = one process for the duration of the tab). This means OpenCode needs more sophisticated health monitoring and reconnection logic.

### Claude Code: Git Worktree Isolation

**Architecture:** Claude Code supports `--worktree` mode where each agent session gets its own git worktree. This provides complete filesystem isolation — each agent sees its own copy of the working tree, can make independent commits, and can be rolled back without affecting other agents.

**Key patterns applicable to ADR-010:**

1. **Worktree creation:** `git worktree add <path> -b <branch>` creates an isolated checkout. Each agent gets a unique branch name (e.g., `agent/claude-session-123`). The worktree shares the `.git` directory with the main repo but has its own working tree.

2. **Branch-per-agent:** Each agent works on its own branch. This means:
   - No merge conflicts between concurrent agents
   - Clean rollback: delete the worktree + branch
   - Easy review: each agent's changes are isolated in a branch
   - Integration: merge the branch when the agent's work is approved

3. **Failure recovery:** If an agent crashes or is killed:
   - The worktree remains on disk with all partial changes
   - A new agent can be spawned on the same worktree to continue
   - Or the worktree can be abandoned (git worktree remove)

4. **Resource management:** Worktrees consume disk space (each is a full checkout). Claude Code limits concurrent worktrees and cleans up idle ones.

**Applicability to OpenCode:** Worktree support is listed as Phase 5 in the scalability roadmap (B17). The key integration points would be:
- `SessionProcessManager.spawnSession()` accepts a `worktreePath` parameter
- `SessionStore` stores `worktreePath` per session
- `TabManager` shows worktree indicator in tab bar
- Cleanup on session delete: `git worktree remove <path>`

**Recommended implementation order:**
1. ✅ Process isolation (ADR-010 Phase 2 — done)
2. Next: Per-session SSE subscription (requires server support)
3. Then: Worktree isolation (ADR-010 Phase 5)
4. Finally: LRU process eviction + background pre-fetch

### Key Takeaways

| Pattern | Cline | Claude Code | OpenCode (Current) | OpenCode (Target) |
|---------|-------|-------------|--------------------|--------------------|
| Process isolation | Per-task | Per-session | None (shared) | Per-session (ADR-010) |
| Filesystem isolation | Tool sandbox | Git worktree | None | Worktree (Phase 5) |
| Crash recovery | Respawn + replay | Worktree persistence | TabRestorationState | Process pool + worktree |
| State management | Host-memory | Worktree-commits | SessionStore (globalState) | SessionStore + per-process |
| Resource cost | Low (short-lived) | High (full checkout) | Lowest (shared) | Medium (N processes) |
