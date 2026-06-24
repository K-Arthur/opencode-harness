# Frontend UX Audit & Redesign — OpenCode Harness

> Status: living document. Phase 0 deliverable of the frontend-only UX initiative.
> Scope: **webview frontend only** (`src/chat/webview/**`, `src/chat/ChatProvider.ts`,
> `src/chat/WebviewEventRouter.ts`). No backend/opencode-server behavior is changed here;
> backend limitations are catalogued in §14.

---

## 1. Executive summary

OpenCode Harness wraps the opencode AI agent in a VS Code webview. The webview is **not**
a thin chat box — it is a ~70-module, no-framework TypeScript/HTML/CSS application with a
mature streaming renderer (frozen/tail live text, markdown Web Worker, render-queue
coalescing), tool-call cards with a real lifecycle state machine, a changed-files/diff
dropdown (accept/reject/revert), an accessible custom tab bar, a question bar, a cost
approval modal, categorized error handling, and ~2000 passing tests.

The opportunity is therefore **not** a rewrite. It is to turn a strong transcript UI into
a **control surface**: a place where the objects an agent session produces — plans,
activity, commands, file changes, sessions — are first-class, inspectable, filterable, and
mutable. The audit identifies four concentrated gaps, sequenced as independent vertical
slices:

1. **Agent Activity Timeline** — there is no structured, filterable event feed. The
   existing `timeline.ts` is only a jump-to-turn minimap. *(Built first; see §10.)*
2. **Interactive Plan panel** — plans render display-only (`planCardRenderer.ts`).
3. **Commands/Tasks panel** — `exec` output appears only on completion; no cancel/retry.
4. **Session mutability** — rename is CLI-only; no pin/tag/archive UI or search; plus diff
   "open in VS Code diff" and hunk staging.

Research note that shapes everything below: the **VS Code Webview UI Toolkit was
deprecated 2025-01-01**, so this project's plain-HTML + native `--vscode-*` token approach
is the *currently recommended* path, not a liability ([sources in §3](#3-research-backed-ux-findings)).

---

## 2. Frontend architecture map

### 2.1 Data flow (server → screen)

```
opencode server ──SSE──▶ SessionManager.subscribe()                 src/session/SessionManager.ts
                          └▶ EventNormalizer → NormalizedOpencodeEvent[]  src/session/EventNormalizer.ts
ChatProvider.handleServerEvent → serverEventHandlers map            src/chat/ChatProvider.ts
   └▶ StreamCoordinator (per-tab accumulation, seq/ack, dedupe)     src/chat/handlers/StreamCoordinator.ts
        └▶ HostMessageBatcher → webview.postMessage(HostMessage)
WEBVIEW  window 'message' → WebviewEventRouter (90+ types)          src/chat/WebviewEventRouter.ts
   main.ts wires: state, stream orchestrator, renderer, panels      src/chat/webview/main.ts
   renderer.ts RENDERER_MAP dispatch (text/code/tool/diff/…)        src/chat/webview/renderer.ts
   CSS @layers tokens→base→layout→components→messages→blocks→…       src/chat/webview/css/*.css
Persistence  SessionStore → globalState "opencode-harness.sessions" (debounced, max 50)
Webview-local persistence  WebviewState via vscode.setState (state.ts; schema-versioned)
```

### 2.2 Entry points & rendering

- **HTML:** `src/chat/webview/WebviewContent.ts` builds the document (CSP nonce, theme
  style tag, resolves CSS `@import`s) from the static template `index.html`.
- **Runtime:** `src/chat/webview/main.ts` is the IIFE entry; `acquireVsCodeApi()`, global
  error boundary, wires state + orchestrators + panels.
- **Rendering:** `renderer.ts` (`renderBlock`/`RENDERER_MAP`), `messageRenderer.ts`
  (bubbles), `toolCallRenderer.ts` (tool `<details>` cards + grouping), `liveTextRenderer.ts`
  (streaming frozen/tail split), `syntaxHighlighter.ts` (highlight.js + DOMPurify),
  markdown via `markdown-it` with a `markdownWorker.ts` for large payloads.

### 2.3 State & messages

- **Webview state:** `WebviewState` in `types.ts`; managed by `createState()` in
  `state.ts` (debounced `save()`, prune at 2 MB, schema migration). Per-session UI state
  lives on `SessionState`.
- **Contract:** `HostMessage` (host→webview) and `WebviewMessage` (webview→host)
  discriminated unions in `types.ts`; documented in `docs/webview-messages.md`. Compile-time
  exhaustiveness via `assertNever`.

### 2.4 Surfaces that already exist (do not rebuild)

| Surface | Module(s) | Maturity |
|---|---|---|
| Streaming render | `liveTextRenderer.ts`, `streamHandlers.ts`, `streamOrchestrator.ts` | Strong |
| Tool cards | `toolCallRenderer.ts`, `toolGrouping.ts` | Strong (state machine, grouping, kbd nav) |
| Diffs / changed files | `changed-files-dropdown.ts` (strip + inline `#changed-files-panel`), diff blocks in `renderer.ts` | Strong (accept/reject/revert, partial hunks) |
| Tabs / sessions | `tabs.ts`, `sessionListRenderer.ts` | Good (kbd nav, a11y) |
| Questions / cost approval | `questionBar.ts` (wired via `main.ts`), `ui/tokenCostDisplay.ts` | Strong (wired) |
| Errors / empty / loading | `errorHandler.ts`, `errorComponents.ts`, `ui/welcomeView.ts` | Strong |
| Conversation minimap | `timeline.ts` | Navigation-only (not an activity feed) |
| Plan card | `planDetector.ts`, `planCardRenderer.ts` | Display-only |

### 2.5 Testing

- Webview unit: `*.test.ts` via `tsx --test`; DOM tests use `jsdom` (set globals + `makeEls()`),
  plus source-string contract checks (`readFileSync(...).includes(...)`).
- Backend unit: `*.test.mjs` via `node:test`. Visual/E2E: Playwright `*.spec.ts`.
- `npm test` = unit + message-contract + roundtrip. `fast-check` is **not** installed
  (property tests use hand-rolled randomized loops).

---

## 3. Research-backed UX findings

Sourced from current guidance (mid-2026). Each finding is mapped to a concrete decision.

1. **Use webviews sparingly; make them native, themeable, accessible.** VS Code's UX
   guidelines say webviews are heavyweight and a poor fit unless functionality exceeds the
   native API; when used they must be themeable, keyboard-accessible, and use toolbar
   command actions. → *Decision:* new surfaces reuse the existing toolbar `icon-btn` +
   `*-panel hidden` pattern and `--vscode-*` tokens; no new framework.
2. **The Webview UI Toolkit is deprecated (2025-01-01).** → *Decision:* plain HTML + design
   tokens is correct; we do **not** adopt a component library.
3. **Visibility of system status (NN/g heuristic #1) is the dominant need for agents.**
   Users must always know what the system is doing; streaming feedback and causal links
   between input and output reduce perceived latency. → *Decision:* the Activity Timeline
   exists primarily to make "what is the agent doing / what did it do" continuously legible.
4. **Agent UX in 2026 = transparency, status, override, recovery.** Show what the agent is
   doing, why, let users override at any point, and recover from errors. → *Decision:* every
   new surface exposes status badges + user actions (approve/reject/cancel/retry/revert).
5. **The Review Paradox / Review Fatigue.** Verifying agent work can cost more than doing
   it; blanket approval gates cause rubber-stamping. → *Decision:* prefer **filtering and
   summarization** (the timeline's filter chips, command summaries, file grouping) over
   adding more mandatory gates; reserve approvals for genuinely risky actions.
6. **Cline-style checkpoints make autonomy safe.** Snapshot-per-action + restore
   (files-only vs files+task) is the pattern that makes auto-approve tolerable. →
   *Decision:* surface checkpoints in the timeline and (later) wire restore granularity
   where the backend supports it (§14).
7. **WCAG 2.2 + keyboard-first.** Visible focus, ARIA roles, operable without a mouse, AA
   contrast across light/dark/high-contrast. → *Decision:* every new control is in the
   `accessibility` cascade layer's focus regime, arrow-key navigable, and labelled.

Sources:
- VS Code UX Guidelines — Overview & Webviews: https://code.visualstudio.com/api/ux-guidelines/overview · https://code.visualstudio.com/api/ux-guidelines/webviews
- Webview UI Toolkit (deprecated): https://github.com/microsoft/vscode-webview-ui-toolkit
- NN/g — Visibility of System Status: https://www.nngroup.com/articles/visibility-system-status/
- NN/g — AI: First New UI Paradigm in 60 Years: https://www.nngroup.com/articles/ai-paradigm/
- Agent UX (2026): https://fuselabcreative.com/ui-design-for-ai-agents/
- Cline — Checkpoints: https://docs.cline.bot/core-workflows/checkpoints
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

---

## 4. Competitive pattern review

| Product | Pattern worth adopting | How we adapt it (not copy) |
|---|---|---|
| **opencode TUI** | Compact, keyboard-driven activity log; mode (plan/build) front-and-center | Keep our mode dropdown; add a denser **Activity** feed mirroring the TUI's event log, but filterable |
| **Claude Code** | Plan → diff → mention workflow; plans as reviewable artifacts | Upgrade plan cards to interactive checklists with approve/reject (Phase 2) |
| **Cline** | Per-action approval + **checkpoints** (shadow git) + restore files/task; diff review | Surface checkpoints + per-command actions in the Activity/Tasks panels; restore gated on backend (§14) |
| **VS Code native** | Toolbar command actions, `vscode.diff`, Quick Picks, theming | "Open in VS Code diff" (Phase 4); reuse toolbar buttons; never reinvent native affordances |

Net: we are closest to Cline/Claude Code in capability but currently weaker on **structured
activity** and **plan interactivity** — exactly the first two verticals.

---

## 5. UX audit table (severity-ranked)

Severity: **Critical** (blocks core use) · **High** (frequent friction) · **Medium** ·
**Low** (polish).

| # | Area | Current behavior | Problem | User impact | Sev | Recommended fix | Files |
|---|---|---|---|---|---|---|---|
| 1 | Activity transparency | Events live only inline in the transcript | No aggregated/filterable view of what the agent did | Users scroll the transcript hunting for tool/file/error events | **High** | Build Agent Activity Timeline (read-model over blocks) + filters | `activityModel.ts`, `activity-panel.ts` (new) |
| 2 | Plans | `planCardRenderer.ts` renders read-only todos | Can't approve/reject/edit/reorder/check off steps | Plans are inert; no control loop | **High** | Interactive plan panel + per-session annotations | `planCardRenderer.ts`, `planDetector.ts`, `plan-panel.ts` (new) |
| 3 | Commands | `exec` output shows only on completion; no controls | No live output, cancel, retry, exit-code emphasis | Long commands feel frozen; failures hard to act on | **High** | Tasks panel + exec action row (gated bits in §14) | `tasks-panel.ts` (new), `toolCallRenderer.ts` |
| 4 | Session mgmt | Rename CLI-only; close == delete; no search/pin/tag | Can't organize or clean up sessions from the UI | Junk/test sessions accumulate; hard to find work | **Medium** | Session mutability (pin/tag/archive/rename/search) | `SessionStore.ts`, `sessionListRenderer.ts`, `tabs.ts` |
| 5 | Diff review | Unified diff in dropdown; no native diff | Can't open VS Code's diff viewer; hunk staging partial | Reviewing large diffs is cramped | **Medium** | "Open in VS Code diff" (`vscode.diff`); finish hunk staging | `changed-files-dropdown.ts` |
| 6 | Stale states | `isStreaming` reset on reload; few explicit "stale" cues | Interrupted/stale turns not always visually distinct | Ambiguity after reconnect | **Medium** | Explicit stale/cancelled/interrupted badges across surfaces | `renderer.ts`, panels |
| 7 | Long sessions | History condensation exists; no list virtualization | Very long transcripts/logs can lag | Slowdowns in marathon sessions | **Low** | Virtualize timeline/long logs (Phase 5) | `activity-panel.ts`, `timeline.ts` |
| 8 | Naming overload | `timeline.ts` is a minimap, not activity | "Timeline" means two things | Conceptual confusion | **Low** | Name new surface "Activity"; keep "Conversation Timeline" | this audit, `index.html` |

---

## 6. Proposed frontend product model

Most entities already exist as block/message shapes; the model normalizes them and adds a
few fields. **Bold** = newly added on the frontend.

| Entity | Backing type today | Key frontend fields |
|---|---|---|
| Session | `SessionState` / `OpenCodeSession` | id, name, model, mode, messages[], isStreaming, cost, tokenUsage, changedFiles[], archived, **pinned**, **tags[]** |
| Message | `ChatMessage` | role, id, blocks[], timestamp, sessionId, tokenCount, **turnIndex** (derived) |
| Plan | `PlanData` | name, overview, filePath, todos[], **approvalState**, **stepOrder** |
| Plan step | `PlanData.todos[i]` | id, content, status (pending/running/blocked/completed/failed/skipped), **note**, **links[]** |
| Tool call | `ToolCallBlock` | id, name, class (read/write/exec/error/meta/mixed), state, args, result, durationMs, error |
| Command | `ToolCallBlock(class=exec)` | id, **commandText**, **cwd**, status, **exitCode**, result(stdout/stderr), durationMs, **userActionsAvailable[]** |
| File edit / Diff | `FileChange` / `DiffBlock` | path, status (added/modified/deleted/renamed/conflicted), added, removed, hunks[], decision (pending/accepted/rejected/reverted) |
| Checkpoint | `CheckpointInfo` | id, sessionId, messageId, createdAt, filesChanged[], **restorable** |
| Approval / Question | `QuestionBlock` / `permission_request` | id, title, type, options[], requiresApproval, status |
| **ActivityEvent** (new) | derived | id, kind, label, detail, status, timestamp, **anchorMessageId**, refId, icon |
| Error / Warning | `ErrorBlock` | code, message, detail, severity, retryable, **actions[]** |

**`ActivityEvent.kind`** ∈ `message · plan · tool · file-read · file-edit · command ·
approval · checkpoint · error · thinking · completion` — derived purely from existing
`ChatMessage[]` blocks and `ToolCallBlock.class`.

---

## 7. Recommended UI structure

A unified **side region** (`#side-region`) replaces four standalone panels with a tabbed
interface using `.side-region-tabbar` (`.side-tab` buttons) and `.tab-pane` content
areas. Four tab panes sit inside a single `.side-region-body`:

- **Activity** (`.tab-pane#activity-pane`): filter chips
  *All · Messages · Plans · Commands · Files · Errors · Approvals*; row click scrolls to the
  originating block.
- **Plan**: inline card upgraded to interactive; optional docked panel.
- **Tasks** (`.tab-pane#tasks-pane`): running commands with metadata + actions.
- **Session controls**: tab context menu + enhanced session modal (rename/pin/tag/archive/search).

The region exposes a `SideRegionApi` (`open`, `close`, `toggle`, `switchTab`) with pin
(`aria-pressed` star icon) and close buttons. Active tab is persisted in `sessionStorage`.
Toggle buttons in the toolbar call `sideRegion.toggle(tabId)` rather than manipulating
individual panel DOM elements. A single close button dismisses the entire region; the pin
button prevents auto-close. The subagent detail view includes a pop-out-to-editor button
that posts `open_subagent_detail`.

Naming: keep the existing **Conversation Timeline** minimap; the new structured feed is
**Activity**.

---

## 8. State machines

```
Streaming:  idle → starting → streaming → (interrupted ↔ resuming) → finalizing → done | error
Command:    queued → awaitingApproval → running → succeeded | failed → retrying → running
            awaitingApproval → rejected ;  running → cancelled
Plan:       detected → proposed → (approved | rejected | editing) → in-progress → (completed | abandoned)
  step:     pending → running → (completed | failed | skipped | blocked)
File edit:  pending → (accepted | rejected) → applied → (reverted)
Approval:   requested → (granted | denied | expired)
Session:    active ↔ archived ;  unpinned ↔ pinned ;  * → deleted (confirm)
```

These define the legal badges each surface may render and the transitions UI controls may
trigger.

---

## 9. Prioritized implementation plan

| Phase | Goal | Primary files | Status |
|---|---|---|---|
| 0 | Commit this audit | `docs/frontend-ux-audit.md` | **done** |
| 1 ⭐ | Agent Activity Timeline (deep vertical) | `activityModel.ts`, `activity-panel.ts`, `css/activity.css`, wiring | **done** |
| 2 | Interactive plan cards (progress, badges, Approve/Revise) + `detectPlanFile` fix | `toolCallRenderer.ts`, `planDetector.ts`, `WebviewEventRouter.ts`, `css/blocks.css` | **done** |
| 3 | Commands/Tasks panel (metadata, copy/terminal/re-run, cancel) | `commandModel.ts`, `tasks-panel.ts`, `css/tasks.css`, `open_terminal` host handler | **done** (live stdout uses Hybrid A; true per-command cancel remains server-gated — §14) |
| 4 | Session mutability: **pin + rename + tags** + open-applied-diff in VS Code | `SessionStore.ts`, `MessageRouter.ts`, `sessionListRenderer.ts`, `renderer.ts` | **done** (hunk staging remains — §14) |
| 5 | A11y/perf/polish | reduced-motion guard, global `*:focus-visible`, token theming, keyboard nav across all panels | **done** (long-log virtualization deferred; history condensation covers it) |
| 6 | Question bar wiring | `questionBar.ts` (main.ts wiring), `renderer.ts` (question block), `types.ts` (persistence), `sendLogic.ts` (steer-mode fix) | **done** |

Each later phase is an independent vertical: UI + state + messages + tests + a11y, shipped
behind its own toolbar toggle, degrading gracefully when a backend capability (§14) is absent.

---

## 10. Code changes made (Phase 1)

See the PR for full detail. Phase 1 adds the **Agent Activity Timeline** as a pure
frontend read-model (no backend changes):

- `activityModel.ts` — pure `buildActivityEvents(messages, opts)` mapping blocks →
  `ActivityEvent[]`, with `filterActivityEvents()` and `ACTIVITY_FILTERS`.
- `activity-panel.ts` — `setupActivityPanel(els, deps)`: renders the feed, filter chips,
  empty/streaming states, ARIA list semantics, arrow-key navigation, row click → scroll.
- `css/activity.css` — themed via `tokens.css`; registered in the `components` layer.
- Wiring: `index.html` (toggle + panel), `dom.ts` (refs), `types.ts`
  (`activityFilter` per session), `main.ts` (toggle + active-session refresh on message
  and tab switch events).

## 10a. Code changes made (Question Bar Wiring)

- **Input-area question dock** — `questionBar.ts` wired into `main.ts` (was previously unwired; now connected).
- **Non-interactive question block in transcript** — `renderer.ts` renders question blocks in the message stream.
- **Question answer persistence** — `types.ts` updated to persist question/answer data.
- **Steer-mode button fix** — `sendLogic.ts` fixed to handle steer-mode correctly.

## 10b. Welcome-screen ↔ session-focus reconciliation

Fixes for four coupled defects where the welcome screen and live tab state disagreed:

- **Welcome-screen mode selection** — the mode selector is in the input area (visible on
  the welcome screen), but mode changes were dropped when no session existed. A persisted
  **pending mode** (`state.pendingMode`) now records the choice and the next session adopts
  it. (`ui/modeDropdown.ts`, `state.ts`, `types.ts`, `main.ts`)
- **Welcome model card** — `renderWelcomeContext` now falls back to the active-session /
  picker model and refreshes on `model_list`, so it is never stuck on "No model selected".
- **Focus ownership** — host `active_session_changed` and `init_state` are reconciled
  through pure helpers (`sessionFocus.ts`) so a background/refresh change never steals
  focus from the tab the user is viewing (especially a streaming one).
- **Closed-tab resurrection** — the host's "active session" restorable fallback is gated by
  `restorablePolicy.ts` so a closed tab is not re-added on a visibility refresh.

## 11. Tests added or updated (Phase 1)

- `activityModel.test.ts` — kind mapping, ordering, filtering, randomized invariants.
- `activity-panel.dom.test.ts` — render, filter chips, empty/streaming states, keyboard
  nav, dispose cleanup (jsdom).
- `tests/visual/activity.spec.ts` — Playwright: events appear, filters narrow, row click
  scrolls.

## 12. Manual verification checklist

1. Send a prompt that triggers reasoning + a tool call + a file edit + an error.
2. Open the Activity panel; confirm each event appears **live** as it streams.
3. Each filter chip (All/Messages/Plans/Commands/Files/Errors/Approvals) narrows correctly.
4. Clicking a row scrolls the transcript to the originating block.
5. Operate the panel **keyboard-only** (Tab to chips, arrow keys through rows, Enter to jump).
6. Toggle light / dark / high-contrast themes — text remains readable, focus rings visible.
7. Resize to a narrow sidebar — layout holds.
8. Empty session shows the empty state; streaming session shows a live indicator.

## 13. Remaining frontend issues (tracked for later phases)

- Plans are still display-only until Phase 2.
- `exec` commands lack live output / cancel until Phase 3 (and §14).
- Session pin/tag/archive UI and search are shipped; remaining work is visual polish only.
- No list virtualization yet (Phase 5) — relies on existing history condensation.
- **Latent bug found during Phase 1:** `planDetector.ts`'s `todos:` frontmatter
  regex (`/todos:\s*\n((?:\s+-[\s\S]*?)+)/`) is unanchored and lazy, so it
  captures only `"  -"` and `detectPlanFile()` returns `null` for well-formed
  plans — meaning the existing **plan card never renders**. The Activity feed
  sidesteps this with its own robust `detectPlanLite()`. Fix `detectPlanFile`
  in Phase 2 (anchor the capture / parse line-by-line) and add a regression test. **Fixed** — `planDetector.ts` now uses an anchored `^todos:\s*$` regex and parses line-by-line; `planDetector.test.ts` locks the regression.
- **Sprint 4 iconography** (c233830, 12bce8c, 96447dc): per-tool-name SVG resolver, activity-kind SVG icons, subagent-domain SVG icons, and state overlays all shipped. All emoji + literal-glyph replacements live. See `docs/ui/icons.md`.

## 14. Backend / API gaps blocking ideal frontend behavior

These require the **opencode server itself** (a separate process reached via
`@opencode-ai/sdk`), so they are implemented up to the extension-host boundary and the
remainder is documented here rather than faked:

1. **Live command stdout streaming** — implemented as Hybrid A. The host consumes
   `message.part.updated` / `session.next.tool.progress` partials when they expose live
   output, then arms a 500ms `session.messages` polling fallback for running bash/exec tools
   that have not produced SSE partials. The webview keeps stdout/stderr buffers transient,
   updates cards and the Tasks panel live, drops stale/duplicate tokens, and logs a one-time
   warning per session when the server exposes no recognizable live buffer.
2. **Mid-command cancellation** — bash-card **Cancel** marks the card cancelled with captured
   live output, stops polling, and falls back to whole-stream `abort`. A true per-tool abort
   still needs a server/SDK handle for the running tool. **Re-run / Open in terminal** are
   fully wired host-side (`open_terminal`).
3. **Hunk-level apply/revert** — UI can render hunks and `accept_hunk`/`reject_hunk`
   messages exist; granular apply/revert needs server support beyond file-level
   `accept_diff`/`revert_diff`. (Open-applied-diff in VS Code is **done**.)
4. **Plan step execution / write-back** — **Approve/Revise** are wired (`plan_action` →
   prefilled prompt); editing/reordering steps as *actions* that rewrite the plan file
   needs the agent/server to consume plan edits.
5. **Checkpoint restore granularity** — Cline-style files-only vs files+task restore
   depends on the opencode checkpoint API surface.

Shipped host-side this initiative (not server-gated): session **pin/rename/tags** (durable
in globalState), `open_terminal`, `plan_action`, and open-applied-diff via `vscode.diff`.

Note: session `pinned`/`tags[]` are **not** a backend gap — they live in extension
globalState and are fully in frontend scope.

---

## 14. Welcome Screen Audit (2026-06-07)

Research document: `welcome-screen-research-notes.md`

### Bug Inventory

| ID | Bug | Severity |
|---|---|---|
| B1 | `steer_prompt` vs `send_steer_prompt` type mismatch — steer-while-streaming silently dropped | High |
| B2 | Welcome view hidden BEFORE model check — user dropped into empty tab | High |
| B3 | Prompt text cleared on model-missing error — typed text irrecoverable | High |
| B4 | Send button enabled when no model — lets user hit silent error | Medium |
| B5 | Model-empty race on init — welcome card stuck on "No model selected" | Medium |
| B6 | No "Pick model" action in error block — generic "Retry" only | Medium |

### Architecture

The welcome screen (`#welcome-view`) and main input (`#prompt-input` in `#input-area`)
are **separate DOM elements**. The shared textarea is always rendered below the welcome
view. Prompt-starter cards originally only filled the textarea (never auto-submitted).

### Root Cause of the "Cannot Send" Bug

Model resolution happened AFTER the welcome view was hidden and textarea cleared.
A missing model silently created an empty tab with a destroyed prompt.

### Fixes Applied

1. **Reordered `sendMessage()`** — model validation moved before `hideWelcomeView()`
   and `els.promptInput.value = ""`. On failure, the model manager opens, the prompt
   text stays intact, and the welcome view stays visible.
2. **Send button gates on model** — `updateSendButton()` checks `resolveSendModel()`.
   Disabled + "Select a model first" tooltip + `.no-model-blocked` CSS class.
3. **One-click starter submission** — plain click fills + submits; Shift+click fills only.
4. **Empty-model banner** — `.welcome-model-empty-banner` with "pick a model" link.
5. **`pick_model` action** — new `ErrorActionType` that opens the model manager panel.
6. **Backend deferral** — `pushAllStateToWebview()` awaits `refreshModels()` before
   pushing `init_state`, eliminating the `globalModel: ""` flash.
7. **Lazy model refresh** — `StreamCoordinator.startPrompt()` retries `refreshModels()` with
   a 3s timeout if both tab and global model are empty at send time.
