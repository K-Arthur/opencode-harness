# Context & Token Usage Bar — Cross-Tool UX Research

**Date:** 2026-06-06
**Purpose:** Inform the redesign of the context-window / token-usage bar in the opencode-harness VS Code extension. Research-only — no code changes.
**Project terminology:** Aligned with ADR `2026-05-29-context-token-usage-accounting.md` — two distinct signals:
1. **Context-window fill** (`OpenCodeSession.contextUsage`: `tokens`, `maxTokens`, `percent`, optional `breakdown`, `source: "estimated" | "actual"`, `updatedAt`).
2. **API token spend** (cumulative `UsageDelta`, accumulated via `SessionStore.accumulateTokenUsage()`).

---

## A. OpenCode capabilities (what the upstream CLI/SDK actually exposes)

### A.1 Per-message usage fields
The opencode SDK on every Assistant message returns a `usage` object with:

| Field | Source | Notes |
|---|---|---|
| `inputTokens` | `usage.input_tokens` | Fresh non-cached input |
| `cachedInputTokens` | `usage.input_tokens_details.cached_tokens` | Anthropic prompt-cache hits |
| `outputTokens` | `usage.output_tokens` | Generated output (includes reasoning for thinking models — see `output_tokens_details.reasoning_tokens`) |
| `reasoningTokens` | `usage.output_tokens_details.reasoning_tokens` | Thinking-model budget, billed as output |
| `totalTokens` | derived | Sum for display only |
| `cost` | `usage.cost` | Provider-billed USD estimate (per-message) |

Sources: Context7 `/anomalyco/opencode` `specs/v2/message.ts`, `packages/opencode/src/provider/transforms/usage.ts`.

### A.2 Model context-window limit
- Schema: `Model.limit.context` (e.g. `200000`) and `Model.limit.output` (e.g. `65536`).
- Per-provider per-model; for custom OpenAI-compatible providers, populated from the model catalog or user config.
- Unknown / unreported limit is a real state — UX must handle it (see section H).

Source: Context7 `/anomalyco/opencode` `packages/web/src/content/docs/config.mdx`, `specs/v2/config.md`.

### A.3 Compaction configuration (auto-summarization)
Opencode supports auto-compaction with these knobs (confirmed via two Context7 hits, with a terminology drift to flag):

```jsonc
{
  "compaction": {
    "auto": true,        // enable auto-summarize when context fills
    "prune": true,       // drop old tool outputs verbatim
    "keep": {
      "turns": 2,        // preserve N most-recent user turns verbatim
      "tokens": 2000     // token budget for retained turns
    },
    "buffer": 10000      // (v2 spec) reserve N tokens of headroom
    // "reserved": 10000 // (docs.mdx alias for the same concept)
  }
}
```

**Drift caveat:** `specs/v2/config.md` uses `buffer`; `packages/web/src/content/docs/config.mdx` uses `reserved`. The summarization prompt lives at `packages/opencode/src/agent/prompt/compaction.txt` ("Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary…").

**Implication for the bar:** when `compaction.auto = true` and the bar crosses the `buffer` (≈95% if `buffer=10000` and `limit=200000`), the next user turn triggers compaction. The bar should communicate this threshold distinctly from "hard limit reached".

### A.4 Streaming events
- `response.completed` / `response.incomplete` chunks carry the final `usage` for a turn (OpenAI Responses adapter).
- The harness already distinguishes **live step-finish accumulation** from **final SDK fallback** (per the ADR).
- No distinct "compaction-fired" event was found in indexed sources — compaction is observable only indirectly: the next turn's `input_tokens` drops sharply.

### A.5 Prompt-caching economics
Anthropic returns two cache fields that flow into `cachedInputTokens`:
- `cache_creation_input_tokens` — written this turn (1.25× for ≤1h cache, 2× for 5-min cache within first 5 min).
- `cache_read_input_tokens` — cache hits (~10% of standard input price; ~90% discount).

Source: <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>.

---

## B. What good context bars show (cross-industry survey)

### B.1 Claude Code (the canonical reference)
Claude Code exposes a JSON statusline API and ships official example code that gives us an explicit, citable default scheme.

**Fields exposed** (`<https://docs.anthropic.com/en/docs/claude-code/statusline>`):

| Field | Semantics |
|---|---|
| `context_window.total_input_tokens` | Tokens currently in context = `input + cache_creation + cache_read` (post-v2.1.132: current context, not cumulative session total) |
| `context_window.total_output_tokens` | Output from most recent response |
| `context_window.context_window_size` | Model max (200k default, 1M extended) |
| `context_window.used_percentage` | Pre-computed fill %, **input-only** (output excluded) |
| `context_window.remaining_percentage` | 100 − used |
| `context_window.current_usage.input_tokens` | Fresh input |
| `context_window.current_usage.cache_creation_input_tokens` | Cache writes |
| `context_window.current_usage.cache_read_input_tokens` | Cache reads |
| `context_window.current_usage.output_tokens` | Generated output |
| `exceeds_200k_tokens` | **Fixed 200k threshold flag, independent of actual window size** — used to nudge `/compact` regardless of model |
| `cost.total_cost_usd` | Estimated session cost |
| `rate_limits.five_hour.used_percentage` | Claude.ai 5h rolling window (Pro/Max only) |
| `rate_limits.seven_day.used_percentage` | Claude.ai 7-day window |
| `cost.total_duration_ms` / `total_api_duration_ms` | Wall vs. API time |

**Official example thresholds** (from the multi-line example in the docs):

```bash
if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi
```

→ **Green <70%, Yellow 70–89%, Red ≥90%.** Three zones, 70/90 thresholds.

**Refresh behavior:** statusline re-runs after each new assistant message, after `/compact` finishes, on permission-mode change, and on vim-mode toggle. Updates debounced at 300ms. In-flight script executions are cancelled when a new trigger arrives. Optional `refreshInterval` (seconds, min 1) for time-based segments.

**Crucial nuance:** `used_percentage` is **input-only**. Output tokens are not part of the fill ratio. The official docs explicitly state: *"The `used_percentage` field is calculated from input tokens only: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. It does not include `output_tokens`."*

### B.2 Cline (VS Code extension)
- Emits a `usage` SDK event with token + cost tracking per iteration.
- Renders in the chat panel header as: `<input-tokens>K in | <output-tokens>K out | $<cost>` (no progress bar by default).
- Visual progress bar for context fill is **not** in the default UI — only the textual counters.

Source: <https://docs.cline.bot/sdk/events>.

### B.3 Cursor / Windsurf (Devin Desktop)
- **Cursor:** public docs (`docs.cursor.com`) returned empty for context-window UI; no direct evidence found. Community screenshots show a small "X / 200K" indicator in the chat panel footer, no progress bar. **No official documentation cited — by analogy only.**
- **Windsurf / Devin Desktop:** the docs at `docs.devin.ai` describe RAG indexing, context pinning, @-mentions, and M-Query retrieval, but **do not document a public context-window fill indicator**. The Codeium-era "context length" indicator (small grey text) has not surfaced in current docs.

Source: <https://docs.devin.ai/desktop/context-awareness/overview>.

### B.4 Aider (terminal)
- Aider prints "Tokens: X / Y (Z%)" in the chat footer with no graphical bar.
- Compaction is manual (`/clear`, `/drop`) rather than auto.
- Context-window file: 404'd (`aider.chat/docs/more/context-window.html`).

### B.5 GitHub Actions billing (thresholds analogy)
- **Default email notifications at 90% and 100%** of included quota during a billing period.
- Storage billed hourly (GB-Hours), minutes billed per-job.
- Quote: *"receive email notifications when your included GitHub Actions usage reaches 90% and 100% during a billing period"*.

Source: <https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions>.

### B.6 Stripe metered billing (thresholds analogy)
- Max 25 alerts per (meter, customer) combination.
- Single monetary threshold per subscription; single usage threshold per subscription item.
- *"Invoiced amounts or usage might be slightly higher than the specified thresholds because invoices aren't issued at the exact moment a specified threshold is reached."* — i.e. thresholds are advisory, not hard cutoffs.
- Common UX pattern: alert at 50%, 75%, 90%, 100% (community convention; not in the official docs).

Source: <https://docs.stripe.com/billing/subscriptions/usage-based/monitor>, `<https://docs.stripe.com/billing/subscriptions/usage-based/thresholds>`.

---

## C. Recommended default display

Based on Claude Code's documented official pattern + VS Code UX guidelines:

### C.1 Always-visible compact bar (single line in chat input strip)

```
[───────░░░░░░░░░░───────]  74% · 148K / 200K · $0.42
```

- **Progress bar:** 20 chars wide, filled `─` (or `█`), empty `░`.
- **Color encoding:** see section F.
- **Numbers:** `% fill` (always), `used/total` (compact `K` units), `cost` (USD, 2 decimals).
- **Tooltip:** see section D.

### C.2 What to include in the default compact view
| Element | Show by default? | Rationale |
|---|---|---|
| Fill % | ✅ Always | The single most-actionable signal |
| Used / Max (absolute tokens) | ✅ Always | Lets users reason about how much room is left |
| Cost | ✅ Always | Claude Code includes this; users care |
| Cached vs. fresh split | ❌ Hide in tooltip | Adds visual noise; expert-oriented |
| Output tokens | ❌ Hide in tooltip | Not part of fill ratio; confusing if shown by default |
| Reasoning tokens | ❌ Hide in tooltip | Only relevant for thinking models |
| Rate-limit % (5h / 7d) | ❌ Hide in tooltip | Opencode doesn't expose this in v2 — Claude-Code-specific |
| Source badge (estimated vs. actual) | ✅ Subtle dot | Trust signal — see section H |

---

## D. Tooltip / details panel

On hover or click, expand to show:

```
┌─────────────────────────────────────────────────┐
│ Context Window                    [source: ●]   │
│ ─────────────────────────────────────────────── │
│  Input (fresh)         42,318 tokens            │
│  Cache read           101,444 tokens  (70%)     │
│  Cache write            4,231 tokens            │
│  ─────────────────────────────────              │
│  Total input          148,000 / 200,000  (74%)  │
│                                                 │
│  Last response         12,400 output tokens     │
│    └ reasoning              8,200 tokens        │
│                                                 │
│  Cost (session)            $0.42                │
│  Duration (API)          2m 14s                 │
│                                                 │
│ ⚡ Auto-compact fires at 95% (10K buffer)        │
│ [ Compact now ]  [ Clear context ]              │
└─────────────────────────────────────────────────┘
```

Key practices from research:
- **Cache hit ratio** is the single most actionable efficiency metric for users — surface it explicitly.
- **Reasoning tokens** appear under output, indented, only when non-zero.
- **"Compact now"** action button is featured (Claude Code's `/compact` is the canonical recovery action).
- **Source indicator** (`●` green = actual, `◐` yellow = estimated) — see section H.

---

## E. Threshold scheme (with rationale)

### E.1 Recommended four-zone scheme

| Zone | Fill | Color | Intent | Action affordance |
|---|---|---|---|---|
| **Comfortable** | 0–69% | Green (`var(--vscode-testing-iconPassed)` / `#3FB950`) | Business as usual | None |
| **Approaching** | 70–84% | Yellow (`var(--vscode-editorWarning-foreground)` / `#D29922`) | Heads-up | Tooltip hint: "Approaching context limit" |
| **Near-limit** | 85–94% | Orange (`#DB6D28`) | Compaction recommended | Highlight "Compact now" button in tooltip |
| **Critical** | ≥95% | Red (`var(--vscode-editorError-foreground)` / `#F85149`) | Compaction will fire / has fired | Banner: "Next message will auto-compact" |

### E.2 Rationale (mapped to research)

- **70% yellow** — matches Claude Code's official example threshold.
- **90% red** in Claude Code's example → I split into **85% orange** and **95% red** because:
  - Opencode's compaction buffer (default `10000` of `200000` = 5%) means auto-compact fires around 95%, not 90%.
  - A "near-limit" zone (85–94%) gives users a window to manually compact **before** auto-compact takes over, preserving conversational continuity.
  - This mirrors GitHub Actions' 90% notification pattern but with a 5% safety margin that aligns with opencode's compaction behavior.
- **50% threshold** (Stripe community convention) is **not** included — too noisy for an always-visible bar; only relevant for quota tracking, not fill ratio.

### E.3 Threshold constant values (for the implementation)

```ts
const THRESHOLDS = {
  APPROACHING: 0.70,   // yellow
  NEAR_LIMIT: 0.85,    // orange  
  CRITICAL: 0.95,      // red — matches default compaction.buffer (5% of context)
} as const;
```

These should be **configurable** in extension settings (`opencode.contextBar.thresholds`) with these as defaults, since power users may want to tune the orange band based on their model's compaction behavior.

---

## F. Accessibility pattern

### F.1 ARIA structure

Per MDN (`<https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/progressbar_role>`):

```html
<div
  class="context-bar"
  role="progressbar"
  aria-label="Context window usage"
  aria-valuenow="74"
  aria-valuemin="0"
  aria-valuemax="200000"
  aria-valuetext="148,000 of 200,000 tokens used (74 percent)"
  aria-busy="false"
  tabindex="0"
>
  <div class="context-bar-fill" style="width: 74%"></div>
</div>
```

- **`aria-valuetext`** is critical — `74%` alone is unhelpful; the human-readable form should include absolute tokens + percentage + zone name (e.g. "approaching limit").
- **`aria-busy="true"`** while the SDK is mid-stream and the value is changing rapidly (debounce to 300ms — matches Claude Code).
- **`tabindex="0"`** so keyboard users can focus the bar to read it via screen reader.

### F.2 Live region for threshold transitions

```html
<div role="status" aria-live="polite" class="sr-only">
  <!-- Updated only on zone transitions (green→yellow, yellow→orange, etc.) -->
  Context window approaching limit: 72% used.
</div>
```

- Use `aria-live="polite"` (not `assertive`) — context fill is important but never urgent enough to interrupt.
- Update **only on zone transitions**, not every token count change (would be noise).
- This mirrors VS Code's own progress-bar patterns.

### F.3 Color contrast (WCAG)

Per WCAG SC 1.4.3 and SC 1.4.11 (from `<https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html>`):

| Element | Required ratio | Target |
|---|---|---|
| Color-zone indicator (green/yellow/orange/red fill) vs background | 3:1 (non-text UI, SC 1.4.11) | ≥4.5:1 for safety |
| Tooltip body text vs tooltip background | 4.5:1 (normal text) | Use `var(--vscode-*)` token pairs (already contrast-validated by VS Code) |
| Percentage text on bar vs bar fill | 4.5:1 (or 3:1 if ≥18pt / 14pt bold) | Use text-shadow or always render text outside the fill |

**VS Code theme tokens to use** (from `<https://code.visualstudio.com/api/references/theme-color>`):
- Green: `var(--vscode-testing-iconPassed)` or `var(--vscode-charts-green)`
- Yellow: `var(--vscode-editorWarning-foreground)` or `var(--vscode-charts-yellow)`
- Orange: `var(--vscode-charts-orange)` (no canonical warning-amber token)
- Red: `var(--vscode-editorError-foreground)` or `var(--vscode-charts-red)`
- Background: `var(--vscode-editor-background)` or `var(--vscode-statusBarItem-remoteBackground)`

### F.4 Keyboard
- `Tab` to focus the bar.
- `Enter` / `Space` to open the details panel (tooltip on hover, panel on click).
- `Escape` to dismiss the panel.
- **Do not** bind to arrows / `Home` / `End` — those should remain usable for scrolling when the bar isn't focused.

### F.5 Reduced motion
Per VS Code webview UX guidelines (`<https://code.visualstudio.com/api/ux-guidelines/webviews>`):
- Respect `prefers-reduced-motion: reduce`.
- Disable bar-fill animations (smooth width transitions) when set.
- Keep color-zone transitions instant (no fades) under reduced motion.

---

## G. Streaming update strategy

### G.1 Source-of-truth flow
The existing architecture (per ADR `2026-05-29`) defines two update paths:
1. **Live estimate** (`ContextMonitor`, `source: "estimated"`): updated pre-generation and during stream.
2. **Final SDK actual** (`source: "actual"`): the authoritative reading on `response.completed`/`response.incomplete`.

### G.2 Recommended debounce / batching
Following Claude Code's pattern (debounced 300ms, cancel in-flight on new trigger):
- **During streaming:** batch context-usage updates to ≤1 update per 300ms per session. Drop intermediate values.
- **On stream end:** always emit one final update with `source: "actual"` — even if no values changed — so the source indicator flips from yellow (estimated) to green (actual).
- **Cancel-on-new-trigger:** if a new user message arrives while a debounce is pending, drop the pending update and reset the timer. (Otherwise stale values can race.)

### G.3 What gets updated when
| Event | Update bar? | Why |
|---|---|---|
| Stream chunk arrives (token-by-token) | No | Too noisy; debounce to 300ms |
| 300ms timer fires during stream | Yes | Shows progress without flicker |
| `response.completed` | Yes (final) | Authoritative reading |
| `response.incomplete` | Yes (final) | Authoritative + error indicator |
| Mode change / model switch | Yes (immediate) | Denominator may have changed |
| Tab switch | No (already correct via session-scoped state) | ADR ensures session isolation |
| Compaction fires | Yes (immediate + flash) | `input_tokens` drops sharply — surface this distinctly |

### G.4 Compaction event detection
Opencode does **not** emit a distinct compaction event. Detect client-side:
- If `input_tokens` drops by ≥30% between consecutive `response.completed` events, assume compaction fired and show a transient "Context compacted" badge (3s, then fade).
- Document this heuristic in code so future maintainers can replace it when opencode adds a proper event.

---

## H. Unknown / estimated / over-limit / no-model-states

### H.1 State matrix

| State | Source field | Visual | Tooltip |
|---|---|---|---|
| Live estimate during stream | `source: "estimated"` | Yellow dot `◐` next to % | "Estimated — final value updates when response completes" |
| Final SDK reading | `source: "actual"` | Green dot `●` (or no dot) | "Actual usage from provider" |
| No model selected | `maxTokens = 0` or undefined | Empty bar, greyed out | "Select a model to see context usage" |
| Model selected, no usage yet | `tokens = 0, maxTokens > 0` | Empty bar (0%), grey dot `○` | "Awaiting first response" |
| Unknown model limit | `maxTokens = null` | Indeterminate bar (animated stripes), no % | "Context limit unknown for this provider" |
| Over-limit (should not happen with compaction) | `percent > 100%` | Red bar clipped at 100% + ⚠ icon | "Over context limit — compaction should have fired" |
| Compaction in progress | detected via drop heuristic | Spinner overlay on bar | "Compacting context…" |

### H.2 The "indeterminate" state
For models with unknown limits (custom OpenAI-compatible providers without catalog metadata):
- Use **animated diagonal stripes** (classic indeterminate pattern).
- Do **not** show a percentage.
- Show "Unknown context limit" in the bar text.
- Hide "Compact now" action (compaction threshold is unknown).
- Animation must respect `prefers-reduced-motion` → switch to static stripes.

### H.3 The "over-limit" state
Should never occur if opencode's auto-compaction is enabled. If it does (compaction disabled or buffer too small):
- Clip bar fill at 100% visually.
- Show ⚠ icon.
- Color: red.
- Tooltip: "Over context limit — auto-compaction is disabled or buffer too small. Run `/compact` immediately."
- Persistence: this state should be reported as a telemetry event so we can tune the default buffer.

### H.4 Synthetic-zero protection
The ADR is explicit: *"Missing host data and zero fallbacks must never clear a valid webview-local value."* The UI must therefore **never** paint the bar at 0% if the previous value was non-zero — preserve the last known value with a "stale" indicator (faded fill) until either:
1. A fresh non-zero value arrives, or
2. The user manually clears / switches sessions.

---

## I. Model-switch handling

### I.1 What changes when the model changes
| Property | May change | Notes |
|---|---|---|
| `maxTokens` (context window) | ✅ | e.g. Claude Sonnet 4 → 200K; GPT-4o → 128K; Gemini 1.5 Pro → 1M |
| `output_tokens` cap | ✅ | Smaller denominator for output |
| Cached-input pricing | ✅ | Provider-specific |
| Compaction buffer | Possibly | User can configure per-model in opencode |
| Cost rate | ✅ | Different per-provider pricing |
| Live `tokens` (numerator) | ❌ | The conversation in context doesn't shrink just because the model changed |

### I.2 Recommended behavior
1. **On model switch:** immediately re-query `Model.limit.context` and `Model.limit.output` for the new model.
2. **Recompute `percent`** with the new denominator. The bar may jump (e.g. 60% → 80% when switching from 200K to 128K context).
3. **Animate the jump** (300ms ease-out) so users see the change rather than perceive it as a glitch. Disable under `prefers-reduced-motion`.
4. **Do NOT reset `tokens`** — the actual fill hasn't changed, only the denominator.
5. **Show a transient toast** if the new model's limit is smaller and the current conversation exceeds it: "Context exceeds this model's limit — compact or switch back."
6. **Persist the cost** accumulated under the previous model — do not zero it.

### I.3 Per-tab model tracking
ADR `2026-05-29` makes context fill session-scoped end-to-end. The bar's model identifier and denominator must therefore come from the same `OpenCodeSession` that owns the `contextUsage`. Never read model state from a global — always from the session.

---

## J. Citations

### OpenCode
- Context7 `/anomalyco/opencode` — usage schema, model limit schema, compaction config (3 queries).
- `specs/v2/message.ts`, `specs/v2/config.md` — usage + compaction field names.
- `packages/opencode/src/agent/prompt/compaction.txt` — summarization instructions.
- `packages/web/src/content/docs/config.mdx` — public docs alias (`reserved` vs `buffer`).
- `packages/opencode/src/provider/transforms/usage.ts` — Anthropic → opencode usage mapping.

### Anthropic / Claude Code
- Claude Code overview: <https://docs.anthropic.com/en/docs/claude-code/overview>
- Costs & usage: <https://docs.anthropic.com/en/docs/claude-code/costs>
- Statusline (the canonical reference): <https://docs.anthropic.com/en/docs/claude-code/statusline>
- Prompt caching: <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>
- Token counting: <https://docs.anthropic.com/en/docs/build-with-claude/token-counting>

### Other coding tools
- Cline SDK events: <https://docs.cline.bot/sdk/events>
- Cline docs: <https://docs.cline.bot/>
- Cline repo: <https://github.com/cline/cline>
- Devin Desktop (formerly Windsurf) Context Awareness: <https://docs.devin.ai/desktop/context-awareness/overview>
- Roo Code: <https://docs.roocode.com/> (shut down 2026-05-15 — not used as comparison)
- Aider conventions: <https://aider.chat/docs/usage/conventions.html>

### Thresholds & billing UX
- GitHub Actions billing (90%/100% notification thresholds): <https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions>
- Stripe metered billing overview: <https://docs.stripe.com/billing/subscriptions/metered>
- Stripe usage alerts: <https://docs.stripe.com/billing/subscriptions/usage-based/monitor>

### Accessibility
- MDN ARIA progressbar role: <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/progressbar_role>
- WCAG SC 1.4.3 contrast minimum: <https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html>

### VS Code extension APIs
- Webview guidelines: <https://code.visualstudio.com/api/extension-guides/webview>
- Webview UX guidelines: <https://code.visualstudio.com/api/ux-guidelines/webviews>
- Theme color reference: <https://code.visualstudio.com/api/references/theme-color>
- Accessibility docs: <https://code.visualstudio.com/docs/configure/accessibility/accessibility>

### Project-internal references
- ADR `2026-05-29-context-token-usage-accounting.md` — context-fill vs. API-spend separation, `OpenCodeSession.contextUsage` shape, `ContextMonitor` lifecycle, session-scoped updates.
- AGENTS.md — CSS variable / theme constraints, error-handling flow.

---

## Appendix K. Quick-reference implementation notes (non-normative)

The research is the deliverable, but for the next-step design discussion:

- **Single React component** for the bar (likely under `src/chat/webview/ui/contextBar/`).
- **Props:** `{ percent: number; maxTokens: number; usedTokens: number; source: "estimated" | "actual"; cost?: number; }` — matches the existing `OpenCodeSession.contextUsage` shape.
- **CSS:** use `var(--vscode-charts-*)` and `var(--vscode-editorWarning/Error-foreground)` tokens; do **not** hard-code hex.
- **Thresholds:** expose via `opencode.contextBar.thresholds` setting (default: 70/85/95).
- **Update path:** `ContextMonitor` → `SessionStore.updateContextUsage()` → webview `context_usage` message → bar component. No new host→webview message type needed.
- **Tests:** add visual test under `tests/visual/` covering all four zones; add behavioral test for the compaction-detection heuristic.
