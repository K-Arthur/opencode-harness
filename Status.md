# Status.md

## Last Updated: 2026-05-05
## Project State: V4 CLEANUP COMPLETE — TypeScript errors fixed, packages updated, 502 tests passing

## Build Status
| Check | Status |
|-------|--------|
| Typecheck (`tsc --noEmit`) | ✅ Zero errors |
| Build (`node esbuild.js`) | ✅ Extension 421KB, Webview 630KB |
| Unit tests (behavioral) | ✅ 502 pass, 0 fail |
| Integration tests | ✅ Extension Dev Host |
| CI | ✅ 3 jobs (typecheck+unit, integration, visual) |

## Test Suite
| Layer | Count | Type |
|-------|-------|------|
| Behavioral (`tests/unit/*.test.mjs`) | 502 tests | Real function calls |
| Integration (`tests/integration/`) | 2 files | Extension Dev Host |
| Visual (`tests/visual/`) | 4 files | Playwright screenshots |
| Unit tests (`src/**/*.test.ts`) | 38 files | Structural checks (being migrated) |

## Feature Tracker
| Feature | Status | Notes |
|---------|--------|-------|
| Chat rendering overhaul | ✅ | RENDERER_MAP dispatch, targeted DOM, event dedup, diff UUID v4, _exhaustiveCheck |
| Custom tab bar | ✅ | Plain HTML tabs, left-to-right, newest/active first |
| Session history modal | ✅ | Full overlay with click-outside-to-close |
| Plan/Build mode toggle | ✅ | Plain `<button>` with `.active` class |
| Model picker dropdown | ✅ | Absolute positioned, in-viewport |
| @mention dropdown | ✅ | Above-input positioning |
| Skill indicators | ✅ | Compact inline pills, auto-remove 3s |
| Empty session filtering | ✅ | Sessions without messages not persisted |
| Multi-tab chat | ✅ | Max 3 concurrent streams, 20 tab limit |
| Diff preview | ✅ | Accept/reject, mutex safety |
| Checkpoints | ✅ | Git stashing, concurrency lock, **20-checkpoint cap**, **pre-action snapshot** |
| Rate limit monitor | ✅ | Config listener disposed, **real-time countdown**, **auto-re-enable on reset** |
| CSS theme system | ✅ | Custom properties, CLI discovery, **file watcher**, **preview command**, **forced-colors system keywords** |
| Session persistence | ✅ | Schema-validated memento storage, **auto-title generation**, **rename validation** |
| Model selection | ✅ | Server + CLI fetch, **globalState cache**, **provider grouping in QuickPick** |
| Compaction | ✅ | autoCompact setting, **snooze logic**, **context % in banner** |
| Export conversation | ✅ | Markdown export, **tool calls in details blocks**, **diffs in fenced code**, **timestamps** |
| Delete session | ✅ | **Confirmation modal**, **stream abort before delete** |

## Known Bugs — All Fixed
| ID | Description | Severity | Fix |
|----|-------------|----------|-----|
| C-001 | Self-import (circular) | Critical | Corrected import path |
| C-002 | ChatService dead code | Critical | Removed |
| C-003 | `.env` not in `.gitignore` | Critical | Added |
| C-004 | Global promptInFlight lock | Critical | Per-tab Set |
| C-005 | EventNormalizer unbounded memory | Critical | 10k entry limit |
| C-006 | CSS property injection | Critical | Key validation |
| C-007 | Mode buttons `appearance` attr | High | Plain `<button>` |
| C-008 | process.env leaked | High | Allowlist filter |
| C-009 | vscode-elements Shadow DOM | High | All replaced with custom HTML |
| C-010 | Tab bar vscode-tabs broken | High | Custom tab bar |
| C-011 | Welcome screen never removed | High | Fixed .welcome-container selector |
| C-012 | No tab UI on send message | High | Auto-create tab in sendMessage |
| C-013 | Skill badges flood message list | Medium | Compact inline pills |
| C-014 | Buttons not working (recentSessions null) | Critical | optionalElement + null guards |
| C-015 | Empty sessions persisted needlessly | High | flush() filters empty sessions |
| C-016 | Multiple sessions open on startup | High | `init_state` only creates welcome tab; fixed `.tab-panel` selector |
| C-017 | Welcome screen not showing after close | High | `closeTab` now calls `createInitialTab` with `isWelcome=true` |
| C-018 | Active session shown in Recent | Medium | `renderRecentSessionsList` filters `s.id !== activeId` |
| C-019 | New session button creates duplicate tabs | Critical | Removed duplicate `newTabBtn` listener from `setupButtons` |
| C-020 | TypeScript typecheck errors | Critical | Fixed type incompatibilities, updated packages |

## Technical Debt (Remaining)
| Item | Impact | Priority |
|------|--------|----------|
| Remaining text-grep tests to convert | False confidence | Medium |
| ESLint config incompatible with ESLint 10 | Rules unenforced | High |
| Accessibility: ARIA on message blocks | Screen reader UX | Medium |

## Current Context
- Extension v0.2.0 installed and running
- All `@vscode-elements` removed — no Shadow DOM conflicts
- 502 real behavioral tests passing, zero failures
- TypeScript typecheck: zero errors
- Empty sessions filtered from persistence
- Custom tab bar with left-to-right ordering
- Welcome screen with suggestion cards
- Chat rendering overhaul complete (Phase 0-6):
  - `RENDER_MAP` strict dispatch table in renderer.ts
  - Targeted DOM updates in stream.ts (no full re-render per token)
  - `isDuplicateEvent()` event deduplication
  - `_exhaustiveCheck` guard in MessageRouter.ts
  - UUID v4 stable diffIds in DiffHandler.ts
  - Per-tab stream lifecycle + watchdog in StreamCoordinator.ts
  - CSS architecture: blocks.css, messages.css, tokens.css
- Packages updated: @opencode-ai/sdk, @vscode/test-cli, eslint, mocha, typescript
- Next steps: ESLint migration (v9→v10), remaining behavioral test conversions, VS Code extension install test