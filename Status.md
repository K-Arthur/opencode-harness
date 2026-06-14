# Status.md

## Last Updated: 2026-06-13
## Project State: steering/queueing + keyboard redesign (Queue default / Interrupt explicit; Alt+1/2/3 modes) + SDK 1.17.6 + prior fuzzy-search/streaming/a11y fixes (TDD)

### Recent Work (2026-06-13): Steering / queueing redesign + keyboard de-conflict + SDK bump
- **Symptom:** sending a message mid-stream showed a red "Stream error — The request was cancelled. Aborted"; the three steer modes (Interrupt/Append/Queue) were inconsistent (Append gave no feedback); steer `Ctrl+1/2/3` clashed with the plan/build/auto shortcuts, which never fired from the composer anyway.
- **Root causes:** (1) "interrupt" was the default and did `abort()` → the server's late `MessageAbortedError` (SSE) was mapped to an error card by `ChatProvider`'s `server_error` handler; the `abortedTabs` flag cleared after one tick, too soon to suppress it. (2) steer digits in `inputHandlers` swallowed `Ctrl+Alt+digit`; mode shortcuts in `modeDropdown` bailed on `isTextEntryTarget`.
- **Fix — behavior:** collapse to **Queue (default)** + **Interrupt (explicit)**; remove "Append" (folded into Queue) and its `appendCallbacks`/`append_cancelled` plumbing + the dead `add_to_queue` handler. Add a self-expiring intentional-abort window (`StreamCoordinator.wasIntentionallyAborted`) consulted by `server_error` (via new pure `isAbortErrorValue` in `chatUtils`) so intentional aborts never show an error or kill the replacement run.
- **Fix — keyboard:** composer **Enter** = send(idle)/queue(streaming), **⌘/Ctrl+Enter** = send(idle)/interrupt-and-send(streaming, one-shot), **Shift+Enter** = newline; session modes **Alt+1/2/3** now work in the composer (match `e.code`); steer `Ctrl+1/2/3` removed. Help modal updated.
- **Fix — frontend:** streaming-only **Queue | Interrupt** segmented toggle (re-shows on tab switch via `syncSteerAffordance`); CSS + a11y (`aria-keyshortcuts` Alt+1/2/3) updated.
- **SDK:** bumped `@opencode-ai/sdk` → **1.17.6** (latest; v1 prompt path unchanged); classified 3 new v2 events in the coverage contract. v2 `delivery:"steer"|"queue"` noted as a future enhancement.
- **Tests:** RED→GREEN across `chatUtils` (isAbortErrorValue), `ChatProvider`/`StreamCoordinator` (abort suppression, append removal), `SteerPromptHandler` (queue default + legacy coercion), `modeDropdown` (Alt+1/2/3 incl. in text input), `steerMode`, `input-handlers-behavioral` (Enter/Cmd+Enter), regression-smoke. Full unit + message-contract + roundtrip green; typecheck clean.

### Recent Fix (2026-06-13): Fuzzy command + skill search — custom commands no longer "missing"
- **Symptom:** custom commands (e.g. `.opencode/commands/code-review.md`) and MCP/skill commands appeared to be missing from the slash UI; you also couldn't search by characters that don't begin the command name.
- **Root cause:** the inline `/` dropdown filtered with `startsWith` and the commands palette + skills search with `includes`. A command whose *name* didn't begin with the typed characters never showed — so `/review` never surfaced `/code-review`, and `/cr` found nothing. Custom commands *do* flow through the server's `command.list()` (opencode reads `.opencode/commands/*.md`), but the prefix filter hid them.
- **Fix:** new pure, DOM-free `fuzzyMatch.ts` (`fuzzyScore` / `scoreCommandMatch` / `rankByFuzzy`). Names match by subsequence, descriptions by substring; results rank best-first (exact › contiguous prefix › word-boundary › scattered; a name match always tiers above a description-only match). Wired into all three surfaces so they can't drift: inline `/` dropdown (`mentions.ts`), commands palette incl. stash search (`commands-modal.ts`), and host-side skill search (`WebviewEventRouter.search_skills`). (`src/chat/webview/fuzzyMatch.ts`, `mentions.ts`, `commands-modal.ts`, `src/chat/WebviewEventRouter.ts`)
- **Not a bug (verified):** `.opencode/prompts/*.md` (client-side variable-templating prompts, `PromptManager` → "Custom" badge) and `.opencode/commands/*.md` (server-executed, "Server"/"MCP"/"Skill" badge) are deliberately separate features with different execution paths (`resolveCustomPromptVariables` vs `sendCommand`). No directory change made.
- **Follow-up polish:** the inline `/` dropdown now shows a per-command origin badge (`Built-in`/`Server`/`MCP`/`Skill`/`Custom`, with a per-source icon + accent, matching the palette) and caps at 50 fuzzy-ranked rows with a non-interactive "+N more" hint so a short query against a large MCP/skill set can't run away. `MentionItem` gained an optional `badge`. (`mentions.ts`, `types.ts`, `css/components.css`)
- **Tests:** +34 RED-first (`fuzzyMatch.test.ts` ×23 incl. hand-rolled property checks; commands-modal fuzzy behaviour ×5; mentions badge/cap behaviour ×6) plus updated `mentions.test.ts` assertions. Full unit suite (3413 tests) + message-contract + roundtrip green; typecheck clean; design-token discipline green (badge uses `--text-2xs`, no raw px).

### Recent Fix (2026-06-13): Streaming remnant, switch-marker UX, and modal focus a11y
- **Streaming never recognised as complete (empty bubble + stuck "live" dot).** A stream restart for a new message id (agent/model switch mid-turn) finalized the prior bubble's tool calls but never removed the orphaned empty assistant placeholder — leaving an empty bubble whose pulsing `.message.assistant.streaming` dot never cleared. `handleStreamStart` now removes an empty prior placeholder (array + DOM), or re-renders a non-empty prior as finalized so the dot stops. New exported `isEmptyStreamingMessage()`. (`src/chat/webview/streamHandlers.ts`)
- **Agent/Model "switched" cards were verbose and mis-placed.** (1) The normalizer stores the FULL event type (`session.next.agent.switched`) but renderers compared the bare form, so the heavy activity-card path ran instead of the compact pill — fixed with a shared `isSwitchEventType()`. (2) `session.next.*` switches arrive at turn-end and were appended at the transcript bottom; new `switchInsertIndex()`/`decideSwitchPlacement()` place them before the trailing assistant generation (×N coalescing preserved) on both host and webview. (`src/session/activityCoalesce.ts`, `SessionStore.ts`, `src/chat/webview/switchEvent.ts`, `renderer.ts`, `messageRenderer.ts`, `main.ts`)
- **Modal focus management (WCAG 2.4.3 / 2.1.2).** New `mountModalFocus()` (capture invoker → focus in → trap Tab → restore on release) wired into Model Manager (was leaking Tab behind the dialog, no restore) and Tool Permissions (never moved focus into the dialog). (`src/chat/webview/focus-trap.ts`, `model-manager.ts`, `permissionConfig.ts`)
- **Icon collision + welcome a11y.** Input-bar "Edit tab instructions" no longer shares the header "More options" cog (distinct notes icon); the welcome "Shortcuts" button is no longer a focusable control inside an `aria-hidden` container (WCAG 4.1.2). (`src/chat/webview/index.html`)
- **ARIA role corrections.** `#context-usage` (no `aria-valuenow`, focusable, opens a dropdown) changed `role="progressbar"` → `role="button"`; `#mode-dropdown` wrapper dropped its mismatched `role="radiogroup"` (it wraps a listbox combobox, not radios). Verified non-issues: the two conversation-timeline toggles stay `aria-pressed`-synced (deliberate quick-access), and the input bottom bar already `flex-wrap`s so it never clips on narrow sidebars. (`src/chat/webview/index.html`)
- **Layout/grouping pass.** The "More options" menu is grouped into labelled Panels/View/Configure sections (`role="group"` + `aria-label`); the welcome view now leads with the New/Continue CTA and moves the history search box down beside the recent-sessions list it filters. Keyboard traversal and all id-based wiring preserved; +1 grouped-nav test. (`src/chat/webview/index.html`, `css/layout.css`, `settings-menu.behavior.test.ts`)
- **Welcome model chip keyboard access.** `#welcome-model-ctx` (click-only `<span>` that opens the model manager) is now a keyboard-operable `role="button"` (Enter/Space). Audited all focusable custom widgets — the rest were already operable. (`index.html`, `ui/welcomeView.ts`)
- **Note (reverted):** an attempt to hide the welcome search box for "new" users was reverted — the Playwright welcome spec correctly enforces that search stays visible because it queries server-side history, not the webview's local session list. Kept as a guard against re-introducing the bug.
- **Visual tests:** no spec uses `toHaveScreenshot` (the `*-snapshots/*.png` are orphaned from an older revision), so no snapshot re-baseline is needed. The functional Playwright welcome spec passes by inspection; it can't be executed in this environment (Playwright's `chrome-headless-shell` browser isn't installed — `npx playwright install chromium-headless-shell` to run locally).
- **Tests:** +25 (each fix RED-first where applicable): focus-trap `mountModalFocus` ×9, restart remnant ×3, `isSwitchEventType` ×4, `switchInsertIndex`/`decideSwitchPlacement` ×9. Full unit suite + message-contract + roundtrip green; typecheck clean.

### Recent Fix (2026-06-11): Two-session lag — persistence amplification + virtual-list lifecycle (5 root causes, TDD)
- **Symptom:** UI lag with only two open sessions; slow session switching. The streaming/render pipeline (2026-06-02 audit) was healthy — the cost was in persistence and the virtual-list lifecycle. Full record: `docs/performance-audit.md` §"2026-06-11".
- **RC1 — webview `setState` full-state churn:** every debounced save handed the entire state (all sessions × all messages, ~2.9 MB at 2×500 msgs) to `vscode.setState` (serialize + IPC), fired by scroll saves, stream block boundaries, token updates. Now persists a bounded snapshot (last 50 msgs/session, deep-trim to 10 over the 2 MB budget); `doPrune`/`schedulePrune` full-state stringify machinery deleted. Payload 2.9 MB → 289 KB. (`src/chat/webview/state.ts`)
- **RC2 — virtual list:** placeholders were never observed → scroll-back restore was dead code (pruned history = permanent empty boxes), masked by resume's dispose→`restoreAll()`→recreate cycle which synchronously re-rendered every detached message at switch time. Placeholders now observed (restore works), `dispose({restoreDom:false})` on close/delete/rebuild, resume reuses the existing list when the DOM wasn't rebuilt. (`src/chat/webview/virtualList.ts`, `main.ts`)
- **RC3 — open-tab clicks triggered full server refetch:** recent-list/history-modal clicks always posted `resume_session` (host re-fetches the ENTIRE transcript, rewrites the store, re-pushes 50 messages). New `openSession` router: open tabs switch locally; closed sessions resume; post-compaction keeps the true refetch. (`src/chat/webview/main.ts`)
- **RC4 — host `SessionStore.flush()` serialized the whole store** (~28 MB at 10×1000 msgs → ~170 ms per 500 ms-debounced flush + state-DB write). Now routes through pure `buildPersistedSessions(sessions, 200)`: 200 msgs/session persisted, in-memory unbounded, server remains source of truth (resume/backfill re-fetch). 170 ms → 16 ms, 28 MB → 5.6 MB. (`src/session/SessionStore.ts`, `sessionUtils.ts`)
- **RC5 — `TimestampUpdater` memory leak:** element-keyed Map never pruned; tick() now drops `isConnected === false` entries. (`src/chat/webview/timestampUpdater.ts`)
- **Also:** init_state/resume virtual lists read messages through `stateManager` (canonical in-place array) instead of capturing hydration payload arrays (stale-closure hazard exposed by working scroll-back restore).
- **Language review verdict:** no Rust/WASM/native justified — bottlenecks were redundant serialization and wasted DOM renders, removed in TypeScript.
- **Tests:** +21 new (each fix landed RED first): 7 state snapshot, 4 virtualList restore/dispose, 4 openSession routing, 4 buildPersistedSessions, 2 timestamp pruning. Full suite 0 fail; typecheck clean; production bundle gate green (ext 544.0/545 KB, main 699.6/700 KB).
- **Caveat:** no live-host profiling available in the work environment; serialize/payload wins measured via reproducible node benchmarks of the real code paths. Manual two-session checklist to be run post-reinstall.

### Recent Feature (2026-05-31): Automatic opencode CLI install on activation
- **The required opencode CLI is now installed for the user.** VS Code has no install-time hook, so detect-and-install runs on activation. Default is **prompt-once** (Install / Manual Instructions / Not Now); declines are remembered in `globalState` to avoid nagging. macOS/Linux use the official installer (downloaded, validated, run as `bash <file>` with `shell:false` — no `curl | bash`; installs to `~/.opencode/bin`); Windows uses `npm i -g opencode-ai` (or manual). New `opencode.autoInstall` setting (`prompt`|`auto`|`off`) and `OpenCode: Install CLI` command. (`src/install/installPlan.ts`, `src/install/OpencodeInstaller.ts`, `src/extension.ts`, `src/commands/misc.ts`, `package.json`)
- **Binary detection probes known install dirs.** `ServerLifecycle.findOpencodeBinary()` now falls back from PATH to `~/.opencode/bin/opencode` etc., fixing "installed but not detected" for GUI-launched editors. (`src/session/ServerLifecycle.ts`)
- **ADR:** `docs/adrs/2026-05-31-cli-auto-install.md`. **Tests:** typecheck clean, build clean; new behavioral tests (`installPlan`), string-assertion tests (`OpencodeInstaller`), ServerLifecycle fallback + config-schema assertions — full suite passing, 0 failures.

### Recent Fix (2026-05-31): Model variant selector — variant now actually sent with prompts, persisted locally, restored on tab switch
- **Variant was silently dropped from `send_prompt`.** `sendLogic.ts` built the prompt message without reading the session's variant — no variant was ever sent to the server. Now reads `session.variant` (fallback `globalVariant`) and includes it in the payload. (`src/chat/webview/sendLogic.ts`)
- **Selection not persisted locally.** `onSelect` in `main.ts` posted to host but didn't call `setSessionVariant`/`setGlobalVariant`, creating a stale-race window. Now updates local state synchronously before posting. (`src/chat/webview/main.ts`)
- **Tab switch left selector stale.** `switchTab()` now restores the variant from the active session (fallback global → "Default"). (`src/chat/webview/main.ts`)
- **New sessions didn't inherit global variant.** `createSession()` now spreads `state.globalVariant` into new sessions, matching the `globalModel` pattern. (`src/chat/webview/state.ts`)
- **Tests:** typecheck clean, build clean, 16/16 structural state tests pass, 41/41 regression smoke tests pass.

### Recent Fix (2026-05-31): Error message fidelity — structured errors preserved end-to-end
- **`mapOpencodeError` read the wrong field locations.** The @opencode-ai/sdk error union nests its payload under `.data` (`ApiError = { name, data: { statusCode, isRetryable } }`), but the mapper read top-level `err.statusCode`/`err.providerID`. Result: a real `429` mapped to `NETWORK_UNREACHABLE` ("Can't reach the server") and auth errors lost the provider name. Mapper now normalizes both nested and flat shapes; `technicalDetails` is populated from `responseBody`/message for progressive disclosure. (`src/chat/webview/opencodeErrorMapper.ts`)
- **The rich mapper was dead in the live path.** Host flattened SDK errors to a bare string in `errorValueToMessage` before posting, so `mapOpencodeError` was never reached and the webview re-classified by regex. Host now maps genuine SDK errors (`looksLikeSdkError` guard) and carries the full `ErrorContext` over the wire via `request_error.errorContext`; connection strings / command failures keep the friendly string path. (`ChatProvider` server_error handler, `MessagePostService`, `chatUtils.looksLikeSdkError`)
- **Webview stopped discarding structured context.** `handleStreamError`/`handleRequestError` now prefer a carried `ErrorContext` over re-classifying; `handleServerStatus` threads the host-mapped context (category/severity/actions/URL) through instead of collapsing to `userMessage`. (`streamHandlers.ts`, `stream.ts`, `streamOrchestrator.ts`, `main.ts`)
- **Error-display action buttons are functional.** Replaced the per-button `console.log` with an injected dispatcher: URL-bearing actions → `open_url`, retry/regenerate/wait → `retry_stream`, switch_model → model picker, edit → `connect_provider`. (`errorComponents.ts` `setErrorActionHandler`, wired in `main.ts`)
- **Collapsed the duplicate `sessionStatusMapper`.** Deleted the dead webview copy (only its own test consumed it); the live host copy is the single source and now also sets `technicalDetails`. Test moved beside it. (`src/session/eventHandlers/sessionStatusMapper.ts` + test)
- **Wire-contract + type drift fixed.** `request_error` type now declares `message` (was a mismatched `error`); `MessageInfoLike.error` typed as the SDK union (was `string`).
- **Tests:** +18 mapper/guard/status assertions (RED→GREEN); updated 2 brittle structural assertions for the new signatures.
- **Verification:** `npm run typecheck` clean; `test:unit` 447 + 2426 pass / 0 fail; `test:message-contract` 9/9; `test:roundtrip` 7/7; `npm run build` clean.

### Recent Feature (2026-05-30): ADR-010 Complete — Horizontal Scaling, Crash Resilience, Configurable Streams
- **Crash resilience (Phase 1.5):** Tabs survive CLI crashes. On `server_disconnected`, streaming tab state is captured as `TabRestorationState` and persisted to `globalState`. On reconnect, interrupted tabs receive `stream_interrupted` messages with "Resume Stream" / "Dismiss" buttons. `resume_stream` clears restoration state and re-sends the last prompt via `retryFromHere`.
- **Multi-process infrastructure (Phase 2):** `LocalSessionProcessManager` wraps N `ServerLifecycle` instances with crash detection. `SessionManagerRegistry` provides tab→process routing. `PortPool` allocates ports atomically (no TOCTOU race). Default model is shared-process (all tabs → 1 server) to avoid SQLite contention.
- **Configurable stream cap:** `opencode.sessions.maxConcurrentStreams` setting (default 5, range 1-10). `TabManager` reads the setting; webview receives value via `init_state` and updates at runtime via `setMaxConcurrentStreams()`.
- **Process strategy:** `opencode.sessions.processStrategy` setting (`"shared"` default, `"per-tab"` option). Shared mode uses one server for all tabs. Per-tab mode gives each tab its own process with isolated `OPENCODE_DATA_DIR`.
- **SessionManagerRegistry wired:** `extension.ts` creates registry, passes to `ChatProvider`. `StreamCoordinator.startPrompt` resolves per-tab SessionManager via registry.
- **Research findings:** SDK is fully stateless (safe for N instances). `opencode serve` supports multiple ports. SQLite is shared (`~/.local/share/opencode/opencode.db`, WAL mode) — multiple writers cause `SQLITE_BUSY`. Extension handles 5+ concurrent streams efficiently (per-session chunk batching, O(1) event routing).
- **Files added:** `LocalSessionProcessManager.ts`, `SessionManagerRegistry.ts`, `portPool.ts`
- **Files modified:** `SessionProcessManager.ts`, `TabManager.ts`, `ChatProvider.ts`, `WebviewEventRouter.ts`, `StreamCoordinatorTypes.ts`, `sessionTypes.ts`, `main.ts`, `sendLogic.ts`, `types.ts`, `messages.css`, `package.json`, `extension.ts`
- **Tests:** 445/445 unit tests pass, 2403/2403 structural tests pass.
- **Verification:** `npm run typecheck` clean, `npm run build` clean, `npm run test:unit` 445/445 pass.

### Recent Fix (2026-05-29): Session-scoped context usage + cumulative token accounting
- **Backend token totals no longer reset after multi-turn sessions** — final SDK assistant
  usage is now a live accumulation fallback only. Full-history summaries from opencode
  SDK/server backfill continue to use replacement semantics so older sessions can recover
  complete totals from persisted server history.
- **Frontend context usage is session-scoped** — `context_usage`,
  `context_window_known`, and `context_window_unknown` update the addressed session and only
  repaint the visible context bar/dropdown when that session is active.
- **Context window updates no longer emit stale sessionless usage** —
  `ContextMonitor.setTokenLimit(limit, sessionId?)` re-emits latest known usage for the target
  session instead of falling back to active-tab interpretation in the webview.
- **`token_usage` wire contract aligned** — canonical host messages now send
  `usage: { prompt, completion, total, reasoning?, cacheRead?, cacheWrite? }`; legacy `tokens`
  payloads are still accepted defensively by the webview handler.
- **Tests**: focused regressions cover final SDK accumulation, sessionless context-limit
  emissions, the `token_usage.usage` contract, and cross-tab context bar isolation.
- **Verification**: `npm run test:unit` passed (`2138` pass, `7` skipped, `0` fail);
  `npm run typecheck`, `npm run build`, the focused Node regressions, and the targeted
  Playwright context-usage test all passed.

### Recent Fix (2026-05-22): Show-thinking visibility + codex-style compact tool blocks
- **Show-thinking now actually hides blocks** — previously the toggle only flipped each `<details>` element to closed, which still left the summary chip in the layout. Now the toggle drives a `hide-thinking` body class that CSS uses to `display: none` every `.thinking-block`. `setupThinkingToggle()` calls `toggleAllThinkingBlocks()` at boot so the persisted pref applies immediately instead of after a double-click. (`src/chat/webview/dom.ts:395`, `src/chat/webview/main.ts:3065`, `src/chat/webview/css/components.css:44`).
- **Codex-style compact tool blocks** — `.tool-call` now renders without a heavy card border (only the left accent stripe survives). `.tool-header` is a single-line row at `min-height: var(--size-target-min)` (24 px) with `text-xs` font. Multi-tool turns no longer become a wall of cards. (`src/chat/webview/css/blocks.css:263-340`).
- **Tests**: 6 new source-string assertions across `dom.test.ts`, `messages-css.test.ts`, `main.test.ts`. Updated existing `thinking-toggle.spec.ts` to assert full block invisibility (not just body collapse), added `hide-thinking` body-class assertion, added new `compact-tool-blocks.spec.ts` Playwright suite that pins row height ≤ 28 px and asserts the flat-not-card border shape.

### Previous Fix: Streaming pipeline, session persistence, and frontend redesign
- **Critical: Stream handler prototype methods lost on spread** — `...stream` on `StreamSession` class instance silently discarded all handler methods. Fixed via `Object.assign(Object.create(proto), stream, overrides)`.
- **Critical: Extension crash on startup** — `initConnectionStatusBar` called with `sessionStore` before it was initialized. Reordered initialization.
- **Critical: Session history lost tool calls** — `handleStreamEnd` was replacing entire `blocks` array with server blocks (text + tool only). Changed to merge, preserving all block types.
- **Stream messageId mismatch** — `stream_start` used session ID (`ses_...`) as messageId prefix, `stream_end` used message ID (`msg_...`). Normalized both to `resp-{id}` format.
- **Welcome page always shown** — No longer auto-switches to a session on init. User picks from recent sessions.
- **Mode dropdown** — Replaced three separate mode buttons with unified dropdown with icons, colored backdrops, keyboard nav, WCAG AA.
- **Stop button fixed** — Sends abort instead of enqueueing when streaming.
- **Edit/revert buttons fixed** — Missing `sessionId` in payload prevented routing.
- **Avatars removed** — Differentiation via bubble styles and role label colors instead.

## Build Status
| Check | Status |
|-------|--------|
| Typecheck (`tsc --noEmit`) | ✅ Zero errors |
| Build (`node esbuild.js`) | ✅ Extension 796KB, Webview 1.1MB |
| Unit tests | ✅ 447 pass, 0 fail |
| Integration tests | ✅ Extension Dev Host |
| CI | ✅ 3 jobs (typecheck+unit, integration, visual) |
| VSIX package | ✅ packaging |
| npm audit (high+) | ✅ Zero HIGH/CRITICAL |

## Test Suite
| Layer | Count | Type |
|-------|-------|------|
| Unit (`npm run test:unit`) | 307 tests, 306 pass | TypeScript + MJS tests |
| Integration (`tests/integration/`) | 2 files | Extension Dev Host |
| Visual (`tests/visual/`) | 4 files | Playwright screenshots |
| Co-located unit (`src/**/*.test.ts`) | 537 tests | Static analysis + structure |
| **Regression smoke** | **14 suites** | **All 22 main user flows covered** |

## Feature Tracker
| Feature | Status | Phase |
|---------|--------|-------|
| Streaming pipeline | ✅ | P02 — TTFB timeout, rAF batching, reason field forwarded |
| Streaming hardening | ✅ | P02-fix — Double-finalize guard, session-scoped errors, placeholder cleanup |
| Session persistence + archive | ✅ | P03 — onDidChangeSession, clearAll dry-run, archive/unarchive |
| Server lifecycle + password | ✅ | P04 — auto-generated password, Bearer auth, idempotency keys |
| Webview CSS bundling | ✅ | P05 — @import resolution, edit button transition fix, focus trap |
| Slash commands unified | ✅ | P06 — single LOCAL_COMMANDS source, SVG icons, duplicate removed |
| Edit message + revert | ✅ | P07 — state consistency, revert button on assistant messages |
| Prompt queue | ✅ | P08 — per-tab queue, auto-advance, image attachments |
| Scroll markers + jump-to-bottom | ✅ | P09 — content-visibility, rAF batching, scroll markers |
| Hardening sweep | ✅ | P10 — CSP, a11y aria-labels, packaging, regression tests |
| Regression suite | ✅ | P11 — 14 suites covering all 22 user flows |
| Crash resilience | ✅ | ADR-010 Phase 1.5 — TabRestorationState, auto-resume, stream_interrupted |
| Multi-process infrastructure | ✅ | ADR-010 Phase 2 — LocalSessionProcessManager, SessionManagerRegistry, PortPool |
| Configurable stream cap | ✅ | opencode.sessions.maxConcurrentStreams (default 5, was hardcoded 3) |

## Regression Coverage
| # | Flow | Test Suite | Status |
|---|------|-----------|--------|
| 1 | Activation & server connection | Regression: Activation & Server Connection | ✅ |
| 2 | First prompt + streamed response | Regression: Send Prompt & Streamed Response | ✅ |
| 3 | Persist, reload, resume session | Regression: Session Persistence & Resume | ✅ |
| 5 | Multiple tabs & concurrency | Regression: Tabs & Concurrency | ✅ |
| 8 | Slash command menu | Regression: Slash Commands | ✅ |
| 10 | Edit message | Regression: Edit Message | ✅ |
| 12 | Accept diff & checkpoint | Regression: Diff Accept & Checkpoint | ✅ |
| 15 | Archive session | Regression: Archive, Delete, Clear Sessions | ✅ |
| 18 | Network failure & recovery | Regression: Security & Access Control | ✅ |
| 19 | Long chat scrolling/markers | Regression: Performance & Scroll | ✅ |
| 20 | Keyboard-only navigation | Regression: Accessibility & Styling | ✅ |
| 22 | Packaged VSIX smoke | Regression: Packaging & Hygiene | ✅ |

## All Issues Fixed Across 11 Audit Rounds
| Phase | Issues Fixed | Key Changes |
|-------|-------------|-------------|
| P01 | Baseline identified 55+ issues | Failure map, storage audit, cleanup plan |
| P02 | 6 critical streaming bugs | TTFB timeout, event routing, chat cleanup |
| P03 | 8 session persistence bugs | Archive, clearAll, typed events, server session re-attach |
| P04 | 5 server lifecycle bugs | Auto-generated password, Bearer auth, idempotency keys |
| P05 | 4 UI rendering bugs | CSS @import bundling, edit button transition, focus trap, fonts |
| P06 | 2 slash command bugs | Unified mentions system, SVG icons, dead code removal |
| P07 | 8 message lifecycle bugs | Edit state consistency, revert button, checkpoint indicator |
| P08 | 1 queue feature | Queue state machine, auto-advance, image attachments |
| P09 | 4 performance improvements | content-visibility, rAF batching, scroll markers, jump-to-bottom |
| P09-fix | Jump-to-bottom visibility bug | Removed duplicate CSS overriding `display: none`; added initial `onScroll()` call |
| P10 | 6 hardening items | CSP, aria-labels, perf logging gated, VSIX packaging |
| P11 | 14 regression suites | Comprehensive regression matrix, test data builders |

## Technical Debt (Remaining)
| Item | Impact | Priority |
|------|--------|----------|
| SkillsManager not implemented (completely absent from codebase) | Missing feature | Medium |
| No mock opencode server for integration tests | Can't test full pipeline headless | Medium |
| No webview integration tests for slash commands, context modal | Manual testing required | Low |
| Prefers-reduced-motion should be expanded | Accessibility | Low |
| Focus trap in session modal works but no visible indicator | UX | Low |
| Queue edit in webview (click-to-edit) works but no dedicated UI button | UX | Low |

## Current Context
- All 11 audit rounds complete (P01-P11)
- 825+ tests passing, zero failures, zero type errors
- Build clean, VSIX packages at 241KB
- 2 low-severity dev-only dependency issues (mocha's diff dep — not shipped)
- Security: CSP default-src 'none', auto-generated server password, Bearer auth, log scrubbing, environment allowlist
- Accessibility: aria-labels on all controls, role=dialog modals, focus-visible rings, reduced motion, forced-colors
- Performance: content-visibility: auto, rAF-batched streaming, DocumentFragment batching for session resume
- Prompt queue: per-tab, auto-advance on stream end, image attachment support
- Scroll markers: positioned dots for user messages, click-to-jump with flash animation
- Regression: 14 suites covering all 22 main user flows
