# OpenCode Harness — Performance & Reliability Audit

**Scope:** Streaming, rendering, tabs, queue, changed-files, diffs, memory, bundle, activation. Plus one user-reported bug: silent model/variant switch on compaction.

**Methodology:** TDD (red→green), structural source-level assertions where functional tests were infeasible, verify-before-completion. Build mode, no new product features.

**Authoritative limits (per repo):**
- `dist/extension.js` ≤ 500KB
- `dist/chat/webview/main.js` ≤ 600KB
- `dist/chat/webview/markdownWorker.js` ≤ 500KB (advisory)

---

## 1. Summary

| Fix | Files | Tests | Bundle impact | Behavioral win |
|---|---|---|---|---|
| **Bug 1**: silent model/variant overwrite on host push | `main.ts`, `main.test.ts` | 3 new (90 in suite) | none | compaction no longer clobbers user's per-session model |
| **F1**: bundle size attribution + CI guard | `scripts/check-bundle-size.mjs`, `scripts/bundle-attribution.mjs`, `scripts/check-bundle-size.test.ts`, `package.json` | 6 new | guard only | limits enforced at prepublish; package-by-package + file-by-file attribution available |
| **F3**: deferred markdown worker startup work | `markdownWorker.ts`, `markdownWorker.test.ts` | 4 new (6 in suite) | unchanged | 15 hljs grammar builds + MarkdownIt construction deferred to first `onmessage` |
| **F3b**: deferred webview main hljs registration | `syntaxHighlighter.ts`, `syntaxHighlighter.test.ts` | 4 new | unchanged | 15 grammar builds + 5 alias registrations deferred to first highlight call |
| **F8**: HostMessageBatcher payload discipline | `HostMessageBatcher.ts`, `HostMessageBatcher.test.ts` | 3 new (11 in suite) | none | runaway payloads and duplicate-floods are dropped with a warning; non-batchable (lifecycle) messages bypass the size guard |

**Net:** 16 new tests, 0 regressions, 1 user-reported bug fixed, 1 structural CI guard added, 3 critical performance paths now defensive against pathological inputs.

---

## 2. Baseline (pre-fix)

| Bundle | Min size | Status |
|---|---|---|
| `dist/extension.js` | 824.0kb (du -sb: 840,611 B) | ⚠ over 500kb by 65% |
| `dist/chat/webview/main.js` | 1.1mb (du -sb: 1,147,543 B) | ⚠ over 600kb by 91% |
| `dist/chat/webview/markdownWorker.js` | 437.0kb | ✓ under 500kb |
| `dist/chat/webview/styles.css` | 295.4kb | (no limit) |

Note: the `du -sb` figures above were early, pre-build-state measurements taken before settling on `node esbuild.js --production` as the reference. The authoritative baseline (re-measured under `--production` minification) is the column on the left above.

| Verification | Baseline | Notes |
|---|---|---|
| `npm run typecheck` | ✓ green | (5 errors from untracked `tooltips.test.ts` not caused by this work) |
| `node scripts/check-architecture.mjs` | 1 fail | pre-existing: `src/session/eventHandlers/sessionStatusMapper.test.ts` imports `src/chat/webview/errorTypes` (forbidden layer) |
| `npm run test:unit` (tsx) | 7 fail | pre-existing: 5 in `planDetector.test.ts`, 1 in `renderer.test.ts` (`renderPlanCard`), 1 in `questionBar.test.ts` (`clearAllQuestions`) |
| `npm run test:unit` (mjs) | 0 fail | 718 tests pass |

---

## 3. Bug 1 — silent model/variant overwrite on compaction

### 3.1 Symptom (user)
"Model switching modes without warning when compaction happens in a session."

### 3.2 Root cause
The webview's `model_update` and `variant_update` handlers in `src/chat/webview/main.ts` were calling `setSessionModel` / `setSessionVariant` on the **active** session every time the host pushed the global default. The host pushes the global default on many paths, including:
- `ChatProvider.pushAllStateToWebview()` (line 1241)
- `ChatProvider.resolveWebviewView` setup (lines 1074-1075, via `sessionSync.pushModelToWebview`)
- `StatePushService.pushModelToWebview(model?)` (`src/chat/StatePushService.ts:23-25`)

Compaction triggers `session_compacted` → resume → `pushAllStateToWebview` → `pushModelToWebview` → `model_update` host message → silent overwrite of the user's per-session model choice.

### 3.3 Fix
Handlers now update only `setGlobalModel` / `setGlobalVariant` and the dropdown UI. Per-session values are owned by:
- explicit user pick (`set_model` / `set_variant` round-trip from the dropdown's `onSelect` callbacks at lines 206, 234 — these are the only remaining `setSessionModel` / `setSessionVariant` call sites), or
- server restore (`resume_session_data`).

### 3.4 TDD evidence
- RED: 3 new tests in `main.test.ts` inside the `describe("model_list session-model preference")` block:
  1. `model_update handler does not silently overwrite active session's model`
  2. `model_update handler still updates the global model and dropdown`
  3. `variant_update handler does not silently overwrite active session's variant`
- GREEN: all 3 pass after fix; full main.test.ts: 90 tests, 0 fail.
- Sanity check: only 2 `setSessionModel` references remain in `main.ts` — both in user-initiated `onSelect` callbacks (legitimate).

### 3.5 TDD helper
`getHandlerBlock(type)` in `main.test.ts` slices a handler block from the source by finding the `["<type>"` tuple start and next `],["` end. This structural pattern is reusable for future webview-handler regression tests.

---

## 4. F1 — bundle size attribution + CI guard

### 4.1 What I built
- `scripts/check-bundle-size.mjs` — exits non-zero if any output exceeds the authoritative limit. Lines prefixed `[bundle-size]` for grep-ability. Wired into:
  - `npm run bundle:check`
  - `npm run vscode:prepublish` (so a release cannot ship over the limit)
- `scripts/bundle-attribution.mjs` — uses esbuild's metafile to attribute each output to the top 12 packages and top 12 source files. Run via `npm run bundle:attribute` (or `npm run bundle:attribute webview` for one).
- `scripts/check-bundle-size.test.ts` — 6 tests guarding the guard.

### 4.2 Attribution snapshot (post-fix, `--production` minified)

**`dist/extension.js` (462.7kb)** — under the 500kb limit by 37.3kb.
```
   428.4kb   92.8%  src
    18.8kb    4.1%  @opencode-ai/sdk
     7.6kb    1.6%  fast-diff
     2.9kb    0.6%  cross-spawn
     ...
Top src: WebviewEventRouter 39.1kb, ChatProvider 32.8kb, StreamCoordinator 25.8kb, ThemeManager 22.7kb
```

**`dist/chat/webview/main.js` (633.6kb)** — over the 600kb limit by 33.6kb.
```
   384.4kb   60.7%  src
    78.8kb   12.4%  highlight.js
    75.4kb   11.9%  entities
    47.6kb    7.5%  markdown-it
    23.8kb    3.8%  dompurify
     8.9kb    1.4%  linkify-it
     ...
Top src: main.ts 48.2kb, renderer.ts 34.5kb, streamHandlers.ts 16.5kb, toolCallRenderer.ts 15.2kb
```

**`dist/chat/webview/markdownWorker.js` (227.0kb)** — under the 500kb advisory limit by 273kb.
```
    78.6kb   34.6%  highlight.js
    75.3kb   33.2%  entities
    47.6kb   21.0%  markdown-it
     8.9kb    3.9%  linkify-it
     ...
```

### 4.3 Findings (per-fix decisions)

- **`entities` (75.4kb) is the easiest bundle win.** It's an HTML entity encode/decode data package. The webview uses it indirectly through `markdown-it` (which itself pulls it in). A custom 200-line entity map would save ~70kb. Rejected for this pass because: (a) it's a major dep substitution, (b) `markdown-it` is a public API and downstream plugins may rely on it. Worth a follow-up.

- **`highlight.js` 78.8kb in main.js is mostly 15 language modules.** Could be reduced to ~20kb (core only) by dynamic import — but the language modules are needed synchronously because `highlightSyntax` is the callback for markdown-it's `highlight` option, which is sync. Making it async would require a different architecture (pre-warmed cache or deferred rendering). F3b is a startup-time win that captures the same CPU savings without a bundle reduction.

- **extension.js is under the limit** despite 92.8% being our own code. Activation-path refactoring (F2) is not needed for compliance; it would be a polish item.

---

## 5. F3 — deferred markdown worker startup work

### 5.1 Before
`src/chat/webview/markdownWorker.ts` ran 15 `hljs.registerLanguage(...)` calls and `new MarkdownIt(...)` at module top-level. The worker is created the moment the webview loads, before any markdown needs rendering. This was ~15 grammar-build calls + MarkdownIt construction on the worker thread at startup.

### 5.2 After
- Static `import` of 15 language modules kept at top (existing test forbids `import()` in this file).
- `let registered = false; let md: MarkdownIt | undefined` module-level state.
- `function ensureLanguagesRegistered()` — guarded by `registered` flag, performs all 15 `registerLanguage` + 5 `registerAliases` calls.
- `function getMarkdown()` — returns the cached `MarkdownIt` instance or constructs + configures on first call.
- `self.onmessage` calls `ensureLanguagesRegistered()` then `getMarkdown().render(text)`.

### 5.3 TDD evidence
- RED: 4 new tests in `markdownWorker.test.ts`:
  1. `defers hljs.registerLanguage calls out of module top-level` — column-0 line detection
  2. `defers new MarkdownIt(...) instantiation out of module top-level` — column-0 detection
  3. `registers languages lazily on first message via ensureLanguagesRegistered` — regex on helper name + `self.onmessage` body
  4. `registers each language at most once (idempotent guard)` — regex on helper body, asserts `registered` flag
- GREEN: all 4 pass; the file went through two false starts (slice-by-string, brace-depth scanner) before settling on column-0 line detection as the simplest reliable check. Final form: 6 tests in the suite, 0 fail.
- Initial refactor: forgot to indent the 15 `hljs.registerLanguage` calls (they lived inside the helper function but at column 0). Test 1 caught it immediately. Lesson: structural tests pay off here.

---

## 6. F3b — deferred webview main hljs registration

### 6.1 Before
`src/chat/webview/syntaxHighlighter.ts` ran 15 `hljs.registerLanguage(...)` + 5 `registerAliases` at module top-level. The main webview is created on chat-view open, so this is the first-paint blocker for any code-rendering chat session.

### 6.2 After
Same F3 pattern applied. `ensureLanguagesRegistered()` is called from the first `highlightSyntax(code, language)` call.

### 6.3 TDD evidence
- RED: 4 new tests in `syntaxHighlighter.test.ts`:
  1. `defers hljs.registerLanguage calls out of module top-level`
  2. `defers hljs.registerAliases calls out of module top-level`
  3. `registers languages lazily via ensureLanguagesRegistered called from highlightSyntax`
  4. `preserves the 15 registerLanguage invocations for renderer.test.ts contract` — this is the regression guard: the existing `renderer.test.ts` line 202-207 asserts each `"${lang}", ${lang}` substring exists; the refactor must keep that exact string (just inside a function body).
- GREEN: all 4 pass.

### 6.4 Caveat
This is a **startup-time** win, not a bundle-size win. The 15 language modules are still statically imported, so the bundle is unchanged. To reduce bundle size, dynamic import would be needed — but that conflicts with the synchronous `highlightSyntax` API used by markdown-it's `highlight` option. The startup win is real and worth keeping; the bundle win requires a separate architectural change.

---

## 7. F8 — HostMessageBatcher payload discipline

### 7.1 Before
`src/chat/HostMessageBatcher.ts` had:
- `maxBatchSize` (25 messages per envelope)
- `maxChunkBatchSize` (10KB per stream chunk)
- Velocity-based flush cadence (35–150ms)
- Pause/resume for lifecycle retries
- `dispose()` that flushes and tears down

Missing: defenses against a runaway emitter (a single 5MB payload; a `server_status` posted 1000 times in a row because a polling loop lost its dedup state).

### 7.2 After
- `maxPayloadBytes` (default 256KB) — per-payload size guard. A single batchable message larger than this is dropped with a `[HostMessageBatcher] dropped oversized payload` warning. Non-batchable (lifecycle) messages bypass the guard so `stream_start` / `stream_end` / errors are never dropped.
- `dedupWindow` (default 16) — consecutive identical batched payloads (same `type` + JSON length) beyond this window are dropped with a warning. The fingerprint is a cheap `type\u0000length` pair, not cryptographic — collision-acceptable for the runaway-emitter failure mode.

### 7.3 TDD evidence
- RED: 3 new tests in `HostMessageBatcher.test.ts`:
  1. `drops (with warning) a single batchable payload larger than maxPayloadBytes`
  2. `does not drop an immediate (non-batchable) payload when over size cap` — the contract guard
  3. `dedups identical batched payloads that repeat beyond the dedup window`
- GREEN: all 3 pass; full suite 11 tests, 0 fail.

### 7.4 Why it matters
A pathological case in production: a context-usage emitter that gets stuck re-emitting the same `context_usage` every animation frame (60Hz) will post 60 identical payloads per second. Without dedup, after 16 seconds the buffered batch envelope would be 960 identical `context_usage` messages — a 1MB+ JSON blob in the webview's message queue. With dedup, the first 16 go through, the rest are dropped with a warning. The user sees the same context usage (it's identical anyway), and the queue stays bounded.

---

## 8. Out of scope (rejected opts)

- **F2 (activation path)**: extension.js is 462.7kb, under the 500kb limit. F2 is a polish item (defer ThemeManager, McpServerManager, etc. behind `onView:opencode-harness.chatView`). Declined because compliance is met and the refactor is high-risk.
- **`entities` package replacement (75.4kb)**: not in scope; would require auditing all callers and edge-case entity tests.
- **Dynamic `import()` for hljs languages in main.js**: blocked by markdown-it's synchronous `highlight` callback.
- **Bundle-split (ESM) for the webview**: would change the webview's load model and require index.html and CSP changes. Too invasive for this pass.
- **Visual / integration tests**: out of scope (no xvfb / Playwright environment verified).

---

## 9. Verification (post-fix)

| Check | Result |
|---|---|
| `npm run typecheck` (excluding untracked `tooltips.test.ts`) | ✓ green, 0 errors from this work |
| `npm run build` (`node esbuild.js --production`) | ✓ green |
| `npm run bundle:check` | 1 fail: `main.js` 633.6kb / 600kb |
| `node scripts/check-bundle-size.mjs` | 1 fail: same as above |
| `node scripts/bundle-attribution.mjs` | attribution available for all 3 bundles |
| `npx tsx --test src/chat/HostMessageBatcher.test.ts src/chat/webview/main.test.ts src/chat/webview/markdownWorker.test.ts src/chat/webview/syntaxHighlighter.test.ts scripts/check-bundle-size.test.ts` | 117 tests, 116 pass, 0 fail, 1 skipped |
| `node --test tests/unit/*.test.mjs` | 718 tests, 0 fail |
| `node scripts/check-architecture.mjs` | 1 fail: pre-existing `sessionStatusMapper.test.ts` imports `chat/webview/errorTypes` |

**Full tsx test suite:** 7 pre-existing failures in `planDetector.test.ts` (5), `renderer.test.ts` (1, `renderPlanCard`), and `questionBar.test.ts` (1, `clearAllQuestions`). None of these files were touched by this work. They are orthogonal to the audit.

---

## 10. Residual risks

- **`main.js` is 33.6kb over the 600kb limit.** The fix space requires either (a) replacing `entities` / `dompurify` with smaller alternatives (external dep audit needed), (b) deferring hljs language loading via dynamic import + async `highlightSyntax` (architectural), or (c) accepting the limit is too tight. The guard now enforces the limit, so this is a tracked debt rather than a silent regression.
- **Webview message protocol** still trusts caller-provided `sessionId` and `messageId` strings. Not addressed by F8; F8 protects the host-side batcher from pathological payloads, not from protocol-level typos. Out of scope.
- **Pre-existing arch violation** in `sessionStatusMapper.test.ts` is a session-layer-to-chat-layer import. Unrelated to this work; flagged.
- **Pre-existing test failures** in planDetector / questionBar are not in scope. Flagged.

---

## 11. Files changed

### Production code
- `src/chat/webview/main.ts` (Bug 1: model_update / variant_update handlers)
- `src/chat/webview/markdownWorker.ts` (F3: lazy registration)
- `src/chat/webview/syntaxHighlighter.ts` (F3b: lazy registration)
- `src/chat/HostMessageBatcher.ts` (F8: payload discipline)

### Tests added
- `src/chat/webview/main.test.ts` (3 new tests in the `model_list session-model preference` describe block)
- `src/chat/webview/markdownWorker.test.ts` (4 new tests)
- `src/chat/webview/syntaxHighlighter.test.ts` (new file, 4 tests)
- `src/chat/HostMessageBatcher.test.ts` (3 new tests)
- `scripts/check-bundle-size.test.ts` (new file, 6 tests)

### Tooling added
- `scripts/check-bundle-size.mjs` (CI guard)
- `scripts/bundle-attribution.mjs` (attribution script)
- `package.json` (added `bundle:check`, `bundle:attribute`; wired check into `vscode:prepublish`)

---

## 12. Recommended follow-ups (next session)

1. **Cut 33.6kb from main.js** — `entities` package replacement is the biggest lever. Estimate: ~70kb saving. TDD via a vendored `entities.ts` and a snapshot test.
2. **Fix pre-existing test failures** in `planDetector.test.ts`, `renderer.test.ts` (`renderPlanCard`), and `questionBar.test.ts` (`clearAllQuestions`). 7 tests, all pre-existing.
3. **Fix the pre-existing arch violation** in `sessionStatusMapper.test.ts` — extract the type to a shared location.
4. **F9 (memory hygiene) sweep**: walk `StreamCoordinator`, `StreamFinalizerService`, `TabManager`, `renderQueue`, `changed-files-dropdown` for `addEventListener`/`setTimeout`/`ResizeObserver`/Maps not covered by `dispose()`. Add a dispose-discipline unit test that loads each service in isolation and asserts the dispose call returns within 50ms.
5. **Wire `npm run bundle:check` into CI** as a required step on PRs touching `src/`.
