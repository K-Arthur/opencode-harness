# AGENTS.md — OpenCode Harness

> ## ⚠️ READ FIRST — THE WORKING TREE IS EPHEMERAL. COMMIT TO PRESERVE WORK.
>
> This workspace runs an external checkpoint process (opencode `oc-ckp-*`
> checkpoints, and other agent harnesses) that periodically does
> `git stash` / `git reset → HEAD`. That **discards every uncommitted change**
> in the working tree. Committed work is never touched; `git stash`/`reset → HEAD`
> only move uncommitted changes aside (into `git stash list`). The git **reflog**
> shows the recurring `reset: moving to HEAD` entries.
>
> **Rules every agent/model MUST follow here (applies to Claude, Cursor, Cline,
> Windsurf, Gemini, Codex, and any human):**
> 1. **Commit completed, verified work BEFORE ending your turn.** Never leave
>    finished work uncommitted — it can be wiped between turns. Prefer small,
>    frequent commits over one large uncommitted batch.
> 2. **Never run** `git reset --hard`, `git checkout -- .`/`git checkout -- <file>`
>    against live edits, or `git stash` on the working tree — you would discard
>    your own or another agent's uncommitted work.
> 3. **If your edits "vanished," they are almost certainly stashed, not lost.**
>    Recover: `git stash list` → `git stash show -p "stash@{0}"` →
>    `git checkout "stash@{0}" -- <files>` (or `git stash apply`).
> 4. After finishing a unit of work, run `typecheck → build → test`, then commit.
>
> This is environment behavior, not a flaw in your edits. Full detail + recovery
> and the **correct rebuild/reinstall flow** (`npm run reinstall`): see
> [`docs/development/rebuild-and-reinstall.md`](docs/development/rebuild-and-reinstall.md).

## ⚠️ Multiple agents editing at once — coordination protocol

Several AI agents (and humans) edit this repo concurrently. Sharing one working
tree is the primary cause of clobbered/"reverted" edits: one agent's
`git stash`/`reset`, or two agents writing the same file, silently drops the
other's work. To make concurrent work safe:

1. **Isolate when possible — one branch (or git worktree) per agent.**
   `git worktree add ../oh-<agent> -b agent/<name>` gives each agent its own
   checked-out tree and branch; merge back via PR/`git merge`. This is the only
   approach that *fully* prevents two agents from corrupting one shared tree.
   (The Claude Code `Agent` tool supports `isolation: "worktree"` for this.)
2. **If you must share the tree, commit small and often** and **re-check state
   before and after editing**: `git status` + `git log --oneline -5` to see
   in-flight work; `git diff` to confirm your change landed and nothing else
   reverted it. Treat an unexpected clean file you just edited as "another agent
   reset the tree" → recover from `git stash list`.
3. **Stay in your lane.** Before editing a file, check it is not mid-change by
   someone else (`git status`). Avoid large rewrites of files outside your task.
   Scope every commit to only the files you own (`git add <files>`, never
   `git add -A` when others have in-flight work).
4. **Review via git, not the tree.** Review another agent's work through
   `git diff`/commits/PRs — never by `git checkout`/`reset` of the shared tree.
5. **The ephemeral-tree rule above is the safety net:** committed work survives;
   uncommitted work is fair game for the next reset. Commit before yielding.

Full rationale + worktree recipes: [`docs/development/concurrent-agents.md`](docs/development/concurrent-agents.md).

## What This Is

VS Code extension that integrates the opencode AI agent into VS Code. TypeScript/Node.js, built with esbuild. Client-server architecture: extension connects to an opencode HTTP server (localhost:4096) via `@opencode-ai/sdk/v2` (v2 client). Does not embed or spawn the CLI directly for chat.

## Commands

```bash
npm run build        # esbuild bundle (extension + webview + CSS + markdownWorker)
npm run typecheck    # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run test:unit    # behavioral tests (tests/unit/*.test.mjs) + structural tests (src/**/*.test.ts)
npm run lint         # alias for typecheck
npx eslint src/      # ESLint (separate from typecheck in CI)
```

**Verification order before any commit:** `typecheck → build → test:unit`

CI also runs `npx eslint src/` and `node scripts/check-architecture.mjs` as separate steps.

## Build System

esbuild bundles 4 entry points into `dist/`:
- `src/extension.ts` → `dist/extension.js` (CJS, Node, vscode external)
- `src/chat/webview/main.ts` → `dist/chat/webview/main.js` (IIFE, browser)
- `src/chat/webview/markdownWorker.ts` → `dist/chat/webview/markdownWorker.js` (IIFE, browser)
- `src/chat/webview/css/styles.css` → `dist/chat/webview/styles.css`

Assets copied: `index.html`, `media/opencode-wordmark-dark.svg`.

**CI bundle size limits:** extension.js ≤ 640KB, main.js ≤ 780KB (paydown target: 545KB by moving `highlight.js` into the worker; see `docs/plans/highlight-worker-separation.md` and `scripts/check-bundle-size.mjs`).

## Packaging & Reinstalling (READ THIS BEFORE `code --install-extension`)

**Always reinstall with `npm run reinstall`.** Do NOT hand-run
`vsce package` + `code --install-extension` of the *same* version — that
reliably ships a **stale build** (you install successfully but keep seeing the
old UI). Full rationale + manual fallback: `docs/development/rebuild-and-reinstall.md`.

`npm run reinstall` (→ `scripts/reinstall-extension.mjs`) does, in order:
1. **Bump the patch version** (`npm version patch --no-git-tag-version`). VS Code's
   Extension Host keys cached code by version; an unchanged version is not
   guaranteed to swap in. This is the single most important step.
2. **Delete every old `opencode-harness-*.vsix`** in the repo (so nobody installs
   a stale artifact by accident — they pile up fast).
3. **Uninstall** the current extension.
4. **Package** (runs `vscode:prepublish`: typecheck + prod build + bundle check).
5. **Install** the freshly-built `.vsix`.
6. **Prune every other versioned dir** under `~/.vscode*/extensions/` — `--uninstall`
   only *marks* the old `…-<version>` dir obsolete; it lingers and can be loaded again.
7. Print the one step it cannot do: **reload the window**.

**Mandatory manual step after any (re)install:** run *Developer: Reload Window*
(or restart VS Code). The running Extension Host holds the previous code in
memory until reload — this is why "it installed but looks unchanged" happens.

Flags: `--no-bump` (keep version — not recommended), `--code=code-insiders`
(target a different CLI). Do not commit the generated `.vsix` (it is gitignored).

## Test Layers

| Layer | What | Command |
|---|---|---|
| Behavioral unit | Real function-calling tests for SessionStore, EventNormalizer, DiffApplier, etc. | `node --test tests/unit/*.test.mjs` |
| Structural unit | Source code pattern checks (being migrated to behavioral) | `npx tsx --test "src/**/*.test.ts"` |
| Message contract | Webview message type contracts | `npx tsx --test tests/webview/message-contract.test.ts` |
| Roundtrip | Integration roundtrip tests | `node --test tests/integration/message-roundtrip.test.mjs` |
| Integration | VS Code Extension Dev Host (requires xvfb on Linux) | `npm run test:integration` |
| Visual | Playwright screenshot regression | `npm run test:visual` |
| Marketplace screenshots | Automated marketplace asset generation + visual regression | `npm run screenshots:generate` / `npm run screenshots:verify` |

Run all unit+contract+roundtrip: `npm test`

## Architecture

- **Entry point:** `src/extension.ts`
- **Webview provider:** `src/chat/ChatProvider.ts` — thin orchestrator, delegates to services
- **Per-tab state:** `TabManager.ts`, **streaming:** `StreamCoordinator.ts`, **routing:** `MessageRouter.ts`
- **Server lifecycle:** `src/session/SessionManager.ts`
- **Theme system:** `src/theme/ThemeManager.ts` — CSS_VAR_MAP maps OpencodeTheme properties to CSS vars
- **Max concurrent AI streams** configurable via `opencode.sessions.maxConcurrentStreams` (default 5)

### Webview Module Decomposition

`src/chat/webview/main.ts` is the IIFE entry point (~4800 lines). High-complexity functions are extracted into dedicated modules using an explicit deps-object pattern to thread IIFE-local dependencies without closure capture:

| Extracted module | Function | Deps interface | Purpose |
|---|---|---|---|
| `ui/keyboardShortcuts.ts` | `setupGlobalKeyboardShortcutsImpl` | `KeyboardShortcutDeps` | Document-level keyboard shortcuts (tab management, command palette, search, panel toggles) |
| `todoSubagentSetup.ts` | `setupTodoSubagentPanelsImpl` | `TodoSubagentSetupDeps` | Todos/activity/tasks/terminal/skills/subagent panel setup + toggle button wiring |
| `tabSwitcher.ts` | `switchTabImpl` | `TabSwitcherDeps` | Tab switching: scroll anchors, model/cost/token displays, permission bar, question bar, todos/activity sync |

Each extracted function is called from a thin one-liner delegation in `main.ts` that passes the deps object. The pattern follows the existing `SendLogicDeps` / `ComposerDeps` precedent.

### Session SDK Method Coverage (audit §11)

| Method | File | SDK endpoint | Purpose |
|--------|------|-------------|---------|
| `runShell` | `SessionClient.ts` / `SessionManager.ts` | `session.shell()` | Execute a shell command in session context; returns `{ messageId, text }`. `shell.started`/`shell.ended` events fire via `SessionNextHandler`. |
| `shareSession` | `SessionClient.ts` / `SessionManager.ts` | `session.share()` | Create a shareable link; returns updated `Session` with `share.url`. |
| `unshareSession` | `SessionClient.ts` / `SessionManager.ts` | `session.unshare()` | Remove the shareable link; returns updated `Session` with `share` cleared. |
| `forkSession` | `SessionClient.ts` / `SessionManager.ts` | `session.fork()` | Branch a conversation at a message; returns the new `Session`. |
| `revertMessage` | `SessionClient.ts` / `SessionManager.ts` | `session.revert()` | Revert a message (undo effects, restore previous state). |
| `importFromFile` | `SessionImporter.ts` | (local, no SDK) | Import a session from JSON (mirrors export format). Registered as `opencode-harness.importConversationJson`. |
| `exportJson` / `exportMarkdown` / `exportPlainText` | `SessionExporter.ts` | (local, no SDK) | Export a session to JSON/Markdown/text. Registered as `opencode-harness.exportConversation{,Json,Text}`. |

### ChatProvider Services (delegated from ChatProvider.ts)

| Service | File | Responsibility |
|---------|------|---------------|
| `RetryQueueService` | `src/chat/RetryQueueService.ts` | Message retry with exponential backoff |
| `StashService` | `src/chat/StashService.ts` | Prompt stash CRUD |
| `ProviderManagementService` | `src/chat/ProviderManagementService.ts` | AI provider config CRUD |
| `MessagePostService` | `src/chat/MessagePostService.ts` | Webview message posting |
| `SlashCommandService` | `src/chat/SlashCommandService.ts` | Built-in slash commands |
| `SessionSyncService` | `src/chat/SessionSyncService.ts` | Push model/MCP/rate-limit state |
| `DiffAcceptService` | `src/chat/DiffAcceptService.ts` | Diff accept + plan permission |
| `CodeInsertionService` | `src/chat/CodeInsertionService.ts` | Insert-at-cursor + create-file-from-code |
| `AutoModeService` | `src/chat/AutoModeService.ts` | Auto-mode confirmation gate |
| `HostPromptQueue` | `src/chat/HostPromptQueue.ts` | Host-side prompt queue (single source of truth, workspaceState persistence) |
| `QuestionExpiryDetector` | `src/chat/QuestionExpiryDetector.ts` | B10: Categorizes question reply failures (expired/transient/rejected) + staleness detection |

### Session Title Lifecycle

Titles flow across three surfaces (server / CLI / webview tab strip) via two complementary paths. Full design: [`docs/webview-messages.md` § Session Title Propagation](docs/webview-messages.md#session-title-propagation).

- **Race-free IPC push**: `SessionStore.setTitleAppliedCallback(cb)` (DI hook) fires synchronously from inside `applyServerTitle` / `setTitle` / `updateName`. ChatProvider wires it in its constructor to post `session_title_updated` → webview's `patchTabLabel` patches `.tab-label` in place (no `innerHTML` wipe, no focus/IME clobber). Bypasses the registration-order-dependent `onDidChangeSession` subscriber (which still posts `session_renamed` for regression safety).
- **cliSessionId race queue**: `SessionStore.pendingTitles: Map<cliSessionId, title>` queues server titles that arrive before `updateCliSessionId` binds the mapping. Flushed via `queueMicrotask` on next bind.
- **CLI consistency**: `WebviewEventRouter.rename_session` calls `setTitle` (not `rename`) so deduped titles propagate to the opencode server via `serverTitleUpdater`. Feedback-loop-safe (equality gate in `applyServerTitle`).
- **Title generation**: shared pure module `src/session/titleExtractor.ts` — `extractTitle(text)` strips markdown headers / bracketed metadata / TODO labels and truncates at 40 chars on a word boundary; `dedupeTitle(proposed, existingSet)` appends ` (2)` / ` (3)` until unique. Imported by both host (`sessionUtils.ts`) and webview (`main.ts`) — replaces the duplicated naive 37-char-hard-slice.
- **In-place tab patch**: `tabs.ts::patchTabLabel(els, tabId, newName)` updates only `.tab-label` textContent + `.tab-close` aria-label. Used by the `session_title_updated` handler. The legacy `renderTabs` (full `innerHTML` rebuild) is reserved for structural changes (create/close/reorder/stream-capacity).
- **CSS tokens**: `--size-tab-label-max` (100px), `--size-tab-label-min` (48px) drive the ellipsis cutoff independent of `--size-tab-max`.

### Webview Composer Modules (delegated from composer.ts)

| Module | File | Responsibility |
|--------|------|---------------|
| `slashCommands` | `src/chat/webview/slashCommands.ts` | /command dispatching |
| `queueRenderer` | `src/chat/webview/queueRenderer.ts` | Queue chip UI (ARIA listbox, keyboard nav, drag-reorder, edit/remove/retry) |
| `sendLogic` | `src/chat/webview/sendLogic.ts` | Factory composing sendMessage/sendButton/steerMode modules |
| `sendMessage` | `src/chat/webview/sendMessage.ts` | Core send logic, title generation, model validation, G8 ack watchdog |
| `sendButton` | `src/chat/webview/sendButton.ts` | Send button state, stream capacity checking, icon updates |
| `steerMode` | `src/chat/webview/steerMode.ts` | Steer mode (interrupt/queue) UI and state management |
| `inputHandlers` | `src/chat/webview/inputHandlers.ts` | Keyboard + paste + resize handlers |
| `surfaceCoordinator` | `src/chat/webview/surfaceCoordinator.ts` | Cross-surface mutual exclusion — closes other dropdowns/modals when one opens (prevents z-index conflicts) |

### Webview Timeline Modules (delegated from timeline.ts)

| Module | File | Responsibility |
|--------|------|---------------|
| `timeline` | `src/chat/webview/timeline.ts` | Conversation timeline sidebar: toggle, render, keyboard nav, progress, history condensation, per-turn model indicator |
| `thinkingToggle` | `src/chat/webview/thinkingToggle.ts` | Global thinking block visibility toggle (extracted from timeline for SRP) |
| `scrollMarkers` | `src/chat/webview/ui/scrollMarkers.ts` | Scroll marker dots, jump-to-bottom, scrollToTurn with injected timers |

### Webview Terminal Panel (audit §14.1/§14.2)

| Module | File | Responsibility |
|--------|------|---------------|
| `terminal-panel` | `src/chat/webview/terminal-panel.ts` | Live PTY terminal visibility: `setupTerminalPanel()` folds `pty.*` lifecycle events + byte chunks into renderable state via the pure `ptyReducer` from `ptyModel.ts`. Renders one card per PTY (status dot, command, exit code, runtime, Cancel, bounded stdout). Stays hidden until `terminal_capability.ptySupported === true` (graceful degradation). |
| `ptyModel` | `src/terminal/ptyModel.ts` | Pure `ptyReducer` (lifecycle + output chunks + ring buffer) + `isPtySupported` capability probe. Tested in `ptyModel.test.ts`. |
| `PtyService` | `src/terminal/PtyService.ts` | Host SDK wrapper: `listSessions`, `createSession`, `getConnectToken`, `connectWebSocket`, `sendInput`, `setTerminalSize`, `removeSession`. Exposed via `SessionManager.ptyService`. |
| `PtyEventHandler` | `src/session/eventHandlers/PtyEventHandler.ts` | Normalizes raw SDK `pty.*` events into `ServerEvent` for `EventNormalizer`. |

**PTY terminals are a global resource** — the `ptyId` is carried as `sessionId` in lifecycle events, not a chat session id. The panel shows all PTYs regardless of active chat tab. Full message contract: [`docs/webview-messages.md` § PTY Terminal](docs/webview-messages.md#pty-terminal-audit-14142).

### Webview Diff Viewer Modules

| Module | File | Responsibility |
|--------|------|---------------|
| Diff rendering | `src/chat/webview/renderer.ts` | `renderNewDiffBlock`, `createDiffTableWrapper`, `createDiffLineRow`, `createHunkHeaderRow`, `createHunkActionCell`, `toggleDiffWrap`, `renderPendingDiffActions`, `createRevertDiffButton`, `createHunkNavButtons`, `inferLanguageFromPath`, `createDiffViewToggle`, `appendSideBySideHunkRows`, `pairLinesForSideBySide`, `createSideBySideLineRow` |
| Markdown worker | `src/chat/webview/markdownWorkerClient.ts` | Web Worker client for async markdown rendering and syntax highlighting (extracted from renderer.ts to break renderer↔toolCallRenderer cycle) |
| Word-level diff | `src/chat/webview/wordDiff.ts` | `computeWordDiffs()` — character-level diff of paired removed/added lines using `diff-match-patch`, emits `<ins>`/`<del>` spans via `line.wordDiffHtml` |
| Diff types | `src/chat/webview/types.ts` | `DiffBlock`, `DiffHunk`, `DiffLine` (with `wordDiffHtml?`) |
| Model indicator | `src/chat/webview/messageRenderer.ts` | Per-turn model badge in message headers: `[modelShortName]` CLI-style notation, provider prefix stripped, `text-overflow: ellipsis` truncation, streaming dot `::before` pseudo-element, WCAG `aria-label` |
| Turn summary | `src/chat/webview/renderer.ts` | `groupMessagesIntoTurns()` populates `TurnSummary.model` from `ChatMessage.model`; timeline items render compact `.timeline-item-model` badge |
| Changed-files dropdown | `src/chat/webview/changed-files-dropdown.ts` | Per-file change tree with stats, hunk previews, per-hunk revert, per-file Undo button, bulk Revert All. **WCAG 2.1 AAA** — see accessibility section below |
| Hunk staging | `src/chat/diff/hunkRevertPlan.ts`, `hunkStaging.ts` | LCS-based per-hunk revert planning, host-authoritative hunk computations |
| Host diff handlers | `src/chat/WebviewEventRouter.ts` (~lines 500-560, 660-670, 1193-1210) | `accept_diff`, `reject_diff`, `revert_diff`, `accept_hunk`, `reject_hunk`, `revert_hunk`, `get_file_hunks`, `get_file_diff`, `undo_file`, `revert_all_files` |
| Diff CSS | `src/chat/webview/css/blocks.css` (~lines 1330-1600) | `.diff-block`, `.diff-table`, `.diff-line--added`, `.diff-line--removed`, `.diff-line-num--old/new`, `.diff-wrap-toggle`, `.diff-hunk-collapse`, `.diff-hunk-nav`, `.diff-view-toggle`, `.diff-table-wrapper--side-by-side` |
| Wrap toggles | `src/chat/webview/renderer.ts` | `readDiffWrapPreference`, `persistDiffWrapPreference`, `readCodeWrapPreference`, `persistCodeWrapPreference`, `readDiffViewModePreference`, `persistDiffViewModePreference` |

### Changed Files Modal — Accessibility Architecture (v0.4.0)

The Changed Files dropdown (`#changed-files-dropdown`) is a fully accessible modal dialog following WAI-ARIA APG patterns. Full redesign in v0.4.0 to match native VS Code Source Control aesthetics and WCAG 2.1 AAA compliance.

**Dialog semantics:**
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby="cf-dropdown-title"` + `aria-describedby="cf-dropdown-desc"` (live file count)
- **Focus trap**: Tab/Shift+Tab cycle within the panel (`_trapTab` in `changed-files-dropdown.ts`)
- **Focus restore**: on close, focus returns to the trigger button (`_previouslyFocused` ref — WCAG 2.4.3)
- **Initial focus**: moves to the close button on open (`_focusInitial`)

**Tree semantics (WAI-ARIA treeview):**
- `.cf-file-list` → `role="tree"` + `aria-label="Changed files"`
- `.cf-dir-header` → `role="treeitem"` + `aria-level="1"` + `aria-expanded` + descriptive `aria-label` ("src/chat/handlers directory, expanded")
- `.cf-dir-files` → `role="group"` + `aria-label`
- `.cf-file-row` → `role="treeitem"` + `aria-level="2"` + `aria-selected` + `aria-label` ("StreamingLog.ts, Modified, 4 additions, 2 deletions")
- Collapsed directories get `data-collapsed-children="true"` so the focus trap skips hidden children

**Roving tabindex** (APG pattern): exactly one tree item carries `tabindex="0"`; all others get `-1`. Arrow keys move the roving slot. `_moveRoving()` scrolls into view (`block: "nearest"`).

**Keyboard navigation** (`_handleTreeKeydown`):

| Key | Action |
|-----|--------|
| `ArrowDown`/`ArrowUp` | Move to next/previous visible tree item |
| `ArrowRight` | Expand collapsed dir, or descend to first child |
| `ArrowLeft` | Collapse expanded dir, or move to parent dir header |
| `Home`/`End` | First / last visible tree item |
| `Enter` | Dir: toggle; File row: open file |
| `Space` | File row: toggle inline diff preview |
| `Escape` | Close modal (dialog-level handler) |
| `Tab`/`Shift+Tab` | Cycle within modal (focus trap) |

**Path shortening** (`shortenDirPath`, `shortenFileDir`): directory paths are shortened relative to structure — `src/chat/handlers/deep/nested` → `src/…/deep/nested` (max 3 segments for headers, last-segment-only for file subtitles). **No uppercase transform** (WCAG 1.4.8).

**Focus rings**: all interactive elements use `--vscode-focusBorder` via `:focus-visible` outlines (WCAG 2.4.7). Never suppressed.

**Status badges** (`_inferStatus`): without explicit git status, all files default to `M` (Modified) — line-count inference of A/D is unreliable. The badge has `aria-hidden="true"` because the row's `aria-label` already announces the status word ("Modified"/"Added"/"Deleted").

**Test coverage:**
- `changed-files-dropdown.test.ts` — summary bar, status badges, directory grouping, controls, expand/diff preview
- `cf-redesign-styles.test.ts` — CSS rule coverage (500-char window for consolidated multi-selector rules)
- `changed-files-isolation.test.ts` — per-session state isolation
- `changed-files-perf.test.ts` — render coalescing, incremental expand

### Horizontal Scaling (ADR-010 — Proposed)

- Interface: `src/session/SessionProcessManager.ts` (ADR-aligned with `onCrash` events)
- Port allocation: `src/utils/portPool.ts` (atomic reservation, no TOCTOU race)
- Crash resilience: `TabRestorationState` in `src/session/sessionTypes.ts`, persisted via `TabManager`
- Configurable stream cap: `opencode.sessions.maxConcurrentStreams` (default 5)
- ADR: `docs/adrs/ADR-010-horizontal-scaling.md`

## Key Constraints

- VS Code engine: `^1.98.0`, Node.js: `20.x+`
- `tsconfig.json`: `strict: true` AND `noUncheckedIndexedAccess: true` — both required
- No mocks in source code (only in tests)
- Circular imports forbidden (acyclic module graph)
- All disposables must be pushed to `context.subscriptions`
- Extension activation must be fast (<500ms target)

## Code Navigation

Use jCodemunch-MCP tools for code exploration. Use `Read` only when editing a file (harness requires Read before Edit/Write).

**Start any session:**
1. `resolve_repo { "path": "." }` — confirm indexed; if not: `index_folder { "path": "." }`
2. `suggest_queries` — when repo is unfamiliar

**Key patterns:**
- Symbol by name → `search_symbols`
- String/config/comment → `search_text` (supports regex)
- Before opening any file → `get_file_outline` first
- What imports this file → `find_importers`
- What breaks if I change X → `get_blast_radius`

**Session-aware routing:**
- Open with `plan_turn { "repo": "...", "query": "...", "model": "<model-id>" }`
- `high` confidence → go directly, max 2 supplementary reads
- `medium` → explore recommended files, max 5 supplementary reads
- `low` → feature likely doesn't exist; report the gap, don't search further
- After edits: call `register_edit` with edited file paths to invalidate caches

## Error Handling Architecture

Error handling spans three layers: SDK errors (host-side), extension routing, and webview display.

### Error Flow
1. **SDK errors** (`@opencode-ai/sdk/v2`) arrive at `ChatProvider.ts` as `server_error` events with shapes like `ProviderAuthError`, `APIError`, `MessageOutputLengthError`, `MessageAbortedError`
2. **Host mapping**: `looksLikeSdkError()` checks for known error names/status codes → `mapOpencodeError()` in `opencodeErrorMapper.ts` produces a structured `ErrorContext` with category, severity, actions, and technical detail
3. **Host serialization**: `ChatProvider.postRequestError` converts the `ErrorContext` to a discriminated `WebviewErrorPayload` (`errorTypes.ts::toWebviewErrorPayload`) and posts it. The four payload variants (`auth_error`/`quota_error`/`infra_error`/`stream_error`) encode the host's classification.
4. **Wire boundary (type-safe)**: `errorWire.ts` is the SOLE authority over the IPC boundary. `normalizeIncomingError(raw, sessionId)` validates inbound payloads and **never trusts a TypeScript `as` cast** — `null`, `"[object Object]"`, and partial objects degrade to a safe `UNKNOWN_INBOUND` fallback (Tier C) instead of crashing the renderer. It also derives the `ErrorTier` via `deriveTier` / `deriveTierFromPayload`.
5. **Spatial routing**: `streamOrchestrator.handleRequestError` calls `routeErrorByTier(normalized, deps, store)` (in `errorTiers.ts`), which sends the error to one of three isolated surfaces (see **Spatial Error Tiers** below). Tier C falls through to the legacy in-stream path; Tier A/B claim dedicated surfaces and bypass the in-stream bubble.
6. **Webview handling (Tier C)**: `handleRequestError()` → `handleStreamError()` in `streamHandlers.ts` renders an `ErrorDisplay` component (`errorComponents.ts`) with progressive disclosure and creates a persisted `ErrorBlock` in the message list.

### Spatial Error Tiers (A / B / C)
Errors are routed to a spatial surface by a single pure function — **never decided per call-site**. `deriveTier(ctx)` (host-side, from `ErrorContext`) and `deriveTierFromPayload(p)` (webview-side, from the payload `type`) are the only tier decision points. See `PLAN.md` Phase 2 for the full matrix.

| Tier | Meaning | Surface | Component | Composer | Persistence |
|---|---|---|---|---|---|
| **A** | Hard block — quota cap, auth failure, unusable system | Persistent anchor in `#global-status-banner` | `TierAAnchor` (`errorTiers.ts`) | **Disabled** (`#prompt-input[disabled]`) until recovery | `ErrorStateStore` (survives panel toggle; reload-restore ready) |
| **B** | Infrastructure — network drop, server timeout, transient 429/5xx | Ambient top-edge banner in `#global-status-banner`, dismissible, no focus steal | `GlobalStatusBanner` (`errorTiers.ts`) | Left enabled (user may queue) | Session-scoped (setState); not transcript-persistent |
| **C** | Local stream fault — prompt-too-long, payload validation, model misconfig, policy refusal | Inline system turn in the conversation thread | `handleStreamError` / `renderErrorBlock` (legacy path) | Unaffected | Transcript (persisted message history) |

- **Router**: `routeErrorByTier(normalized, deps, store)` in `errorTiers.ts`. The single injection point is `streamOrchestrator.handleRequestError`.
- **Tier-A precedence**: a hard cap holds the banner slot over a later Tier-B banner (a quota cap is not displaced by a transient blip).
- **Reconnect-while-drawn**: `applyErrorCleared(envelope, deps)` dismisses a live Tier-B banner but **never** clears a Tier-A hard cap (reconnect ≠ resolved quota/auth). Triggered by an `error_cleared` host envelope.
- **Recovery CTAs**: action buttons forward to the host as `{type:'error_action', action, correlationId, code, metadata}`; `dismiss` is local for Tier B. Action types: `retry`, `edit`, `contact_support`, `view_details`, `dismiss`, `regenerate`, `switch_model`, `upgrade_plan`, `wait_for_reset`, `pick_model`.
- **CSS**: `.tier-a-anchor` / `.tier-b-banner` in `blocks.css` — color comes ONLY from VS Code semantic tokens (`--vscode-errorForeground`, `--vscode-inputValidation-*Background/*Border`, `--vscode-notificationsWarningIcon-foreground`); severity refinement via `[data-severity]`. No primary hardcoded color literals.
- **Wire envelopes** (`errorWire.ts`): `WebviewErrorPayload` (canonical), `ErrorBatchEnvelope` (`error_batch` — host coalesces multi-stream bursts), `ErrorClearedEnvelope` (`error_cleared` — dismiss Tier B on reconnect).

### Error Message Types (Host → Webview)
| Type | Source | Handler | Notes |
|---|---|---|---|
| `request_error` | `MessagePostService.ts` | `main.ts:2275+` | Carries `errorContext` (a `WebviewErrorPayload`); validated by `normalizeIncomingError` in `errorWire.ts` |
| `webview_request_error` | `ChatProvider.ts` | `main.ts:2272+` | Legacy path, now also carries `errorContext` |
| `prompt_rejected` | `StreamCoordinator.ts` | `main.ts:2256+` | Shows rejection reason as in-stream error |
| `show_error` | Any host code | `main.ts` | Shows arbitrary error message in-stream |
| `provider_error` | Provider config | `main.ts` | Surfaces provider config errors to user |
| `server_status` (error) | `SessionManager` | `main.ts:1912+` | Maps through error context if available |
| `rate_limit_exhausted` | `RateLimitMonitor` | `main.ts:2260+` | Shows input-area banner + in-stream error |
| `rate_limit_state` | `RateLimitMonitor` | `main.ts:2084+` | Feeds quota bar + QuotaMonitor |
| `run_status_result` | `StreamCoordinator.probeActiveRun` | `main.ts` | Host-authoritative answer to `probe_run_status`; reconciles both streaming flags. `serverReachable:false` means the answer is uncertain. |
| `streaming_state` | `TabManager.setStreaming` (via `onStreamingStateChanged`) | `main.ts` | Now carries `{source, cliSessionId, messageId, runId}`; writes BOTH `isStreaming` and `isServerStreaming` (host-authoritative). |
| `session_title_updated` | `SessionStore.setTitleAppliedCallback` (fired from `applyServerTitle` / `setTitle` / `updateName`) | `main.ts:4077+` | Race-free title push. Patches `.tab-label` in place via `patchTabLabel` (no `innerHTML` wipe, no focus clobber). Distinct from the legacy `session_renamed` (which still fires via `onDidChangeSession` for regression safety). |

### Error Block Rendering
- **Block-level**: `renderErrorBlock()` in `renderer.ts` renders persisted errors from message history with header, message, detail, and action buttons (Retry/Dismiss by default)
- **Component-level**: `ErrorDisplay` in `errorComponents.ts` provides progressive disclosure (Show Details toggle), severity-coded colors, and category labels. Used for transient/stream errors via `handleStreamError()`
- **CSS classes**: `.msg-error` (messages.css), `.error-bubble` / `.error-header` / `.error-message` / `.error-detail` (messages.css), `.error-actions` / `.error-action-btn` (blocks.css), `.error-boundary` (blocks.css, global crash screen)
- **Action buttons**: Support `primary`/`secondary`/`disabled` states, Enter/Space keyboard activation, `metadata` for URL-based actions. Dismiss removes both DOM and persisted state. Action types: `retry`, `edit`, `contact_support`, `view_details`, `dismiss`, `regenerate`, `switch_model`, `upgrade_plan`, `wait_for_reset`, `pick_model` (opens the model manager panel).

### Quota / Rate-Limit
- `QuotaMonitor` (`quotaMonitor.ts`) proactively warns at configurable thresholds (80%, 50%, 20%, 10%)
- Started after `init_ack` in `main.ts`
- Fed by `rate_limit_state` messages
- `handleRateLimitExhausted()` in `theme.ts` shows input-area notice + disables send button until reset
- Quota bar in status strip (`#quota-bar`) shows token/request usage with color states (green/yellow/red)

### Error Recovery
- **Retryable errors**: Suggested actions include "Retry" (sends `retry_stream`), "Switch Model" (opens model picker), "Wait & Retry" (uses `wait_for_reset`)
- **Non-retryable errors**: "Dismiss" removes error from both DOM and persisted message history
- **Duplicate coalescing**: `handleStreamError()` compares against last error's `userMessage` — same message within 1s refreshes timestamp instead of stacking
- **Queue recovery**: `markStuckSendingAsQueued()` resets items stuck in "sending" state after stream end, allowing retry
- **Global crash**: `window.onerror` + `window.onunhandledrejection` show `#error-boundary` overlay with user-visible message

### Stream End Reasons & Timeline Markers
`showStreamEndReasonMessage()` in `streamOrchestrator.ts` maps `stream_end` reasons to user-visible system messages in the conversation timeline:
| Reason | Message | Retryable |
|---|---|---|
| `ttfb_timeout` | "The model took too long to start responding..." | Yes |
| `timeout` | "Response timed out..." or "Response was cut off (timeout)..." | Yes |
| `hard_timeout` | "Stream interrupted after extended run..." | Yes |
| `aborted` | "Generation interrupted by user." | No |
| `error` | "An error occurred..." (suppressed if error card already exists) | Yes |
| `reconnect_completed` | (Suppressed — emitted by `reconcileAfterReconnect` when the run completed during an SSE outage. The completed assistant message is already on the transcript; a system message would be noise.) | No |

`stream_end` payloads also carry a `source?: "host" | "watchdog" | "abort" | "finalize" | "ttfb" | "reconcile"` discriminator for attribution — useful for tracing and for the webview to decide whether to show a Resume affordance.

### Streaming State Stability & Host-Authoritative Probe Loop

The webview's send button (Send/Stop) is the canonical user-visible streaming indicator. It is driven by TWO flags OR'd together in `updateSendButton` (`sendLogic.ts`):

| Flag | Source | Purpose |
|---|---|---|
| `SessionState.isStreaming` | Optimistic local; set immediately on send, cleared by `stream_end` / `streaming_state:false` | Fast UI feedback before the host acks |
| `SessionState.isServerStreaming` | **Host-authoritative**; only mutated by `streaming_state` and `run_status_result` messages | Ground truth that revives a stale optimistic `false` (or clears a stuck optimistic `true`) |

The send button shows Stop when EITHER flag is true. Capacity accounting (`getStreamCapacityState`) counts sessions where either flag is true.

**Run identity** is tracked alongside the flags: `SessionState.activeServerMessageId` and `SessionState.activeRunId` correlate late chunks with the active run and let the webview reject stale `streaming_state` pushes from a previous run. Both are cleared on `streaming_state:false` and on webview reload.

#### Probe Loop (`probe_run_status` ↔ `run_status_result`)

The webview can ask the host to confirm whether a run is still active. The host queries the server (last assistant message's `time.completed`) and replies authoritatively.

```
Webview → Host: { type: "probe_run_status", sessionId, cliSessionId? }
Host → Webview: { type: "run_status_result", sessionId, cliSessionId?, active, runId?, messageId?, probedAt, serverReachable }
```

The webview triggers a probe in three situations:
1. **Tab switch** (`tabSwitcher.ts:switchTabImpl`) — confirms the switched-to tab's run state.
2. **Non-terminal error** (`handleRequestError` with `mayStillBeRunning: true`) — preserves the Stop button pending probe confirmation.
3. **Send-ack watchdog** (`SEND_ACK_WATCHDOG_MS = 5000ms`, `sendLogic.ts:sendMessage`) — fires if the host hasn't pushed `isServerStreaming:true` within 5s of send (lost `send_prompt`, silent reject, host crash mid-send).

`probeActiveRun` (`StreamCoordinator.ts`) replies `active=false` if the server has a completed assistant message, `active=true` if the run is still in progress, and `serverReachable=false` on HTTP failure (so the webview knows the answer is uncertain).

#### `streaming_state` Payload Extension

The wire format now carries run identity for correlation:

```ts
{ type: "streaming_state"; sessionId; isStreaming; source?: "host" | "watchdog" | "reconnect" | "probe"; cliSessionId?; messageId?; runId? }
```

`source` values:
- `"host"` — normal lifecycle (`startPrompt` / `finalizeStream` / `abort`)
- `"watchdog"` — the 45-min stuck-stream watchdog fired (synthetic terminator)
- `"reconnect"` — `server_disconnected` or per-tab process-crash cleanup
- `"probe"` — answer to `probe_run_status`

The webview writes BOTH flags from any `streaming_state` message, so a single host push can revive a stuck optimistic `false` (G7 fix).

#### Gap Coverage (G1–G10)

| Gap | Symptom | Fix |
|---|---|---|
| **G1** | TTFB (45s) < SSE idle watchdog (90s); TTFB unilaterally cleared streaming while backend kept generating | `setupTtfbTimeout` probes `probeActiveRun` before posting `stream_end`; suppresses stream_end if the run is still active. `source: "ttfb"` on attribution. |
| **G2** | `handleRequestError` cleared `isStreaming` for any error (show_error, provider_error, server_status:"error") | Reads `mayStillBeRunning` from `errorContext`; preserves flag + posts `probe_run_status` when true. New `readMayStillBeRunning` helper in `streamOrchestrator.ts`. |
| **G3** | `server_disconnected` did double-work (setStreaming + manual postMessage) and gave no attribution | Single `setStreaming(id, false, { source: "reconnect" })` call; the emitter handles the post. |
| **G4** | `event_stream_reconnected` reconcile was gated on `tab.isStreaming` — once G1/G2/G3 cleared it, reconnect couldn't reattach | Reconcile now considers BOTH `isStreaming` tabs AND `getInterruptedTabs()` snapshot. |
| **G5** | Transient `session.idle` (between tool calls, during provider retry) triggered premature finalize | `maybeFinalizeStream` defers status-triggered finalizes by `STATUS_FINALIZE_QUIET_MS` (1500ms); any chunk/tool cancels (`cancelPendingStatusFinalize`). |
| **G6** | Run completed during SSE outage → terminal events lost → webview stuck "streaming" for up to 45min | `reconcileAfterReconnect` checks `time.completed` on the last assistant; emits dropped `stream_end` (reason:"reconnect_completed", source:"reconcile"). |
| **G7** | `streaming_state` handler wrote only the optimistic flag; the authoritative backstop was dead code | Handler now writes both flags + stashes run identity; clears identity on stop so a stale push can't revive. |
| **G8** | Optimistic `isStreaming=true` on send with no host ack → stuck Stop button | 5s `SEND_ACK_WATCHDOG_MS` timer in `sendMessage` probes if the host hasn't pushed `isServerStreaming=true`. |
| **G9** | `switchTab` read only the local flag → misrendered Stop after an error/reconnect | Derives from `isStreaming || isServerStreaming`; calls `composer.probeActiveRun()` to reconcile. (Logic now in `tabSwitcher.ts:switchTabImpl`.) |
| **G10** | Per-tab process crash (ADR-010) handler only logged → stuck Stop for 45min | `ChatProvider.handleProcessCrash(processId, tabIds, timestamp)` cleans up via `cleanupTab`, posts `streaming_state:false` (source:"reconnect") + `stream_interrupted`. Wired from `extension.ts:onProcessCrash`. |
| **G11** | TTFB watchdog fired at a hardcoded 90s — too short for reasoning models that "think" before emitting the first token (GLM-5.x, Kimi, DeepSeek-R1, Qwen-QwQ routinely take 60–180s) | `TTFB_TIMEOUT_MS` is now configurable via `opencode.streaming.ttfbTimeoutMs` (default **180s**, range 60s–600s). Resolved at runtime through `StreamCoordinator.resolveTtfbTimeoutMs` so per-workspace overrides take effect on the next stream. Floor/ceiling enforced so a misconfigured value can't re-introduce the bug. |
| **G12** | `.catch(err => log.warn(...))` on `probeActiveRun` silently swallowed probe failures; a single transient network blip during a slow TTFB reverted the Send button mid-thinking | New `probeActiveRunWithRetry` retries up to `PROBE_MAX_ATTEMPTS` (3) with exponential backoff (`PROBE_BACKOFF_BASE_MS` = 1s → 2s → 4s) before falling through to the dead-run path. Emits `probe_retry` / `probe_exhausted` events to the streaming log. |
| **G13** | "Stuck streaming" reports were untriagable — the UI gave no signal beyond "it just stopped" | New `StreamingLog` module (`src/chat/handlers/StreamingLog.ts`) funnels every state transition (`send_dispatched`, `prompt_accepted`, `first_chunk`, `ttfb_warning`, `ttfb_timeout`, `probe_dispatched`, `probe_result`, `probe_retry`, `probe_exhausted`, `stream_end`, `reconnect`, `abort`) to the OpenCode Output channel AND posts `streaming_log` envelopes to the webview. Mirrors opencode CLI's `--print-logs` discipline. Wired from `ChatProvider` constructor via `streamCoordinator.wireStreamingLog(postMessage)`. Toggled by `opencode.streaming.logToOutputChannel` (default true). |
| **G14** | Auto-tab-switch during generation: `sendMessage`'s "active panel doesn't exist" fallback yanked focus onto `active.id` whenever its panel was missing — even if the user was deliberately viewing another valid tab (state desync after init/resume could fire this mid-generation) | New `shouldForceFocusOnSend` helper in `sessionFocus.ts`. `sendLogic.ts::sendMessage` now only calls `switchToTab` when the user is on the welcome screen or has no current valid tab; otherwise the panel is created but the user stays where they are. |
| **G15** | Sidebar/panel toggles (timeline, activity, tasks, subagents) during a stream re-wrapped every line and yanked scroll position | New `pauseForReflow(ms)` on `ScrollAnchor`. Toggles call `pauseActiveAnchorForReflow(150)` so `scrollIfAnchored` is a no-op for ~150ms (long enough to span the reflow + one animation frame); the next chunk resumes normal autoscroll. Wired in `timeline.ts::setupTimelineToggle` + activity/tasks/subagents click handlers in `main.ts`. |
| **G16** | Scroll "haywire" during long sessions — `scrollHeight` polling during streaming raced with chunk arrival | `scrollAnchor.ts` now wires an `IntersectionObserver` sentinel as the PRIMARY "is at bottom?" signal (1px div as last child, rootMargin = ANCHOR_THRESHOLD). Cheaper and more robust than polling scrollHeight mid-stream. Falls back gracefully to scroll/wheel/touch listeners when `IntersectionObserver` is unavailable (older webview). |
| **G17** | Send button stuck "streaming" when the server's `message_complete` / `session.idle` is missed or delayed — the model's own `finish_reason` (emitted via the `step-finish` part) was discarded by `StepFinishHandler`, so the only completion signals were server-level. | `StepFinishHandler` now preserves the `reason` field on the normalized `step_finish` event. `ChatProvider`'s `step_finish` handler treats terminal reasons (`stop`/`end_turn`/`stop_sequence`/`complete` — `tool_use`/`tool_calls` deliberately excluded since those mean mid-loop) as a completion **backstop**: after a `STEP_FINISH_BACKSTOP_DELAY_MS` (500ms) delay, it probes `maybeFinalizeStream`. The delay lets the server's authoritative `message_complete` win when prompt; `maybeFinalizeStream` no-ops once `waitingForCompletion` is cleared. Drop-in safety net — no change to the primary completion path. |

#### Test Coverage
- `tests/unit/streaming-state-stability.test.mjs` (27 tests) — structural coverage for every gap, the wire format, host authority wiring, and reload state clearing.
- `src/chat/handlers/StreamingLog.test.ts` — OutputChannel + webview mirror, malformed-payload rejection, best-effort error swallowing.
- `src/chat/webview/sessionFocus.test.ts` — `shouldForceFocusOnSend` (auto-tab-switch guard), `shouldHonorResumeSessionSwitch` (background-resume guard), plus the existing `shouldHonorActiveSessionChange` + `resolveInitStateTarget` matrix.
- `src/chat/webview/scrollAnchor.test.ts` — `IntersectionObserver` sentinel wiring, `pauseForReflow` guard, graceful fallback when observer unavailable.

### Auto-Tab-Switch Policy (No Yank During Generation)

The webview treats the user's current view as authoritative. Host pushes (`active_session_changed`, `resume_session_data`) are honoured ONLY when doing so cannot steal focus from a tab the user is deliberately viewing. Three pure helpers in `src/chat/webview/sessionFocus.ts` encode this; each is unit-tested in isolation.

| Helper | Triggers when | Rule |
|---|---|---|
| `shouldHonorActiveSessionChange` | host pushes `active_session_changed` (every host-side `setActive`) | Honour only when welcome is visible, current tab is invalid, OR neither current nor target is streaming. Never yank onto a streaming session; never yank away from a streaming session. |
| `shouldForceFocusOnSend` | `sendLogic.ts::sendMessage` finds the active session's panel missing (state desync after init/resume) | Switch only when the user is on the welcome screen or has no current valid tab. Otherwise create the panel but leave the user where they are. |
| `shouldHonorResumeSessionSwitch` | `main.ts` `resume_session_data` handler (host-pushed session hydration) | Honour only when user-initiated (history click), or when the user is on the welcome screen / has no valid tab. Background resumes must never steal focus. |
| `resolveInitStateTarget` | `init_state` (fired on every webview visibility change) | First init honours the host's restored active id. Subsequent inits preserve the user's current tab. |

### Scroll Stability Architecture

`src/chat/webview/scrollAnchor.ts::createScrollAnchor` controls auto-scroll during streaming. Three layers of defence (research: chat-scroll-anchoring literature + TanStack virtual issues + VS Code webview guidance):

1. **Primary signal: `IntersectionObserver` sentinel.** A 1px `<div data-scroll-sentinel>` is the last child of the message list. When it intersects the viewport (within `ANCHOR_THRESHOLD = 80px`), the user is "at the bottom" and autoscroll is anchored. Cheaper than polling `scrollHeight`, doesn't force layout, doesn't race with streaming chunks.
2. **Fallback signals: `scroll`/`wheel`/`touchmove` listeners.** Used when `IntersectionObserver` is unavailable (older webview) and for fast user-driven pause detection (e.g., wheel-up immediately pauses).
3. **Reflow guard: `pauseForReflow(ms)`.** Sidebar/panel toggles call this BEFORE the visibility change so the width-change reflow (every wrapped line re-wraps) doesn't yank the user's scroll position. Default 150ms — long enough to span the reflow + one animation frame, short enough that the next chunk resumes normal autoscroll. Wired from:
   - `timeline.ts::setupTimelineToggle` via `onLayoutReflow` dep → `pauseActiveAnchorForReflow(150)`
   - `main.ts` activity/tasks/subagents toggle handlers

**Native browser scroll anchoring** is left enabled (don't write `overflow-anchor: none` on the message list). The IntersectionObserver sentinel + reflow guard co-operate with it; JS-driven scrolls don't conflict with reflow-driven movements.

### Provider-Specific Error Mapping
`opencodeErrorMapper.ts` handles third-party OpenAI-compatible providers (GLM, DeepSeek, etc.):
- `insufficient_quota`/`quota exceeded` in response body → QUOTA_EXCEEDED error with "Switch provider" action
- HTTP 402 → payment/usage exhausted
- HTTP 429 → rate-limited with provider name in message
- `ProviderAuthError` → auth failure with provider name

### Question Tool Lifecycle & Expiry (B10)

The `question` tool allows the LLM to ask the user questions during execution. Questions are session-scoped on the server — the server stores pending questions in an **in-memory `Map<QuestionID, PendingEntry>`** tied to `InstanceState`. When the server instance is disposed/recreated, all pending questions are lost.

**Architecture**: The extension treats questions as **ephemeral** (matching the server's model). Unanswered questions are NOT persisted across reconnects — only answered questions survive as transcript records. This prevents the "question exists in UI but server returns NotFoundError" mismatch.

**Key files**:
- `src/chat/QuestionExpiryDetector.ts` — categorizes reply failures (expired/transient/rejected/unknown)
- `src/chat/webview/questionBar.ts` — `markStale()`, `getQuestionItem()`, staleness timer (5min), ephemeral `repopulateFromMessages`
- `src/chat/WebviewEventRouter.ts` — `question_answer` handler with B10 expiry-aware catch block; `resolveCliSessionId` short-circuits for existing server session IDs
- `src/chat/webview/css/question-bar.css` — stale warning banner styling
- `src/session/eventHandlers/QuestionHandler.ts` — normalizes `question.asked`/`question.v2.asked` events

**Error categories**:
| Category | Pattern | Retryable | Behavior |
|---|---|---|---|
| `expired` | `Question.NotFoundError`, `request not found` | No | Mark answered, remove from bar, **send answer as text prompt** |
| `transient` | network/timeout/5xx | Yes | B9 rollback, user can retry |
| `server_rejected` | 4xx (non-404) | No | B9 rollback, no retry |
| `unknown` | anything else | No | B9 rollback |

**Expired answer recovery**: When a question expires on the server, the user's answer is sent as a regular text prompt via `streamCoordinator.startPrompt`. The model receives the answer and continues — no retry loop. If the recovery `startPrompt` itself times out (20s hard watchdog in `StreamCoordinator.setupExpiredRecoveryTimeout`), the watchdog:
1. Clears the `promptsInFlight` guard so the auto-send isn't queued
2. Awaits the server abort to complete (preventing race with the new send)
3. Posts `expired_question_recovery_failed` to the webview
4. The webview handler (`main.ts`) pre-fills the prompt input and auto-sends after 100ms (via `sendMessage()`), with zero manual intervention required

**Staleness detection**: Questions older than 5 minutes (`STALENESS_WARNING_MS`) are auto-flagged with a warning banner ("This question may have expired on the server") and a "Continue without answering" button.

**`ensureSession` optimization**: `resolveCliSessionId`, `StreamCoordinator.startPrompt`, and `SessionLifecycleService` skip the `ensureSession` HTTP roundtrip when the tab already has a real server session ID (not a local placeholder). Uses `isLocalPlaceholderSessionId()` consistently.

**Two event paths for question creation**:
1. **Server-first**: `question.asked` SSE → `QuestionHandler` → `question_asked` → `ensureQuestionBlock` (stores + posts to webview)
2. **Tool-stream**: `tool_start` (name="question") → `StreamCoordinator.appendToolStart` → creates question block in `blocksBuffer`

**Answer flow**: Webview → `question_answer` → `WebviewEventRouter` → two branches:
- **v2 path** (has `requestID`): `replyToQuestion(cliSessionId, requestID, answers)` via SDK
- **Legacy path** (no `requestID`): `streamCoordinator.startPrompt()` as follow-up prompt
- **Expired fallback** (v2 fails with `NotFoundError`): answer sent as text prompt via `startPrompt`

### Test Coverage
- **Unit**: `blocks.test.ts`, `queue.test.ts`, `errorHandler.test.ts`, `errorTypes.test.ts`, `opencodeErrorMapper.test.ts`, `quotaMonitor.test.ts`, `toolLifecycle.test.ts`
- **IPC boundary & tiers**: `errorWire.test.ts` (42 tests — `deriveTier` matrix, `deriveTierFromPayload`, `normalizeIncomingError` graceful degradation for null/`[object Object]`/malformed, host→wire→webview round-trip), `errorTiers.test.ts` (16 JSDOM tests — `routeErrorByTier` dispatch, `ErrorStateStore` persistence/reload, Tier-A precedence, reconnect-while-drawn, CTA forwarding)
- **Question expiry**: `QuestionExpiryDetector.test.ts` (error categorization, staleness detection), `questionBar.test.ts` (markStale, createdAt, repopulation staleness), `WebviewEventRouter.questionAnswer.test.ts` (B10 structural tests)
- **Visual**: `tests/visual/error-display.spec.ts` (rendering, actions, keyboard, states)
- **E2E**: `tests/webview/error-handling-e2e.spec.ts` (full lifecycle: prompt_rejected, rate_limit, show_error, provider_error, duplicate coalescing)

## CSS / Theme

CSS variables defined in `src/chat/webview/css/tokens.css` with VS Code token fallbacks. ThemeManager overrides injected via `applyThemeVars()`. Theme presets only style the chat webview — must NOT contribute VS Code workbench themes or call `workbench.action.setTheme`.

### Unified Design System Tokens (tokens.css)

All components share a strict, coordinated token system:

- **Spacing:** 4px baseline grid (`--space-0` through `--space-16`)
- **Border widths:** `--border-width-thin` (1px), `--border-width-medium` (2px), `--border-width-thick` (3px)
- **Border radius:** `--radius-xs` (2px) through `--radius-full` (9999px)
- **Shadows:** Flat, VS Code-native — minimal depth (`--shadow-sm` through `--shadow-xl`, `--shadow-mission`)
- **Typography:** Dual scale (`--text-2xs` through `--text-2xl`, `--oc-font-size-2xs` through `--oc-font-size-2xl`)
- **Z-index scale:** Layered contract from `--z-base` (0) through `--z-lightbox` (500) with explicit stacking contexts

#### Component-Specific Tokens
- **Panels:** `--panel-bg`, `--panel-border`, `--panel-radius`, `--panel-padding`, `--panel-header-height`
- **Accordion/Sidebar:** `--accordion-header-height`, `--accordion-header-padding`, `--accordion-chevron-size`
- **Timeline:** `--timeline-width`, `--timeline-item-padding`, `--timeline-dot-size`
- **Context Usage:** `--ctx-bar-height`, `--ctx-track-width`, `--ctx-track-height`, `--ctx-dot-size`
- **Files Changed:** `--cf-dropdown-max-height`, `--cf-item-indent`, `--cf-chevron-size`, `--cf-stat-radius`
- **Pinned Prompts:** `--rp-card-radius`, `--rp-card-padding`, `--rp-chip-radius`

### Theme System
- **Theme state:** `src/theme/ThemeManager.ts` — presets, CLI file discovery, merge (preset → CLI → user), 30s TTL cache, FS watchers
- **Theme controller:** `src/chat/ThemeController.ts` — config persistence, validation, webview push (uses `isValidCssColor`)
- **Color validation:** `src/utils/colorValidation.ts` — shared `isValidCssColor()` accepting hex (#RGB/#RRGGBB/#RRGGBBAA), rgba, hsla, var(), transparent, color-mix()
- **Webview apply:** `src/chat/webview/theme.ts` — `applyThemeVars()` with XSS protection (blocks url/expression/javascript/data:text-html)
- **Webview customizer:** `src/chat/webview/ui/themeCustomizer.ts` — preset cards, CLI theme browser, color pickers, preview swatch
- **XDG paths:** `getXdgConfigDir()` / `getHomeDir()` module-level helpers in ThemeManager.ts (single source of truth)
- **CLI theme dedup:** `discoverCliThemes()` canonicalizes paths via `fs.realpathSync` to skip symlinked duplicates

`cli-default` uses `var(--vscode-*)` for canvas colors; other presets use explicit hex. All 6 presets (cli-default, light, dark, high-contrast, high-contrast-dark, high-contrast-light) define complete property sets including diff, markdown, and syntax fields.
`FIELD_MAP`: `background` → `panelBg`, `text` → `panelFg`, `backgroundPanel` → `editorBg`, `textMuted` → `mutedFg`, `border` → `borderColor`.

## Keyboard Shortcuts

### VS Code Global Commands (`package.json` `keybindings`)
| Shortcut | Command | When |
|----------|---------|------|
| `Ctrl+I` | `opencode-harness.quickChat` | `editorTextFocus` |
| `Ctrl+Alt+O` | `opencode-harness.toggleFocus` | — |
| `Ctrl+Alt+N` | `opencode-harness.newSession` | — |
| `Alt+K` | `opencode-harness.insertMention` | `editorTextFocus` |
| `Escape` | `opencode-harness.stop` | `focusedView == 'opencode-harness.chat'` |
| `Ctrl+Shift+Escape` | `opencode-harness.stop` | `focusedView == 'opencode-harness.chat'` |
| `Ctrl+Shift+/` | `opencode-harness.openCommandsPalette` | `focusedView == 'opencode-harness.chat'` |
| `Alt+Shift+Tab` | `opencode-harness.cycleMode` | `focusedView == 'opencode-harness.chatView'` |

### Webview Document-Level Shortcuts (when webview is focused)
| Shortcut | Action | Source |
|----------|--------|--------|
| `Ctrl/Cmd+L` | Focus prompt input | `main.ts` |
| `Ctrl/Cmd+Alt+1` | Set Plan mode | `modeDropdown.ts` |
| `Ctrl/Cmd+Alt+2` | Set Build mode | `modeDropdown.ts` |
| `Ctrl/Cmd+Alt+3` | Set Auto mode | `modeDropdown.ts` |
| `Alt+Shift+Tab` | Cycle mode forward (plan→build→auto→plan) | `modeDropdown.ts` |
| `Ctrl/Cmd+Shift+T` | Toggle thinking blocks | `thinkingToggle.ts` |
| `Ctrl/Cmd+F` | Open message search | `messageSearch.ts` |
| `Ctrl+Shift+Alt+L` | Toggle timeline sidebar | `main.ts` |
| `Ctrl+Shift+Alt+T` | Toggle todos/changed-files panel | `main.ts` |
| `Ctrl+Shift+Alt+K` | Toggle checkpoint panel | `main.ts` |
| `Ctrl+Shift+Alt+S` | Open skills modal | `main.ts` |
| `Ctrl+Shift+Alt+H` | Open session history | `main.ts` |
| `Ctrl+Shift+Alt+N` | New session | `main.ts` |
| `Escape` | Close modal / dropdown / search | Various |

### Prompt Input Shortcuts (when prompt textarea is focused)
| Shortcut | Action | File |
|----------|--------|------|
| `Enter` | Send message | `inputHandlers.ts` |
| `Ctrl/Cmd+Enter` | Send or steer (if streaming) | `inputHandlers.ts` |
| `Ctrl/Cmd+T` | New tab | `inputHandlers.ts` |
| `Ctrl/Cmd+W` | Close tab | `inputHandlers.ts` |
| `Ctrl/Cmd+Tab` | Next tab | `inputHandlers.ts` |
| `Ctrl/Cmd+Shift+Tab` | Previous tab | `inputHandlers.ts` |
| `Ctrl/Cmd+1` | Steer: Interrupt | `inputHandlers.ts` |
| `Ctrl/Cmd+2` | Steer: Append | `inputHandlers.ts` |
| `Ctrl/Cmd+3` | Steer: Queue | `inputHandlers.ts` |
| `Ctrl/Cmd+K` | Open commands palette | `inputHandlers.ts` |

### Queue Items Keyboard Shortcuts (when queue is focused)
| Shortcut | Action | File |
|----------|--------|------|
| `↑` / `↓` | Navigate between chips | `queueRenderer.ts` |
| `Home` / `End` | Jump to first / last chip | `queueRenderer.ts` |
| `Delete` / `Backspace` | Remove focused chip | `queueRenderer.ts` |
| `F2` | Edit focused chip text | `queueRenderer.ts` |
| `Alt+↑` / `Alt+↓` | Reorder chip up / down | `queueRenderer.ts` |
| `Alt+Home` / `Alt+End` | Move chip to front / back | `queueRenderer.ts` |
| `Escape` | Exit queue navigation / cancel edit | `queueRenderer.ts` |

**Queue-state messages from host:** `queue_state` (full sync, renders chips) · `prompt_queued` (log-only, chips via queue_state) · `append_cancelled` (notification on abort)

### Dropdown/Modal Navigation
All dropdowns and modals support: `ArrowUp`/`ArrowDown` to navigate, `Enter`/`Space` to select, `Escape` to close, `Home`/`End` for first/last.
- Mode dropdown (`modeDropdown.ts`)
- Model selector (`model-dropdown.ts`)
- Variant selector (`variant-selector.ts`)
- Settings menu (`settingsMenu.ts`)
- Commands palette (`commands-modal.ts`)
- Mention autocomplete (`mentions.ts`)

### VS Code Commands (remappable via Keyboard Shortcuts editor)
| Command ID | Default Key | Purpose |
|-----------|-------------|---------|
| `opencode-harness.cycleMode` | `Alt+Shift+Tab` | Cycle session mode |
| `opencode-harness.setBuildMode` | (none) | Set mode to Build |
| `opencode-harness.setPlanMode` | (none) | Set mode to Plan |
| `opencode-harness.setAutoMode` | (none) | Set mode to Auto |
| `opencode-harness.showCost` | (none) | Show session cost |
| `opencode-harness.continueLastSession` | (none) | Resume most recent session |

### Settings
- `opencode.defaultMode`: Default session mode for new tabs (`"build"`, `"plan"`, or `"auto"`)
- `opencode.sessions.maxConcurrentStreams`: Max concurrent AI streams across all tabs (default 5)
- `opencode.chat.fontSize`: Font size (px) for chat panel input and message text, clamped 8–32 (default 14; 0 = inherit editor font size)
- `opencode.chat.fontFamily`: CSS font-family for chat panel input and message text (default `""` = inherit editor monospace)
- `opencode.streaming.ttfbTimeoutMs`: Time-to-first-byte timeout in ms (default 180000 = 3 minutes; range 60000–600000). Raised from the original 90s default after research showed reasoning models (GLM-5.x, Kimi, DeepSeek-R1, Qwen-QwQ) routinely take 60–180s to emit the first token. Decrease for snappy first-class providers; increase if your workflow regularly hits the timeout while the model is still thinking. Read at runtime via `StreamCoordinator.resolveTtfbTimeoutMs` so workspace changes take effect on the next stream — no reload required.
- `opencode.streaming.logToOutputChannel`: When true (default), mirror streaming-lifecycle events (send, ttfb, probe, reconnect, abort) to the **OpenCode** Output channel. Mirrors opencode CLI's `--print-logs` discipline; useful for diagnosing "Send button reverted while still generating" symptoms.

### Implementation Details
- ### UI/UX Patterns (v0.3.2+)

Action placement follows progressive disclosure:
- **Primary controls** always visible: Mode switcher, Model selector, History, Skills, Send/Stop
- **Secondary controls** in Settings overflow (⋮): Checkpoints, Todos, Activity, Tasks, Timeline, MCP, Theme, Tab Instructions, Keyboard Shortcuts
- **Contextual actions**: Diff Accept/Reject primary · Review/Open behind ⋮ menu · Session actions behind ⋮ menu
- **Keyboard shortcut reference**: `?` or `Shift+/` opens the shortcut modal; also accessible from Settings → Keyboard Shortcuts and Welcome screen
- **Panels auto-show**: Todos panel opens once when first todos arrive (respects dismiss-per-session); Subagent panel uses badge-only notification (no auto-open)
- **Steer while streaming**: Enter = Queue a follow-up (default) · ⌘/Ctrl+Enter = Interrupt & send now. A Queue ▏Interrupt segmented toggle (visible only during streaming) sets what Enter does per tab. (The old Interrupt/Append/Queue trio + Ctrl+1/2/3 was removed.) Session modes: Alt+1/2/3 (Plan/Build/Auto), work in the composer.
- **Adding new actions**: Use keyboard shortcuts and overflow menus before adding new visible buttons. Prefer progressive disclosure over permanent controls.

**Debounce**: Mode cycling is debounced at 200ms to prevent accidental rapid cycles.
- **Modal gating**: `Alt+Shift+Tab` and global shortcuts are suppressed when `[aria-modal="true"]` elements are visible.
- **Text input protection**: Global shortcuts do not fire when the active element is an input, textarea, select, or contenteditable — preserving normal typing behavior.
- **Focus traps**: `Tab`/`Shift+Tab` within modals wrap focus (see `src/chat/webview/focus-trap.ts`).
- **Mode cycling**: Defined in `src/chat/webview/ui/modeDropdown.ts` → `cycleModeForward()`. Uses `MODE_ORDER = ["plan", "build", "auto"]`.

## Code Exploration Policy

Always use jCodemunch-MCP tools for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** Use `Read` when you need to edit a file — the agent harness requires a `Read` before `Edit`/`Write` will succeed. Use jCodemunch tools to *find and understand* code, then `Read` only the specific file you're about to modify.

**Start any session:**
1. `resolve_repo { "path": "." }` — confirm the project is indexed. If not: `index_folder { "path": "." }`
2. `suggest_queries` — when the repo is unfamiliar

**Finding code:**
- symbol by name → `search_symbols` (add `kind=`, `language=`, `file_pattern=`, `decorator=` to narrow)
- decorator-aware queries → `search_symbols(decorator="X")` to find symbols with a specific decorator (e.g. `@property`, `@route`); combine with set-difference to find symbols *lacking* a decorator (e.g. "which endpoints lack CSRF protection?")
- string, comment, config value → `search_text` (supports regex, `context_lines`)
- database columns (dbt/SQLMesh) → `search_columns`

**Reading code:**
- before opening any file → `get_file_outline` first
- one or more symbols → `get_symbol_source` (single ID → flat object; array → batch)
- symbol + its imports → `get_context_bundle`
- specific line range only → `get_file_content` (last resort)

**Repo structure:**
- `get_repo_outline` → dirs, languages, symbol counts
- `get_file_tree` → file layout, filter with `path_prefix`

**Relationships & impact:**
- what imports this file → `find_importers`
- where is this name used → `find_references`
- is this identifier used anywhere → `check_references`
- file dependency graph → `get_dependency_graph`
- what breaks if I change X → `get_blast_radius`
- what symbols actually changed since last commit → `get_changed_symbols`
- find unreachable/dead code → `find_dead_code`
- class hierarchy → `get_class_hierarchy`

## Session-Aware Routing

**Opening move for any task:**
1. `plan_turn { "repo": "...", "query": "your task description", "model": "<your-model-id>" }` — get confidence + recommended files; the `model` parameter narrows the exposed tool list to match your capabilities at zero extra requests.
2. Obey the confidence level:
   - `high` → go directly to recommended symbols, max 2 supplementary reads
   - `medium` → explore recommended files, max 5 supplementary reads
   - `low` → the feature likely doesn't exist. Report the gap to the user. Do NOT search further hoping to find it.

**Interpreting search results:**
- If `search_symbols` returns `negative_evidence` with `verdict: "no_implementation_found"`:
  - Do NOT re-search with different terms hoping to find it
  - Do NOT assume a related file (e.g. auth middleware) implements the missing feature (e.g. CSRF)
  - DO report: "No existing implementation found for X. This would need to be created."
  - DO check `related_existing` files — they show what's nearby, not what exists
- If `verdict: "low_confidence_matches"`: examine the matches critically before assuming they implement the feature

**After editing files:**
- If PostToolUse hooks are installed (Claude Code only), edited files are auto-reindexed
- Otherwise, call `register_edit` with edited file paths to invalidate caches and keep the index fresh
- For bulk edits (5+ files), always use `register_edit` with all paths to batch-invalidate

**Token efficiency:**
- If `_meta` contains `budget_warning`: stop exploring and work with what you have
- If `auto_compacted: true` appears: results were automatically compressed due to turn budget
- Use `get_session_context` to check what you've already read — avoid re-reading the same files

## Model-Driven Tool Tiering

Your jcodemunch-mcp server narrows the exposed tool list based on the model you are running as. To avoid wasting requests on primitives when a composite would do, always include `model="<your-model-id>"` in your opening `plan_turn` call.

Replace `<your-model-id>` with your active model:
- Claude Opus variants → `claude-opus-4-7` (or any `claude-opus-*`)
- Claude Sonnet variants → `claude-sonnet-4-6`
- Claude Haiku variants → `claude-haiku-4-5`
- GPT-4o / GPT-5 / o1 / Llama → use the model id as printed by your runner

The `model=` parameter rides on the existing `plan_turn` call — it does **not** add a separate tool invocation. If `plan_turn` is not appropriate for a non-code task, call `announce_model(model="...")` once instead.

