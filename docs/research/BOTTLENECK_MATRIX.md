# OpenCode VS Code Extension — Bottleneck Matrix

**Date:** 2026-06-17
**Ranked by:** Impact × Confidence. Includes estimated effort for remediation.

## Severity Legend

| Severity | Icon | Description |
|----------|------|-------------|
| Critical | 🔴 | Affects all sessions, can cause data loss or unrecoverable failure |
| High | 🟠 | Significantly degrades experience under load, affects power users |
| Medium | 🟡 | Noticeable under specific conditions, affects some users |
| Low | 🟢 | Minor impact, affects edge cases or maintainability |

## Effort Legend

| Effort | Scope |
|--------|-------|
| Trivial | <1 day |
| Small | 1-3 days |
| Medium | 1-2 weeks |
| Large | 2-4 weeks |
| X-Large | 1+ month |

---

## Ranked Bottlenecks

| Rank | ID | Title | Severity | Confidence | Effort | Subsystem | Detail |
|------|----|-------|----------|------------|--------|-----------|--------|
| 1 | B1 | Single server process — crash kills all sessions | 🔴 Critical | High | Large | ServerLifecycle.ts | `opencode serve` is a single process. Any crash, OOM, or stuck loop affects ALL tabs. 5 reconnect attempts before permanent failure. Recovery: manual restart. |
| 2 | B2 | Single SSE connection — disconnect kills all event streams | 🔴 Critical | High | Medium | SseSubscriber.ts | All tabs share one `GET /global/event` connection. If disconnected, ALL tabs lose real-time events simultaneously. Reconnect with exp backoff (10 attempts max, 30s cap). |
| 3 | B3 | No per-session process isolation | 🔴 Critical | High | Large | SessionProcessManager.ts | Infrastructure defined but not wired. One busy session can starve others. One crash kills all. ADR-010 proposed but not implemented. |
| 4 | B4 | Full message fetch on every session resume | 🟠 High | High | Small | SessionLifecycleService.ts:91 | `handleResumeSession()` fetches ALL server messages via `getSessionMessages()`. No pagination. No incremental fetch. 50MB response cap only safety net. |
| 5 | B5 | StreamCoordinator map proliferation | 🟠 High | High | Medium | StreamCoordinator.ts | 35+ per-tab `Map<string, ...>` instances. Each active stream holds references in ~20 maps. At 20 tabs × 20 maps = 400 map instances minimum. |
| 6 | B14 | No session unloading for inactive tabs | 🟠 High | Medium | Medium | SessionStore.ts | All sessions stay in memory Map. No LRU eviction. No serialization to disk. 50 sessions × ~200 messages each = 10,000 messages in memory. |
| 7 | B6 | No stream backpressure to upstream server | 🟡 Medium | Medium | Medium | StreamCoordinator.ts | Chunks are buffered/deferred at extension host but the opencode server has no mechanism to slow down. Backpressure is extension-host-side only. |
| 8 | B7 | TabManager MAX_TABS=20 hardcoded | 🟡 Medium | High | Small | TabManager.ts:31 | No configuration override. No eviction policy beyond creation-time rejection. Power users need more tabs. |
| 9 | B8 | SessionStore message cap at 200 (silent truncation) | 🟡 Medium | High | Small | SessionStore.ts:122 | Long conversations lose early messages from local persistence. Restored from server on resume (full fetch), but local search/offline access degraded. |
| 10 | B19 | Missing instrumentation everywhere | 🟡 Medium | Medium | Medium | All | No activation time. No P50/P95 message latency. No memory tracking. No event throughput metrics. Can't optimize what isn't measured. |
| 11 | B9 | HostPromptQueue FIFO only — no priorities | 🟢 Low | High | Small | HostPromptQueue.ts | All queued prompts treated equally. No way to prioritize urgent prompts (e.g., "fix this crash") over background tasks. |
| 12 | B10 | Timeline full DOM rebuild on every refresh | 🟢 Low | High | Medium | timeline.ts:131 | `replaceChildren()` destroys all timeline items, rebuilds O(turns). Debounced during streaming but still rebuilds on every refresh call. |
| 13 | B11 | Diff side-by-side toggle full re-render | 🟢 Low | High | Medium | renderer.ts:1540-1553 | Toggle destroys all table rows, rebuilds from scratch. 500-line cap mitigates worst case but each toggle is O(lines) × word-diff computation. |
| 14 | B12 | Inline DOM event listeners without cleanup | 🟢 Low | Medium | Small | renderer.ts | `renderPendingDiffActions` wires click handlers inline. If DOM is replaced without listener removal, handlers leak. |
| 15 | B13 | Tool partial polling at 500ms per tool | 🟢 Low | Medium | Small | StreamCoordinator.ts:657 | Each long-running tool (bash, exec) gets a 500ms polling interval. With 10 concurrent tools across tabs: 20 polls/sec. |
| 16 | B15 | SessionStore 500ms save debounce — data loss window | 🟢 Low | Medium | Small | SessionStore.ts:114 | Changes in the 500ms window before crash/dispose are lost. `flush()` exists but is only called in `dispose()`. |
| 17 | B16 | ChatProvider monolithic event handler | 🟢 Low | Medium | Medium | ChatProvider.ts | Single 1500+ line method (`resolveWebviewView`) handles all event types inline. Hard to test, hard to extend, hard to reason about. |
| 18 | B17 | No worktree support for agent isolation | 🟡 Medium | Medium | Large | N/A | Concurrent agents in the same workspace can step on each other's files. Git worktrees would give each agent its own checkout. |
| 19 | B18 | Webview message handler map — 85 string-keyed entries | 🟢 Low | Low | Small | main.ts:2747 | No compile-time type safety for message handler keys. Runtime `type` string dispatch. 85 handlers in single closure scope. |
| 20 | B20 | Cold first-message latency from lazy start | 🟢 Low | High | Small | extension.ts | Server starts on first webview resolve. First prompt includes server startup time (~1-3s). "Waiting for server..." perceived as latency. |
| 21 | B21 | RetryQueueService max 50 — silent eviction | 🟢 Low | Medium | Small | RetryQueueService.ts:49 | When queue is full, oldest non-critical item evicted. If all 50 are critical, oldest critical item evicted. |
| 22 | B22 | Auto-compaction only triggers on active tab | 🟢 Low | Medium | Small | AutoCompactor.ts:58 | Background tabs can exceed context limits without triggering compaction. Only the active tab's token count is monitored. |
| 23 | B23 | Model list refresh race on first prompt | 🟢 Low | Medium | Small | StreamCoordinator.ts:1080-1098 | If model list hasn't loaded by first prompt, 3s timeout race to fetch. On timeout, sends prompt without model — server may reject. |
| 24 | B24 | No pre-fetch of background tab sessions | 🟢 Low | Low | Medium | SessionLifecycleService.ts | Only the active tab gets backfilled. Switching to a background tab triggers a blocking fetch. |
| 25 | B25 | PendingEventBuffer 10s TTL — can miss slow-mapping events | 🟢 Low | Medium | Small | PendingEventBuffer.ts:14 | If `setCliSessionId` takes >10s after session creation (unlikely but possible under load), buffered events are dropped. |
| 26 | B26 | Single global AbortController per operation | 🟢 Low | Low | Small | SessionClient.ts | All retries of the same prompt share one AbortController. Can't abort just one retry attempt. |
| 27 | B27 | ContextEngine reads all open files to memory | 🟢 Low | Low | Small | ContextEngine.ts:44-85 | Up to 10 open files read fully into memory for each context gather. Large files (>50K tokens) may OOM. Token truncation is per-file, not global. |
| 28 | B28 | RateLimitMonitor 1s status bar interval | 🟢 Low | Low | Trivial | RateLimitMonitor.ts | `setInterval` every 1s for countdown timer. Trivial CPU cost but unnecessary when no rate limit is active. |

---

## Summary Statistics

| Severity | Count | Est. Total Effort |
|----------|-------|-------------------|
| Critical | 3 | ~8 weeks |
| High | 3 | ~5 weeks |
| Medium | 4 | ~2-3 weeks |
| Low | 18 | ~4-5 weeks |
| **Total** | **28** | **~20 weeks** |

---

## Quick Reference: Top 5 Fixes by ROI

| Fix | Effort | Impact | ROI Rationale |
|-----|--------|--------|---------------|
| B7: Configurable MAX_TABS | Small | Medium | 1-line change, enables power users |
| B9: HostPromptQueue priorities | Small | Low | Minimal change, better UX for urgent prompts |
| B4: Paginated message fetch | Small | High | Major latency win on resume, simple pagination API |
| B8: Configurable message cap | Small | Medium | Config override for power users with long convos |
| B20: Pre-warm server on activation | Small | Low | 1-3s latency reduction on first prompt |

## Quick Reference: Top 5 Fixes by Impact

| Fix | Effort | Impact | Primary Risk |
|-----|--------|--------|-------------|
| B1: Per-session process (ADR-010) | Large | Critical | High complexity, integration testing |
| B2: Multiple SSE connections | Medium | Critical | Server-side SSE fanout support |
| B3: Process isolation wiring | Large | Critical | Depends on B1 + server changes |
| B4: Paginated message fetch | Small | High | Server API compatibility |
| B5: StreamCoordinator consolidation | Medium | High | Regression risk in stream state machine |
