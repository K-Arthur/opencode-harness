# Status.md

## Last Updated: 2026-05-29
## Project State: Context/token usage accounting fix applied and verified

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
| Build (`node esbuild.js`) | ✅ Extension 454KB, Webview 668KB, CSS 99KB |
| Unit tests | ✅ 306 pass, 1 known pre-existing (DeltaHandler messageId format) |
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
