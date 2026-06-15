# R1 — Unify the Dual Stream State Machine

**Status:** Planned (2026-06-15) · **Priority:** P0 · **Audit ref:** 2026-06-15 productivity/reliability audit, finding F2.1
**Depends on / builds on:** R2 (`IntentionalAbortRegistry`, pure run-identity seam — `e37d04d`), R3 (`createLazyStarter` — `e51f1a7`)
**Related:** R4 (decompose `main.ts`) is the natural follow-on — R1 gives the webview a small, typed render surface that R4 can route cleanly.

---

## 1. Problem

Streaming reliability bugs recur (empty bubbles, stuck "live" dots, lost tool calls, switch-lag, abort mis-mapping — the dominant theme in `Status.md`/`CHANGELOG.md`). Each has been fixed pointwise, on **both** sides of the webview boundary, because the stream state machine is implemented **twice**.

**Root cause:** there is no single source of truth for stream lifecycle state. The host and the webview each independently infer "is this message live / finalized / aborted / which bubble does this chunk belong to."

## 2. Evidence (current dual implementation)

**Host derives & owns** (`src/chat/handlers/`):
- `StreamCoordinator.ts` (~2.5k LOC): `activeRuns`, `activeMessageIds`, `streamStates`, `finalizingTabs`, `abortedTabs`, `serverMessageId` (R2), tool reconciliation, heartbeats, deferral/backpressure.
- `StreamFinalizerService.ts`, `RunActivityTracker.ts`, `src/session/eventHandlers/*` (EventNormalizer).

**Webview re-derives** (`src/chat/webview/`):
- `streamHandlers.ts` (~1.5k LOC): `StreamState.isStreaming`, `mergeStreamText` (chunk overlap dedup), `findMessageById`, and a family of **compensating** finalizers — `finalizeStreamingText`, `finalizeAllPendingTools`, `finishUnresolvedToolCalls`, `demoteStreamingText`, `reRenderMessage`. The code comments ("defensive end-of-turn sweep", "mop up true orphans") are symptoms of the webview guessing at state it cannot authoritatively know.
- `main.ts` (~4.6k LOC), `renderer.ts` (~2.3k LOC), `streamOrchestrator.ts` (stream-end reason → system message).

**Wire contract today (host → webview, per stream):** `stream_start`, `stream_chunk`, `stream_tool_start`, `stream_tool_update`, `stream_tool_partial`, `stream_tool_end`, `stream_tool_unresolved`, `stream_end`, `stream_ping`, `stream_interrupted`, `step_tokens`, `token_usage`, `run_activity_update`, `force_rerender`.

These are **deltas**: the webview must reconstruct message/run state from the stream of deltas — i.e. maintain its own copy of the state machine. `force_rerender` exists precisely because the two copies drift and the host has to forcibly resync the webview.

## 3. Goal / target architecture

One **host-authoritative** stream state machine; the webview becomes a **pure renderer** of host-pushed view-models.

```
SSE → EventNormalizer → ┌─────────────────────────────┐
                        │ streamReducer (PURE, shared) │  ← single source of truth
                        └──────────────┬──────────────┘
                                       │ emits immutable per-message ViewModels
                        host posts ──► webview renders (no state inference)
```

- **Pure `streamReducer(state, event) → state`** lives in `src/shared/` (the established cross-boundary module, cf. `contextUsage.ts`). No DOM, no `vscode`, no I/O — fully unit-testable with the existing `node:test` harness.
- Host owns the reducer instance per tab; on each transition it posts an **immutable `MessageViewModel[]`** (or a targeted patch) to the webview.
- Webview deletes its stream-state inference: `streamHandlers` shrinks to render glue; the compensating finalizers and `force_rerender` go away (the host's terminal transition is authoritative).

## 4. The seam — view-model contract

Define in `src/shared/streamViewModel.ts`:

```ts
export type MessageLifecycle = "streaming" | "finalized" | "aborted" | "error"
export interface ToolViewModel { id: string; name: string; status: "pending"|"running"|"ok"|"error"|"cancelled"; ... }
export interface MessageViewModel {
  id: string                 // host-anchored UI id (resp-…) — the ONE id the webview keys on
  serverMessageId?: string   // from R2
  role: "user" | "assistant"
  lifecycle: MessageLifecycle
  blocks: Block[]            // text / tool / thinking, already reconciled by the host
  seq: number                // monotonic, for ordered application
  ...
}
```

New wire message `stream_view_model` (sessionId + `MessageViewModel` patch + seq). The legacy delta messages stay during migration (see phases) and are removed in the final phase.

## 5. Phased migration (incremental — ship each phase)

Each phase is independently shippable, behind a flag where behavior could change, with RED-first tests.

- **Phase 0 — Extract types & reducer skeleton.** `src/shared/streamViewModel.ts` + `src/shared/streamReducer.ts` with the state shape and the events from the normalized event set. Behavioral tests only (no wiring). *No runtime change.*
- **Phase 1 — Host routes events through the reducer (shadow mode).** Feed the same normalized events into the reducer alongside the existing `StreamCoordinator` path; assert the reducer's derived state matches the coordinator's via **characterization tests**. Reducer output is computed but not yet sent. *No runtime change.*
- **Phase 2 — Push view-models behind a flag.** New setting `opencode.streaming.unifiedRenderer` (default `false`). When on, host posts `stream_view_model`; webview renders from it in parallel with the legacy path (dual render guarded so only one is visible). Dogfood.
- **Phase 3 — Flip default + delete webview inference.** Default the flag `true`; remove `streamHandlers` state inference, the compensating finalizers, and `force_rerender`. `streamHandlers` becomes pure render glue.
- **Phase 4 — Remove legacy deltas + flag.** Delete the per-delta wire messages superseded by `stream_view_model` and the flag. Collapse `StreamCoordinator` state that the reducer now owns.

## 6. Reducer design notes

- **Run identity:** key on `serverMessageId` where present (R2 already records it), fall back to host-anchored `resp-…` id. This kills the "which bubble does this chunk belong to" class of bugs.
- **Idempotent under replay:** SSE can replay; transitions must be safe to re-apply (use `seq`). Roundtrip tests must cover out-of-order and duplicate events.
- **Terminal authority:** `finalized`/`aborted`/`error` are set only by the host reducer; the webview never demotes "live" on its own → no stuck dots, no orphan sweeps.
- **Abort:** consume `IntentionalAbortRegistry` (R2) inside the reducer's error transition so suppression and lifecycle live in one place.

## 7. Test strategy (also delivers R5 for this surface)

- **Reducer unit tests** (`src/shared/streamReducer.test.ts`): every normalized event (`start/chunk/tool_*/abort/switch/end/ping/step_tokens`), out-of-order, duplicate/replay, multi-message turns (text→tool→text), restart-for-new-id.
- **Characterization tests** (Phase 1): reducer-derived state == current coordinator state for recorded event sequences.
- **Roundtrip tests** (extend `test:roundtrip`): host view-model → webview render produces the expected DOM-agnostic structure.
- **Delete** the source-string stream tests as their behavior is covered behaviorally (continues R5).

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Large blast radius | Phases 0–1 are no-ops; Phase 2 is flag-gated parallel render; deletion only after characterization passes |
| Regress multi-tab concurrency (a differentiator) | Per-tab reducer instances; snapshot tests per tab; keep `maxConcurrentStreams` path |
| Bundle size — host at **561.6/562 KB**, ~0.4 KB headroom | Reducer is shared/small; net should *drop* webview bundle as `streamHandlers` shrinks. Re-baseline `scripts/check-bundle-size.mjs` as needed |
| Hidden coupling in `main.ts` (4.6k LOC closure) | Sequence R4 right after Phase 3 so the render surface lands in a routable module |

## 9. Acceptance criteria / success metrics

- Streaming-bug reopen rate → ~0 over 60 days post Phase 4.
- One copy of stream lifecycle logic (webview inference deleted; `force_rerender` gone).
- Behavioral coverage of stream paths ≥ 90%; source-string stream tests = 0.
- All gates green each phase (typecheck, unit, message-contract, roundtrip, prod build + bundle).

## 10. Out of scope

- R4 (`main.ts` decomposition) — follow-on.
- v2 SDK `delivery:"steer"|"queue"` events (noted in `Status.md` 2026-06-13) — fold into the reducer's event set when adopted.
