# ADR: Stable-Tail Streaming Render

**Status:** Accepted
**Date:** 2026-05-29
**Authors:** Claude (Opus 4.8)

## Context

The host already streams **incremental text deltas** to the webview
(`DeltaHandler` / `TextPartHandler` emit only the new slice, and
`HostMessageBatcher` velocity-batches them). The wire is therefore O(total).

The webview render path, however, was quadratic. On every flush both render
paths did:

```ts
const displayText = stripContextFromText(state.currentBlockBuffer) // full buffer
textEl.innerHTML = renderMarkdown(displayText, true)               // full re-parse
```

For an N-char answer arriving over k flushes this is **O(N·k)** of `markdown-it`
parse + `DOMPurify` sanitize + full `innerHTML` replacement — on the main
thread. Additionally:

- During streaming, `renderMarkdown(..., isStreaming=true)` **bypasses the
  markdown cache and the markdown worker** ([renderer.ts]), so the heaviest
  phase of the app ran uncached and on-thread.
- Replacing the whole `innerHTML` each flush destroyed text selection, IME
  composition, and `<details>` open-state, and forced full layout/paint.

## Decision

Split the streaming buffer into a **stable prefix** (closed markdown blocks that
will not change as more text arrives) and an unstable **tail**, and render them
separately.

- `streamTail.splitAtStableBoundary(buf)` returns `{ stable, tail }`, splitting
  at the last blank line (`\n\n`) that is **outside a fenced code block** and
  that is a *safe* boundary. A boundary is rejected when either side is a list
  item, blockquote, or indented continuation — so loose lists, multi-paragraph
  blockquotes, and indented continuations are never fragmented. When unsure it
  keeps text in the tail (correctness over optimization). Lossless:
  `stable + tail === buf`. Cost is a single O(n) line scan (no backtracking) —
  orders of magnitude cheaper than the parse it avoids.

- `LiveTextRenderer` owns a two-child container:
  - `.stream-frozen` — stable blocks, appended **once** via `insertAdjacentHTML`
    and never reassigned. Rendered with `isStreaming=false`, so it is
    **cache- and worker-eligible**, and selection / `<details>` state survive.
  - `.stream-tail` — the unstable remainder, re-rendered each flush (bounded by
    one block). Rendered with `isStreaming=true`.
  It reattaches (rebuilding frozen state) when pointed at a new container — e.g.
  a fresh text block created after a tool boundary — so one instance spans a
  whole stream, and rebuilds defensively if the stable prefix ever shrinks
  (e.g. a `<context>` strip shift).

The model still stores the full text per text block, so the post-stream
`reRenderMessage` from the server's authoritative blocks is unchanged.

This converts O(N·k) into ≈ O(N + tail·k). `streamBench.test.ts` asserts the
total parsed characters stay a small multiple of N (≥8× better than the
quadratic baseline on a 60 KB / ~120-flush fixture) and that each frozen block
is parsed exactly once.

## Alternatives considered

- **Memoize the stable HTML in one element** (`frozenHtml + render(tail)` with a
  single `innerHTML =` per flush): captures the parse-cost win but still
  reassigns `innerHTML`, so selection/`<details>` are lost (P3 unfixed). The
  two-child structure fixes both for marginal extra code.
- **Native WASM markdown/highlighter** (`comrak` + `ammonia`, or `syntect`):
  deferred. The defect was algorithmic (re-parsing), not a slow language;
  fixing the algorithm in TS keeps the build toolchain simple. WASM is reserved
  as a profile-gated follow-up for the off-thread syntax highlighter.

## Consequences

- **+** Near-linear streaming render; cache/worker reuse for closed blocks;
  selection and disclosure state survive mid-stream.
- **−** Slightly more DOM structure (two children inside `.msg-text`) and a
  per-stream `LiveTextRenderer` instance. Frozen-block boundaries are
  conservative, so some optimizable text occasionally stays in the tail —
  always correct, just not maximally frozen.
- **Trade-off:** boundary detection prefers correctness; constructs containing
  blank lines (loose lists, etc.) are kept whole in the tail until a provably
  safe boundary appears.

## References

- `src/chat/webview/streamTail.ts`, `liveTextRenderer.ts`, `streamHandlers.ts`
- Tests: `streamTail.test.ts`, `liveTextRenderer.test.ts`, `streamBench.test.ts`,
  `renderQueue.toolBoundary.test.ts`, `streamEnd.forceFlush.test.ts`,
  `streamHandlers.restart.test.ts`, `messageUpsert.test.ts`,
  `placeholderContent.test.ts`, `stripContext.test.ts`, `streamWiring.test.ts`
