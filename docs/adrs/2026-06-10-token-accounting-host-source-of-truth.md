# ADR: Host SessionStore is the canonical token/cost ledger

**Date:** 2026-06-10
**Status:** Accepted

## Context

Token and cost figures shown in the status strip were inaccurate and
inconsistent, especially after closing/reopening a session or switching tabs.
Two independent accumulators existed:

1. **Host** — `SessionStore.accumulateTokenUsage/accumulateCost`, fed by
   `step_finish` events (ChatProvider) and the final-usage fallback
   (StreamCoordinator).
2. **Webview** — `accumulateTokenUsage/accumulateCost` in
   `ui/tokenCostDisplay.ts`, fed by `step_tokens` / `token_usage` messages
   carrying **deltas**.

The only reconciliation was a 30-second duplicate-signature window
(`isDuplicateRecentStepUsage`) plus asymmetric merge rules in the webview's
`ensureSession`. Any SSE replay, message re-delivery, or webview reload caused
the two ledgers to drift — totals jumped or reset when switching sessions.

`cost_update` already worked differently: it carries the **cumulative** session
cost and the webview SETs it (`handleCostUpdate`), which proved immune to the
drift.

## Decision

The host `SessionStore` is the single source of truth for token usage and cost.

- `step_tokens` (ChatProvider `step_finish`) and the final `token_usage`
  fallback (StreamCoordinator) now attach `cumulative` (the host session's
  `tokenUsage`) and `cumulativeCost` to the outgoing message **after** host
  accumulation.
- The webview prefers these fields: `applyTokenUsageTotals()` SETs the session
  totals (idempotent under replay) instead of adding deltas.
- Legacy payloads without `cumulative` still go through the delta path with the
  30s dedup window (back-compat with older hosts).
- `ensureSession` lets host-provided `tokenUsage`/positive `cost` replace local
  values when a host snapshot arrives.

## Consequences

- Re-delivered or replayed events can no longer double-count: applying the same
  cumulative payload twice yields identical totals.
- Tab switches and webview reloads display exactly what the host ledger holds.
- The webview-side delta accumulator remains only as a legacy fallback and can
  be removed once no older host emits delta-only payloads.

Tests: `ui/tokenCostDisplay.context.test.ts` (idempotency / replace semantics /
legacy back-compat), `ChatProvider.test.ts` (cumulative fields on
`step_finish`), `state.test.ts` (host snapshot wins in `ensureSession`).
