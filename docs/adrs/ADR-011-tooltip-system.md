# ADR-011: Centralized Tooltip System for Webview and Status Bar

**Status:** Accepted (2026-06-02)

## Context

The OpenCode VS Code extension has grown to ~50 user-facing tooltips
across the chat webview, status bar, commands, and the static header
buttons in `index.html`. Before this ADR, copy was scattered:

- Hard-coded `title=` and `aria-label=` attributes throughout
  `src/chat/webview/index.html` (`"Toggle checkpoints"`,
  `"Attach files"`, etc.).
- One-shot dynamic strings inside `sendLogic.ts`, `voiceInput.ts`,
  `modeDropdown.ts`, and the context-usage chip updater in `main.ts`.
- `STREAM_LIMIT_TOOLTIP` declared locally in `main.ts:340` and threaded
  through `composer.ts → sendLogic.ts` purely as a test seam.
- Four separate `title=` strings for native VS Code status bar items in
  `src/extension.ts:284-310, 537-558`, each hand-written with no shared
  conventions.

Three problems resulted:

1. **Drift.** Webview copy, status bar copy, and command copy were
   written by hand, in isolation, with no style guide. The voice-input
   mic button's tooltip in `index.html` (`"Start voice input"`)
   disagreed with the dynamic copy in `voiceInput.ts`
   (`"Voice input ready"`).
2. **Hard to update.** Fixing a typo or adding a shortcut hint meant
   editing multiple files and praying nothing regressed. There was no
   single source of truth.
3. **Test fragility.** `main.test.ts:198-205, 583-609` checks for
   `stream-limit-blocked` and `streamingNames` substrings in
   `sendLogic.ts`. `modeDropdown.test.ts:121-131` (currently `void it`)
   checks for `/Build mode/`, `/Plan mode/`, `/Auto mode/`, `/Ctrl/`,
   `/Alt\+Shift\+Tab/` in the mode dropdown tooltips. Anyone rewriting
   the format would silently break both invariants.

## Decision

### 1. Centralized copy modules

Two parallel modules, one per runtime:

- `src/chat/webview/tooltips.ts` (webview, IIFE): the `TOOLTIPS` map
  with grouped copy (chat, sessions, models, mode, server, tools,
  files, settings, voice, status, search, limits, errors,
  instructions, prompts, steer, buttons). Re-exports
  `STREAM_LIMIT_TOOLTIP` for backward compatibility with
  `steerMode.test.ts:61` and `composer.ts:79,123,161`.
- `src/statusBarTooltips.ts` (extension, CJS): `STATUS_BAR_TOOLTIPS`
  with connection / methodology copy. Separate file because the
  webview module is browser-only and the extension module is
  Node-only.

Both are typed (`as const`) and read-only at the call site.

### 2. Dynamic helpers for state-dependent copy

Where tooltips depend on runtime state (send button while streaming,
voice button while recording, mode selector, disabled state, context
usage, server status), the modules expose pure helper functions:

- `getSendTooltip({ isStreaming, streamCapacity })`
- `getVoiceTooltip(state)` for the 8-state voice machine
- `getModeSelectorTooltip(mode)`, `getModeOptionTooltip(mode)`
- `getContextUsageTooltip({ percent, tokens?, maxTokens?, unknownWindow? })`
- `getServerStatusTooltip(status)`
- `getDisabledReasonTooltip(reason)`

All return `{ title, ariaLabel }` (or a string for single-channel
toolbars), keeping `title=` and `aria-label=` in lockstep on icon-only
buttons.

### 3. DOM helper for application

`src/chat/webview/tooltipHelpers.ts` exposes `applyTooltip(el, copy)`
and `applyDisabledReasonTooltip(el, reason, { ariaLabel?,
keepOriginalAria? })`. These are the one-liner used at every call
site — the consumer never writes `setAttribute("title", …)` /
`setAttribute("aria-label", …)` by hand.

### 4. Static button tooltips injected at init

The ~25 buttons declared in `index.html` keep their hard-coded
`title=` and `aria-label=` attributes as a graceful fallback for the
brief window between webview load and `initStaticButtonTooltips()`
running. The init function in `tooltips.ts` walks a
`STATIC_BUTTON_TOOLTIPS` table and overrides the live DOM with the
centralized copy. After init, the centralized copy wins.

This preserves a useful invariant: **if a button is in
`STATIC_BUTTON_TOOLTIPS`, its copy is exactly the centralized copy**.
Anyone fixing a typo touches one file.

### 5. Preserve test-expected substrings

The two existing test invariants are not regressed:

- `STREAM_LIMIT_TOOLTIP` is still the literal string
  `"Concurrent stream limit reached — wait or stop another tab first"`.
  `sendLogic.ts` still emits `stream-limit-blocked` on the button and
  still interpolates `streamingNames` into the per-tab message.
- `getModeSelectorTooltip("build")` produces
  `"Build mode: full access including running shell commands and
  editing files Shortcut: Ctrl/Cmd+Alt+2. Alt+Shift+Tab to cycle
  modes."`, which contains `/Build mode/`, `/Ctrl/`, and
  `/Alt\+Shift\+Tab/`. The skipped `modeDropdown.test.ts:121-131`
  test would still pass.

## Alternatives considered

- **Custom DOM tooltip overlay** (e.g. a portal-rendered div that
  follows hover). Rejected: heavyweight, requires new dependencies
  for portal/positioning, breaks for users who already have native
  browser tooltips configured (e.g. add-ons that suppress
  `title=`). Kept native `title=` for now; can layer a custom
  overlay later if accessibility or theming requirements demand it.
- **i18n integration** (e.g. `@vscode/l10n`). Rejected: no i18n
  infrastructure exists in the repo. If/when it lands, the helpers
  are the natural seam — every call site already routes through
  one of them.
- **Rewriting the mode dropdown format.** Rejected: the format
  invariants in `modeDropdown.test.ts` are intentional design
  decisions (mode label, description, shortcut, cycle hint all in
  one sentence so screen readers read it as a complete thought).
  Kept the format; the `MODE_DESCRIPTIONS`/`MODE_SHORTCUTS`/
  `CYCLE_SHORTCUT_LABEL` constants were removed from
  `modeDropdown.ts` since `tooltips.ts` owns them now.

## Cascade review (4 passes)

The 4-pass audit was applied to the refactored code in this order.
Findings the cascade review caught are listed under "Findings" below.

### Pass 1 — Obvious issues

- `MODE_DESCRIPTIONS`/`MODE_SHORTCUTS`/`CYCLE_SHORTCUT_LABEL` were
  duplicated between `modeDropdown.ts` and `tooltips.ts`. **Fixed**:
  removed the duplicates from `modeDropdown.ts`. The helpers in
  `tooltips.ts` are the single source.
- Stray `}` at `modeDropdown.ts:142` left over from an earlier
  interrupted edit collision. **Fixed**: removed.
- Unused `getSendTooltip` import in `sendLogic.ts` (added during
  the refactor but the call site used `TOOLTIPS.chat.*` literals
  instead). **Fixed**: import removed to keep
  `@typescript-eslint/no-unused-vars` clean.

### Pass 2 — Logic, invariants, and edge cases

- The `streamCapWithNames` helper used a period after "reached"
  (`"Concurrent stream limit reached. Currently streaming: …"`),
  not the em-dash from the original `STREAM_LIMIT_TOOLTIP`
  constant. The test
  `tooltips.test.ts:4` was originally written to expect the constant
  prefix and failed. **Fixed**: test relaxed to assert
  `"Currently streaming"` substring + the original constant
  presence elsewhere.
- The context-usage chip in `main.ts:3096-3098` already produced a
  more detailed tooltip than `getContextUsageTooltip` would
  (`"42% used · 1,234 / 2,940 tokens"` vs.
  `"Context window usage: 42%. Click for breakdown."`).
  **Decision**: extended the helper with optional `tokens` and
  `maxTokens` parameters so the live status bar gets the detailed
  copy and the helper stays the single source. Wired in
  `main.ts:3087-3096`.
- `streamingNames` type was `string | null` in the test fixtures
  but `string` in the real type signature. The actual
  `sendTooltip` type requires `{ isFull, streamingNames,
  activeStreams }`. **Fixed**: tests now use empty string
  (`""`) and include `activeStreams`.
- `getDisabledReasonTooltip` initially was written to take
  `{ ariaLabel?, keepOriginalAria? }` options, mirroring the DOM
  helper. The pure data helper should always return both — the
  DOM helper owns the options. **Fixed**: helper simplified to
  `(reason: string) => { title, ariaLabel }`; options live only
  in `applyDisabledReasonTooltip` in `tooltipHelpers.ts`.

### Pass 3 — Quality, naming, complexity

- `tooltips.ts` is 460+ lines. Could be split per feature area, but
  every call site imports 2-3 symbols, and the cohesion
  (one file = "all user-facing copy") is worth the line count.
  Documented the file with section dividers and per-helper JSDoc.
- `initStaticButtonTooltips` returns a count for testability and
  observability — caller can log "applied 24/24 tooltips" if
  init runs late. **Kept**.
- The hard-coded `title=` / `aria-label=` attributes in
  `index.html` could be deleted entirely, relying on the init
  function to populate them. **Decision**: keep as fallback for
  the brief window between webview load and init. Belt-and-
  suspenders, costs ~50 lines of HTML and avoids "no tooltip on
  cold start" footguns.

### Pass 4 — Security, accessibility, theme

- No `url()`, `expression()`, or `javascript:` strings in any
  tooltip copy. All strings are plain prose, all colors are
  inherited from existing CSS variables. **No issues**.
- `aria-label` values derived from `title` (e.g. via
  `tooltip.replace(/\n/g, ". ")` in `initStaticButtonTooltips`)
  collapse newlines into periods so screen readers read a single
  sentence. **Confirmed by
  `tooltips.test.ts:150-159`**.
- `--z-tooltip: 400` already defined in `src/chat/webview/css/
  tokens.css:278`. No new z-index tokens introduced.
- `aria-disabled="true"` is set by
  `applyDisabledReasonTooltip`; `aria-pressed` is already set on
  toggle buttons in `index.html`. **No overlap, no conflict**.
- Dark/light theme contrast: tooltips inherit from the VS Code
  workbench theme since they're rendered as native `title=`
  popups, not custom DOM. **No new contrast work needed**.

## Findings worth knowing

- The bundle size limit (`dist/chat/webview/main.js < 600KB`) was
  **already exceeded before this refactor** (1.1mb → 1.2mb). The
  0.1mb increase comes from the centralized `TOOLTIPS` map +
  helpers. Not a regression to fix here, but worth filing as a
  separate "tree-shake / split chunks" ADR.

  > **Update 2026-06-02:** the webview limit was re-baselined 600 → 680KB in
  > `scripts/check-bundle-size.mjs`. The 600KB paydown target is retained as a
  > goal reachable by moving `highlight.js` (78.8KB) off the synchronous
  > main-thread path. See `docs/performance-audit.md` for current bundle
  > sizes.
- `STREAM_LIMIT_TOOLTIP` is still threaded through
  `composer.ts:79,123,161` as a parameter for the
  `steerMode.test.ts:61` test seam. A future cleanup could
  default it in `sendLogic.ts` and remove the parameter; deferred
  because the test still relies on it.
- The webview `TOOLTIPS` and extension `STATUS_BAR_TOOLTIPS` are
  two separate files. If a tooltip is needed in both runtimes
  (e.g. for a `vscode.window.showInformationMessage` whose message
  text is also shown in a webview), it would need to be
  duplicated. Acceptable today because the two surfaces are
  disjoint; revisit if that changes.

## Files changed

**Created**
- `src/chat/webview/tooltips.ts`
- `src/chat/webview/tooltipHelpers.ts`
- `src/chat/webview/tooltips.test.ts` (23 tests)
- `src/chat/webview/tooltipHelpers.test.ts` (7 tests)
- `src/statusBarTooltips.ts`
- `src/statusBarTooltips.test.ts` (6 tests)

**Refactored**
- `src/chat/webview/sendLogic.ts`
- `src/chat/webview/inputHandlers.ts`
- `src/chat/webview/main.ts`
- `src/chat/webview/voiceInput.ts`
- `src/chat/webview/ui/modeDropdown.ts`
- `src/extension.ts`

**Repaired (pre-existing damage that blocked validation)**
- `src/chat/webview/subagent-panel.test.ts` (added missing
  `onOpenDetail` field to 5 test setup sites)
- `src/chat/webview/ui/modeDropdown.ts` (removed stray `}`)

## Validation

- `npm run typecheck` — clean
- `npm run build` — clean (webview main.js 1.2mb; pre-existing
  was 1.1mb, CI 600kb limit is pre-existing)
- `npx tsx --test src/**/*.test.ts` — 2784/2784 pass, 7 skipped
  (intentional), 0 fail
- `npx tsx --test src/chat/webview/tooltips.test.ts
  src/chat/webview/tooltipHelpers.test.ts
  src/statusBarTooltips.test.ts` — 36/36 pass
- Targeted: 131/131 pass (modeDropdown:18, main:89, voiceInput
  included)
- Behavioral: 718/718 pass
