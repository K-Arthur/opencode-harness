# Performance investigation: streaming/switch lag that "grows over time"

**Date:** 2026-06-06
**Symptoms reported:** UI lags with only two sessions open; switching sessions is
slow; lag is worst *during streaming* and *gets worse the longer sessions stay
open*.
**Status:** Root cause found and fixed (frontend). One unrelated runtime
regression discovered in an in-progress edit (see "Incidental findings").

---

## TL;DR

The extension is already heavily performance-hardened (single SSE connection,
adaptive host→webview batching, rAF-batched live rendering, frozen-prefix
markdown, DOM-evicting virtualization, debounced persistence on both sides). The
remaining lag was **not** a missing optimization — it was one O(N) hot path
hiding *inside* the virtualization layer:

> `VirtualMessageList.pruneOffScreen()` recomputed the visible window by calling
> `getBoundingClientRect()` on **every** message element on **every**
> IntersectionObserver callback. During streaming the list auto-scrolls ~10–30×/s,
> so this fired a full **O(total-transcript) synchronous layout flush many times a
> second** — and detached placeholders also carry `data-message-id`, so the scan
> never shrank. The cost therefore grew with accumulated history, which is exactly
> the "worse the longer it runs" signature.

**Fix:** derive the visible window from the IntersectionObserver's own
intersection state (which it already computes) instead of re-measuring the DOM.
Measured cost of one prune over a 240-message transcript dropped from **241
`getBoundingClientRect` reads → 0** (the viewport height now uses a single
`clientHeight` read).

---

## How this was investigated (no live GUI required)

This was done by static audit + Node micro-measurement, because the
bottleneck class (forced synchronous layout in a loop) is deterministic and
provable without a running Electron host:

1. **Mapped the full pipeline:** webview (`main.ts`, `streamHandlers.ts`,
   `state.ts`, `virtualList.ts`, `renderQueue.ts`, `liveTextRenderer.ts`) →
   extension host (`ChatProvider.ts`, `StreamCoordinator.ts`,
   `HostMessageBatcher.ts`, `SessionStore.ts`) → opencode SSE (`SseSubscriber.ts`).
2. **Ruled out the usual suspects with evidence** (see table below).
3. **Matched the three symptom signals** (during streaming / on switch / grows
   over time) to code that is simultaneously (a) in the streaming hot path,
   (b) in the switch path, and (c) O(accumulated transcript). Only one path fit:
   the virtual-list prune, which runs on every auto-scroll during streaming AND
   on the scroll triggered by switching into a session.
4. **Pinned it with a failing test** that counts layout-forcing reads
   (`virtualList.prune-perf.test.ts`): 241 reads for 240 messages → confirmed
   O(N). Fixed → bounded.

### Things that were checked and found already-optimal

| Suspected cause (from the brief) | Reality in this codebase |
|---|---|
| Full transcript re-render per token | rAF `RenderQueue` + frozen-prefix `LiveTextRenderer`; `streamBench` proves render is near-linear and the frozen region is parsed exactly once |
| Deep clone of messages per token | In-place block mutation; no per-token clone |
| Streaming updates global state per chunk | `saveState` is **not** called per chunk — it is debounced and fires on stream-end / recovery only |
| Duplicate SSE subscriptions per session | Single global SSE (`SseSubscriber`); events routed to one tab by `cliSessionId` |
| Backend polling | Watchdog (15s) and heartbeat (5s) are gated to *only while a tab is streaming* and self-stop when idle |
| Full session payload resent per chunk | `HostMessageBatcher`: adaptive velocity-based chunk coalescing, dedup window, 256 KB payload cap, 16 ms batch engine |
| No virtualization / pagination | `VirtualMessageList` (DOM eviction), `createChunkedLoader`, `request_more_messages` pagination |
| Unbounded buffers / state | Soft caps, prune-by-age, `MAX_MESSAGES_PER_SESSION`, debounced saves both sides |
| Heavy host work on switch | `syncActiveSession` posts a tiny `active_session_changed`; switching toggles persistent per-tab DOM panels (no re-render) |

---

## Root cause (detail)

`src/chat/webview/virtualList.ts` — `pruneOffScreen()` (before):

```ts
const containerRect = this.container.parentElement?.getBoundingClientRect()
for (let i = 0; i < allMessages.length; i++) {
  const rect = allMessages[i].getBoundingClientRect()   // ← O(N) forced layout
  if (rect.bottom >= viewportTop && rect.top <= viewportBottom) { ... }
}
```

- `allMessages = container.querySelectorAll("[data-message-id]")` includes
  **detached placeholders** (they keep `data-message-id`), so the scan length is
  the *full* transcript, not just attached nodes.
- The prune is scheduled (rAF-deduped) from the IntersectionObserver callback,
  which fires on every scroll. During streaming, `scrollIfAnchored()` runs on
  every render flush, so the observer — and therefore this O(N) layout scan —
  fires continuously.
- `getBoundingClientRect()` forces a synchronous style/layout recalc. Doing it N
  times per scroll, ~10–30×/s, while N grows, is a textbook "compounding jank"
  pattern. It also explains the *switch* lag: switching into a session triggers a
  scroll-restore, which triggers a prune, which (for a long session) was an O(N)
  layout flush on the click.

## Fix

Maintain a `visibleIds: Set<string>` from the observer callback (the observer
*already* tells us `isIntersecting` for each target), and compute the visible
window from set membership using cheap property reads. Use a single
`clientHeight` read for the viewport height. Defer (don't guess) if no
intersection data has arrived yet. Off-screen detach still uses `offsetHeight`
per detached node — a one-time, bounded-per-prune cost, not a per-scroll one.

This preserves the existing virtualization behaviour (same detach/restore,
keep-alive budgets, complexity scoring) and is slightly *more* conservative
(the 500 px observer rootMargin means a touch more is kept attached), which is
safe — it can never detach on-screen content.

### Before / after (measured)

| Metric | Before | After |
|---|---|---|
| `getBoundingClientRect` reads per prune (240-msg transcript) | **241** | **0** |
| Layout reads per prune scaling | **O(total transcript)** | **O(1)** (one `clientHeight`) |
| Prune frequency during streaming | ~10–30×/s (unchanged) | ~10–30×/s (now cheap) |

Test: `src/chat/webview/virtualList.prune-perf.test.ts` (RED→GREEN, pins the
bound at ≤12 reads regardless of N).

---

## Language / runtime evaluation (TS vs Rust/WASM/Go/workers)

The bottleneck was **forced synchronous layout**, not CPU-bound text processing.
Moving anything to Rust/WASM/Go/a worker would not help — layout happens on the
DOM/main thread regardless of where the *decision* logic runs, and the fix was to
stop asking the browser to lay out at all. **No non-TypeScript component is
justified.** The streaming text parse is already bounded by the frozen-prefix
renderer (`streamBench` proves it), so a WASM markdown/tokenizer would add
packaging/debugging complexity for no measurable win. Keep everything in
TypeScript.

If a future CPU bottleneck *does* appear (e.g. very large diff computation
blocking the host), the right first step is a Web Worker in the webview or
`worker_threads` on the host — not a native helper, which complicates
cross-platform packaging and security for the extension marketplace.

---

## Incidental findings (not part of this fix)

- **`context-usage-dropdown.ts` has a runtime ReferenceError in an in-progress
  edit:** `updateUsage()` references a free variable `pct` (lines ~94–95) that no
  longer exists (`Cannot find name 'pct'`). `tsc` flags it; esbuild is type-blind
  and ships it, so calling `updateUsage` will throw `ReferenceError: pct is not
  defined` at runtime, breaking the context-usage button. This was introduced in
  the working tree during the session and is unrelated to the perf work — it must
  be fixed before packaging. (`dropdown-positioning.test.ts` also references a
  removed `badge` option.)
- **Low-priority, transcript-scaling (not fixed):** the streaming flush callback
  in `streamHandlers.ts` calls `messages.find(m => m.id === streamId)` per flush,
  which is O(messages) from the front even though the streaming message is the
  last element. Microsecond-scale today; if profiling ever shows it, switch to a
  reverse scan / cached reference. Left unfixed to avoid churning the streaming
  hot path for a non-measurable gain.

---

## How to profile this extension in the future

- **Webview main-thread jank:** open the webview DevTools (Command Palette →
  "Developer: Open Webview Developer Tools"), Performance tab, record while
  streaming. Watch for "Recalculate Style" / "Layout" purple bars that scale with
  transcript length — that is forced synchronous layout (the bug class fixed here).
  In the Performance pane, "Forced reflow" warnings name the offending call site.
- **Counting layout reads in tests:** stub `Element.prototype.getBoundingClientRect`
  with a counter (see `virtualList.prune-perf.test.ts`) to pin layout cost in CI
  without a GUI.
- **Host hot paths:** `StreamCoordinator`/`ChatProvider` log high-frequency event
  types; enable verbose logging and watch the OpenCode output channel. For CPU,
  run the host under `--inspect` and capture a CPU profile in chrome://inspect.
- **Message volume:** `HostMessageBatcher` is the single choke point for
  host→webview traffic; instrument its `delegate` to count messages/bytes per
  second during a stream.

---

## Follow-up (2026-06-06, same session)

Two more items from the report were completed:

1. **Streaming hot-path lookup (`findMessageById`).** The render-flush / tool /
   diff / skill handlers in `streamHandlers.ts` located the streaming message
   with `Array.find` (front-scan) even though it is always the *last* element —
   an O(N) walk per flush. Replaced all such lookups with a reverse-scan helper
   (`findMessageById`), O(1) in the common case. Ids are unique by construction,
   so semantics are identical. Test: `findMessageById.test.ts`.

2. **Test-harness flakiness (recommendation, not yet applied to `package.json`).**
   The webview suite (`npx tsx --test "src/**/*.test.ts"`) runs files
   concurrently in one process, and many DOM tests assign `globalThis.document`
   / `window` / prototypes without tearing them down, so the failure set shifts
   run-to-run. A large cascade source was the in-progress `context-usage-dropdown.ts`
   `ReferenceError: pct` (now fixed), which removed most of it. Remaining
   recommendation, in priority order:
   - Add `afterEach` teardown of installed globals to DOM tests (the real fix).
     `virtualList.prune-perf.test.ts` now models this pattern.
   - As a stopgap, run the webview glob with `--test-concurrency=1` for
     deterministic ordering (eliminates races; slower).
   `package.json` was being actively edited during this session, so the script
   change was left for the author to apply.

   **Note:** the remaining *real* (isolation-reproducible) failures —
   `sessionIdentityLifecycle` (new untracked file), `WebviewEventRouter.openContextWindowOverride`,
   `ChatProvider` permission tests, `ActivityPartHandler` — are in in-progress
   ADR-014 / context-window work and do **not** import `virtualList` or
   `streamHandlers`; they are unrelated to this performance work.
