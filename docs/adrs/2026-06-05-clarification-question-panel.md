# ADR: Composer-Anchored Clarification Panel (Question Bar)

**Status:** Accepted
**Date:** 2026-06-05
**Authors:** Claude (Opus 4.8)

## Context

When the opencode `question` tool fires mid-generation, the webview rendered a
**fully interactive "QUESTION FROM MODEL" card inside the assistant message
bubble** (`renderQuestionBlock` in `renderer.ts`, dispatched for block type
`question`). That placement had several problems:

- A *required user action* was buried in the scrollable transcript and visually
  indistinguishable from generated content.
- Selecting an option gave **no visible feedback** — there was no
  `.question-option.selected` style anywhere in the CSS.
- A single-group/single-select question **auto-submitted on first click**
  (surprising, easy to mis-click).
- The answer was only mutated on the in-DOM block object, **never persisted** to
  `SessionStore`, so a reload re-showed the question as pending.

A prior attempt at the fix was **half-built and abandoned**: a complete,
unit-tested sticky-panel module (`questionBar.ts`) existed but was never wired —
no `#question-bar` element in `index.html`, `initQuestionBar` never called, and
the `onQuestionBlock` feeder hook (`streamHandlers.ts`) had no consumer. (An
earlier `frontend-ux-audit.md` entry marked this "done"; it was not.)

Research into the field confirmed the target pattern. The MCP **elicitation**
spec (2025-06/11) standardizes server→user input requests with a clear message,
enum/array/string schemas, validate-before-send, and a three-action model
(**accept / decline / cancel**) where clients *should* allow decline at any time.
Cline/Roo/Kilo's `ask_followup_question` renders 2–4 selectable options with
free-text still allowed. The Claude Code VS Code feature request (modeled on
Cursor Plan Mode) asks for a "Clarifying Questions" card with radios/checkboxes,
highlighted selection, an explicit Continue button, and an optional Skip. Our
design matches or exceeds all of these on every axis.

## Decision

Move all interactive clarification UI out of the transcript into a **single
sticky panel anchored directly above the composer** (`#question-bar`, a sibling
of `#input-area`, mirroring `#changed-files-strip`). The transcript keeps only a
passive record of the decision.

### 1. Transcript = passive pointer / record (`renderer.ts`)
`renderQuestionBlock` no longer builds controls. A **pending** question renders a
compact non-interactive pointer ("Answer in the panel below ↓") and feeds the
panel via `addQuestion`. An **answered** question renders a collapsed record
(`Selected:` / `Your answer:` / a friendly "Skipped" line) and calls
`removeQuestion`. The block keeps `data-block-id` so the existing in-place
`refreshQuestionBlock` re-render still works.

### 2. Interactive panel (`questionBar.ts`)
The previously-orphaned module is finished and wired:
- **Explicit Submit always.** Submit is enabled only when *every* options group
  has a selection (an options-less item requires non-empty free-text) — no
  auto-submit. Selecting toggles `.selected` + `aria-pressed` (a check glyph
  makes the choice non-color-only).
- **Skip** sends `"Skip this question — please use your best judgment and
  continue."` as the follow-up prompt. Because answers are forwarded as *prompts*
  (not null tool results), this cleanly unblocks the agent — the analog of MCP
  `decline`. Skip is always enabled while a question is pending.
- **Resume affordance.** On submit/skip the panel shows a "Sending…/Resuming"
  status and retires the item (host-confirmed, with a scoped fallback timer).
- **Multi-tab safe.** The panel mirrors the active session only
  (`setActiveQuestionSession`); a background tab's streaming question never leaks
  in. `main.ts` repopulates the panel from the active session's persisted blocks
  on tab switch (cached panels aren't re-rendered).

### 3. Persistence (`WebviewEventRouter.ts` + `SessionStore.markQuestionAnswered`)
The `question_answer` host handler is unchanged in how it forwards the answer
(append user message → `startPrompt`, guarded by the per-session in-flight set).
It now also calls `SessionStore.markQuestionAnswered(sessionId, toolCallId,
value, source)`, which flips the originating block to `answered` with the
answer/source so the transcript renders a record and a reload doesn't re-prompt.
Skip stores a friendly summary rather than the raw prompt.

### 4. Styling (`css/question-bar.css`, registered in `styles.css` `layer(components)`)
Token-themed panel with `--vscode-*` fallbacks; `max-height` + internal
`overflow-y` so multi-question stacks never push the composer off-screen;
`:focus-visible` rings; `prefers-reduced-motion` guard; the previously-missing
selection-feedback style.

## Consequences

- **Positive:** required decisions are unmissable and never buried; selection and
  resume states are obvious; answers persist across reload; behavior aligns with
  MCP elicitation and the leading agent IDEs; the dead `questionBar.ts` and its
  tests are now load-bearing.
- **Trade-offs / known limits:**
  - The single shared panel answers one question (one or many groups) cleanly;
    *multiple simultaneous distinct `question` tool calls* still submit only the
    first (the host in-flight guard drops the rest) — rare, since the agent
    pauses on the first. Left as a follow-up.
  - We don't pre-populate server-provided defaults (opencode's `question` rarely
    sends one); the MCP "SHOULD pre-populate defaults" is a future enhancement.
- The transcript-interactivity tests moved from `question-block.test.ts` to
  `questionBar.test.ts`; the transcript test now asserts the passive pointer.

## References
- `src/chat/webview/questionBar.ts`, `renderer.ts`, `main.ts`, `index.html`,
  `css/question-bar.css`
- `src/chat/WebviewEventRouter.ts`, `src/session/SessionStore.ts`
- MCP elicitation: https://modelcontextprotocol.io/specification/draft/client/elicitation
- ADR-001 (client-server), constitution rule #4 (multi-tab)
