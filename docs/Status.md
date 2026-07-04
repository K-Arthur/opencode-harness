# opencode-harness — Status

**Last Updated:** 2026-07-04
**Version:** v0.4.56 (unreleased)

## Highlights (2026-07-04) — Thinking display, compaction, token cap

- **Thinking blocks now grow incrementally during generation**: each reasoning
  delta now updates the same stable DOM element instead of appending a new one.
  A `reasoningAccumulator` Map accumulates deltas per `tabId:reasoningId` and
  posts with a fixed `msgId` so `upsertMessageById` replaces in-place.
  Accumulator is cleared on `reasoning.ended` so the next thinking turn is fresh.
- **Compaction now fires for models with unknown context windows**: models absent
  from models.dev / OpenRouter (e.g. glm-4.7) resolved to `maxTokens=0` →
  `percent=0` → the `< threshold` gate always exited early. A `windowUnknown`
  fallback now triggers compaction at ≥50 messages, bypassing the percent check.
- **Context usage bar no longer shows 297M+ token counts**: heuristic token
  estimation in `StreamCoordinator` is now capped — 50k per block,
  2M per component — preventing astronomical values from large workspace trees
  or many accumulated tool outputs.
- **Open file button on streaming edit-tool cards**: `postMessage` is now
  threaded through `StreamSession.handleToolUpdate` → `handleToolUpdate` →
  `renderFileEditCard`, so the button's click handler can message the host.
  (Fix committed in the 2026-07-03 batch; documented here as the reinstall
  delivers it for the first time.)

## Highlights (2026-07-03) — Multi-session performance and fix batch

- **Multi-session freeze eliminated**: hidden tabs deferred via `visibilityGate`
  — no DOM mutations, no `scrollTop` RAF churn, no markdown re-parses on
  background chunks. Rendering is accumulated losslessly and flushed in a single
  RAF on tab activation.
- **force_rerender flood stopped**: `HeartbeatService` now gates resends behind
  a `pendingForceRerender` flag; one resend fires on the next ack recovery
  instead of flooding every 5s tick while the webview is blocked. Ping cadence
  backs off to every 3rd tick during unresponsiveness.
- **Whole-file green highlighting fixed**: `AgentGazeService.onToolEnd` no
  longer loops all visible editors. Tool-call-id → file-path mapping
  (`agentGazePolicy.ts`) restricts decoration to the specific edited file.
  `opencode.agentGaze.enabled` setting (default true) provides an escape hatch.
- **"Open file" button on streaming edit-tool cards**: now works; `postMessage`
  threaded through `handleToolUpdate` → `renderFileEditCard` so the click
  handler can message the host.
- **Finalize-defer loop bounded**: `ToolCallTracker` fingerprints grace-expiry
  state; identical consecutive fingerprint escalates to
  `{ includeChildLinked: true }`, capping stuck-subagent loops at ~60s.
- **todos_update coalesced**: `ChatProvider` routes `todo_updated` through
  `PerSessionDebouncer` (300ms trailing per session) to reduce CodeLens churn.

## Highlights (2026-07-03) — Subagent tracking and UI fixed

- **Subagent tracker no longer switches to "unconfirmed" for long tasks**: the
  30-second tool grace timeout fired while subagents were still legitimately
  running, marking the task tool as "unresolved" and the subagent as "failed".
  This stopped the `SubagentHeartbeat` (which relies on `hasActiveRun`) and
  incorrectly showed "Unconfirmed" in the UI. Subagent tools are now skipped in
  `markUnresolvedPendingToolCalls` and `markActiveSubagentsUnresolved` — the
  heartbeat (5s poll) is the authoritative completion signal for subagents with
  a linked `childSessionId`. Only orphaned subagents are marked unresolved.
- **Stream finalizes after heartbeat completes a subagent**: the
  `recordSubagentActivity` heartbeat callback now triggers
  `maybeFinalizeStream` so the stream doesn't stay deferred forever waiting for
  a subagent that has already finished.
- **Subagent card updates title/details live**: the initial `tool_start` for a
  `task` tool may carry partial/empty args. When full args arrive via
  `tool_update`, `applySubagentCardUpdate` now re-renders the card header so
  the title and purpose reflect the actual subagent invocation immediately.

## Highlights (2026-07-03) — Suite hang fixed, message copy shipped

- **Test-suite hang eliminated**: JSDOM harnesses leaked Node-global timers
  (streamHandlers' elapsed ticker), so stream test files passed their tests
  then pinned the event loop forever — stalling the sequential
  `npm run test:unit` run. `streamHarness.installDom()` now tracks and clears
  timers in `restore()`; `stream.test.ts` delegates to the shared harness.
  All stream/webview files verified to pass AND exit.
- **Copy button on messages**: user prompts and model responses have a
  hover-revealed copy control (messageCopy.ts — new module; renderMessage is
  a cc=90 hotspot, so extracted rather than enlarged). DI'd clipboard with
  execCommand fallback; 8 behavioral tests + chromium-webview e2e.
- **Stale e2e specs modernized**: three tests still switched tabs via
  host-driven `active_session_changed` (deliberately ignored since the
  no-focus-stealing policy). Now they click `.tab-btn` like a user;
  chromium-webview project fully green (31 passed / 0 failed).

## Highlights (2026-07-03) — Context usage counter: cross-tab bleed eliminated

**Multiple tabs showed identical context-usage figures, some pegged at a bogus 100%.**

- **Root cause**: `ContextMonitor`'s sessionless getters (`percent`,
  `tokensUsed`, `limit`) hold whichever session updated last.
  `StreamCoordinator`'s stream-boundary emits, `AutoCompactor`'s threshold
  gate, and `WebviewEventRouter`'s `get_context_usage` fallback all read them
  on behalf of a *specific* tab — so tab B's bar was painted with tab A's
  numerator and/or denominator (`tokens_A / limit_B` clamps to 100%).
- **Fix**: per-session attribution everywhere. New
  `ContextMonitor.emitLatestForSession(tabId)` re-emits a tab's own snapshot at
  stream boundaries; `setTokenLimit(limit, sessionId)` no longer refreshes the
  shared default; `AutoCompactor` gates on `getCurrentUsage(activeTab.id)`;
  `ChatProvider` drops sessionless `context_usage` emits (the webview would
  attribute them to the viewed tab and persist them).
- **Lifecycle**: `resetSession` (compaction) now keeps the session's context
  window; new `clearSession` wipes usage + window on session deletion.
- **Tests**: 8 behavioral tests (`ContextMonitor.session.test.ts`) + 4
  attribution pins (`contextUsageAttribution.test.ts`), RED-first. See
  `docs/token-tracking-architecture.md` § Per-Session Attribution Invariant.

## Highlights (2026-07-02) — Test infrastructure: 174-file glob blind spot fixed

**The npm test script was silently skipping 174 of 303 TypeScript test files.**

- **Root cause**: `npm run test:unit` used an unquoted `src/**/*.test.ts` glob.
  `/bin/sh` (used by npm) doesn't support `**` recursion without `globstar`,
  so every test in `src/chat/handlers/`, `src/chat/webview/`, `src/chat/diff/`,
  and `src/session/eventHandlers/` was never executed.
- **Fix**: single-quoted the glob so Node 26's built-in engine expands it.
  Added `tests/unit/*.test.ts` (5 behavioural TS tests for input/send/webview)
  which were also missing from the pipeline.
- **Harness drift fixed**: three divergences in the newly-running tests —
  max-height cap (200→160px), missing `els.welcomeView` in JSDOM fixture,
  missing `sessions: {}` in `getState` overrides, and missing
  `attachmentManager` stubs (getContextItems, isActiveFileIncluded, etc.).
- **Net gain**: `npm run test:unit` now runs ~4280+ tests across 303 TS files
  + 64 MJS files + 5 previously-hidden TS unit files, all green.

## Highlights (2026-07-02) — Finalize deadlock, message ordering, queue/steer robustness

**Log-driven root-cause fixes for stuck/vanishing generations, plus a queueing & steering overhaul.**

- **Finalize deadlock fixed**: the quiet-period defer timer re-entered the
  public `maybeFinalizeStream` and chained onto its own pending promise —
  streams never finalized ("deferring status finalize…" then silence).
  Timer now calls the internal path; cancelled defers settle their promise.
- **Wrong message at stream end fixed**: server returns newest-first with
  `limit`; `reverse().find()` picked the previous turn's assistant message,
  replacing streamed output with stale content. Order-independent
  `pickLatestAssistant` used in all three consumers.
- **Focus stealing fixed**: background stream starts/replays no longer switch
  the active tab (v0.4.36 policy honored in the stream orchestrator).
- **Queue/steer overhaul**: Send Now works on any queued item with busy-tab
  move-to-front semantics; keyboard reorder posts real indices; stale chips
  cleared; paused queues (post-abort/reload) show a "Send next" resume button.
- **Test debt**: repaired stale deep-path suites (steer, attachments,
  orchestrator harness) that the npm glob never executes; added 3 new suites.

## Highlights (2026-07-01) — Performance audit, state integrity fixes, frontend improvements

**Six targeted fixes for session lifecycle state bugs and performance bottlenecks, plus frontend generation tracking and notifications.**

- **Activity-sequence guard** (Fix 1): Replaced the 1500ms quiet-period timer
  that could be raced by late tool events with a microtask-based sequence check.
  Eliminates "completed session shows as running / running session shows as done".
- **Finalizer chain fix** (Fix 3): Second concurrent finalize trigger now chains
  on the in-flight promise instead of silently returning the same result.
- **Paginated final fetch** (Fix 5): Replaced full-history `getSessionMessages`
  with `getMessages(limit=5)` — O(1) regardless of session length.
- **Heartbeat fingerprint** (Fix 7): Replaced `JSON.stringify` with a field-level
  hash for the activity snapshot dirty check — eliminates per-tick GC pressure.
- **EventDeduplicator** (Fix 4): TTL-based SSE event dedup that survives
  reconnects, preventing server-replayed events from causing duplicate state updates.
- **Idle watchdog raised to 300s** (Fix 6): Accommodates DeepSeek-R1/Qwen-QwQ
  long reasoning silences that were triggering spurious reconnects at 90s.
- **pendingStream restoration** (Fix 2): Finalizing-phase tabs are now captured
  in the restoration snapshot and reconciled on VS Code reload.
- **Elapsed time indicator**: Streaming "Thinking…" indicator shows live elapsed
  seconds (e.g. "• 12s") ticking during generation.
- **Generation outcome notifications**: VS Code native notifications on success/
  failure when the webview is hidden; in-webview success/error toasts always.

## Highlights (2026-06-28) — Theme customizer rework, subagent bug fixes

**Complete redesign of the Customize theme modal with modular accessible architecture, plus three subagent UX regression fixes.**

- **Theme customizer rework** — replaced the monolithic `themeCustomizer.ts`
  with 10 new modular components under `src/chat/webview/ui/theme/`:
  `themeOrchestrator` (wires everything together), `themeModal` (native
  `<dialog>` shell with focus trapping/ESC/backdrop), `presetGrid` (terminal-
  window thumbnail cards with `role="radiogroup"` roving tabindex), `cliSearch`
  (debounced CLI theme search with listbox pattern), `colorSections` (native
  `<details>` accordion), `previewStrip` (live preview), `themeState` (ephemeral
  modal state with undo), `themeUtils` (pure utilities), `themeBridge` (typed
  message contract), `themeConstants` (shared CSS var map). All modules have
  co-located tests (60+ new test cases). `RESEARCH.md` documents findings from
  VS Code docs, WAI-ARIA APG, MDN, and a11y blogs.
- **Theme customizer blinking fixed** — removed the CSS Grid accordion animation
  that conflicted with native `<details>` rendering, and split
  `presetGrid.setSelected()` from `selectPreset()` so hydration no longer fires
  the user-action callback that created a webview-host message loop.
- **Theme customizer styling consistency** — preview strip now uses the correct
  message and syntax color tokens; removed unused component tokens; modal shadow
  uses the shared `--shadow-xl` token; native `<details>` marker is hidden.
- **CSS hardcoding audit** — created `scripts/check-css-hardcoding.mjs` to
  detect hardcoded hex/rgba/hsl colors and px values outside design tokens.
  Fixed remaining violations in theme customizer, context usage bar, and
  question bar CSS. All target-file hardcoded px values now reference spacing
  or size tokens.
- **High-contrast visual noise** — added `.vscode-high-contrast` /
  `.vscode-high-contrast-light` overrides in theme customizer CSS to remove
  decorative borders and reduce border weight on structural elements,
  eliminating overstated yellow/red lines in high-contrast mode.
- **Tab close not firing on SVG clicks** — `tabs.ts` used
  `classList.contains("tab-close")` which missed clicks on inner SVG elements.
  Fixed with `closest(".tab-close")`.
- **Generic "subagent" titles** — when the agent name was the generic fallback,
  the activity panel showed "subagent" instead of the task description. Added
  shared `resolveSubagentDisplayName`/`resolveSubagentActivityName` helpers.
- **Stale `isLive` flag** — the spread merge preserved stale `isLive=true`
  after status transitions. Added `computeIsLive`/`recomputeActivityLiveness`
  helpers; `isLive` is now derived from status, never trusted from the wire.
- **Bundle size re-baseline** — webview limit bumped from 798KB to 812KB to
  accommodate the new theme modules. Production build measures 809.9KB.

Files: `src/chat/webview/ui/theme/*`, `src/chat/webview/css/theme-customizer.css`,
`src/chat/webview/css/context-usage.css`, `src/chat/webview/css/question-bar.css`,
`src/chat/webview/{tabs,subagentsModule,subagentReconciler,subagentCard,main,dom}.ts`,
`src/chat/handlers/toolClassifier.ts`, `src/chat/webview/index.html`,
`scripts/check-css-hardcoding.mjs`, `scripts/check-bundle-size.mjs`, `RESEARCH.md`, `CHANGELOG.md`

**Zero-emoji icon migration, question bar carousel restore, attachment chip overhaul, diff/drag-drop fixes.**

- **Zero emoji policy enforced** — all Unicode glyphs and Codicon font references
  replaced with inline SVG icons from `icons.ts`: `📎` → SVG paperclip data-URI,
  `×`/`&times;` → `REMOVE_SVG` (7 close/remove buttons), `✗⏳✕✓◉` → `STATE_*_SVG`
  (tool call status badges), `✓` → `CHECK_SVG` (question bar), `✕` → `REMOVE_SVG`
  (error tiers), `↓` → `CHEVRON_DOWN_SVG` (scroll markers), `★`/`☆` →
  `PIN_FILLED_SVG`/`PIN_SVG` (recent prompts), `•` → CSS-drawn dot, `codicon-add`
  → inline SVG plus, `codicon-sync` → `SPINNER_SVG`. Added `INFO_SVG` to icons.ts.
- **UI Methodology Standards codified** — `CONVENTIONS.md` now includes a
  comprehensive section covering design-system tokens first, zero emoji policy,
  WCAG 2.2 AA minimum, icon usage standards, TDD-first, and cascade review
  checkpoints. Cross-references added to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
  `.windsurfrules`.
- **Question bar carousel restored** — multiple simultaneous questions were
  stacking instead of showing one at a time. Fix: `refreshQuestionVisibility()`
  hides queued questions via `.question-bar-item--queued { display: none }` and
  reveals the next one when the current question is answered.
- **Question bar free-text submission fixed** — free-text answers were dropped
  when the "Ready" button was used. Fix: always append free-text as a final
  answer group when it has content, regardless of `cardReady` state.
- **Document attachments show as broken image thumbnails** — the CSS
  `:not(:has(img))` selector was unreliable; `attachFileBlob` was also calling
  `addImageAttachment` for documents. Fix: use explicit
  `.attachment-chip--image`/`.attachment-chip--document` classes; fix
  `attachFileBlob` to call `addDocumentAttachment`.
- **Attachment chip styling improved** — removed `📎` emoji, reduced chip size
  from 56px to 48px via `--attachment-size` token, replaced `:has()` with
  explicit classes.
- **Diff editor fails for out-of-workspace files** — `getBaselineContent` passed
  absolute paths to `git show` without converting to workspace-relative. Fix:
  convert absolute paths to workspace-relative; skip git strategies for
  out-of-workspace files.
- **Drag-drop overlay persists after file added** — `stopPropagation()` on input
  area handlers prevented the global drop handler from hiding the overlay. Fix:
  remove `stopPropagation()`; add `inputArea.contains(e.target)` check.
- **Copy file path button** — each file row in the changed files dropdown now
  has a copy-path button using `navigator.clipboard.writeText`.

Files: `src/chat/webview/{icons,index,questionBar,theme,tabs,file-chip-list,
toolCallRenderer,errorTiers,recentPromptsRail,changed-files-dropdown}.ts`,
`src/chat/webview/ui/{attachments,contextTray,keyboardShortcutsModal,
scrollMarkers,dragDrop}.ts`, `src/chat/webview/css/{tokens,layout,blocks,
components,question-bar}.css`, `src/chat/{SessionBaselineResolver,
WebviewEventRouter}.ts`, `CONVENTIONS.md`, `AGENTS.md`, `CLAUDE.md`,
`GEMINI.md`, `.windsurfrules`, `docs/ui/icons.md`, `CHANGELOG.md`.

## Highlights (2026-06-28) — Long-session scroll fixes

**Scroll fix pass: condensation race, timer leak, prepend-during-streaming race.**

- **Scroll position lost after history condensation** — on sessions with > 140
  messages, the chunked loader restored scroll after 20 messages, but
  `applyHistoryCondensation` then replaced groups of 20 old messages with
  summary buttons, shrinking `scrollHeight` and causing the browser to clamp
  `scrollTop` to the bottom. Fix: re-restore scroll position in `onAllDone`
  after condensation, on both `resume_session` and `init_state` load paths.
- **Scroll-save timer leak on tab close** — `closeTab` did not clear the
  pending `scrollSaveTimers` entry. Fix: clear the timer in `closeTab`.
- **"Load earlier" during streaming could yank scroll to bottom** — a
  concurrent streaming chunk's `scrollIfAnchored()` could undo the scroll
  compensation from `prependMessagesPreservingScroll`. Fix:
  `pauseForReflow(200)` on the scroll anchor before prepending.

Files: `src/chat/webview/main.ts`, `CHANGELOG.md`, `docs/Status.md`.

## Highlights (2026-06-27) — Question-answer recovery crash, empty question bar persistence

**Question-answer fix pass: recovery crash, empty bar persistence, flat question parsing, stale structural tests.**

- **Question-answer recovery crash** — the webview question bar threw
  `Cannot read properties of undefined (reading 'header')` when a `question`
  block had empty `groups`. This crashed both the initial `stream_tool_start`
  render and the `expired_question_recovery_failed` handler, blocking the
  auto-send of the user's answer and leaving the frontend without confirmation.
  `questionBar.ts` now guards missing groups, renders the question text from
  `block.text` when groups are empty, and repopulates answered transcript
  records as read-only cards.
- **Empty question bar persistence** — `questionBar.addQuestion` now skips empty
  tool-start payloads (no groups, no question text, no options) so a blank
  "Question from model" card cannot get stuck in the UI.
- **Flat question parsing** — `QuestionHandler.ts` now parses the server's
  `question`/`prompt`/`message`/`text` fields when the `questions` array is
  absent, so free-text questions produce a real group and `text` instead of an
  empty block.
- **Stale structural tests** — `main.test.ts` and `toolLifecycle.test.ts`
  structural assertions were updated to inspect the files where the logic now
  lives (`panelSetup.ts`, `ToolCallTracker.ts`, `tabSwitcher.ts`) and to match
  the current drop handler and scroll-anchor code.

Files: `src/chat/webview/questionBar.ts`, `src/chat/webview/questionBar.test.ts`,
`src/session/eventHandlers/QuestionHandler.ts`, `src/session/EventNormalizer.test.ts`,
`src/chat/webview/main.test.ts`, `src/chat/webview/toolLifecycle.test.ts`,
`CHANGELOG.md`, `docs/Status.md`.

## Highlights (2026-06-27) — v2 SDK error messages, SVG icon fix, tab attention indicator, diff compact mode

**Regression fix pass: v2 SDK audit, SVG icon rendering, tab switching, CSS tokens, diff display.**

- **SVG icons rendered as literal text** — `textContent` on SVG strings
  displayed raw `<svg>` markup instead of the icon. Switched to `innerHTML`
  in `liveCommandCard.ts` (initial render + status update) and
  `tasks-panel.ts`. Regression from the emoji-to-SVG conversion.
- **Auto-tab-switch on background resumes** — background sessions with pending
  questions or permissions no longer steal focus. A pulsing attention
  indicator (`data-needs-attention`) marks tabs needing user input. Scroll
  restoration on streaming tabs now anchors to bottom (prevents scroll jump).
- **CSS preset design tokens** — context-chip, context-chip-toggle, and
  live-command-card styles now use `--oc-*` semantic variables instead of
  raw `--vscode-*` variables.
- **Diff display compact mode** — `buildDiffPreview` in `fileEditCard.ts`
  now counts all preview lines (added/removed/context) toward
  `MAX_PREVIEW_LINES` (5). `MAX_DIFF_LINES` reduced 40→15.
- **v2 SDK error messages** — `throwOnV2Error` produced `Command failed: {}`
  on empty error objects. New `v2ErrorDetail` helper extracts message →
  field JSON → HTTP status code. Applied to `SessionClient` + `PtyService`.
- **`file.read` shape mismatch** — removed dead `messageID` parameter not
  accepted by the v2 SDK `file.read` signature.
- **AGENTS.md** — added Focused-Change Discipline (Anti-Regression Protocol)
  and Tab Attention Indicator policy sections.

Files: `src/session/v2ErrorDetail.ts` (new), `src/session/SessionClient.ts`,
`src/session/PtyService.ts`, `src/chat/CommandExecutionService.ts`,
`src/chat/webview/liveCommandCard.ts`, `src/chat/webview/tasks-panel.ts`,
`src/chat/webview/main.ts`, `src/chat/webview/tabSwitcher.ts`,
`src/chat/webview/fileEditCard.ts`, `src/chat/webview/css/layout.css`,
`src/chat/webview/css/components.css`, `src/chat/webview/css/blocks.css`,
`AGENTS.md`, `scripts/check-bundle-size.mjs`.

## Highlights (2026-06-27) — Emoji→SVG, active file toggle, file mention search, file edit cards & changed files dropdown

**Comprehensive UI fix pass: emoji replacement, active file toggle, file mention search, and regression fixes.**

- **Emoji → SVG icon replacement** — all emoji/Unicode symbols across webview UI
  files, HTML, CSS, extension host files, and dead code replaced with SVG icons
  from `icons.ts`. CSS pseudo-elements use CSS-drawn shapes (checkmarks). VS Code
  status bar items use codicon syntax (`$(warning)`).
- **Active file context toggle** — moved `#context-bar` inside `#input-area` in
  `index.html` for proper placement. Propagated `reason` field in active_file
  handler for suppressed files (binary/too large). Removed dead
  `toggle_active_file` postMessage. Re-posted active file on tab switch.
- **File edit cards stuck as running** — added branch in `handleToolEnd` to
  resolve file edit cards from "running" to completed/error/stale state.
- **Changed files dropdown** — updated dropdown immediately on `file_edited`
  message. Added changed files toolbar button back to HTML with SVG icon.
- **File mention search with WorkspaceFileIndex** — `MessageRouter` now uses
  `WorkspaceFileIndex` as primary source for file mention search, with
  `vscode.workspace.findFiles` as fallback. Results deduplicated. `WorkspaceFileIndex`
  refreshed on `webview_ready`. Webview proactively requests files on `@` trigger.
- **ActiveFileTracker crash fix** — `bestEditor()` safely handles undefined
  `visibleTextEditors` array.

Files: `src/chat/handlers/MessageRouter.ts`, `src/chat/WebviewEventRouter.ts`,
`src/chat/ActiveFileTracker.ts`, `src/chat/ChatProvider.ts`,
`src/chat/webview/mentions.ts`, `src/chat/webview/index.html`,
`src/chat/webview/streamHandlers.ts`, `src/chat/webview/fileEditCard.ts`,
`src/chat/webview/changed-files-dropdown.ts`, `src/chat/webview/theme.ts`,
`src/chat/webview/renderer.ts`, `src/chat/webview/tasks-panel.ts`,
`src/chat/webview/subagent-panel.ts`, `src/chat/webview/ui/contextTray.ts`,
`src/chat/webview/ui/attachments.ts`, `src/chat/webview/css/components.css`,
`src/chat/webview/css/question-bar.css`, `src/chat/webview/css/layout.css`,
`src/chat/webview/css/file-edit.css`, `src/monitor/RateLimitMonitor.ts`,
`src/session/SessionExporter.ts`.

## Highlights (2026-06-26) — Tool cards, compact diff, context bar & ARIA fixes

**File-edit card rendering, context usage accuracy, and accessibility.**

- **Tool cards show file paths and diffs** — fixed `data-tool-id` → `data-block-id`
  mismatch so `handleToolUpdate` finds file-edit cards for state transitions.
  Added upgrade path so a generic `<details>` card (rendered during pending
  state with empty args) is replaced by a proper file-edit card when real args
  arrive via `stream_tool_update`.
- **Compact diff preview** — inline preview capped at 5 lines (was 50);
  "Show diff" expanded view capped at 40 (was 200). Header now shows `+N / -M`
  stats chips for at-a-glance scope assessment.
- **Context bar compaction reset** — `ContextMonitor.resetSession()`,
  `SessionStore.resetContextUsage()`, and the webview `session_compacted`
  handler all clear stale pre-compaction token counts so the bar hides
  correctly instead of continuing to show the old high fill level.
- **Clearer context panel copy** — "No breakdown available" → "Token breakdown
  not reported by model"; source pill labels `ESTIMATED`/`ACTUAL` →
  `approx`/`exact` with tooltip explanations.
- **ARIA/WCAG** — `aria-pressed` on chip toggle buttons, `type="button"` on
  all interactive buttons, `:focus-visible` outlines on chip action buttons.
  File-edit card diff toggle carries `aria-expanded`, `aria-controls`,
  `role="region"` per WCAG 2.1 SC 4.1.2.

Files: `src/chat/ChatProvider.ts`, `src/chat/webview/fileEditCard.ts`,
`src/chat/webview/streamHandlers.ts`, `src/chat/webview/toolCallRenderer.ts`,
`src/chat/webview/main.ts`, `src/chat/webview/context-usage-dropdown.ts`,
`src/chat/webview/theme.ts`, `src/chat/webview/css/file-edit.css`,
`src/chat/webview/css/components.css`, `src/monitor/ContextMonitor.ts`,
`src/session/SessionStore.ts`.

## Highlights (2026-06-26) — Context-pill, drag, problems & activity-bar fixes

**Resolved follow-up bugs in the v0.4.14 UI/UX work.**

- **Active-file context pill now renders on first open** — the eager
  `active_file` post in `ActiveFileTracker.start()` raced ahead of the
  webview's handler wiring (and `active_file` is a non-queued passthrough
  message), so the pill never appeared until an editor switch. The host now
  re-posts via `ActiveFileTracker.repost()` from the `webview_ready` handler.
- **Drag overlay no longer sticks** — replaced the asymmetric enter/leave
  counter (incremented on every child, decremented only when leaving the app)
  with a canonical symmetric counter; `setupDragDrop()` is idempotent.
- **Context chip `×` styled** — `.context-chip-remove` now matches the chip
  toggle (transparent, muted, hover) instead of native button chrome.
- **"Send to OpenCode" reachable from problems** — moved off the invalid
  `problems/context` menu (silently dropped by VS Code) to a Quick Fix
  `CodeActionProvider` on diagnostics.
- **Activity-bar running indicator** — `WebviewView.badge` reflects active
  streaming sessions, driven by `TabManager.onStreamingStateChanged`.
- **Active-file inclusion single-sourced** — removed dead host inclusion API
  and the parallel `contextTray` toggle (empty `sessionId`); inclusion is
  gated webview-side via the `@file:` mention.

Files: `src/chat/ActiveFileTracker.ts`, `src/chat/WebviewEventRouter.ts`,
`src/chat/ChatProvider.ts`, `src/extension.ts`, `package.json`,
`src/chat/webview/ui/dragDrop.ts`, `src/chat/webview/ui/contextTray.ts`,
`src/chat/webview/css/components.css`.

## Highlights (2026-06-26) — Reconnection state sync & UI/UX improvements

**Closed all identified gaps in connection/reconnection handling and improved
context tray / drag-and-drop UX.**

### Reconnection state sync

- **Status bar preserves "running" on reconnect** — `wireRunningIndicator`
  now subscribes to `event_stream_reconnected` / `server_connected` /
  `server_disconnected` events and re-evaluates the streaming count. The
  indicator no longer reverts to "Connected" when sessions are still active.
- **CLI session IDs restored** — `event_stream_reconnected` re-registers
  CLI session IDs from `TabManager` into `SessionStore` so `get_todos` and
  other server-fetch handlers don't silently fail after
  `server_disconnected` invalidated them.
- **Per-tab `server_status` re-pushed** — `reconcileAfterReconnect` now
  pushes `idle` or `thinking` for reconciled tabs; non-candidate tabs get
  `idle` from the reconnect handler.
- **`streaming_state: false` re-pushed** for non-streaming tabs in case the
  webview missed the `server_disconnected` clear.
- **Stale permissions cleared** — `reconnect_sync` clears
  `pendingPermissionBySession` and hides the permission bar.
- **Question bar reconciled** — `reconnect_sync` calls
  `questionBar.repopulateFromMessages()` and `reconcileBar()`.

Files: `src/extension.ts`, `src/chat/ChatProvider.ts`,
`src/chat/handlers/StreamCoordinator.ts`, `src/chat/webview/main.ts`,
`tests/unit/streaming-state-stability.test.mjs`.

### UI/UX improvements

- **Active file safety guards** — `ActiveFileTracker` skips binary files
  and files > 1 MB with a `reason` field for the webview.
- **Folder context type** — `picked_folder` added to `ContextItemType`;
  `WorkspaceFileIndex` now indexes directories.
- **XML/YAML document icons** — extension-based icon fallback via
  `getIconForFile()`.
- **Toggleable context chips** — `ContextChip.onToggle` / `isIncluded`
  with eye/eye-off toggle button.
- **Pill-style document attachments** — compact pill layout for non-image
  attachments.
- **Drag-and-drop overlay reliability** — symmetric enter/leave counter,
  `forceHideOverlay()`, window-exit fallback, and a 3 s emergency hide
  timeout (see the fixes section above; the earlier `isOutsideApp()` decrement
  gate leaked the counter and is gone).
- **Diff line numbers** — `getFileHunks` exposes `oldStart` / `newStart`;
  `WebviewEventRouter` initializes counters from hunk positions.
- **Edit/patch/apply tool cards** — `isEditLikeTool` detects by name
  (`edit`, `write`, `patch`, `apply`) in addition to `class: "write"`.

Files: `src/chat/ActiveFileTracker.ts`, `src/chat/WorkspaceFileIndex.ts`,
`src/chat/WebviewEventRouter.ts`, `src/chat/diff/hunkRevertPlan.ts`,
`src/chat/webview/types.ts`, `src/chat/webview/theme.ts`,
`src/chat/webview/icons.ts`, `src/chat/webview/ui/attachments.ts`,
`src/chat/webview/ui/dragDrop.ts`, `src/chat/webview/css/components.css`,
`src/chat/webview/css/layout.css`, `src/chat/webview/fileEditCard.ts`.

Verification: typecheck clean; build clean; unit tests 1966/1966 pass;
eslint clean.

## Highlights (2026-06-24) — Changed-files strip interaction fix

**Fixed the changed-files strip being unclickable.** The strip (`#changed-files-strip`)
was rendered underneath the sticky composer (`#input-area`) because the composer created a
stacking context at z-index 110 while the strip was at z-index 100. Raising the strip would
have blocked the model, mode, and mention dropdowns that lived inside the composer.

Resolution: fixed-position dropdowns are now moved to a root-level `#dropdown-portal`
(`src/chat/webview/index.html`) so they participate in the root stacking order above the
strip. The strip's z-index was raised to `calc(var(--z-sticky) + 20)` (120) so it sits above
the composer but below the portaled dropdowns (150 / 201). The input area's `isolation: isolate`
was removed because it is no longer needed for dropdown containment. Visual regression tests
for the strip and all dropdowns pass; `npm run reinstall` is still needed to load the change
in the VS Code Extension Host.

Files: `src/chat/webview/index.html`, `src/chat/webview/css/layout.css`,
`src/chat/webview/css/context-usage.css`, `tests/visual/chat-context-usage.spec.ts`.

## Highlights (2026-06-23) — AttachedContextItem integration & document attachment support

**Rich context metadata for `send_prompt`.** The webview now tracks all context items
through the `AttachedContextItem` structure (`src/chat/webview/types.ts`) with fields for
`type`, `path`, `languageId`, `lineCount`, `selection`, `isActive`, and `tokenEstimate`.
The `send_prompt` message includes a `contextItems` array alongside the existing
`attachments` field. (`src/chat/webview/ui/attachments.ts`, `sendMessage.ts`, `types.ts`)

Key changes:

- **`AttachmentManager` interface** formalized with `getContextItems()`,
  `clearSentContextItems()`, `syncContextItemsWithPrompt()`, and `getContextSummary()`.
- **`@file:` injection restored** — active file path is prefixed into `sendText` so the
  backend resolves the file content. Paths with spaces are quoted.
- **Quote stripping fixed** in `syncContextItemsWithPrompt` — was only stripping the
  leading quote from `@file:"path with spaces"` tokens; now strips both.
- **Post-send cleanup** — `clearSentContextItems()` removes per-send items (picked files,
  images) while preserving the active file context item for the next send.
- **`isActive` flag consistency** — derived from `isActiveFileIncluded()` which checks both
  the toggle state and the dismissed set, so dismissed files are correctly excluded.
- **Selection in context items** — `updateActiveFileContextItem` now includes `selection`
  data when available.
- **Image/file attachments tracked as context items** — `attachImageBlob`/`attachFileBlob`
  call `addImageAttachment()` in parallel with the legacy `pendingAttachments` array.
  Chip removal also removes the corresponding context item.
- **Document MIME validation** — `attachFileBlob` validates against `ALLOWED_DOCUMENT_MIMES`
  before acceptance; `DOCUMENT_ICONS` renders type-specific emoji icons in attachment chips.
- **Dead code cleanup** — removed unused `AmbiguityInfo` import in `slashCommands.ts`,
  unused `root` variable in `WorkspaceFileIndex.ts`.
- **Verification:** tsc clean; build clean; 1951 tests pass / 0 fail / 1 skipped.

## Highlights (2026-06-21) — context-usage, composer chips, command cards & sidebar

**Dead-wire audit (Phase 1–4).** A top-down sweep for the "handlers exist but the inbound
`VALID_WEBVIEW_TYPES` gate rejects the message" anti-pattern found **six** dead-wired message
types — the whole prompt-template feature (`save_template`/`list_templates`/`delete_template`),
`save_message_as_template`, the changed-files **undo file** button (`undo_file`), and
`revert_all_files`. All are now allowlisted, and a regression guard asserts
handler⊆allowlist so the class can't recur. Also fixed tool-call **compact mode** reading a
static `false` baseline (now reads the live `displayPrefs` pref). (`WebviewEventRouter.ts`,
`messageRenderer.ts`, `displayPrefs.ts`)


Branch `cleanup/extension-refactor`. Webview/UX hardening pass (all changes are in the
webview bundle — require `npm run reinstall` to appear in-app):

- **Context-usage modal actions repaired.** *Compact context* posted an unhandled
  `compact_context` (now `compact_session`) and *Switch model* posted an unhandled
  `open_model_selector` (now a registered host handler that re-posts `open_model_manager`).
  Both previously no-op'd. (`context-usage-dropdown.ts`, `WebviewEventRouter.ts`)
- **Model-aware context bar.** The bar/dropdown recompute percent from `tokens / maxTokens`
  so multi-model sessions stay consistent after a window change. (`ui/tokenCostDisplay.ts`,
  `context-usage-dropdown.ts`)
- **Provider quota counter no longer stuck at "0 tok"** for proxy providers — falls back to
  the active session's cumulative `tokenUsage.total`. (`ui/tokenCostDisplay.ts`)
- **Composer mention chips.** Typed `@file:`/`@folder:`/`@url:`/image mentions now render as
  styled, per-kind chips (basename/hostname labels, image-vs-file icons, full-path tooltip)
  and refresh live on every edit. (`inputHandlers.ts`, `ui/attachments.ts`, `theme.ts`, css)
- **Live bash/command cards were stuck "RUNNING".** The card now sets `data-block-id` so the
  streaming layer can find it, and a dedicated `applyLiveCommandCardUpdate` updates its own
  structure in place (command text, output, status, footer). (`liveCommandCard.ts`,
  `streamHandlers.ts`)
- **Responsive tool cards.** Breakpoints now target the real classes (`.tool-call`,
  `.live-command-card`, …) instead of dead `.tool-card` selectors; command wraps on narrow
  consoles. (`css/messages-responsive.css`, `css/blocks.css`)
- **Sidebar panels.** Panel pin buttons use a pin icon (filled when pinned) instead of a
  star; Todos & Files spacing fixed (collapsed empty status container, first-line alignment);
  leading section icons added. (`index.html`, `css/components.css`, `css/layout.css`)
- **Verification:** tsc clean; mjs unit suite 1196 pass / 0 fail; all touched tsx suites green
  (incl. new tests for the mention parser and live-command-card updater).

## Highlights v0.4.8 (2026-06-20) — MCP command palette + session-title fixes + test-suite repair

- **MCP commands now appear under the MCP filter in the commands palette.**
  `SessionClient.listCommands()` hard-coded `source: "server"` for every entry,
  discarding the server's real `source` (`"command" | "mcp" | "skill"`), so
  MCP-provided commands — though executable — never matched the **MCP** chip in
  the commands modal. It also read `.data` off a response the SDK types as a bare
  `Array<Command>` (yielding `undefined` → an empty list). The method now
  preserves the reported source and accepts both the bare-array and legacy
  `{ location, data }` shapes. (`src/session/SessionClient.ts`)
- **Command-created sessions are no longer all titled "Tab session-".** Webview
  tab IDs are `session-<id>` and `"session-"` is exactly 8 characters, so
  `Tab ${sessionId.slice(0, 8)}` always produced the identical, useless title
  "Tab session-". `CommandExecutionService` now mirrors the normal send path:
  use the tab's own name, otherwise defer to the server's auto-title.
  (`src/chat/CommandExecutionService.ts`)
- **Test suite restored to fully green.** Repaired 16 pre-existing failures
  across 9 files — all brittle source-inspection / behavioural assertions left
  pointing at code that moved or changed shape in prior refactors (the
  `StartPromptConfig` object, `setupTerminalPanel`/`MarkdownWorkerClient`
  extraction, exec→live-command-card rendering, changed-files floating-modal →
  inline-panel). No source changes in that pass; behaviour was verified intact.
- **Verification**: `npm run lint` (tsc) clean; full unit suite green —
  **tsx 4237 pass / 0 fail, mjs 1004 pass / 0 fail**. New behavioural tests for
  both fixes (`tests/unit/session-client-list-commands.test.mjs`,
  `tests/unit/command-exec-session-title.test.mjs`).

## Highlights v0.4.7 (2026-06-20) — IDE warning cleanup + small-webview overflow

- **Cleared remaining IDE warnings** across the chat send-flow, webview renderers,
  and host wiring. Removed unused imports/destructured deps in `ChatProvider.ts`,
  `SessionManager.ts`, `StreamCoordinator.ts`, `composer.ts`, `sendLogic.ts`,
  `sendButton.ts`, `renderer.ts`, and `toolCallRenderer.ts`. Replaced `require()`
  style imports in `ChatProvider.ts` and `WebviewEventRouter.ts` with top-level ESM
  imports of `execSync`.
- **Tightened `any` types** in `composer.ts`, `sendLogic.ts`, `sendMessage.ts`,
  `streamHandlers.ts`, `renderer.ts`, and `toolCallRenderer.ts` with `unknown` /
  narrow structural types.
- **Fixed conversation-history search overflow** on the welcome screen
  (`welcome.css`) and added responsive breakpoints for the composer at `<=320px`
  / `<=280px` in `layout.css` so the send area remains usable in very narrow
  webviews.
- **Verification**: `npm run lint` (tsc) and `npx eslint` on the touched files
  are now clean; relevant webview/host tests pass.

## Highlights v0.4.4 (2026-06-20) — checkpoint restore-point rail

- **Snapshot-bearing parts are now surfaced as a "restore to here" rail** in the
  checkpoint panel. The pure collector in `src/checkpoint/restorePoints.ts` is no
  longer unused: `list_restore_points` derives `RestorePointView[]` from the
  local session messages, and clicking **Restore** calls `session.revert` with the
  exact `messageID` and optional `partID` for that snapshot.
- **Host-side wiring**: `SessionClient.revert(sessionId, messageID, partID?)`
  and `SessionManager.revert` expose the per-part revert coordinate; the
  WebviewEventRouter handles `list_restore_points` and `restore_point`.
- **Webview-side wiring**: `renderRestorePoints` in `fileTracking.ts` renders the
  rail inside the existing checkpoint panel; `buttonSetup.ts` requests restore
  points when the panel opens; `main.ts` receives `restore_points` and
  `restore_point_result` messages. Styling lives in `layout.css`.
- **Message contract documented** in `docs/webview-messages.md` under
  "Restore Points (audit §14.5)".
- **Tests**: `src/chat/webview/ui/restorePoints.test.ts` and
  `src/chat/WebviewEventRouter.restorePoints.test.ts`.

## Highlights v0.3.76 (2026-06-16) — marketplace icon redesign
**Version:** v0.3.76 (includes: opencode CLI auto-install, native local voice input, frontend overhaul, stream/dedicated-bar redesign)
**Audit:** `docs/adrs/2026-05-04-feature-parity-audit.md`
**TechSpec:** `docs/TechSpec.md`

## Highlights v0.3.76 (2026-06-16) — marketplace icon redesign (detail)

- **`media/opencode-icon-256.png` (the icon shown in the VS Code Marketplace
  and Extensions view, per `package.json`'s `icon` field) replaced** — the
  previous asset was a flat black square with a plain white rectangular
  cutout and no depth, which read as visually "too simple" next to other
  marketplace listings.
- New design keeps the **exact existing brand silhouette** (the
  frame-with-rectangular-cutout mark, officially commented as "OpenCode
  mark: single geometric O" in `media/opencode.svg`, also used by
  `media/opencode-activity.svg` and the in-product header logo in
  `src/chat/webview/index.html`) — elevated, not replaced.
- **Palette corrected to match the project's actual established brand
  assets**: `media/opencode-logo.svg` and `media/opencode-wordmark-dark.svg`
  use a neutral warm-charcoal/off-white palette (`#4B4646`/`#B7B1B1`/
  `#F1ECEC`), not blue. The new icon uses a deepened version of that same
  neutral family (a warm charcoal gradient badge with an off-white frame
  mark) instead of introducing an unrelated brand color.
- Added depth via a subtle corner sheen (radial highlight), a recessed
  "well" gradient inside the cutout, and a soft inset shadow/highlight pair
  at the cutout's top edge — flat, single-tone shapes elevated to a
  premium-feeling badge without adding new hues or animation.
- **Background is fully opaque and bakes in its own dark-charcoal backdrop**
  (not transparent), so the icon renders identically regardless of whether
  the surrounding VS Code/Marketplace chrome is in light or dark mode.
  Verified by compositing the rendered PNG over white, dark (`#1e1e1e`), and
  light-gray backdrops — confirmed legible and theme-agnostic in all three.
- Verified legible down to 32px (smallest realistic Extensions-list
  thumbnail size) via nearest-neighbor upscale inspection — the frame
  silhouette remains clearly readable.
- Added `media/opencode-icon.svg` as the editable vector source (the repo's
  existing convention for brand PNGs, e.g. `opencode-logo.svg` alongside its
  PNG exports) so the icon can be regenerated at any resolution in future.
- Out of scope (not touched): `media/opencode-icon-96.png` and
  `media/opencode-apple-touch-icon.png` carry the same dated flat style but
  are currently unreferenced anywhere in the codebase — the user's request
  was specifically about the marketplace/extension-store icon.

## Highlights v0.3.76 (2026-06-16) — streaming UI visual redesign

- **Streaming indicators upgraded from functional to polished**, reusing
  existing design tokens (`--oc-accent-glow`, `--oc-accent-border`) and the
  codebase's established box-shadow "ping ring" idiom (precedent:
  `subagent-highlight-pulse` in `blocks.css`, `message-flash` in
  `messages.css`) rather than inventing new colors or DOM nodes:
  - The assistant role dot and timeline-item dot (`pulse-active` keyframe,
    shared by both) now scale and emit an expanding glow ring instead of a
    flat opacity blink.
  - The streaming message bubble gets an ambient accent-colored box-shadow
    that breathes alongside its existing border-left color shift
    (`bubble-stream-pulse`).
  - Typing-indicator dots (`typing-bounce`) now scale and fade in addition
    to translating, and carry a static glow.
  - The stream cursor and `.streaming-text::after` caret switched from a
    hard `step-end` blink to an `ease-in-out` fade (mirrors VS Code's own
    native caret) and gained a small glow.
  - The previously dead-on-arrival `streaming-pulse` keyframe in
    `animations.css` (used by the tab-bar streaming indicator) had a no-op
    `transform: scale(1)` at both keyframe stops; it now actually scales
    and emits a glow ring.
  - All new `box-shadow`/`transform` properties are covered by existing
    `prefers-reduced-motion` and `forced-colors: active` rules (extended,
    not replaced) so the upgrade degrades safely in both modes.
  - Deliberately **not** touched: `question-bar.css` (interactive control
    surface — kept restrained so motion doesn't compete with clickable
    affordances) and the existing SVG-based premium spinner (already a
    separate, polished system).
  - Verified rendered correctly in a real browser (Playwright +
    `bypassCSP: true`, since the webview's strict CSP otherwise blocks the
    bundled stylesheet outside the extension host) — no regressions, no
    visual breakage.

## Highlights v0.3.76 (2026-06-16) — keyboard-shortcuts modal header fix

- **Keyboard-shortcuts modal header no longer collides with the table's
  sticky column headers.** `.keyboard-shortcuts-content` put `overflow-y:
  auto` directly on the container holding *both* the modal header (title +
  close button) and the shortcuts table, so the header scrolled away with
  the rest of the content. Meanwhile `.keyboard-shortcuts-table thead th`
  is `position: sticky; top: 0`, which sticks relative to the nearest
  scrolling ancestor — the same container — so the column-header row ended
  up sticking right where the modal header had just scrolled out from
  under it, visually overlapping the title and close button. Every other
  modal in this codebase (session history, API key) avoids this by giving
  the header a non-scrolling `.modal-body` sibling; the keyboard-shortcuts
  modal was the one outlier missing that wrapper. Fix:
  `setupKeyboardShortcutsModal` now wraps the table in a `.modal-body` div
  (reusing the existing `flex: 1; overflow-y: auto` rule already used by
  every other modal), and `.keyboard-shortcuts-content` no longer sets its
  own `overflow-y`. New regression coverage in
  `keyboardShortcutsModal.test.ts` asserts the header is not inside the
  scrolling body. Audited every other `position: sticky` usage in the
  webview CSS (sticky search box, sticky bottom composer, sticky diff
  action bar, sticky changed-files summary bar) — none share this bug,
  since each is the sole sticky element in its own scroll container.

## Highlights v0.3.76 (2026-06-16) — multi-tab session-attribution fixes

- **Question bar no longer bleeds across tabs.** Questions arriving via the
  live-stream tool-start path (`streamHandlers.ts` → `onQuestionBlock`) always
  carried an empty `block.sessionId`, because `handleStreamStart` creates the
  streaming `ChatMessage` with no `sessionId` field. `main.ts` called
  `questionBar.addQuestion(block, messageId)` with no third `sid` argument, so
  `addQuestion`'s fallback chain landed on `_activeSessionId` — whichever tab
  the user currently had open — silently misattributing a background tab's
  question to the viewed tab. The same gap existed in
  `questionBar.repopulateFromMessages`, called on tab switch *before*
  `setActiveSession(tabId)` runs for the new tab. Fix: thread the
  already-in-scope tab/session id through both call sites as `addQuestion`'s
  third argument. New regression coverage in `questionBar.session.test.ts`
  and `toolLifecycle.test.ts`.
- **Tab switching no longer snaps back to a stale tab.** `switch_tab` called
  `sessionStore.setActive` unconditionally, which always broadcasts
  `active_session_changed` back to the webview — but the webview already
  applies the switch locally before sending `switch_tab`, so this was a pure
  echo. Under rapid tab switching, a stale echo for an earlier switch could
  arrive after the user had already moved to a third tab, forcing a visible
  snap back to the superseded tab. `SessionStore.setActive` now takes a
  `{ silent: true }` option; the `switch_tab` handler in
  `WebviewEventRouter` uses it so the echo never fires. New regression
  coverage in `SessionStore.test.ts` and `WebviewEventRouter.test.ts`.
- **Permission bar no longer bleeds across tabs.** `permission_request`
  rendered the shared `#permission-bar` for whatever `sid` the host sent,
  with no check against the tab the user was actually viewing — a permission
  raised by a background tab's tool call popped up over the focused tab, and
  clicking Allow/Always/Deny resolved the *background* tab's permission while
  appearing to belong to the viewed one. A second request arriving from
  another tab would also silently overwrite the first tab's still-pending
  one, so switching back showed no bar at all and that tab's stream stayed
  stuck. Fix: a new `pendingPermissionBySession` map tracks one pending
  request per session; `permission_request` records into it unconditionally
  but only renders when the request's session matches the active one;
  `switchTab` restores the switched-to tab's pending request (if any) or
  hides the bar otherwise — mirroring the same per-session pattern already
  used to fix the question bar above. New regression coverage in
  `main.test.ts`; existing `renderer.test.ts` coverage updated to match the
  new shared `respond()` helper.

## Highlights v0.3.63 (2026-06-12) — navigation, wayfinding & Escape safety

Full audit + prioritized plan: `docs/specs/2026-06-12-navigation-audit-and-plan.md`. Architecture: `docs/adrs/ADR-015-navigation-escape-coordinator.md`.

- **Escape never aborts a running task by accident.** A central Escape
  coordinator (`escapeCoordinator.ts`) closes exactly the topmost open overlay
  per press (capture-phase, event consumed) and stops the active stream *only*
  when nothing is open. Replaces 12+ uncoordinated overlay handlers racing the
  destructive host-level `escape → stop` keybinding (now removed;
  `Ctrl+Shift+Escape` remains the always-on stop). Defers to combobox popups,
  unmanaged `aria-modal` dialogs, and text fields. Removed the `F1` hijack
  inside the chat view.
- **"Jump to Running Session" (`opencode-harness.jumpToRunningTask`).** One
  action to reach whatever the agent is doing: 0 running → pointer back to chat,
  1 → jump, several → streaming-first Quick Pick. The connection status-bar item
  shows `$(sync~spin) OpenCode: N running` while any tab streams and clicking it
  jumps there.
- **`OpenCode: View Sessions` is a real switcher again.** Picking a session now
  reveals the chat view and opens it as a tab (was a `setActive` + toast dead
  end). Items gain active/streaming codicons, streaming-first + MRU ordering,
  message count and relative recency. `openStoredSession` (argument-only) hidden
  from the palette.
- **Focus restoration (WCAG 2.4.3).** Keyboard-shortcuts modal now traps Tab and
  returns focus to its invoker; subagent detail Back/Close return focus to the
  originating card.
- **Tests.** `escapeCoordinator.test.ts` (14), `sessionQuickPick.test.ts` (10),
  `keyboardShortcutsModal.dom.test.ts` (4), status-bar tooltip + integration
  command coverage — RED→GREEN committed in sequence.

## Highlights v0.3.63 (2026-06-11) — slash/methodology/skills hardening

Plan + verified gap analysis: `.opencode/plans/2026-06-11-methodology-skills-slash-overhaul.md`. User/dev docs: `docs/slash-commands-and-methodology.md`.

- **Slash registry consolidation.** `LOCAL_SLASH_COMMANDS` gains `aliases`/`usage`/`category`; `/export-md` folded into `/export` as an alias; `/diagnose:generation` now discoverable in the dropdown/palette; `/help` table generated from the registry (`buildHelpTable()`) so it can never drift again; `mentions.ts` uses the shared, alias-aware `dedupServerCommands()`; mention trigger charset accepts `-`/`:`.
- **Slash-during-streaming guard.** `classifyComposerInput()` is the single composer routing decision; command-shaped input typed mid-stream is blocked with a clear error (input preserved) instead of being steer-leaked to the model as literal text.
- **Methodology guidance is now visible and overridable.** `StreamCoordinator` posts `methodology_selected` (was documented but never sent); the webview shows a session-scoped `◆ <label>` chip in the status strip; the VS Code status-bar lightbulb renders the *same* advice that was injected (removed the second, independent classification pass); new `/methodology [on|off]` toggles the now-typed `TabState.methodologyDisabled` (previously an unreachable unsafe-cast read).
- **Honesty cleanups.** Skills-modal toggle copy states it controls *suggestion* only (the opencode server loads skills on its own); removed 8 dead `opencode.methodology.*` settings that configured the never-executing cascade pipeline (only `enabled` remains).
- **Tests.** Registry/alias/help-table/classifier behavioral tests, structural guards for the single-classification-pass and typed opt-out invariants (RED→GREEN committed in sequence).

## Highlights v0.3.31 (2026-06-10) — multi-area bugfix & feature release

- **Subagents no longer stuck "Running".** Run finalize (`markRunComplete`/`markRunCancelled`) now terminalizes all active subagents with the run outcome; SDK `subtask` parts no longer mislabel the parent session as `childSessionId`; webview `restore()` terminalizes stale persisted `subagentActivities` on reload. See addendum in `docs/adrs/2026-06-06-subagent-as-first-class-entity.md`.
- **Subagent "Open session" navigation.** Cards and the detail view expose a one-click "Open session" button (when a child `sessionId` is known) → new `open_subagent_session` message imports the server child session and resumes it as a regular tab.
- **Question bar session isolation hardened.** `submitAllAnswers`, bar visibility, the count badge, submit-enable state and auto-dismiss are all scoped to the active session (another tab's selections can no longer be posted or wiped). `removeQuestion` resolves requestID-only acknowledgements; `updateQuestion` preserves `requestID` when a refreshed block omits it.
- **Token/cost accounting: host is source of truth.** `step_tokens`/final `token_usage` carry cumulative host totals; the webview SETs (`applyTokenUsageTotals`) instead of accumulating a parallel ledger — idempotent under SSE replay, consistent across tab switch/reopen. ADR: `docs/adrs/2026-06-10-token-accounting-host-source-of-truth.md`.
- **Commands tab copy actions fixed.** `navigator.clipboard` is absent in webviews (the old `?.`-chained call threw a TypeError); Copy/Copy-output now round-trip via the new validated `copy_text` message → `vscode.env.clipboard.writeText` + status-bar confirmation. Terminal/Re-run verified end-to-end.
- **Voice setup works on PEP 668 distros (Arch/CachyOS, Debian 12+, Fedora 38+).** Engine install priority: `uv tool install openai-whisper` > `pipx install openai-whisper` > pip (only on non-externally-managed Python) > **runnable uv bootstrap** (system package manager or official installer, then `uv tool install`) > manual hint. The bootstrap tier means "Run Setup" is now offered even before uv/pipx exist — previously the flow dead-ended on "Copy Instructions" on CachyOS. `uv pip install --system` removed (fails under PEP 668). ChatProvider probes `uv`/`pipx` and the stdlib `EXTERNALLY-MANAGED` marker. `commandExists`/spawn fall back to `~/.local/bin` where uv/pipx place `whisper`.
- **Conversation timeline + lazy history.** `more_messages` pages are now inserted into `session.messages` (deduped) and the timeline refreshes immediately; clicking a turn outside the loaded window expands condensed history or chases up to 3 `request_more_messages` pages and scrolls on arrival (`pendingTimelineScroll`); unloaded turns are dimmed (`timeline-item--unloaded`); the toggle gains a header-toolbar twin synced with the settings-menu entry and Ctrl+Alt+T.
- **Changed-files strip/dropdown.** Welcome-screen leak fixed (`refreshChangedFilesVisibility()` re-applies the guard on welcome show/hide). Strip redesigned as a contained widget surface with aggregate `+X −Y` totals (tabular-nums). Dropdown A/M/D badges, per-file stats and hunk lines themed via `--vscode-gitDecoration-*`/diff-editor tokens; stat columns fixed-width right-aligned; summary bar sticky.

## v0.3.29 Highlights (2026-06-09)

- **Streaming clarity & bug fixes.** `maxStreams` now included in capacity state (fixes "X/undefined" tab label). Tool group badges refresh on child state change so "Running" header doesn't persist after all children are "Done". State vocabulary aligned via new `isTerminalState()` in `toolState.ts`. `resetStreamState` clears `isStreaming`. `handleRunActivityUpdate` requires `streamingMessageId` before setting streaming. Duplicate `max-height` removed from tool group panels.
- **Question bar wired up.** The `questionBar.ts` module (HTML, CSS, and logic existed since `ebc0f0e`) is now integrated into the production webview. Questions from the model appear as interactive cards above the composer with option buttons, free-text inputs, multi-select support, submit/skip actions, and per-tab state isolation. `setActiveSession(tabId)` loaded on tab switch; `repopulateFromMessages()` restores pending questions after webview reload.
- **Terminal command display.** CSS for stdout/stderr split layout, exit-code badges (`-ok`/`-error`), scroll-bound terminal output, and overflow protection on tool headers. (`tool-command-output`, `tool-exit-code`, `tool-name`/`tool-header` overflow.)
- **Streaming-vs-done visual differentiation.** Assistant bubble left-border pulse animation during streaming. Running/pending tool calls get an animated accent left-border; completed tools get a static success border. Pulsing dot in the assistant message header during streaming. Composer background tints subtly. Respects `prefers-reduced-motion: reduce`.
- **Model/variant selector overflow.** `.model-selector-btn` capped at `14rem` and `.variant-selector-btn` at `10rem` with `text-overflow: ellipsis`.

## Highlights v0.3.27 (2026-06-09) — stream interruption + UI relocation

- **Stream interruption fixed + permission/question/rate-limit UI relocated** (2026-06-09):
  - **Stream no longer stops on permission/question/rate-limit.** `StreamCoordinator` now tracks `question` tool calls separately from regular tool calls — only removed from `activeToolCallIds` when `answered === true`. New `markQuestionAnswered()` method called from both `WebviewEventRouter` paths. `rate_limit_exhausted` during active stream shows bar only, no inline error card.
  - **Dedicated UI bars.** Interactive controls for questions, permissions, and rate-limits moved from the message stream to `#question-bar` (above input), `#permission-bar` (above input), and `#rate-limit-bar` (below input). Stream shows compact read-only pointers with hints.
  - **Permission requests ephemeral** — no longer persisted in the session transcript.
  - **Permission bar message type fix** — webview sent `permission_response` but host expected `accept_permission`, causing "Unknown webview message type" errors and stream timeouts.
  - **Subagent panel reliability overhaul** — five bugs fixed: (1) panel no longer auto-opens on every activity update, only when a new subagent ID appears; (2) completed subagents no longer stuck showing "Running" — root cause was `normalizeSubagentStatus` mapping unknown → pending/running in three places (webview, RunActivityTracker, ChatProvider), now all map to "unknown" (non-live); (3) detail view no longer overlaps other tab panes — moved inside `#subagent-panel` as a nested pane with `data-view` switching; (4) "Open in editor" button was a no-op placeholder — now creates a dedicated VS Code WebviewPanel in popout mode via `window.__OC_POPOUT__` and renders the subagent detail in a separate editor tab; (5) `activeSubagentCount` no longer counts `"unknown"` as active, preventing run finalization stalls.
  - **System messages redesigned** — orange gradient/emoji/shadow removed; replaced with subtle transparent container and thin left border accent.
  - Shared `.oc-card` model (`css/cards.css`) with severity modifiers (info/success/warning/error/critical/permission); `ErrorDisplay` rewritten class-based with theme SVG icons, collapsed-by-default technical details + Copy, and an in-place Details toggle. `.msg-error` compacted. See `docs/design/cards.md`.
  - Root-cause dedup: activity notices coalesce via `activitySignature`/`decideActivityCoalesce` + `SessionStore.appendOrCoalesceActivity` (`×N` repeat badge); a single generation failure now renders one card (`hasRecentErrorCard` suppresses the generic end-of-stream card; the raw error is no longer echoed in the bottom status).
  - Session-history "More actions" (⋯) menu fixed (new `--z-modal-menu` token so the body-portaled menu stacks above the modal). Context-usage bar can no longer appear on the welcome screen (`isWelcomeVisible` guard in `updateContextBarFromSession`).
  - Tests: `activityCoalesce` (11), `streamEndErrorPolicy` (7), `errorComponents.dom` (8), welcome-guard + modal z-index regressions.

- **Frontend overhaul — tool UX, JSON viewer, web search, error display, a11y** (2026-06-08):
  - **Tool group summary labels** — `buildGroupSummaryLabel()` in `groupSummary.ts` replaces raw class counts with human-readable text: "3 file reads, 1 command, 2 edits" in the collapsed tool group header.
  - **JSON viewer** — `jsonViewer.ts` renders object/array tool args as a collapsible DOM tree (up to 3 levels, Copy JSON button). A 10 KB size guard falls back to truncated plain text for large payloads, preventing DOM bloat on large file-write `content` args.
  - **Web search result cards** — `webSearchRenderer.ts` detects websearch/webfetch/fetch/brave_search/tavily/serper tools and renders structured JSON result arrays as domain+title+snippet cards. Unrecognized formats fall back to plain text (max 2000 chars).
  - **Write-class file action buttons** — "Open", "Copy path", and "Reveal in Explorer" appear inline on write/edit tool summaries. "Reveal in Explorer" wires through a new `reveal_in_explorer` webview message (added to `WebviewMessage` union, validated in `WebviewMessageValidator`, handled in `WebviewEventRouter`).
  - **Error display overhaul** — `handleStreamError` parses JSON error payloads through `mapOpencodeError()` before falling back to raw string. `renderErrorBlock` uses `humanizeErrorCode()` for codes like `QUOTA_EXCEEDED` → "Quota exceeded". Both Retry and Dismiss are always shown.
  - **Thinking block sub-type badges** — `classifyThinkingContent()` heuristic emits "Planning", "Tool selection", or "Reasoning" chip next to the Thinking label.
  - **Subagent keyboard navigation + aggregate stats** — `applyRovingTabindex()` wires ArrowUp/Down/Home/End keyboard nav across subagent cards. `renderAggregateStats()` inserts a `role="status"` stats bar: "3 subagents · 1 running · 2 done · 1m 23s". List has `role="listbox"`, items have `role="option"`.
  - **Semantic status CSS tokens** — `tokens.css` gains `--oc-status-running/success/error/warning/pending/cancelled` and `--oc-surface-elevated`.
  - **Responsive CSS fixes** — `.tool-arg { max-width: min(200px, 40%) }`; diff tables get `overflow-x: auto`; `.tool-file-actions` hides at ≤399px.
  - **New tests** — `jsonViewer.test.ts` (11 tests), `webSearchRenderer.test.ts` (14 tests); `toolGrouping.test.ts` updated for human-readable labels.

- **Native, fully local voice input** — the composer mic now records and transcribes **in the panel, on your machine** — no browser tab, no cloud, no API key (supersedes the ADR-012 browser-helper + OpenAI design). Because a VS Code webview can't access the mic (sandboxed iframe; `SpeechRecognition` is dead in Electron), the host records the default mic with an auto-detected tool (`rec`/sox → `arecord` → `ffmpeg`) and transcribes with a local engine (openai-whisper, or whisper.cpp with a model), both overridable via machine-scoped `opencode.voice.localCommand`/`recordCommand`. Lifecycle states (idle → starting → recording → transcribing → inserted/error), Escape/second-click to stop/cancel, append/replace insert, opt-in `autoSend`, and a graceful "not available" fallback. Capture sits behind injected `Recorder`/`Transcriber` interfaces so the flow is unit-tested with mocks. New settings `opencode.voice.*` (replacing `opencode.voiceInput.*`); removed the OpenAI key command, SecretStorage key, localhost helper server, and `media/voice-helper.html`. See ADR `docs/adrs/ADR-013-native-local-voice-input.md`, `docs/voice-input.md`. (`src/chat/voiceInputCore.ts`, `src/chat/voiceCapture.ts`, `src/chat/VoiceInputService.ts`, `src/chat/webview/voiceInput.ts`)
- **Automatic opencode CLI install** — the CLI is a hard requirement, but VS Code has no install-time hook, so the extension now detects a missing binary on activation and installs it. Default is **prompt-once** (Install / Manual Instructions / Not Now), with the choice remembered to avoid nagging; `opencode.autoInstall` (`prompt`|`auto`|`off`) controls it, and `OpenCode: Install CLI` triggers it on demand. macOS/Linux use the official installer (downloaded → validated → `bash <file>` with `shell:false`, no `curl | bash`; lands in `~/.opencode/bin`); Windows uses npm. See ADR `docs/adrs/2026-05-31-cli-auto-install.md`. (`src/install/`, `src/extension.ts`, `src/commands/misc.ts`)
- **Binary detection probes known install dirs** — `ServerLifecycle.findOpencodeBinary()` falls back from PATH to `~/.opencode/bin/opencode` and other common locations, fixing "installed but not detected" for GUI-launched editors whose PATH doesn't include the installer's directory. (`src/session/ServerLifecycle.ts`, `src/install/installPlan.ts`)

## v0.2.20 Highlights

- **Rate-limit/error-handler hardening** — four Critical-severity bugs closed in `errorHandler.ts` (jitter compounding, weak correlation IDs, repeated `acquireVsCodeApi`, mapper whitelist bypass); NaN-propagation eliminated in `RateLimitMonitor.ts` via `safeParseInt`; sliding-window data loss removed; division-by-zero in `quotaMonitor.ts` now returns `undefined` instead of 100%/`NaN`.
- **Pure-function extraction** — `rateLimitCore.ts` now hosts `safeParseInt`, `parseDuration`, all three rate-limit adapters, and their interfaces, separate from the `vscode`-dependent `RateLimitMonitor` class. Zero-impact on callers via re-exports.
- **Test coverage** — 43 new tests across `RateLimitMonitor.test.ts` (17 tests: helpers + adapters + NaN rejection) and `errorHandler.test.ts` (24 tests: classification, retry, jitter, correlation IDs, history, stats, config).
- **Plan / Build / Auto reliability** — user prompts no longer render as `PROPOSED PLAN`; Plan-mode prose styling is assistant-only. Mode changes are host-acknowledged before the dropdown updates, invalid modes are rejected, Auto warning persistence writes `opencode.autoModeConfirmed`, and the selector exposes tooltips plus `Ctrl/Cmd+Alt+1/2/3` shortcuts.
- **Plan-mode permission guard** — only direct edits/writes to `.opencode/plans/*.md` are allowed in Plan mode. Shell and external-directory permission requests remain rejected even if their pattern mentions a plan file.
- **Changed-Files panel no longer freezes during streaming** — rapid `changed_files_update` events are coalesced into one `requestAnimationFrame` render (was a full `innerHTML` tree rebuild per event); expand/collapse mutates only the affected row; the strip skips unchanged rebuilds; resize is rAF-throttled; previews build via `DocumentFragment`. Review finding: the inline diff accept/reject/apply pipeline is currently unreachable dead code (opencode applies edits server-side) — documented in CHANGELOG, left unwired pending a wire-or-remove decision. (`src/chat/webview/changed-files-dropdown.ts`)
- **"Question from model" block fixed** — model questions now render their text + all answer options and are interactive immediately (mid-stream), not just after `stream_end`. Args are normalized defensively (flat `{question,options}` and Claude-style nested `{questions:[…]}`) by the pure `parseQuestionArgs`; the block refreshes in place as input streams in, is persisted as a real `question` block, and supports multiple question groups + multi-select. Covered by `questionModel.test.ts`, `question-block.test.ts`, and `question-refresh.test.ts`. (`src/chat/webview/questionModel.ts`, `renderer.ts`, `streamHandlers.ts`, `streamEndHandler.ts`, `src/chat/handlers/StreamCoordinator.ts`, `src/session/sdkMessageConverter.ts`)

## v0.2.18 Highlights

- **Frontend streaming correctness** — duplicate persisted assistant messages eliminated (upsert-by-id); `stream_start` is now restartable for a new message id; inter-tool streamed text is no longer dropped at tool boundaries; placeholder removal no longer nukes tool-only turns.
- **Stable-tail streaming render (perf)** — the webview previously re-parsed the entire accumulated buffer on every flush (O(N·k), main thread, cache- and worker-bypassed). A new `LiveTextRenderer` freezes closed markdown blocks (rendered once, cache/worker-eligible) and re-parses only the unstable tail — near-linear, with text selection and `<details>` state surviving mid-stream. See ADR `docs/adrs/2026-05-29-stable-tail-streaming-render.md`.
- **Backfill dedup** — a single `hydrate()` path coalesces concurrent history fetches by `cliSessionId` (no double-fetch across tab-created + session-recovery paths); all pending sessions are processed instead of a fixed `slice(0, 10)`.
- **Branch consolidation** — merged `fix/commands-palette-routing`; resolved leftover merge-conflict markers committed by an earlier botched `show-thinking` merge (ModelManager / main.ts / toolGrouping); fixed a stale renderer streaming-markdown test.
- **Holds:** the syntect→WASM syntax highlighter remains scaffolded-but-inert (activates only when a Rust-enabled CI builds the `.wasm`).

## v0.2.15 Highlights

- **Context window resolves for models the server doesn't report `limit.context` for** — kimi-k2.5, deepseek-v4-flash-free, and most OSS/free-tier models silently lost their context bar in 0.2.13 because the override config was only consulted inside an `if (ctxWindow)` guard. The override now applies regardless, and `onDidChangeConfiguration` re-applies it live without an extension reload.
- **OpenRouter cross-provider fallback** — when our server returns no `limit.context`, the resolver consults a cached catalogue pulled from `https://openrouter.ai/api/v1/models`. Same model weights share the same window regardless of which provider hosts them, so kimi-k2.5 served by any host now resolves to OpenRouter's canonical entry. Catalogue is persisted to `globalState` with a 24h TTL and refreshed in the background; no hand-curated tables.
- **Clickable "set limit ⚙" affordance** — when both the server and OpenRouter come up empty, clicking the per-tab context monitor opens the `Set Context Window Override` dialog directly instead of showing a tooltip.

## v0.2.14 Highlights

- **Tool calls actually group into one row now** — the 0.2.12 CSS work shrank each tool row but consecutive tool calls still stacked one-per-line because (a) `groupConsecutiveToolCalls` treated every non-tool block (including silent SDK lifecycle blocks) as a group-breaker, and (b) the live-streaming append path bypassed the grouper entirely. The grouper now treats `step-start` and normal `step-finish` as transparent, and a new `appendOrFoldToolDOM` helper folds new tools into the prior `details.tool-group` (or wraps the prior single tool + new tool into a fresh group) at append time. The previous tool's live DOM is moved into the group rather than re-rendered, preserving runtime state (args/result/duration) that the update handlers write directly without going through msg.blocks.

## v0.2.13 Highlights

- **Removed the redundant "Step finished (tool-calls) — in:N out:N reasoning:N" chip rendered after every assistant step** — the renderer's normal-completion short-circuit only matched OpenAI-style underscore reasons (`tool_calls`, `end_turn`), but the SDK in practice emits hyphenated variants (`tool-calls`, `end-turn`), so the chip leaked into every step. `renderStepFinishBlock` now normalizes hyphens to underscores before the set lookup. Genuine non-normal finishes (`length`, `content_filter`, abort, errors) still render the chip so the user sees *why* a step ended unusually.

## v0.2.12 Highlights

- **Show-thinking toggle actually hides thinking blocks now** — previously it only collapsed each `<details>`, leaving the summary chip in the layout. The toggle drives a `hide-thinking` body class and CSS removes `.thinking-block` outright (`display: none`). `setupThinkingToggle()` also applies the persisted pref at boot, so a user's prior choice takes effect on the first load instead of requiring a double-click.
- **Codex-style compact tool blocks** — `.tool-call` no longer renders as a bordered card. Only the left accent stripe survives (so tool class is still color-coded), and `.tool-header` is a single-line row at `min-height: var(--size-target-min)` (24 px) with `text-xs` font. Multi-tool turns stack as a tight one-line log instead of a wall of cards.

## v0.2.11 Highlights

- **First prompt from welcome now sends and renders** — fixed the real blank-tab root cause: prompt context-chip updates were passing attachment-only refs into `updateContextChips`, throwing before `send_prompt` was posted. The send flow now renders the optimistic user message, shows the typing indicator, and posts `send_prompt` with the selected model. A Playwright contract test covers the rendered welcome → send path.
- **Model selection reaches pending tabs** — `ensureLocalTab` now refreshes existing tab model/mode state before stream start, so model selections made on the welcome page are reflected in the first prompt.
- **Empty placeholder sessions are transient again** — empty `pendingServerLink` sessions are no longer persisted/restored or exempt from close cleanup; only server imports awaiting backfill (`needsBackfill`) stay exempt while empty.
- **Changed-files UI is active-session scoped** — changed-file updates now refresh chips/todos only for the active session and clear stale chips when switching tabs.
- **Welcome recent-session delete uses the router contract** — recent delete actions post `targetSessionId`, matching `WebviewEventRouter` validation.
- **Send button silently blocked after extension restart (root cause for "messaging fails completely")** — the webview's persisted `vscode.setState()` snapshot preserved `isStreaming: true` for any session whose stream had been orphaned by a prior dropped `message_complete`. On reload, those stale flags inflated `getStreamCapacityState()` to report 3+ active streams; `sendMessage()` then bailed at its `if (streamCapacity.isFull)` guard *before* posting `send_prompt`. The user typed, pressed Enter, and nothing happened — no log line either. Fixed in `src/chat/webview/state.ts`: `restore()` now clears `isStreaming` on every session because no stream can possibly be in progress across a webview reload.
- **Speculative CLI session creation on resume** — `SessionLifecycleService.handleResumeSession` previously called `ensureSession(undefined)` for any tab without a `cliSessionId`, creating a fresh empty server session just to immediately query its 0 messages. Fix: only re-attach when a `cliSessionId` already exists; pending tabs wait for the first prompt to create the session via `StreamCoordinator`.

## v0.2.10 Highlights

- **Fixed silent event drop on first-message session create** — `ChatProvider.handleServerEvent` no longer drops `file_edited`, `tool_*`, or `message_complete` events that arrive in the race window between `session.create` resolving and `setCliSessionId(...)` running. Events are now buffered (5 s TTL, 200/session cap) and replayed on `TabManager.onCliSessionIdRegistered`. See `docs/adrs/ADR-009-pending-event-buffer.md`. This transitively also resolves the "send button stays disabled after first prompt" symptom — the stuck `isStreaming` flag was a downstream effect of the dropped `message_complete` event.
- **Welcome-page search button works again** — the magnifying-glass icon has `pointer-events: none` in CSS, so a click on the glyph delivered the event with `target === wrapper`. The click handler now triggers on any wrapper-targeted click except clicks on the inner input. Queried searches also surface sessions whose backfill has not yet landed, so users can find an unbacked-filled CLI session by name.
- **Image paste hardened** — the paste handler walks `DataTransferItemList` first, then falls back to `DataTransfer.files` (some Linux desktop clipboards put images only there), and skips past same-MIME entries whose `getAsFile()` returned null instead of bailing on the first MIME match. `preventDefault()` only fires once an image actually attaches.
- **Bounded backfill diagnostics** — after the 4-attempt retry budget is exhausted, `needsBackfill` is cleared on the affected sessions so subsequent `sessions_recovered` events stop re-trying and stop logging "Empty response …" lines. Per-tab "not backfilled" diagnostics are suppressed on the steady-state path.

## Test Summary

| Metric | v0.2.6 | v0.2.7 | v0.2.8 | v0.2.10 | v0.2.11 | v0.2.12 | Delta |
|--------|--------|--------|--------|---------|---------|---------|-------|
| Tests | 894 | 1466 | 1466 | 1585 | 1604 | 1746 | +142 |
| Passing | 893 | 1465 | 1466 | 1578 | 1597 | 1739 | +142 |
| Failing | 0 | 1 | 0 | 0 | 0 | 0 | — |
| Skipped | 1 | 7 | 7 | 7 | 7 | 7 | — |
| Typecheck | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Build | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |

The single failing test in v0.2.7 (`main.test.ts › timeline jumps use exact message-list scroll positioning`) was a stale source-grep assertion left over from the extraction of `scrollToTurn`/`scrollMessageToTop` into `src/chat/webview/ui/scrollMarkers.ts`. The test now reads from `scrollMarkersSource` where the implementation actually lives.

## Feature Parity (CLI → Extension) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 1 | Theming | ✅ | forced-colors media query, CLI discovery bugfix, 6 presets (incl. high-contrast-dark/light auto-resolved); light-theme bubble fix; consolidated advanced modal with preset cards, CLI theme search, 6 collapsible sections, live preview swatch; `deriveExtendedTheme` for compact CLI palette schema; workspace-save fallback to Global |
| 2 | Compaction | ✅ | autoCompact (ask/auto/off), snooze with 5% rearm, compact banner |
| 3 | Model Selection | ✅ | Server fetch + globalState cache, provider grouping, per-tab persistence, favorites/recents |
| 4 | Session History | ✅ | Auto-title, rename validation, delete confirmation, Markdown export |
| 5 | Slash Commands | ✅ | Unified autocomplete, 10 local commands, runtime server command routing, custom prompts |
| 6 | Permission Modes | ✅ | 3-mode selector (Plan/Build/Auto), host-acknowledged mode changes, Plan permission policy, assistant-only proposed-plan styling, Auto mode warning persistence, tooltips + `Ctrl/Cmd+Alt+1/2/3` shortcuts |
| 7 | Rate Limits | ✅ | OpenAI/Anthropic/Generic adapters, webview quota bar, VS Code status bar, observed usage fallback, configurable provider limits |
| 8 | Checkpoints | ✅ | VS Code file snapshots for extension-managed diff accepts, 20-checkpoint cap, `WorkspaceEdit` restore; OpenCode server-managed edits revert through `session.revert(messageID)` |
| 9 | UI Reliability | ✅ | Guarded stream finalization, late chunk recovery, right-side conversation timeline, markdown normalization, adaptive RenderQueue, tool deduplication, webview heartbeat, event stream reconnection, "Retry from here", tool grouping + keyboard nav |

## New Features (Extension-Only) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 10 | Navigation Timeline | ✅ | Scroll-tracker sidebar with message bubbles and tool markers |
| 11 | Tool/Skill Persistence | ✅ | Persistent badges for skills and tool calls in message list |
| 12 | Inline CodeLens Actions | ✅ | `InlineActionProvider` — CodeLens (Explain, Refactor, Generate Tests) on functions/classes |
| 13 | Image / Multimodal | ✅ | Clipboard paste → base64, thumbnail renderer, lightbox overlay |
| 14 | Drag & Drop | ✅ | Drop zone with highlight, `@file:` mention insertion |
| 15 | Code Block Actions | ✅ | Copy, Insert at Cursor, Create New File buttons |
| 16 | Message Editing | ✅ | Edit button, input prefill, downstream message clearing |
| 17 | Search in Conversation | ✅ | Ctrl+F bar, highlighting, prev/next navigation, 200ms debounce |
| 18 | Notifications | ✅ | Turn-complete notification when webview unfocused |
| 19 | Prompt Files | ✅ | `.opencode/prompts/*.md`, variable substitution, file watcher |
| 20 | Design Hardening | ✅ | Premium `thinking-pulse` loader, fluid horizontal spacing, optimized tool alignment |
| 21 | Secure Context Attachments | ✅ | Explorer/editor context commands, styled input chips, sensitive-file warnings, prompt-injection checks, read-only context provider |
| 22 | Path-Aware Mentions | ✅ | Debounced file search with path-aware globs and expanded result limit |
| 23 | Unified Session Modal | ✅ | Single list merging local + server sessions, workspace badges, `resume_server_session`, `importOneServerSession` |
| 24 | Changed-Files Chip Bar | ✅ | Backend `SessionStore.addChangedFiles()` persists normalized paths; `changed_files_update` is canonical for chip bar + todos panel, with active-session scoped rendering and `file_edited` merged live |
| 25 | Token & Cost Display | ✅ | `StreamCoordinator.finalizeStream` forwards `AssistantMessage.cost` and `.tokens` to webview on every stream completion |
| 26 | Welcome Dashboard | ✅ | Workspace context row, model name, "Continue last session" + "New session" quick actions, recent sessions sorted by recency, 2×2 prompt-starter grid; host-created empty sessions now open a tab immediately |
| 27 | Header Consolidation | ✅ | Status strip below tab bar (model/tokens/cost); settings overflow menu (`#settings-menu`) with MCP + theme entries; 4-button header; `aria-pressed` on all toggles |
| 28 | CLI Session Sharing | ✅ | `OPENCODE_DATA_DIR`/`XDG_DATA_HOME` passed through env-var allowlist; `recoverSessions` no longer workspace-scoped |
| 29 | Theme Customizer + CLI Theme Parity | ✅ | Webview modal with color pickers + Preview button; 7 override fields incl. user message bg; `--bg-secondary`/`--bg-tertiary` removed from CSS_VAR_MAP to preserve `color-mix()` depth; `.vscode-light` body overrides fix light-theme bubble rendering |
| 30 | Empty Session Cleanup + Restore | ✅ | Empty unused sessions and local `pendingServerLink` placeholders are transient, pruned periodically, deleted on close, and open tabs restore per workspace when enabled; closed historical sessions are not revived on focus sync; server imports awaiting backfill remain exempt |
| 31 | Session Load Performance + Scroll Fixes | ✅ | `resume_session_data` truncated to last 50 msgs + `request_more_messages` pagination; chunked rAF rendering (`CHUNK_SIZE=20`); load-earlier banner; scroll-to-bottom after load; debounced scroll markers + timeline refresh; `content-visibility: auto; contain-intrinsic-size: auto 120px` on messages; `will-change: scroll-position` on message list |
| 32 | Back Button + Modal Focus Traps | ✅ | Back button in header when any modal is open; Tab/Shift+Tab focus cycling within all modals; return-focus-to-trigger on close |
| 33 | Settings Menu Keyboard Nav | ✅ | ArrowUp/Down, Home, End, Escape navigation |
| 34 | Theme Customizer Undo State | ✅ | Save/reset push theme state onto undo stack |
| 35 | Session Recovery Re-push | ✅ | `sessions_recovered` event triggers `pushInitStateToWebview`; process disconnects clear stale server state and emit `server_disconnected` before reconnect |
| 36 | Context Optimization Suggestions | ✅ | `ContextMonitor.generateOptimizationSuggestions()` exposed via webview; WebviewEventRouter now calls it on context_suggestions_request |
| 37 | Skills Performance Tracking UI | ✅ | `SkillInfo` extended with `performanceScore`, `usageCount`, `lastUsed`; skills modal displays metrics when available |
| 38 | Context Optimization UI Display | ⏳ | Backend exposed, pending webview panel integration to display suggestions to users |
| 39 | Skill Usage Recording Integration | ⏳ | ConfidenceScorer infrastructure exists, pending integration with actual skill invocation points (architectural work required) |
| 40 | Skills Modal Wiring Repair | ✅ | Fixed stale-closure on `skillsModalOpen` (`main.ts` passed `skillsModalApi?.open` before the API was constructed) by switching to a thunk so the lookup happens at click time; modal now opens reliably |
| 41 | Skill Preferences Persistence | ✅ | New `SkillPreferencesStore` (`globalState`-backed) persists per-skill enable/disable; `toggle_skill` writes through the store and re-emits `skills_list`; `resolveAllSkills` reflects user preference on every list |
| 42 | Methodology ↔ Skills Integration | ✅ | `MethodologyAdvisor` now accepts a `skillHinter`; `ChatProvider` wires `SkillTriggerEngine.getTriggeredSkills(text)` (filtered by enabled skills) into the addendum so the model receives a `Relevant skills: …` line on every classified prompt |
| 43 | Voice Input Browser Helper | ✅ | Mic button opens a tokenized localhost helper in the user's default browser via `asExternalUri`/`openExternal`; browser mode posts final Web Speech text, OpenAI mode posts audio to the host for SecretStorage-backed transcription |

## Deferred (P2 — High Effort / Niche)

| # | Feature | Reason |
|---|---------|--------|
| 18 | Workspace Indexing | Very High effort — needs persistent embedding index, server-side support |
| 38 | Context Optimization UI Display | Backend exposed via WebviewEventRouter, pending webview panel integration to display suggestions |
| 39 | Skill Usage Recording Integration | ConfidenceScorer infrastructure exists, requires architectural work to identify and integrate with actual skill invocation points |

## Architecture

22 components across 4 layers:

- **Extension Host**: ChatProvider, TabManager, SessionStore, SessionManager, StreamCoordinator, MessageRouter, DiffHandler, ChunkBatcher, ContextEngine, ContextMonitor (with optimization suggestions), ModelManager, RateLimitMonitor, CheckpointManager, ThemeManager, PromptManager, SessionExporter, InlineActionProvider, TerminalBridge, CliDiagnostics, DiffApplier, EventNormalizer
- **Webview**: State, Renderer, DOM, Tabs, Model Dropdown, Mentions, Stream, Scroll Anchor, Theme, Recent Sessions, Search, Slash Autocomplete, Skills Modal (with performance metrics display)
- **Communication**: @opencode-ai/sdk (REST + SSE over localhost)
- **Server**: opencode serve (HTTP, multi-session)
