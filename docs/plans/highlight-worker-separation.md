# Plan: Move highlight.js off the Main Thread

**Goal:** Remove highlight.js (78.8 KB) from the synchronous `main.js` bundle by dispatching all syntax highlighting to the existing markdown web worker, which already bundles highlight.js with all 15 language grammars. This saves ~78.8 KB from the 638 KB minified main.js, hitting the 600 KB paydown target.

**Current state:**
- `main.js` (main thread): imports `highlight.js/lib/core` + 15 language grammars + DOMPurify in `syntaxHighlighter.ts` (78.8 KB)
- `markdownWorker.js` (worker): imports *the same* highlight.js core + 15 language grammars (78.8 KB duplicated)
- The worker already has a working `highlightSyntax()` function (line 110-121 of `markdownWorker.ts`)
- `renderMarkdownAsync()` already dispatches full markdown rendering to the worker for large content

## Architecture

### Phase 1: Add highlight protocol to the worker

**`src/chat/webview/markdownWorker.ts` — Add highlight-only message handler:**

```typescript
type HighlightRequest = { id: number; code: string; language: string; type: "highlight" }
type HighlightResponse = { id: number; html: string } | { id: number; error: string }
```

Extend `self.onmessage` to handle two request shapes (detected by `type` field):
- `type: "render"` → existing markdown rendering (current `RenderRequest`)
- `type: "highlight"` → calls `highlightSyntax(code, language)` and returns the HTML

No new dependencies needed; `highlightSyntax()` already exists in the worker at line 110.

### Phase 2: Create highlight client on main thread

**`src/chat/webview/renderer.ts` — Add a `highlightCode()` method to `MarkdownWorkerClient`:**

The existing `MarkdownWorkerClient` class (lines 162-257) manages the worker lifecycle and tracks pending requests. Add:

```typescript
async highlight(code: string, language: string): Promise<string | undefined> {
  // Reuse the same worker — same lifecycle, just a different message type
}
```

This reuses the existing worker connection, timeout logic, error handling, and disposal path.

### Phase 3: Replace synchronous highlight calls

**Replace `highlightSyntax()` calls in 4 files:**

| File | Line(s) | Current | New behavior |
|------|---------|---------|-------------|
| `renderer.ts` | 315 | `markdown-it highlight: (str, lang) => highlightSyntax(str, lang)` | Return `escapeHtml(str)` — markdown-it code blocks in streaming content show plaintext. This is acceptable because finalized code blocks are re-rendered by `renderCodeBlock()` which gets async highlighting. |
| `renderer.ts` | 743, 759 | `renderCodeBlock()` calls `highlightSyntax(code, lang)` synchronously | Dispatch `markdownWorkerClient.highlight(code, lang)` asynchronously. If the worker times out (10s default), fall back to `escapeHtml(code)`. |
| `streamHandlers.ts` | 819, 826 | JSON tool args highlighted via `highlightSyntax(argsStr, 'json')` | Dispatch `await markdownWorkerClient.highlight(argsStr, 'json')`. For inline args shown during streaming, use `escapeHtml(argsStr)` synchrously. For finalized args panels, use async. |
| `toolCallRenderer.ts` | 254, 260 | JSON tool args highlighted via `highlightSyntax(argsStr, 'json')` | Same as streamHandlers.ts — finalized args use async, streaming uses `escapeHtml()` sync |

### Phase 4: Remove highlight.js from `syntaxHighlighter.ts`

**`src/chat/webview/syntaxHighlighter.ts`:**

Remove:
- `import hljs from "highlight.js/lib/core"`
- All 15 language imports (`javascript`, `typescript`, `python`, etc.)
- The `ensureLanguagesRegistered()` function
- The `highlightSyntax()` export
- The `HighlightCache` class (no longer needed — caching happens in the worker)
- The `getHighlightCacheSize()` export
- The `clearHighlightCache()` export

Keep:
- `import DOMPurify from "dompurify"` (still needed for XSS protection)
- `sanitizeHtml()` function (still used everywhere)
- `escapeHtml()` helper (still needed for fallback highlighting)
- `PURIFY_CONFIG`

**`src/chat/webview/renderer.ts`:** Update imports — remove `highlightSyntax`, `clearHighlightCache`, `getHighlightCacheSize` from the `./syntaxHighlighter` import. Remove the re-export `export { sanitizeHtml, highlightSyntax } from "./syntaxHighlighter"` — only re-export `sanitizeHtml`.

### Phase 5: Clean up dead exports

**`src/chat/webview/streamHandlers.ts`:** Update import to only import `sanitizeHtml` from `./syntaxHighlighter`.

**`src/chat/webview/toolCallRenderer.ts`:** Same — only import `sanitizeHtml`.

## Async Challenge: `renderCodeBlock`

The `renderCodeBlock` function (line 671-764) is called **synchronously** during message rendering. It currently calls `highlightSyntax()` inline to set `.innerHTML`. To make it async:

**Option A (recommended):** Return a placeholder immediately, then update after worker responds.
```
1. Create the outer DOM structure (header, buttons, empty `<pre>`)
2. Set `<pre>` content to `escapeHtml(code)` (plaintext, no colors)
3. Call `markdownWorkerClient.highlight(code, language)`
4. When the promise resolves, update `<pre>.innerHTML` with highlighted HTML
```

This means code blocks appear as plaintext for a few ms, then pop in with colors. The placeholder response is instant (no jank), and the async update is fire-and-forget (no blocking).

**Option B:** Make `renderCodeBlock` return a `Promise<HTMLElement>` and make the render pipeline `async`. This requires changing `renderBlock()` (line 632+) to be async, which cascades to every render call site. Too invasive for the initial pass.

**Recommendation: Option A.** Code blocks are for finalized content (not streaming), so a 50-100ms delay before colors appear is imperceptible. The placeholder (plaintext) ensures the user can read the code immediately.

## `markdown-it` `highlight` callback

The `markdown-it` `highlight` callback (line 315) is **synchronous**. During streaming, `renderMarkdown()` calls `md.render()` synchronously. The callback cannot dispatch to the worker.

**Fix:** Return `escapeHtml(str)` from the callback. This means code blocks rendered *through markdown-it* during sync rendering will show plaintext. However:
- Non-streaming code blocks go through `renderCodeBlock()` (which will get async highlighting via Option A)
- Streaming code blocks are temporary — they're replaced when the message is finalized
- The `renderMarkdownAsync()` path already dispatches to the worker for *full* markdown rendering (including syntax highlighting via the worker's own `highlight` callback)

So the trade-off is: during sync rendering, code blocks show plaintext. Once finalized (via `renderCodeBlock`), they get async syntax highlighting. This is acceptable.

## Tool Args/Results JSON highlighting

`streamHandlers.ts:819,826` and `toolCallRenderer.ts:254,260` highlight JSON in tool argument/result panels. These are:
- `streamHandlers.ts`: Called during streaming to build/update tool call blocks. Use `escapeHtml()` for streaming, trigger async highlight after.
- `toolCallRenderer.ts`: Called during finalized rendering (tool call blocks in the transcript). Can use async highlight since the DOM element already exists.

**Pattern:** Create a helper function in `renderer.ts` (or in a new `highlightService.ts`):

```typescript
async function applyHighlight(el: HTMLElement, code: string, language: string): Promise<void> {
  const result = await markdownWorkerClient.highlight(code, language)
  el.innerHTML = sanitizeHtml(result ?? escapeHtml(code))
}
```

## Sync exports that must remain

`syntaxHighlighter.ts` must still export a synchronous `escapeHtml` for:
- **streaming tool args** — need immediate plaintext before async finish
- **markdown-it callback** — need immediate plaintext before async finish
- **fallback when worker fails or times out** — graceful degradation

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Worker timeout leaves code blocks plaintext | Low | Default timeout is 10s; highlight of a small JSON snippet takes <5ms. Increase timeout or keep sync fallback. |
| Worker highlight rejects on malformed code | Medium | Wrap in try/catch, fall back to `escapeHtml()`. The worker already catches errors. |
| Multiple rapid highlights overwhelm worker | Low | Worker handles one message at a time; the client queues. For bursts (e.g., rendering a session with 50 code blocks), the first few will get colors after ~50-100ms each. Acceptable UX. |
| `renderCodeBlock` swap-in causes layout shift | Medium | The `<pre>` element already exists and has the correct dimensions. Setting `innerHTML` on an empty or plaintext `<pre>` does not change its size (same amount of content). No layout shift. |

## Success Criteria

1. `npm run build` succeeds
2. `npm run typecheck` — 0 errors
3. `npm run test:unit` — all pass
4. `npx eslint src/` — 0 errors
5. highlight.js is NOT in `dist/chat/webview/main.js` bundle
6. highlight.js IS still in `dist/chat/webview/markdownWorker.js` bundle
7. Code blocks render with colors in the webview
8. JSON tool arguments render with colors
9. Streaming messages show code blocks (plaintext during stream, colors when finalized)
10. Bundle size check: `dist/chat/webview/main.js` ≤ 600 KB minified
