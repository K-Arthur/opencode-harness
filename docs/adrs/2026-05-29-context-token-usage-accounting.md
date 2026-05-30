# ADR: Context And Token Usage Accounting

## Status

Accepted

## Context

The extension shows two usage signals that look similar but have different lifecycles:

- Context-window fill: how much of the current model context window is occupied.
- API token spend: cumulative provider usage/cost for a session.

Before this decision, final SDK token accounting could replace cumulative session totals with
only the last assistant turn. At the same time, frontend context usage messages without strict
session routing could update the active tab even when the event belonged to a background
session.

Older sessions add another constraint: they must be able to recover usage from opencode
server/SDK history, including server-listed sessions originally created by the opencode CLI,
where the correct operation is replacing local totals with a full-history summary.

## Decision

Keep context-window fill and API token spend as separate contracts.

- Context-window messages are session-scoped end to end. The webview persists usage on the
  addressed session and repaints visible UI only for the active target session.
- `ContextMonitor.setTokenLimit(limit, sessionId?)` must not emit sessionless stale usage. If
  the target session has previous fill data, it re-emits that session's usage with the new
  denominator.
- `token_usage` host messages use `usage: UsageDelta` as the canonical payload.
- `SessionStore.updateTokenUsage()` means "replace with full-session summary" and is reserved
  for backfill/refresh flows sourced from opencode SDK/server history.
- Live stream accounting uses `SessionStore.accumulateTokenUsage()`. Final SDK assistant usage
  is only a fallback when step-finish accounting has not already advanced the totals.

## Consequences

- Background tabs cannot pollute the active tab's context bar or persisted context usage.
- Multi-turn live sessions retain cumulative token totals instead of being reset by final
  assistant fetches.
- Older sessions can still recover complete usage summaries from the opencode server/SDK data
  path, including CLI-created sessions that the server exposes.
- The webview accepts legacy `tokens` payloads for compatibility, but new host messages should
  use `usage`.

## Verification

- `src/chat/handlers/StreamCoordinator.test.ts`
- `src/monitor/ContextMonitor.test.ts`
- `tests/webview/message-contract.test.ts`
- `tests/webview/chat-e2e.spec.ts`
