# Streaming Performance

> How a streamed assistant response travels from the opencode server to pixels,
> and the performance properties of each stage. Written 2026-06-02 from a
> first-principles read of the code (see `docs/performance-audit.md` for the
> audit that produced it and `docs/performance-research-notes.md` for the
> external research backing the design choices). Every claim below cites
> `file:line`.

## Pipeline overview

```
opencode server (SSE)
   │  message.part.updated / tool events
   ▼
SseSubscriber → StreamCoordinator              (extension host)
   │  stream_chunk / stream_tool_* / stream_end
   ▼
HostMessageBatcher                             (extension host)
   │  coalesces chunks per session, adaptive flush 35–150ms,
   │  256KB payload guard, consecutive-dup dedup, pause/resume backpressure
   ▼  webview.postMessage(host_message_batch | stream_chunk)
WebviewEventRouter / main.ts handlers          (webview)
   │  enqueue(text)
   ▼
RenderQueue                                    (webview, per stream)
   │  rAF batch + 50ms setTimeout fallback, 1MB forced-flush cap
   ▼  renderCallback(text)
LiveTextRenderer.renderInto(textEl, displayText)
   │  freeze stable prefix (append-only), re-parse only the bounded tail
   ▼
markdown-it (sync) + highlight.js + DOMPurify  → DOM
```

## Stage-by-stage performance properties

### 1. Host → webview batching — `src/chat/HostMessageBatcher.ts`
- **Per-session chunk coalescing**: chunks for a session accumulate and flush as
  one `stream_chunk`. Forced flush at `maxChunkBatchSize` (10 KB,
  `HostMessageBatcher.ts:97`).
- **Velocity-adaptive cadence**: flush delay scales 35 ms → 150 ms with stream
  velocity (`computeChunkFlushDelay`, `HostMessageBatcher.ts:285`). Fast streams
  flush less often (bigger batches, fewer postMessages); slow streams flush
  promptly (low latency to first paint).
- **Payload guard**: a single batchable message > 256 KB is dropped with a
  warning (`HostMessageBatcher.ts:144`) — prevents one giant payload from
  stalling the webview queue. Lifecycle messages (`stream_start`, `stream_end`,
  errors — the `IMMEDIATE_TYPES` set at `:27`) bypass batching and the guard.
- **Dedup**: ≥16 consecutive identical-fingerprint payloads are dropped
  (`:158`). Fingerprint = `type + JSON length` (`stableFingerprint`, `:353`).
  *Known limitation:* two **distinct** same-type messages with identical
  serialized length collide; after the window the later one could be dropped.
  Low real-world risk (values usually change length); a content hash would add
  hot-path cost. Tracked, not changed.
- **Backpressure**: `pauseSession`/`resumeSession` (`:203`) let the host hold a
  session's chunks (e.g. while the webview is busy) and replay on resume.

### 2. Webview frame batching — `src/chat/webview/renderQueue.ts`
- Coalesces every chunk received within a frame into **one** flush via
  `requestAnimationFrame` (`renderQueue.ts:56`).
- **Hidden-webview safety**: a `setTimeout(…, 50)` fallback (`:64`) flushes even
  when rAF is throttled/parked (background tab / hidden panel) — without it, a
  hidden-but-streaming panel would buffer indefinitely.
- **Hard cap**: `MAX_BUFFER_SIZE = 1 MB` (`:10`) forces an immediate flush if a
  burst outruns the frame loop, bounding worst-case memory and one-shot work.
- Tracks `chunkCount`/`flushCount`/`totalBytesIn`/`pendingBytes`
  (`getStats`, `:46`) — ready-made instrumentation for a debug overlay.

### 3. Incremental render — `src/chat/webview/liveTextRenderer.ts`
This is the core anti-O(n²) mechanism, and it matches the technique the research
recommends (Chrome "render streamed LLM responses", incremark):
- `splitAtStableBoundary(displayText)` divides the buffer into a **stable
  prefix** (closed markdown blocks) and an **unstable tail**.
- The stable prefix is appended **once** via `insertAdjacentHTML("beforeend", …)`
  (`liveTextRenderer.ts:48`) and never re-parsed — so selection and `<details>`
  open-state survive flushes, and the prefix cost is paid once, not every frame.
- Only the tail is re-rendered each flush, and it's bounded:
  `MAX_LIVE_TAIL_RENDER_CHARS = 64_000` (`:5`); past that the tail falls back to
  `textContent` (`:51`) — no markdown/highlight at all — so a pathological
  no-boundary stream can't create an unbounded per-frame parse.
- Stable prefix renders with `isStreaming=false` (cache + worker eligible); the
  tail renders with `isStreaming=true` (sync, lowest latency).

### 4. Markdown + highlight — `src/chat/webview/renderer.ts`, `syntaxHighlighter.ts`
- **Sync path** (`renderMarkdown`, `renderer.ts:266`): markdown-it on the main
  thread. Used for the streaming tail (must be sync, per frame) and at block
  finalization (`streamHandlers.ts:82`). Cache-backed by `markdownCache`
  (`LruStringCache(250 entries, 2 MB)`, `renderer.ts:128`).
- **Worker path** (`renderMarkdownAsync` → `MarkdownWorkerClient`,
  `renderer.ts:276`): off-thread markdown for non-streaming/large renders
  (`shouldRenderMarkdownInWorker`), result sanitized on the main thread.
- **Highlight** (`highlightSyntax`, `syntaxHighlighter.ts:116`): LRU-cached
  (`HighlightCache(500)`). Targeted `hljs.highlight()` when the fence names a
  known language; otherwise `hljs.highlightAuto()` over all 15 registered
  grammars. **Size cap (2026-06-02): blocks > `MAX_HIGHLIGHT_CHARS` (50 KB)
  return escaped plaintext** (`syntaxHighlighter.ts`, mirrored in
  `markdownWorker.ts`) — prevents a huge block from turning finalization into a
  main-thread long task. Languages are registered lazily on first highlight
  (`ensureLanguagesRegistered`) so grammar construction doesn't block first paint.

### 5. Finalization — `src/chat/webview/streamHandlers.ts:82`
When a text block closes (tool boundary or stream end) it is re-rendered once,
synchronously, in full (`textEl.innerHTML = renderMarkdown(displayText, false)`)
to merge frozen prefix + tail into one clean `markdown-content` block and pick up
the markdown cache. **Residual risk:** for a very large finished block this is a
single main-thread parse; routing it through `renderMarkdownAsync` (worker) is the
recommended future improvement (see audit follow-ups). The size cap above bounds
the *highlight* portion of that work regardless.

## Large-session strategy (not streaming, but related)
Long transcripts use **windowing**, not `content-visibility`: `virtualList.ts`
keeps only a window of recent messages in the DOM with a "load earlier" banner
above them (wired via `createVirtualList`/`getVirtualList`/`disposeVirtualList`
in `main.ts`). `content-visibility: auto` is **not** currently used (only a
`visible` opt-out on the banner) and remains an available, not-yet-applied lever
for the rendered window.

## What is deliberately *not* optimized further (and why)
- **No swap to a dedicated streaming-markdown parser.** `LiveTextRenderer`
  already captures the O(n²)→O(n) win while keeping one markdown engine across
  streaming/finalize/worker/history. Forking engines is high-risk for marginal
  gain.
- **No transferables over postMessage.** Unsupported by VS Code webviews as of
  June 2026 (vscode#115411); payloads are JSON text anyway.
- **`retainContextWhenHidden: true`** (`extension.ts:583`) is kept: it preserves
  live streaming DOM + scroll when the panel hides. It is the dominant webview
  memory lever; revisit only with a measured retained-heap number and a
  `getState`-backed rehydrate design.

## Performance budget (targets; measure in a real host)
| Path | Target |
|---|---|
| First local echo of a sent prompt | < 100 ms |
| Host chunk → webview render | < 50 ms avg under normal load |
| Any single render task during streaming | < 50 ms (long-task threshold) |
| Tail re-parse per flush | bounded by 64 KB cap |
| Single highlight call | bounded by 50 KB cap |
| Changed-files update (100 files) | < 100 ms |
| Tab switch with active stream | < 150 ms |

These are not yet measured in this environment (no VS Code host / DevTools
available from the CLI session). The `RenderQueue.getStats()`,
`getRendererCacheStats()`, and `HostMessageBatcher` counters are the intended
hooks for a debug-gated perf overlay to capture them.
