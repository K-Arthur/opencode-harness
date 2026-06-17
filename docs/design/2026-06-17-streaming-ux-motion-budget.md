# Streaming UX Motion Budget — Approach A

> **Date:** 2026-06-17
> **Goal:** Strip every peripheral animation from the streaming surface so it
> reads like the integrated terminal / Copilot Chat — one signal, never three.

## Context

The streaming UI accumulated 11+ infinite `*-pulse`/`*-glow`/`*-shake`/`*-spin`
animations across tool cards, thinking blocks, error displays, subagent cards,
tab indicators, and message bubbles. During a 5-stream session this produced
**15+ concurrent infinite animations**, several of which animated
`box-shadow` / `border-color` (paint-triggering, not GPU-composited).

The result felt busy, distracting, and non-native compared to VS Code's own
streaming surfaces (terminal, Copilot Chat, markdown preview), which share one
trait: **zero peripheral motion** — the only thing that moves is the content
itself.

## Decision: Approach A — "Editor Mirror"

Strip every peripheral animation. The only motion that remains:

1. **Caret** — a slow opacity-blink (`cursor-blink 1.2s ease-in-out infinite`)
   on `.streaming-text::after`. Self-limiting: removed on stream end.
   Reduced-motion override in `accessibility.css:141`.
2. **Message entrance** — a one-shot `message-fade-in 200ms` opacity animation
   on `.message--new`, applied only on initial render (`!skipHeader`), not
   re-renders. No permanent visual artifact.

Everything else (pulses, glows, shakes, spins, stagger delays) is replaced with
static colour/border state changes.

## What was removed

### Infinite animations (all `*-pulse`, `*-glow`, `*-spin`, `*-shake`)

| Selector | Before | After |
|---|---|---|
| `.thinking-block:not([open])` | `thinking-pulse 3s` | static `border-left: 2px solid` |
| `.thinking-pulse` (dot) | `thinking-pulse-fade 1.5s` + `box-shadow` glow | static dot, no glow |
| `.tool-call--running/--pending` | `tool-border-pulse 1.5s` | static border-left |
| `.tool-status--running` | `badge-pulse 2s` + `box-shadow` glow | static badge |
| `.tool-elapsed` | `tool-elapsed-pulse 1s` | static text |
| `.tool-live-indicator .codicon` | `tool-live-spin 1s linear` | static icon |
| `.tool-group--active` | `tool-group-active-pulse 2s` + `box-shadow` | static border-left |
| `.error-display` | `error-shake-in 0.25s` (translateX wobble) | static block |
| `.subagent-card-status--running` | `subagent-badge-pulse 1.5s` | static badge |
| `.subagent-highlight-pulse` | `subagent-highlight-pulse 1s ×3` (box-shadow) | static `outline: 2px solid` |
| `.message` entrance | `message-enter` re-fired on every token flush | one-shot `message-fade-in` on initial render only |

### Dead utilities

- `.stagger-children` — 40–200ms cascading delays. Not referenced in any TS/HTML.
  Removed entirely.

### Transition stack bloat

8 button/panel selectors had transition stacks listing 6 properties
(`transform`, `box-shadow`, `opacity`, `background`, `color`, `border-color`).
Trimmed to 3 (`background`, `color`, `border-color`) — hover repaint cost
halved.

## What was added

### Layout containment

```css
.message-content { contain: layout; }   /* isolate streaming reflow */
.diff-block      { contain: layout paint; } /* isolate diff growth */
```

`contain: layout` on `.message-content` prevents streaming token growth from
forcing the parent `.message-list` to reflow. Only the bubble's internal layout
recalculates.

**Why `layout` not `content` on `.message-content`:** `contain: content`
includes `contain: paint`, which clips `:focus-visible` outlines on
buttons/headers near the content boundary (WCAG 2.4.7 risk). `contain: layout`
isolates reflow without clipping.

### Streaming state tokens

```css
--oc-stream-accent: var(--oc-accent);
--oc-stream-border: var(--oc-border-subtle, rgba(128, 128, 128, 0.15));
```

Semantic aliases for streaming-specific styling. Both map to existing
`CSS_VAR_MAP` tokens — no new theme keys needed.

### Diff entry state

`.diff-block--entered` — a static 2px accent left border applied to
pending-state diffs via `createDiffWrapper`. Provides a clean visual handoff
when streaming text converts to a diff block.

## Accessibility compliance

| WCAG SC | Status | Notes |
|---|---|---|
| 2.2.2 (Pause, Stop, Hide) | **Pass** | Caret is self-limiting (removed on stream end); user can abort; `prefers-reduced-motion` override exists |
| 2.3.1 (Three Flashes) | **Pass** | Caret frequency ≈ 0.83 Hz (threshold: 3 Hz) |
| 2.4.7 (Focus Visible) | **Pass** | `contain: layout` (not `paint`) preserves focus outlines |
| 4.1.3 (Status Messages) | **Pass** | `aria-live="polite"` on message list (`tabs.ts:172`) |
| 1.4.3 (Contrast) | **Pass** | All colours via `CSS_VAR_MAP` tokens; no new hardcoded values |

## Motion budget summary

| Metric | Before | After |
|---|---|---|
| Concurrent infinite animations (5 streams) | 15+ (incl. box-shadow glows) | 5 (caret blinks, opacity-only) |
| Entrance animation re-fires | Every token flush | Once on initial render |
| Transition properties per button | 6 | 3 |
| Dead `@keyframes` in blocks.css | 11 | 0 |

## Files changed

| File | Change |
|---|---|
| `css/messages.css` | Removed entrance anim; added `.message--new`; `contain: layout`; caret slowed to 1.2s |
| `css/blocks.css` | Removed all `*-pulse`/`*-shake`/`*-spin` animations + keyframes; trimmed transition stacks; added `contain: layout paint` on `.diff-block`; added `.diff-block--entered` |
| `css/animations.css` | Removed `thinking-pulse`, `error-shake-in` keyframes; removed `.stagger-children` |
| `css/tokens.css` | Added `--oc-stream-accent`, `--oc-stream-border` |
| `messageRenderer.ts` | Added `.message--new` on initial render |
| `renderer.ts` | `createDiffWrapper` adds `.diff-block--entered` for pending state |

## Regression tests

- `src/chat/webview/css/motion-budget.test.ts` — structural CSS guards (forbidden
  animation names, box-shadow in keyframes, stagger-children, contain rules)
- `tests/unit/streaming-state.test.mjs` — state transition integrity
- `tests/unit/message-render-contract.test.mjs` — CSS structural contracts
- `tests/unit/streaming-edge-cases.test.mjs` — containment, tokens, transition
  stacks
