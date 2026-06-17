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

### Webview Composer Modules (delegated from composer.ts)

| Module | File | Responsibility |
|--------|------|---------------|
| `slashCommands` | `src/chat/webview/slashCommands.ts` | /command dispatching |
| `queueRenderer` | `src/chat/webview/queueRenderer.ts` | Queue chip UI (ARIA listbox, keyboard nav, drag-reorder, edit/remove/retry) |
| `sendLogic` | `src/chat/webview/sendLogic.ts` | Send/abort/steer + stream capacity |
| `inputHandlers` | `src/chat/webview/inputHandlers.ts` | Keyboard + paste + resize handlers |

### Webview Timeline Modules (delegated from timeline.ts)

| Module | File | Responsibility |
|--------|------|---------------|
| `timeline` | `src/chat/webview/timeline.ts` | Conversation timeline sidebar: toggle, render, keyboard nav, progress, history condensation, per-turn model indicator |
| `thinkingToggle` | `src/chat/webview/thinkingToggle.ts` | Global thinking block visibility toggle (extracted from timeline for SRP) |
| `scrollMarkers` | `src/chat/webview/ui/scrollMarkers.ts` | Scroll marker dots, jump-to-bottom, scrollToTurn with injected timers |

### Webview Diff Viewer Modules

| Module | File | Responsibility |
|--------|------|---------------|
| Diff rendering | `src/chat/webview/renderer.ts` | `renderNewDiffBlock`, `createDiffTableWrapper`, `createDiffLineRow`, `createHunkHeaderRow`, `createHunkActionCell`, `toggleDiffWrap`, `renderPendingDiffActions`, `createRevertDiffButton`, `createHunkNavButtons`, `inferLanguageFromPath`, `createDiffViewToggle`, `appendSideBySideHunkRows`, `pairLinesForSideBySide`, `createSideBySideLineRow` |
| Word-level diff | `src/chat/webview/wordDiff.ts` | `computeWordDiffs()` — character-level diff of paired removed/added lines using `diff-match-patch`, emits `<ins>`/`<del>` spans via `line.wordDiffHtml` |
| Diff types | `src/chat/webview/types.ts` | `DiffBlock`, `DiffHunk`, `DiffLine` (with `wordDiffHtml?`) |
| Model indicator | `src/chat/webview/messageRenderer.ts` | Per-turn model badge in message headers: `[modelShortName]` CLI-style notation, provider prefix stripped, `text-overflow: ellipsis` truncation, streaming dot `::before` pseudo-element, WCAG `aria-label` |
| Turn summary | `src/chat/webview/renderer.ts` | `groupMessagesIntoTurns()` populates `TurnSummary.model` from `ChatMessage.model`; timeline items render compact `.timeline-item-model` badge |
| Changed-files dropdown | `src/chat/webview/changed-files-dropdown.ts` | Per-file change tree with stats, hunk previews, per-hunk revert, per-file Undo button, bulk Revert All |
| Hunk staging | `src/chat/diff/hunkRevertPlan.ts`, `hunkStaging.ts` | LCS-based per-hunk revert planning, host-authoritative hunk computations |
| Host diff handlers | `src/chat/WebviewEventRouter.ts` (~lines 500-560, 660-670, 1193-1210) | `accept_diff`, `reject_diff`, `revert_diff`, `accept_hunk`, `reject_hunk`, `revert_hunk`, `get_file_hunks`, `get_file_diff`, `undo_file`, `revert_all_files` |
| Diff CSS | `src/chat/webview/css/blocks.css` (~lines 1330-1600) | `.diff-block`, `.diff-table`, `.diff-line--added`, `.diff-line--removed`, `.diff-line-num--old/new`, `.diff-wrap-toggle`, `.diff-hunk-collapse`, `.diff-hunk-nav`, `.diff-view-toggle`, `.diff-table-wrapper--side-by-side` |
| Wrap toggles | `src/chat/webview/renderer.ts` | `readDiffWrapPreference`, `persistDiffWrapPreference`, `readCodeWrapPreference`, `persistCodeWrapPreference`, `readDiffViewModePreference`, `persistDiffViewModePreference` |

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
3. **Extension routing**: `ChatProvider.ts` sends `request_error` or `webview_request_error` messages to webview, optionally carrying the `ErrorContext`
4. **Webview handling**: `main.ts` dispatches to `handleRequestError()` → `handleStreamError()` in `streamHandlers.ts` which:
   - Renders an `ErrorDisplay` component (`errorComponents.ts`) with progressive disclosure
   - Creates a persisted `ErrorBlock` in the message list via `createErrorBlock()` 
   - Converts `ErrorContext.suggestedActions` → `ErrorActionButton[]` to flow into the block-level renderer

### Error Message Types (Host → Webview)
| Type | Source | Handler | Notes |
|---|---|---|---|
| `request_error` | `MessagePostService.ts` | `main.ts:2275+` | Carries `errorContext` for structured display |
| `webview_request_error` | `ChatProvider.ts` | `main.ts:2272+` | Legacy path, now also carries `errorContext` |
| `prompt_rejected` | `StreamCoordinator.ts` | `main.ts:2256+` | Shows rejection reason as in-stream error |
| `show_error` | Any host code | `main.ts` | Shows arbitrary error message in-stream |
| `provider_error` | Provider config | `main.ts` | Surfaces provider config errors to user |
| `server_status` (error) | `SessionManager` | `main.ts:1912+` | Maps through error context if available |
| `rate_limit_exhausted` | `RateLimitMonitor` | `main.ts:2260+` | Shows input-area banner + in-stream error |
| `rate_limit_state` | `RateLimitMonitor` | `main.ts:2084+` | Feeds quota bar + QuotaMonitor |

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

**Expired answer recovery**: When a question expires on the server, the user's answer is sent as a regular text prompt via `streamCoordinator.startPrompt`. The model receives the answer and continues — no retry loop.

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
- **Question expiry**: `QuestionExpiryDetector.test.ts` (error categorization, staleness detection), `questionBar.test.ts` (markStale, createdAt, repopulation staleness), `WebviewEventRouter.questionAnswer.test.ts` (B10 structural tests)
- **Visual**: `tests/visual/error-display.spec.ts` (rendering, actions, keyboard, states)
- **E2E**: `tests/webview/error-handling-e2e.spec.ts` (full lifecycle: prompt_rejected, rate_limit, show_error, provider_error, duplicate coalescing)

## CSS / Theme

CSS variables defined in `src/chat/webview/css/tokens.css` with VS Code token fallbacks. ThemeManager overrides injected via `applyThemeVars()`. Theme presets only style the chat webview — must NOT contribute VS Code workbench themes or call `workbench.action.setTheme`.

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

### Implementation Details
- ### UI/UX Patterns (v0.3.2+)

Action placement follows progressive disclosure:
- **Primary controls** always visible: Mode switcher, Model selector, History, Skills, Send/Stop
- **Secondary controls** in Settings overflow (⋮): Checkpoints, Todos, Activity, Tasks, Timeline, MCP, Theme, Tab Instructions, Keyboard Shortcuts
- **Contextual actions**: Diff Accept/Reject primary · Review/Open behind ⋮ menu · Session actions behind ⋮ menu
- **Keyboard shortcut reference**: `?` or `Shift+/` opens the shortcut modal; also accessible from Settings → Keyboard Shortcuts and Welcome screen
- **Panels auto-show**: Todos panel opens when todos arrive; Subagent panel opens when subagents start running
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

