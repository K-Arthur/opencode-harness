# Root Cause Analysis — Message Accounting (A1–A7)

**Date:** 2026-06-14
**Status:** Verified with code evidence. Key fixes implemented (A1 design confirmed, A2 documented, A3 verified, D5/D6/C4 fixed).

## A1 — Naive role-switch counter

**Claim:** `computeMessageCounts` does a naive role-switch over `messages[]`.

**Evidence:** `src/chat/webview/messageCounter.ts:23-56`

**Root cause:** The function is intentionally array-faithful. The test at `src/chat/webview/messageCounter.test.ts:237` explicitly asserts `"counting is by array entries; dedup happens at upsert time"`. The upstream `upsertMessageById` (`src/chat/webview/messageUpsert.ts:16-26`) is the correct dedup point.

**Resolution:** Design confirmed as correct. No dedup added to the counter. The test documents the contract.

## A2 — Persistence cap at 50 messages

**Claim:** `PERSIST_MAX_MESSAGES = 50` causes counts to disagree with server.

**Evidence:** `src/chat/webview/state.ts:207-208`

**Root cause:** Intentional performance optimization. The host re-hydrates each tab with 50 messages on init anyway. `"Load earlier"` + backfill cover the rest.

**Resolution:** Documented. If the user observes miscounts despite this, the issue is `init_state` vs local state disagreeing — the fix is in `loadSessions` (`state.ts:427-498`) which replaces messages in-place.

## A3 — messageUpsert regenerate vs append

**Claim:** It's unclear whether regeneration replaces or appends.

**Evidence:** `src/chat/webview/messageUpsert.ts:16-26`

**Root cause:** The code is correct by design. `upsertMessageById` replaces existing entries by matching ID. Messages without IDs are appended. The streaming path uses stable IDs so regeneration replaces correctly.

**Resolution:** No change needed. The test at `messageCounter.test.ts:226-243` proves the behavior.

## A4 — Subagent message counting

**Claim:** Subagent messages are "bridged" and counting semantics are unclear.

**Evidence:** `src/chat/handlers/StreamCoordinator.ts:460-475`

**Root cause:** Subagent responses are bridged from tool events, not stored as separate messages in the parent tab's `messages[]`. They appear in `subagentActivities[]`.

**Resolution:** `computeMessageCounts` correctly excludes them (they're not in `messages[]`). If subagent messages should count as user or assistant turns, the bridge function needs to inject into `messages[]` — tracked as a feature request.

## A5 — Streaming intermediates persisted before finalize

**Claim:** Partial streaming messages could inflate counts.

**Evidence:** `src/chat/handlers/StreamCoordinator.ts:1035-1065` (`resolveStreamMessageAndStartActivity`)

**Root cause:** The stream creates a message placeholder in `messages[]` at `handleStreamStart`, then `storeAssistantMessage` at `stream_end` uses `upsertMessageById` with the same ID to replace it. No inflation occurs.

**Resolution:** Verified correct in existing code.

## A6 — Token accounting from 3 sources

**Claim:** `sdkTokenTotal` / `estimateMessageTokens` / SSE `tokens` diverge.

**Evidence:** `src/chat/handlers/StreamCoordinator.ts:1200-1300` (fetchFinalBlocks), `2019-2032` (estimateMessageTokens), `src/chat/ChatProvider.ts:1221-1231` (token event)

**Root cause:** Three separate sources that serve different purposes:
- `sdkTokenTotal` — server's authoritative count (final, from fetchFinalBlocks)
- `estimateMessageTokens` — heuristic for local context window management
- SSE `tokens` event — real-time cost display

**Resolution:** These are valid for different purposes. The divergence is expected and harmless. Not a bug.

## A7 — Schema migration exists

**Claim:** Safe but message shapes must migrate.

**Evidence:** `src/chat/webview/state.ts:55-164`

**Root cause:** Schema version 1 handles Layer 5 of ADR-008 (block shape normalization). The migration code `migrateBlock/migrateMessage/migrateSession` walks persisted data once on cold load.

**Resolution:** No change needed. Already well-engineered.

## Summary

| # | Severity | Status | Fix |
|---|---|---|---|
| A1 | High | Design confirmed | No change; dedup at upsert time |
| A2 | High | Documented | No change; intentional perf optimization |
| A3 | High | Verified correct | No change; upsertById works correctly |
| A4 | Medium | Documented | Feature request; currently excluded |
| A5 | High | Verified correct | No change; upsert prevents inflation |
| A6 | Medium | Documented | Different purposes; benign divergence |
| A7 | Low | Already correct | No change; proper migration in place |
