# Performance Research Notes

> Companion to `docs/performance-audit.md`. This file records the **external
> research** consulted for the 2026-06-02 performance pass, what was found
> relevant to *this* extension, what was rejected as not applicable, the
> assumptions still needing validation, and the concrete optimization
> principles adopted. Every external claim below was cross-checked against the
> actual code — citations to `file:line` mark where the codebase already
> satisfies (or violates) a principle.

Date: 2026-06-02
Method: focused web research (official docs + high-quality engineering write-ups),
then verification against the codebase. No claim was accepted without a code
cross-check.

---

## 1. Sources consulted

### Streaming / markdown rendering
- **Chrome for Developers — "Best practices to render streamed LLM responses"**
  <https://developer.chrome.com/docs/ai/render-llm-responses>
- **"Eliminate Redundant Markdown Parsing: 2-10x Faster AI Streaming" / `incremark`** (DEV / Medium)
  <https://dev.to/kingshuaishuai/eliminate-redundant-markdown-parsing-typically-2-10x-faster-ai-streaming-4k94>
- **"From O(n²) to O(n): Building a Streaming Markdown Renderer for the AI Era"** (DEV)
  <https://dev.to/kingshuaishuai/from-on2-to-on-building-a-streaming-markdown-renderer-for-the-ai-era-3k0f>

### Browser rendering / main-thread
- **web.dev — "Avoid large, complex layouts and layout thrashing"**
  <https://web.dev/avoid-large-complex-layouts-and-layout-thrashing/>
- **MDN — Long Animation Frame timing** (50 ms long-task threshold)
  <https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing>
- **DebugBear — "Improve Web Performance With requestAnimationFrame"**
  <https://www.debugbear.com/blog/requestanimationframe>
- **web.dev — "content-visibility: the new CSS property that boosts rendering performance"**
  <https://web.dev/articles/content-visibility>
- **MDN — `contain-intrinsic-size`**
  <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain-intrinsic-size>

### Syntax highlighting
- **highlight.js docs — Core API / readme** (auto-detection cost, language subsets)
  <https://highlightjs.readthedocs.io/en/latest/api.html>

### VS Code extension / webview
- **VS Code API — Webview guide** (`postMessage`, `getState`/`setState`,
  `retainContextWhenHidden` memory cost, dispose on `onDidDispose`)
  <https://code.visualstudio.com/api/extension-guides/webview>
- **microsoft/vscode #115411 — "Support transferables in webview postMessage"**
  (postMessage has no transferables; typed arrays serialize to fat objects)
  <https://github.com/microsoft/vscode/issues/115411>
- **TypeFox — "Enhancing communication between extensions and webviews"**
  <https://www.typefox.io/blog/vs-code-messenger/>

---

## 2. Findings relevant to this extension (with code cross-check)

### 2.1 Streaming markdown must not re-parse the whole buffer per chunk
External consensus (Chrome, incremark): naive `el.innerHTML = parse(allText)` on
every chunk is O(n²); the fix is an **append-only** renderer that freezes stable
blocks and only re-parses the **unstable tail**.

**Codebase already does this.** `LiveTextRenderer`
(`src/chat/webview/liveTextRenderer.ts`) splits at a stable boundary
(`splitAtStableBoundary`), appends frozen blocks once via `insertAdjacentHTML`
(`liveTextRenderer.ts:48`) and re-renders only the bounded tail
(`MAX_LIVE_TAIL_RENDER_CHARS = 64_000`, `liveTextRenderer.ts:5,51`). Frozen
blocks are rendered with `isStreaming=false` so they are cache/worker-eligible.
**Verdict: principle satisfied — do not regress.**

Residual: the **finalization** path (`streamHandlers.ts:82`,
`textEl.innerHTML = renderMarkdown(displayText, false)`) does one full
synchronous re-parse per finished block. Fine for normal sizes; for very large
blocks it is a single main-thread long task. Candidate to route through the
worker (`renderMarkdownAsync`). See audit §B.

### 2.2 Batch DOM writes to animation frames; respect the 50 ms long-task budget
web.dev / DebugBear: coalesce writes into one `requestAnimationFrame`; tasks
>50 ms block the main thread.

**Codebase already does this.** `RenderQueue` (`src/chat/webview/renderQueue.ts`)
coalesces all chunks received within a frame into a single flush via
`requestAnimationFrame`, with a `setTimeout(…, 50)` **fallback** so a hidden /
background webview (where rAF is throttled/parked) still flushes, plus a 1 MB
`MAX_BUFFER_SIZE` forced-flush cap. **Verdict: satisfied — do not regress.**

### 2.3 highlight.js `highlightAuto()` is materially slower than `highlight(code, {language})`
highlight.js docs: auto-detection runs the code against *every registered
grammar*; restrict via a language subset or specify the language.

**Codebase is exposed here.** `highlightSyntax` falls back to
`hljs.highlightAuto(code)` over **all 15 registered languages** when the fence
has no/unknown language (`syntaxHighlighter.ts:132`, and the worker twin
`markdownWorker.ts:110`). Results are cached, but during streaming the tail's
code grows each flush → new cache key → repeated `highlightAuto` over growing
input. **Verdict: real, bounded cost.** Low-risk mitigation: cap the input size
for auto-detection so a pathological large block can't produce a long task
(see audit §B fix). A subset restriction would change colouring and is deferred.

### 2.4 `retainContextWhenHidden` has high memory overhead
VS Code docs: "`getState`/`setState` … have much lower performance overhead than
`retainContextWhenHidden`" which has "high memory overhead and should only be
used when other persistence techniques will not work."

**Codebase uses it:** `extension.ts:583`
(`webviewOptions: { retainContextWhenHidden: true }`). It also has a
`getState`/`setState` layer (`composer.ts:14`). This is a *deliberate* tradeoff:
the chat panel keeps a live streaming DOM, scroll position and in-flight stream
state when hidden — re-hydrating those from `getState` mid-stream is non-trivial.
**Verdict: justified tradeoff, but it is the dominant memory lever for the
webview.** Recommendation = measure retained heap with several long sessions
open before considering a `getState`-backed rehydrate; do **not** flip it blindly
(would drop streaming state on hide). Tracked as future work, not a fix.

### 2.5 `postMessage` payload size matters; no transferables
VS Code / vscode#115411: webview `postMessage` is structured-clone of
JSON-serializable data only; large/whole-state pushes are pure serialization
cost on the extension-host thread.

**Codebase mitigates host→webview chatter** with `HostMessageBatcher`
(`src/chat/HostMessageBatcher.ts`) — coalescing is the right pattern. Audit §E
checks for whole-state re-pushes (changed files, session restore, diffs) that
could be sent as deltas instead. **Verdict: pattern present; verify payloads.**

### 2.6 `content-visibility: auto` skips offscreen layout/paint (needs `contain-intrinsic-size`)
web.dev/MDN: `content-visibility: auto` lets the UA skip rendering offscreen
subtrees (virtual-scroll-like), but without `contain-intrinsic-size` the
scrollbar jumps as items realize.

**Codebase does NOT currently use it.** Source + built CSS contain only a single
`content-visibility: visible` *opt-out* on the load-earlier banner
(`messages.css:42`); there is **no `content-visibility: auto` skip region**.
The large-list strategy is instead **windowing** — `virtualList.ts` renders a
window of recent messages with a "load earlier" banner
(`main.ts` `createVirtualList`/`getVirtualList`/`disposeVirtualList`). The
comments in `scrollAnchor.ts:10` and `messages.css:41` that reference a
"content-visibility skip region" are **stale** (describe a removed approach).
**Verdict:** windowing is a legitimate strategy; the stale comments are a
correctness-of-docs bug (fix), and `content-visibility: auto` on the rendered
window is an *available, not-yet-used* complementary lever (recommend, measure
first).

---

## 3. Findings rejected as not applicable

- **"Swap markdown-it for a dedicated streaming parser (streaming-markdown /
  incremark)."** Rejected for now. The freeze-tail `LiveTextRenderer` already
  captures the O(n²)→O(n) win that these libraries sell, while keeping a single
  markdown engine (markdown-it) shared by streaming, finalization, worker, and
  static history. Swapping engines would fork rendering semantics
  (task-lists plugin, linkify, sanitiser contract) for a marginal gain and high
  regression risk. Re-evaluate only if profiling shows tail parsing is hot.
- **"Use transferable ArrayBuffers / SharedArrayBuffer over postMessage."**
  Not supported by VS Code webview `postMessage` (vscode#115411). The payloads
  here are JSON (text/markdown/diff metadata), not binary; no transferable win
  to capture.
- **"Add a full windowing/virtual-list library (react-window etc.)."** Rejected:
  windowing already exists (`virtualList.ts`) and the app is not React. Adding a
  library would be net-negative for the bundle (which is already over the gate).
- **"`will-change` everywhere for smoother scroll."** Rejected as a blanket
  change — `will-change` is already applied deliberately to transform/scroll
  layers (`messages.css:25`, `components.css:390/1035`, etc.). Over-applying
  `will-change` *increases* memory (extra compositor layers) and can hurt.

---

## 4. Assumptions still needing validation (no profiler in this environment)

These require a real VS Code host + DevTools/profiler trace, which is not
available from this CLI session. They are stated so they are not mistaken for
verified facts:

1. **`highlightAuto` is actually hit during typical streaming.** Verified
   *reachable* by code path; not measured as a % of frame time. The size-cap fix
   is defensive, not proven-necessary.
2. **`retainContextWhenHidden` retained-heap magnitude** across N long sessions.
   Asserted as the dominant webview memory lever by docs; not measured here.
3. **Finalization full re-parse (`streamHandlers.ts:82`) long-task duration** for
   very large blocks. Logic-level risk; not timed.
4. **Real host→webview payload sizes** for session restore / changed-files /
   diffs under large sessions. `HostMessageBatcher` exists; per-message bytes not
   captured. The optional `PerfMark` instrumentation (audit §5) is the intended
   way to capture these in a running host.

---

## 5. Concrete optimization principles adopted for this pass

1. **Verify before changing.** Every "issue" must trace to `file:line`, a
   measurement, or a documented contradiction. (This pass already overturned two
   wrong initial assumptions: the bundle "2× over" was a dev/unminified artifact,
   and the "per-chunk full re-parse" is actually the freeze-tail renderer.)
2. **Don't regress the existing hot-path wins**: `RenderQueue` rAF+fallback
   batching, `LiveTextRenderer` freeze-tail, bounded LRU caches
   (`markdownCache` 250 entries / 2 MB, `highlightCache` 500), `MAX_DIFF_LINES_RENDERED`,
   windowing, `HostMessageBatcher`.
3. **Prefer bounded over unbounded.** Any growing buffer/map/string in a hot path
   gets an explicit cap with a stated tradeoff (see audit §H).
4. **Keep heavy parsing off the per-frame path.** Sync markdown on the main
   thread only for the bounded streaming tail; full/large parses go to the worker.
5. **Bundle gate is a feature, not a nuisance.** Treat the 680 KB webview /
   510 KB host limits as real (re-baselined 2026-06-02 from 600 / 500 KB
   in `scripts/check-bundle-size.mjs`); prefer reductions over raising
   limits, and only adjust a limit with attribution evidence + a recorded
   paydown plan.
6. **Security/accessibility win ties.** Never weaken DOMPurify config, CSP, message
   validation, focus/ARIA, or reduced-motion to gain speed.
