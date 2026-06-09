# Transcript Card System

How OpenCode Harness renders informational "cards" in the chat transcript —
errors, warnings, info, success, permission prompts and activity notices — and
how duplicates are prevented.

## Goals

- **Compact & scannable.** A clear human-readable first line; technical noise
  hidden behind progressive disclosure. ~8–10px padding, 12px text, no
  gradients/drop-shadows/shake animations.
- **Consistent & theme-driven.** One shared `.oc-card` surface; severity is a
  thin left border + icon colour driven by VS Code theme tokens (`--vscode-*`
  via `--oc-*`). Works in light/dark/high-contrast and narrow sidebars.
- **No duplicates.** One fault → one card. Identical repeats collapse with a
  count rather than stacking.
- **Accessible.** `role="alert"` / `role="status"`, ARIA labels on
  expand/dismiss/copy, native focusable buttons, visible focus rings.

## Severity model

| Severity | Modifier class | When to use |
|----------|----------------|-------------|
| Info | `.oc-card--info` | Neutral notice; user can continue. (`ErrorSeverity.LOW`) |
| Success | `.oc-card--success` | A completed/confirmed action. |
| Warning | `.oc-card--warning` | A limitation or recoverable issue, action may be required. (`ErrorSeverity.MEDIUM`) |
| Error | `.oc-card--error` | A blocking failure that needs attention. (`ErrorSeverity.HIGH`) |
| Critical | `.oc-card--critical` | System failure; cannot continue. Slightly heavier (3px) border. (`ErrorSeverity.CRITICAL`) |
| Permission | `.oc-card--permission` | Action/approval required from the user. |

> **Note:** Interactive permission/approval UI now lives in the dedicated `#permission-bar` above the input area, not in the transcript. The transcript shows a compact read-only pointer with header + text + "Respond in the input bar above" hint. Permission requests are ephemeral (not persisted in session history). See `docs/design/permission-bar.md`.

`ErrorSeverity` (`errorTypes.ts`) maps to the modifier via `severityModifier()`
in `errorComponents.ts`.

## Anatomy (`.oc-card`)

```
.oc-card .oc-card--<severity>
├── .oc-card__header   icon (.oc-card__icon svg) + .oc-card__title + .oc-card__code + spacer [+ .oc-card__dismiss]
├── .oc-card__message  the always-visible, human-readable line(s)
├── .oc-card__details  [hidden by default]  →  .oc-card__details-head (label + Copy) + .oc-card__details-pre (raw JSON/stack)
└── .oc-card__actions  .oc-card__btn (+ --primary) action buttons + the .oc-card__btn--ghost "Details" toggle
```

Styling lives in `src/chat/webview/css/cards.css` (imported by `styles.css` in
the `blocks` layer — **a new CSS file must be `@import`ed there or esbuild won't
bundle it**). The legacy `.msg-error` (the `renderErrorBlock` path) is compacted
to match in `messages.css`.

## Lifecycle & disclosure

- **Technical details collapsed by default.** Raw error payloads / stack traces
  live in `.oc-card__details[hidden]`; the "Details" toggle flips the `hidden`
  attribute **in place** (no re-render, focus preserved) and a **Copy** button
  copies the raw text.
- **Dismiss / Retry** are action buttons sourced from the error's
  `suggestedActions` and dispatched via the injected `ErrorActionHandler`.
- **Activity notices** (model/agent switched, compaction, provider retry) render
  as one-line `.activity-block`s, not full cards.

## Deduplication

One fault used to surface as up to three cards. The root causes and fixes:

1. **Activity duplicates** — `ChatProvider.appendActivityBlock` minted a random
   id per delivery and always appended, so a re-delivered event (SSE reconnect,
   `PendingEventBuffer` replay) stacked a second card.
   - `activitySignature(eventType, title, detail)` + `decideActivityCoalesce()`
     (`src/session/activityCoalesce.ts`, pure) collapse an **immediately
     repeated** identical activity into the previous card and bump its
     `repeatCount`; `renderActivityBlock` shows a `×N` badge.
     `SessionStore.appendOrCoalesceActivity` applies the decision and returns
     the stored message; the webview upserts by id and replaces the node in
     place. Distinct/interleaved activities stay separate.

2. **Error duplicates** — a single failure flowed through three surfaces:
   - the structured error card (`handleServerStatus("error")` → `handleStreamError`),
   - a generic "An error occurred while generating the response" end-of-stream
     card (`streamOrchestrator.showStreamEndReasonMessage`),
   - and the raw error echoed into the bottom typing indicator
     (`handleRunActivityUpdate` failed/interrupted).
   - The **structured card is canonical.** `hasRecentErrorCard()`
     (`streamEndErrorPolicy.ts`, pure) suppresses the generic end-of-stream card
     when an error card already exists in the recent window;
     `handleRunActivityUpdate` no longer echoes the raw error into the status
     indicator. `handleStreamError` still coalesces identical consecutive error
     cards.

## Known limitations

- Activity coalescing is scoped to the *immediately previous* message, so a
  far-apart legitimate repeat surfaces as a fresh card (intentional — keeps the
  newest notice near the bottom).
- The specialized error subclasses (`NetworkErrorDisplay`, `QuotaErrorDisplay`,
  `GenerationErrorDisplay`) still append a small extra info row with inline
  styling; the base card is fully class-driven.
- The webview bundle sits close to its size budget; prefer CSS/markup over new
  runtime JS when extending cards.
