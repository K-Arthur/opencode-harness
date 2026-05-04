# ADR-002: Multi-Tab Worker Model with Concurrency Limits

**Status:** Accepted

## Context

Users need to work on multiple tasks concurrently (e.g., debugging, refactoring, and exploring). We need to design how the extension handles multiple simultaneous conversations with the opencode agent.

## Decision

We will use a **Multi-Tab Worker model** where:
- Each tab is an independent worker (server session) with its own model, mode, and conversation history
- Maximum **3 concurrent streams** are allowed (enforced by `TabManager`)
- Tabs are lightweight wrappers around server sessions
- Closing a tab stops the worker but preserves chat history in `SessionStore` (soft-close semantics)

## Alternatives Considered

1. **Single session with context switching**: Rejected because users need concurrent workstreams.

2. **Unlimited tabs**: Rejected because each stream consumes resources and 3 concurrent streams is a reasonable UX limit.

3. **Shared session, separate contexts**: Rejected because opencode server already supports multiple sessions via its API.

## Consequences

**Positive:**
- Users can work on multiple tasks simultaneously
- Each tab maintains independent conversation history
- Soft-close semantics preserve history for later resumption
- Per-tab model selection allows using different models for different tasks

**Negative:**
- Concurrency limit requires UI feedback when limit is reached
- `TabManager` must enforce `MAX_CONCURRENT = 3`
- Stream coordination across tabs adds complexity

**Mitigations:**
- `TabManager.canStartNewStream()` checks count before allowing new streams
- UI shows warning with names of currently streaming tabs when limit reached
- `StreamCoordinator` manages per-tab SSE streams independently

## References

- Architecture Spec Section 1.1: Multi-Tab design
- `TabManager.ts`: Concurrency enforcement (`MAX_CONCURRENT = 3`)
- `SessionStore.ts`: History persistence for soft-close
