# PLAN — Frontend Error-Receiving Infrastructure (Blueprint)

> **Status:** IMPLEMENTING. Commits 1 & 2 (of §10) landed on `master`:
>   - `56d85b4` feat(error-wire): type-safe IPC boundary (`errorWire.ts` + 42 tests)
>   - `5be4217` feat(error-tiers): spatial tier components + live routing wire-up (`errorTiers.ts` + 16 tests, index.html slot, blocks.css tier classes, streamOrchestrator integration)
>
> **Done:** Phase 3 (discriminated union + boundary validation), Phase 4 routing/components/CSS, AGENTS.md error-handling section updated.
> **Deferred follow-ups:** §5 host-side `postError` typed method (wire still carries the payload under `errorContext`, now validated on intake); §6 pre-existing ~30 raw CSS literals in `blocks.css` (not introduced by this work — another agent owns those files); plumb `vscode.getState/setState` into `ErrorStateStore` for Tier-A reload persistence (infrastructure is built + tested, currently in-memory in the orchestrator).
>
> **Methodology:** Supervisor + workers · plan-then-execute. PHASE 1 (PLAN) complete; PHASE 2 (EXECUTE) in progress.
> **Author stance:** Principal Full-Stack Engineer, telemetry & error-propagation topology.

---

## 0. Headline Finding — This Is NOT Greenfield

The task brief assumes the extension "silently swallows or inadequately reflects" errors. **That premise is largely stale.** A direct source audit shows the repo already ships one of the richer error architectures in the dev-tooling category — more structured than Continue.dev's `LLMError(message, llm)` and than anything Cursor/Copilot document publicly, and approaching Claude Code's taxonomy depth:

| Already exists (verified in source) | Location |
|---|---|
| `ErrorCategory` + `ErrorSeverity` enums | `src/chat/webview/errorTypes.ts:12,25` |
| `ErrorContext` + 7 specialized subtypes (`Network`/`Usage`/`Generation`/`Auth`/`Model`/`Context`/`System`) | `errorTypes.ts:73-188` |
| `ErrorAction` w/ 10-element `ErrorActionType` union (retry/upgrade_plan/wait_for_reset/pick_model/…) | `errorTypes.ts:57-68` |
| `ERROR_CODES` registry (~140 lines, ~30 codes) + `DEFAULT_RETRY_STRATEGIES` | `errorTypes.ts:266,306` |
| `mapOpencodeError()` — SDK error → `ErrorContext` (incl. GLM/DeepSeek OpenAI-compat mapping) | `opencodeErrorMapper.ts:79` |
| Specialized renderers: `ErrorDisplay`, `NetworkErrorDisplay`, `QuotaErrorDisplay` | `errorComponents.ts:218,447,484` |
| `renderErrorBlock()` — persisted in-stream block with progressive disclosure + actions | `renderer.ts:2612` |
| `ErrorHandler` with `getErrorStats()` (byCategory/bySeverity/recoveryRate) | `utils/errorHandler.ts` |
| `QuotaMonitor` proactive thresholds (80/50/20/10%) | `quotaMonitor.ts` |
| Duplicate-coalescing, dismiss-from-DOM-and-state, global crash boundary | `streamHandlers.ts` / `main.ts` |

**Therefore the engagement is an *evolutionary gap-fill*, not a clean-sheet design.** The four confirmed gaps (§3) are localized and surgical. A rewrite would discard working, tested machinery and is explicitly rejected.

> ⚠️ **Decision point for the user (§9.1):** the brief's framing implied greenfield. I recommend the evolutionary path. If you actually want a parallel clean-sheet system, redirect now — the plans diverge significantly.

---

## Phase 1 — Competitive & Problem-Space Research (synthesized from two parallel research workers)

### 1.1 Marketplace findings (cited)

| Tool | Error taxonomy depth | Signature behavior |
|---|---|---|
| **Claude Code** | Deepest: ~6 sections, 30+ named classes (server/usage/auth/network/request/policy). `MESSAGE · HINT` string contract. | Shows **two countdowns** — usage-limit reset ("resets 3:45pm", backed by `retry-after` / `anthropic-ratelimit-*-set` headers) and retry backoff ("Retrying in Ns · attempt x/y"). Rich CTAs: ~15 slash cmds + ~6 deep URLs (`status.claude.com`, `claude.com/pricing`, billing/keys). Transient 5xx/529 **hidden during retry**, only shown if exhausted. Hard blockers surface inline; ambient quota → status line. Transcript-persisted; `/resume`, `/rewind`. |
| **GitHub Copilot** | Moderate. AI Credits (typed unit, 1=$0.01). Agent Debug Log persists errors per session. | Quota/auth = **ambient status conditions** (status-bar dashboard, Accounts menu), *not* modals. Even auth revocation gives a 30-min grace window. Context overflow = `/compact`, not an error. `/troubleshoot` + cost-tier enum (Low/Med/High). No public discriminated error union. |
| **Cursor** | Shallow public surface. Two metered pools (Auto+Composer / API). | Quota = status indicator + inline bubble. CTAs: "Add on-demand usage" / "Upgrade plan". Context overflow auto-compresses silently ("context ring" UI). No documented retry/countdown UI. No public error contract; SDK exposes only `requestId` for correlation. |
| **Continue.dev** (OSS, inspected) | Weakest. `LLMError(message, llm)` — no code/severity/category. Errors are "stringly typed", regex-matched in `withExponentialBackoff` (`/overloaded/`, `/"code": 429/`). | Only ONE typed inline error (`"out-of-context"`). Toast-heavy. Two CTAs total (`Open config`, `Hide`). Retry silent (console.log only). |

### 1.2 Three transferable design principles

1. **Severity chooses the location, never the reverse.** Hard blockers (auth, hard cap, policy refusal) earn inline/foreground real estate because the session *cannot proceed* without user action. Transient blips (5xx/529/timeout) are **hidden during retry** and only surface on exhaustion — they never deserve a modal. Ambient quota is a status condition, not an error. (Claude Code, Copilot agree.)
2. **Countdowns are a competitive differentiator.** Claude Code's reset-time and retry-attempt countdowns materially reduce support tickets. We already ingest `retry-after`-equivalent data via `RateLimitMonitor`; we under-render it.
3. **Context overflow is not an error.** Both Cursor and Copilot auto-compress. Surfacing it as Tier-C noise is an anti-pattern.

### 1.3 Host→webview failure-path analysis (VS Code webview sandbox)

- `webview.postMessage()` is async, **non-guaranteed** (returns `Thenable<boolean>`, resolves `false` if the webview is hidden/disposed). `MessagePostService.postRawMessage` already handles this via `onRejected` — good. **Gap:** rejected messages are not retried or queued; a burst during panel-hide is silently dropped.
- There is **no backpressure** signal from webview→host. Rapid-fire multi-stream failure bursts (the brief's edge case) can flood `messageList` DOM appends. Duplicate-coalescing exists (1s window on `userMessage`) but only *within* a single category string — cross-category bursts are not rate-limited.
- Structural payloads (`[object Object]`, null): `mapOpencodeError(null)` is already tested (`opencodeErrorMapper.test.ts:94`), but `webview_request_error`/`show_error`/`provider_error` accept raw `string` and would stringify an object to `[object Object]` — the trivial-pass-through anti-pattern the brief forbids.

### 1.4 Cognitive-ergonomics mapping (why a 5s blip ≠ a hard cap)

A transient 5s disconnect is **retryable, ephemeral, and non-blocking** — the user can keep reading history. Giving it the same visual weight as a hard usage cap (which is **persistent, action-required, composer-disabling**) trains users to dismiss banners reflexively ("banner blindness"), which then defeats the hard-cap banner when it matters. This is the core argument for strict spatial tiering (Phase 2).

---

## Phase 2 — First-Principles Error Classification Matrix

Three mechanical tiers. **Tier = function(severity, retryability, user-action-required, persistence-need).** The `tier` becomes a first-class field on the wire payload (Phase 3) and the sole driver of spatial routing.

### Tier A — Hard Block / Account & Quota Boundaries
- **Examples:** usage limit reached, subscription lapsed, plan entitlement gate (`opus-not-available`), org-policy disabled, credit balance exhausted, hard 402/quota-exceeded.
- **Mapping to existing:** `ErrorCategory.USAGE` / `AUTH` / `SYSTEM` + `severity = CRITICAL` + `retryable = false` → already classified by `mapOpencodeError`. Specialized renderer `QuotaErrorDisplay` exists.
- **UX positioning:** Compact persistent **anchor inside the composer composition space** (replaces/augments today's input-area `QuotaMonitor` banner). **Disables active form inputs** (`#prompt-input[disabled]`, send button converted). Send trigger is *replaced* by the primary recovery CTA ("Upgrade plan" / "Manage subscription" / "Sign in again").
- **Persistence:** `vscode.State`-backed — survives panel collapse/expand AND window reload. Cleared only on explicit user action or server-confirmed recovery.
- **Interaction guard:** Non-blocking to *historic* logs (user can still scroll/read/search). Blocks only *new* composition.
- **Recovery CTAs (verbatim from Claude Code / Copilot parity):** `upgrade_plan` (deep-link), `wait_for_reset` (with live countdown), `pick_model` (opens model manager), `contact_support`. Never `retry` (a hard cap is not retryable).
- **GAP TODAY:** `QuotaMonitor` shows a banner but does **not** reliably disable the composer nor swap the send button into a recovery loop. Tier A is a behavior gap, not a classification gap.

### Tier B — Infrastructure Failures (ambient)
- **Examples:** TCP disconnect, server timeout, 5xx/529, `ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`, SSL/cert failures, transient 429 (per-key throttle, *not* usage), SSE stream interruption.
- **Mapping to existing:** `ErrorCategory.NETWORK` / `SYSTEM` + `severity ≤ HIGH` + `retryable = true`. `NetworkErrorDisplay` + `NetworkErrorContext` exist.
- **UX positioning:** **Ambient global banner** fixed to the **top edge** of the webview (a new `#global-status-banner` slot above `timeline`). Never a modal. **Auto-countdown retry** (`Retrying in Ns · attempt x/y`, Claude-Code parity) with a manual "Retry now" and "Dismiss". Banner **does not steal focus** from the message list — user keeps reading.
- **Persistence:** Ephemeral while the fault is active; *not* written into the persisted transcript unless retries exhaust (then it graduates to a Tier-C in-stream block). State-backed only so the banner survives panel toggle while live.
- **Interaction guard:** Composer stays enabled (user may queue a prompt); if a send fires while Tier-B is active, the prompt enters the retry queue (`RetryQueueService`) automatically.
- **GAP TODAY (the largest gap):** **Tier B does not exist as a spatial zone.** `handleServerStatus("error")` (`streamHandlers.ts:1494-1502`) funnels straight into `handleRequestError` → in-stream bubble. A transient 5s blip renders identically to a local payload fault — exactly the ergonomics failure §1.4 warns against. **This is the principal missing component.**

### Tier C — Local Stream-Context Faults (inline)
- **Examples:** prompt-too-long / context-window exceeded (when not auto-compactable), file-too-large, image-resize failure, invalid payload, tool-use concurrency 400, model misconfiguration, usage-policy refusal, per-message validation rejection.
- **Mapping to existing:** `ErrorCategory.CONTEXT` / `GENERATION` / `MODEL` + `severity ≤ MEDIUM` (mostly). `renderErrorBlock` + `ErrorDisplay` exist and are the right surface.
- **UX positioning:** **Inline system turn embedded in the conversation stream**, scoped to the offending message bubble. **Red warning border + machine-readable error code** on the bubble (`.msg-error` + `data-error-code`). Progressive disclosure (Show Details) for technical detail.
- **Persistence:** Persisted in `messages` history (already via `saveState()` in `handleStreamError`). Survives reload as a transcript record.
- **Interaction guard:** Attaches to a *specific* turn, preventing downstream token corruption. Does not block subsequent turns.
- **GAP TODAY:** Mostly satisfied. Minor: the red border + `data-error-code` attribution is inconsistent; the `code` field from `ErrorContext` is not always rendered for support-traceability.

### Tier derivation function (deterministic, single source of truth)
```
deriveTier(ctx: ErrorContext): 'A' | 'B' | 'C'
  if (!ctx.retryable && ctx.severity === CRITICAL &&
      [USAGE, AUTH, SYSTEM].includes(ctx.category)) return 'A'
  if (ctx.retryable && [NETWORK, SYSTEM].includes(ctx.category)) return 'B'
  return 'C'
```
Pure, unit-testable, and the *only* place spatial routing is decided. Eliminates per-call-site tier guessing.

---

## Phase 3 — Discriminated Union & Type-Safe IPC Schema (TDD specification)

### 3.1 The core violation being fixed
Today the host→webview pipe is **loosely typed end-to-end**:
- `MessagePostService.postMessage(msg: Record<string, unknown>)` (`MessagePostService.ts:13`)
- `MessagePostService.postRequestError(message: string, sessionId?, errorContext?: unknown)` (`:36`)
- Wire variants (`types.ts:603,639-648,688,705`): `errorContext?: unknown`, and `webview_request_error`/`show_error`/`provider_error` carry only a raw `string`.

The rich `ErrorContext` exists in TS but **erases to `unknown` at the boundary**, so the compiler cannot enforce that every emitted error maps to a valid `(category, severity, actions)` triple. This is the "trivial pass-through" the brief forbids.

### 3.2 Target contract — `WebviewErrorPayload` discriminated union

```ts
// NEW: src/chat/webview/errorWire.ts  (sole authority on the wire shape)
export type ErrorTier = 'A' | 'B' | 'C'

// Envelope carried by EVERY error-bearing host message. Replaces `errorContext?: unknown`.
export interface TypedErrorContext extends ErrorContext {
  readonly tier: ErrorTier          // derived host-side via deriveTier()
  readonly correlationId: string    // from generateCorrelationId()
  readonly emittedAt: number        // epoch ms
}

// One discriminated union, one channel. Old parallel channels become deprecated aliases.
export type WebviewErrorPayload =
  | { type: 'error';                       // canonical
      sessionId?: string;
      context: TypedErrorContext }         // subsumes request_error/show_error/provider_error
  | { type: 'error_batch';                 // NEW: multi-stream burst envelope (rate-limited host-side)
      sessionId?: string;
      contexts: TypedErrorContext[] }
  | { type: 'error_cleared';               // NEW: dismiss a live Tier-B banner (reconnect while drawn)
      sessionId?: string;
      correlationIds: string[] }
```

### 3.3 Migration of the seven parallel channels
| Old (deprecated) | Routed to |
|---|---|
| `request_error { message, errorContext? }` | `error` (context built from message if absent) |
| `webview_request_error { error, requestType? }` | `error` (context = `createErrorContext('WEBVIEW_REQUEST_*')`) |
| `show_error { message }` | `error` (context = generic SYSTEM/MEDIUM) |
| `provider_error { error }` | `error` (context = AUTH or USAGE via `mapOpencodeError`) |
| `server_status{status:"error"}` | `error` (context passed through, tier re-derived) |
| `rate_limit_exhausted { info }` | `error` (context = USAGE/CRITICAL, tier A) |
| `prompt_rejected { reason }` | `error` (context = CONTEXT/LOW, tier C, attached to turn) |

A temporary `LegacyHostMessage = HostMessage & Record<string, unknown>` adapter (`types.ts:709`) keeps un-migrated emitters working while the contract narrows.

### 3.4 Boundary validation (no `[object Object]` ever crosses)
A `normalizeIncomingError(raw: unknown): TypedErrorContext` guard at the webview entry point (`main.ts` dispatch) runs before any render:
- Rejects/hydrates `null`, `undefined`, stringified objects, missing `category`/`severity`.
- Falls back to `createErrorContext('UNKNOWN_INBOUND', { tier: 'C' })` — never throws, never renders `[object Object]`.
- Telemetry hook increments `ErrorHandler.getErrorStats()` for every fallback (surfaces contract drift).

### 3.5 TDD specification — tests written FIRST (red), implementation green

Contract test files (all under `src/chat/webview/*.test.ts` per repo convention):

**`errorWire.test.ts`** — wire-shape contracts
- Every `OpencodeError` fixture (from `opencodeErrorMapper.test.ts` corpus) → `mapOpencodeError` → `deriveTier` → `WebviewErrorPayload` round-trips and the `tier` matches the matrix in §2.
- `normalizeIncomingError(null)` → `{tier:'C', category:SYSTEM, code:'UNKNOWN_INBOUND'}` (no throw).
- `normalizeIncomingError("[object Object]")` / `JSON.stringify({})` / `{}` / `{type:'error',context:{}}` → all normalize, none render raw.
- `error_batch` with 50 contexts collapses to ≤1 DOM node (host-side rate-limit gate), and bursts within 1s coalesce by `category+code`.
- `error_cleared` removes a live Tier-B banner and fires no transcript write.
- Rapid-fire: 100 `error` payloads in 10ms → exactly one render frame (debounced via `requestAnimationFrame`), no DOM thrash.

**`errorWire.reconnect.test.ts`** — abrupt restoration while drawn
- Tier-B banner visible → `error_cleared` arrives mid-render → banner removed, no flicker, focus returned to previous element.
- Tier-A banner visible → reconnect → banner **persists** (hard cap not resolved by reconnect) → assert composer still disabled.

**`errorWire.burst.test.ts`** — multi-stream failure bursts
- 5 concurrent streams each emit `error` within 100ms → host-side batcher emits ONE `error_batch` → webview renders one Tier-B banner with "5 failures · Retry all".
- Mixed-tier burst (1× A + 1× B + 3× C) → routed to 3 distinct zones, no cross-contamination.

**`opencodeErrorMapper.test.ts`** (extend) — every upstream → tier mapping
- `MessageAbortedError` → tier C, `retryable:false`, action `dismiss` only.
- `ProviderAuthError` → tier A, action `pick_model` + `contact_support`.
- HTTP 429 transient → tier B, action `wait_for_reset` + live countdown.
- HTTP 402 / `insufficient_quota` body → tier A, action `upgrade_plan` (deep-link).
- `fetch failed: ECONNREFUSED` → tier B, action `retry`.
- Null/undefined/weird-name → tier C fallback, never throws.

All tests run under existing harness: `npx tsx --test "src/**/*.test.ts"` and `node --test tests/unit/*.test.mjs`. Strict-mode + `noUncheckedIndexedAccess` honored (no unchecked index access on `contexts[i]`).

---

## Phase 4 — Component Implementation & Formatting Architecture

### 4.1 State preservation & persistence (VS Code `setState`/`getState`)
- **Tier A:** persisted in `vscode.workspaceState` (key `error.tierA.<sessionId>`). Restored on webview (`document.onvisibilitychange`) and panel re-show. Survives window reload. Cleared on confirmed recovery (`rate_limit_state` healthy) or explicit dismiss.
- **Tier B:** persisted in webview `acquireVsCodeApi().setState()` only (ephemeral, session-scoped). Survives panel collapse/expand within a session; intentionally **not** persisted across reload (transient by definition).
- **Tier C:** already persisted via `messages` history + `saveState()`. No change.
- A single `ErrorStateStore` (new, thin) becomes the owner of all three, replacing ad-hoc reads. Invariant: the store is the **sole** place error state is read for render — eliminates the "flash out of existence" bug on sidebar toggle.

### 4.2 CSS architecture & layout safeguards (`css/blocks.css`)
**Token consolidation — remove all raw literals from error styles.** Today `blocks.css` has ~30 raw literals (`#e07070`×3, `#ffb74d`×12, `#f85149`×3, `#d49a1a`, `#cca700`, `rgba(248,81,73,…)`, `rgba(210,153,34,…)`, `rgba(224,112,112,…)`). Replace every one with VS Code semantic tokens:
- Error → `var(--vscode-errorForeground, var(--vscode-inputValidation-errorBorder, #f85149))`
- Warning → `var(--vscode-notificationsWarningIcon-foreground)`
- Error bg → `var(--vscode-inputValidation-errorBackground)`
- Error border → `var(--vscode-inputValidation-errorBorder)`
- Diff/error icons → `var(--vscode-testing-iconFailed)`

Add three new layout classes with NO hardcoded color:
```
.tier-a-anchor      /* composer-anchored hard block */
.tier-b-banner      /* top-edge ambient banner, #global-status-banner slot */
.tier-c-bubble[data-error-code] /* inline stream bubble + red border */
```
All three pull severity color from a single `data-severity` attribute → `var(--oc-error|oc-warning|oc-info)` tokens defined once in `tokens.css`. `ThemeManager.applyThemeVars()` continues to override at runtime; no preset ships a literal.

### 4.3 Actionable CTAs (native VS Code feel)
Each `ErrorAction` renders as a `.error-action-btn` (already exists). Wire the full set through `vscode.postMessage` back to host:
- `upgrade_plan` → host runs `vscode.env.openExternal(<deep-link>)` (provider-aware: Anthropic vs OpenAI-compat billing URL from `mapOpencodeError`).
- `wait_for_reset` → host arms `RateLimitMonitor` countdown; pushes periodic `rate_limit_state` to refresh the Tier-A countdown.
- `retry` → `RetryQueueService.flush()`.
- `pick_model` → opens existing model manager panel.
- `contact_support` → opens `workbench.action.openIssueReporter`.
- `dismiss` → webview-local + `error_cleared` to host.
Add keyboard parity (Enter/Space activation — partially present, audit for the new buttons).

### 4.4 Spatial routing dispatcher (replaces the single funnel)
New `routeErrorByTier(ctx, deps)` (pure, tested) replaces the `handleServerStatus→handleRequestError→handleStreamError` funnel for non-C-tier cases:
- tier A → `TierAAnchor.mount(ctx, composerEl)` + composer-gate + persist to workspaceState.
- tier B → `GlobalStatusBanner.show(ctx, bannerEl)` + auto-retry scheduler + setState.
- tier C → existing `handleStreamError` path (unchanged).
`streamHandlers.ts:1484 handleServerStatus` loses its direct call into `handleRequestError`; it now calls `routeErrorByTier`.

---

## 5. Changes (file-by-file, scoped)

| File | Change | Phase |
|---|---|---|
| `src/chat/webview/errorWire.ts` | **NEW.** `WebviewErrorPayload`, `TypedErrorContext`, `ErrorTier`, `deriveTier`, `normalizeIncomingError`. Sole wire authority. | 3 |
| `src/chat/webview/errorWire.test.ts` · `errorWire.burst.test.ts` · `errorWire.reconnect.test.ts` | **NEW** TDD specs (§3.5). Written first. | 3 |
| `src/chat/webview/errorTier.test.ts` | **NEW.** `deriveTier` matrix truth-table tests. | 2 |
| `src/chat/webview/types.ts:603-705` | Narrow `errorContext?: unknown` → `context: TypedErrorContext`; mark 6 parallel channels `@deprecated`. | 3 |
| `src/chat/MessagePostService.ts:13,36` | Replace `Record<string,unknown>`/`unknown` with typed `postError(ctx: TypedErrorContext)`; keep `postMessage` for non-error. | 3 |
| `src/chat/StatePushService.ts:19` | Same narrowing for `postRequestError`. | 3 |
| `src/chat/ChatProvider.ts:1395,2044` | Emit `WebviewErrorPayload` via `postError`; remove inline object literals. | 3 |
| `src/chat/webview/main.ts:4667` (`handleRequestError`) | Route through `normalizeIncomingError` → `routeErrorByTier`. | 3/4 |
| `src/chat/webview/streamHandlers.ts:1428,1484` | `handleServerStatus` no longer calls `handleRequestError` directly; calls `routeErrorByTier`. | 4 |
| `src/chat/webview/errorComponents.ts` | Add `TierAAnchor`, `GlobalStatusBanner` components; existing `ErrorDisplay`/`Network`/`Quota` stay as Tier-C primitives. | 4 |
| `src/chat/webview/ErrorStateStore.ts` | **NEW.** Sole owner of tier A/B/C render state; wraps `setState`/`getState`/`workspaceState`. | 4 |
| `src/chat/webview/css/blocks.css` (~lines 363,418,528,1349-1449,1743-1757,2012-2196) | Replace ~30 raw literals with VS Code tokens; add `.tier-a-anchor`/`.tier-b-banner`/`.tier-c-bubble`. | 4 |
| `src/chat/webview/index.html` | Add `#global-status-banner` slot above timeline. | 4 |
| `src/chat/webview/opencodeErrorMapper.ts` | No change — already produces `ErrorContext`; `deriveTier` consumes it. | — |

---

## 6. System Impact

- **Source of truth:** today, error state is scattered (transcript messages + `QuotaMonitor` in-memory + ad-hoc banners). After: `ErrorStateStore` is the single read-source for render; transcript remains the audit log for Tier C only.
- **Data flow:** `OpencodeError → mapOpencodeError (ErrorContext) → deriveTier → postError(TypedErrorContext) → normalizeIncomingError → routeErrorByTier → {TierAAnchor|GlobalStatusBanner|handleStreamError}`. Fully typed end-to-end; `unknown` eliminated from the error path.
- **Lifecycle:** Tier A outlives reload (workspaceState); Tier B is session-scoped; Tier C is transcript-persistent. Reconnect-while-drawn handled by `error_cleared`.
- **Dependent components:** `RetryQueueService`, `QuotaMonitor`, `RateLimitMonitor`, `SessionSyncService` all converge on emitting `TypedErrorContext` instead of bespoke messages. No new state duplication — `ErrorStateStore` *owns* what was previously implicit.
- **Backpressure:** host-side batcher prevents DOM flood on multi-stream bursts (new capability).

## 7. Verification (end-to-end)
1. `npm run typecheck` — strict + noUncheckedIndexedAccess clean (wire is fully typed).
2. `npx tsx --test "src/**/*.test.ts"` — all new + existing error tests green.
3. `node --test tests/unit/*.test.mjs` — behavioral contracts.
4. `npx eslint src/` + `node scripts/check-architecture.mjs` — no acyclic-import / layer violations.
5. `npm run build` + `scripts/check-bundle-size.mjs` — bundle within limits (new components are small DOM modules).
6. **Manual harness** (`tests/visual/`): inject each `OpencodeError` fixture via `webviewTestHarness.dispatchHostMessage`; assert each renders in its tier-specific zone and survives sidebar toggle/reload as specified.
7. Edge cases (§3.5): null/`[object Object]`/100-MSG burst/reconnect-while-drawn/mixed-tier burst — all asserted by test.

## 8. Risks
- **R1 — Migration surface:** 6 deprecated channels are emitted from many call sites. Mitigate with the `LegacyHostMessage` adapter + a `// TODO(errorWire)` grep-driven sweep; deprecation warns in dev.
- **R2 — Tier-A composer-gate UX regressions:** disabling the composer is invasive. Mitigate by gating behind the existing `AutoModeService` confirmation pattern and adding a visual "locked" affordance + the recovery CTA in place of Send.
- **R3 — Token churn:** CSS consolidation touches ~30 sites. Keep changes mechanical (literal → token fallback) to avoid visual regressions; verify against all 6 theme presets.
- **R4 — Ephemeral-tree checkpointing (repo-specific):** per AGENTS.md, commit each phase before yielding. Tier-3 contract tests + type narrowing is a safe first commit unit.

---

## 9. Open Decisions (need your call before EXECUTE)

### 9.1 — Greenfield vs evolutionary (RECOMMEND: evolutionary)
The brief implied greenfield; the source says ~80% exists. Evolutionary = 14 files, mostly additive. Greenfield = parallel system, ~3× the surface, double-maintenance. **I recommend evolutionary.** Redirect if you disagree.

### 9.2 — Tier-B banner position: top vs bottom
I proposed **top** (Claude Code / standard banner idiom). Bottom is less intrusive but breaks reading flow less. Your call.

### 9.3 — Tier-A persistence across reload
Persist across window reload (`workspaceState`), or clear on reload (session-scoped)? I recommend persist (hard caps outlive reloads).

### 9.4 — Context-overflow policy
Adopt the Cursor/Copilot pattern (auto-compact, never an error), or keep surfacing as Tier C? I recommend auto-compact + a non-blocking "Context auto-compressed" notice.

---

## 10. Execution order (PHASE 2 — EXECUTE, after approval)
1. Write failing tests (§3.5) — red.
2. `errorWire.ts` + `deriveTier` + `normalizeIncomingError` — green.
3. Narrow wire types + add `postError`; migrate emitters behind legacy adapter.
4. `ErrorStateStore` + `routeErrorByTier`; wire `handleServerStatus` to it.
5. `TierAAnchor` + `GlobalStatusBanner` components + `index.html` slot.
6. CSS token consolidation + 3 tier classes.
7. CTAs through `postMessage`; keyboard parity audit.
8. Full verification (§7); commit per phase.
