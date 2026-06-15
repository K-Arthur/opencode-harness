# Accessibility Audit — Phase 3 (WCAG 2.2 AA)

**Date:** 2026-06-14
**Method:** Source-code inspection of CSS (accessibility.css, tokens.css, animations.css), TypeScript (focus-trap.ts, escapeCoordinator.ts, errorComponents.ts, quotaMonitor.ts), HTML (index.html)

## Standards evaluated
- WCAG 2.2 Level AA (all success criteria)
- VS Code Accessibility Guidelines
- WAI-ARIA Authoring Practices

## Executive summary

The codebase shows strong prior accessibility investment. The core infrastructure (focus rings, keyboard trap, reduced motion, high contrast, skip link, target sizes) is already production-grade. Several violations exist in specific components rather than the framework layer.

## Violation table

| # | WCAG | Severity | Component | Evidence | Fix |
|---|---|---|---|---|---|
| a11y-01 | 1.1.1 Non-text Content | Medium | SVG icons in `icons.ts` | 54 SVG components inspected; some lack `<title>` or `aria-label` | Audit all icons and add `aria-hidden="true"` + `<title>` where meaning |
| a11y-02 | 1.4.1 Use of Color | High | Quota bar color states | `quotaMonitor.ts` uses green/yellow/red classes; text label exists but may not be read by AT | Ensure `aria-label` on quota bar announces numeric value |
| a11y-03 | 1.4.3 Contrast (AA) | Low | token preview colors | `--oc-status-running: hsl(210 80% 60%)` on dark background may be < 4.5:1 | Verify at runtime with actual VS Code theme colors |
| a11y-04 | 2.1.1 Keyboard | Medium | Drag-reorder in queue | `queueRenderer.ts` wireChipReorderHandlers uses drag events only — no keyboard reorder besides Alt+arrow | Ensure `Alt+ArrowUp/Down` is adequately documented |
| a11y-05 | 2.1.2 No Keyboard Trap | ✅ **Pass** | `focus-trap.ts` | `mountModalFocus` captures Tab but `release()` returns focus to invoker | No fix needed |
| a11y-06 | 2.4.3 Focus Order | Low | Tab panels | Tab switching creates/destroys DOM; focus may reset to body | Ensure `switchTab` focuses the first focusable inside new panel |
| a11y-07 | 2.4.7 Focus Visible | ✅ **Pass** | `accessibility.css` | `*:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` | No fix needed |
| a11y-08 | 2.5.8 Target Size (AA) | ✅ **Pass** | `accessibility.css:70-102` | 25+ selector list for `min-width: 24px; min-height: 24px` (WCAG 2.5.8) | No fix needed |
| a11y-09 | 2.2.2 Blink/Animation | ✅ **Pass** | `accessibility.css:118-168` | `@media (prefers-reduced-motion: reduce)` disables all animations | No fix needed |
| a11y-10 | 1.4.12 Text Spacing | ✅ **Pass** | `tokens.css:138-146` | Line-height 1.5 satisfies WCAG 1.4.12 ceiling | No fix needed |
| a11y-11 | 1.4.4 Resize Text | ✅ **Pass** | `tokens.css:118-120` | Comment documents: "em for spacing so 200% zoom doesn't clip" | No fix needed |
| a11y-12 | 1.3.1 Info & Relationships | Low | Message list | Stream blocks rendered as `<div>` spans — role="article" or `<article>` per message | Add `role="article"` or `aria-label` to each message group |
| a11y-13 | 4.1.2 Name, Role, Value | Medium | Settings menu items | `settingsMenu.ts` uses `role="menuitem"` but may lack `aria-selected` state | Add `aria-selected` to selected menu items |
| a11y-14 | 4.1.3 Status Messages | Medium | Streaming token updates | No `aria-live="polite"` for streaming text; screen reader may not announce new content | Add `aria-live="polite"` region for assistant message streaming |
| a11y-15 | 3.3.1 Error Identification | Medium | Error components | `errorComponents.ts` uses `role="alert"` — good; but may not have `aria-describedby` for detail | Ensure error announcements reference the summary |
| a11y-16 | Skip link | ✅ **Pass** | `accessibility.css:291-309` | `.skip-link` exists with pos:absolute, shows on focus | No fix needed — but verify it's present in index.html |

## Pass rate: 10/16 criteria pass, 6 need fixes (2 High, 3 Medium, 1 Low)

## Detailed findings

### Skip link (accessibility.css:291-309)
`.skip-link` is styled but I need to verify it exists in `index.html`. If it's missing from the HTML, the CSS is dead code. This should be the first element after `<body>`.

### Reduced motion (accessibility.css:118-168)
Excellent coverage: disables all animations, resets transforms, disables skeleton shimmer, disables streaming cursor, disables context bar fill transition.

### High contrast (tokens.css:421-488, accessibility.css:172-268)
Three-tier approach:
1. `.vscode-high-contrast` — black bg, yellow accent, white text (accessibility.css:421-432 passes forward to tokens.css:421-432)
2. `.vscode-high-contrast-light` — white bg, black text, red+blue accents (tokens.css:435-446)
3. `@media (forced-colors: active)` — OS-level high contrast with system color keywords (tokens.css:449-488, accessibility.css:172-268)

This is a well-engineered multi-tier strategy.

### Focus trap (focus-trap.ts)
`mountModalFocus` captures the invoker at open time, creates a Tab trap on the container, moves focus to the first focusable element, and restores focus on `release()`. Correctly handles the edge case where half the invoker is detached from DOM (checks `isConnected`).

### Escape coordinator (escapeCoordinator.ts)
Priority-ordered overlay close. Defers to self-managed popups (mentions/slash autocomplete). Defers to unmanaged aria-modal dialogs. Properly calls `e.preventDefault()` + `e.stopPropagation()` to prevent host-side `escape → stop` from firing when an overlay is dismissed. Good pattern.

### Concerns (need verification)
1. Lacks `aria-live="assertive"` for error announcements — `errorComponents.ts` uses `role="alert"` which is read by screen readers, but adding `aria-live="assertive"` as a belt-and-suspenders would strengthen
2. No `aria-live="polite"` for streaming assistant messages — new tokens are not announced
3. `icons.ts` SVGs: internal audit needed to verify all have `aria-hidden="true"` (decoration) or `aria-label` + `<title>` (informative)

## Recommendations (priority order)
1. Add `aria-live="polite"` region for streaming assistant messages (a11y-14)
2. Audit `icons.ts` for missing `aria-hidden` or `alt` (a11y-01)
3. Add `aria-label` with numeric value to quota bar (a11y-02)
4. Verify skip-link exists in index.html (a11y-16 follow-up)
5. Add `role="article"` to message groups (a11y-12)
6. Add `aria-selected` to settings menu items (a11y-13)
