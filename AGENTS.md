# AGENTS.md — OpenCode Harness

## What This Is

VS Code extension that integrates the opencode AI agent into VS Code. TypeScript/Node.js, built with esbuild. Client-server architecture: extension connects to an opencode HTTP server (localhost:4096) via `@opencode-ai/sdk`. Does not embed or spawn the CLI directly for chat.

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

**CI bundle size limits:** extension.js < 500KB, main.js < 600KB.

## Test Layers

| Layer | What | Command |
|---|---|---|
| Behavioral unit | Real function-calling tests for SessionStore, EventNormalizer, DiffApplier, etc. | `node --test tests/unit/*.test.mjs` |
| Structural unit | Source code pattern checks (being migrated to behavioral) | `npx tsx --test "src/**/*.test.ts"` |
| Message contract | Webview message type contracts | `npx tsx --test tests/webview/message-contract.test.ts` |
| Roundtrip | Integration roundtrip tests | `node --test tests/integration/message-roundtrip.test.mjs` |
| Integration | VS Code Extension Dev Host (requires xvfb on Linux) | `npm run test:integration` |
| Visual | Playwright screenshot regression | `npm run test:visual` |

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

### Webview Composer Modules (delegated from composer.ts)

| Module | File | Responsibility |
|--------|------|---------------|
| `slashCommands` | `src/chat/webview/slashCommands.ts` | /command dispatching |
| `queueRenderer` | `src/chat/webview/queueRenderer.ts` | Queue chip UI + drag-reorder |
| `sendLogic` | `src/chat/webview/sendLogic.ts` | Send/abort/steer + stream capacity |
| `inputHandlers` | `src/chat/webview/inputHandlers.ts` | Keyboard + paste + resize handlers |

### Webview Timeline Modules (delegated from timeline.ts)

| Module | File | Responsibility |
|--------|------|---------------|
| `timeline` | `src/chat/webview/timeline.ts` | Conversation timeline sidebar: toggle, render, keyboard nav, progress, history condensation |
| `thinkingToggle` | `src/chat/webview/thinkingToggle.ts` | Global thinking block visibility toggle (extracted from timeline for SRP) |
| `scrollMarkers` | `src/chat/webview/ui/scrollMarkers.ts` | Scroll marker dots, jump-to-bottom, scrollToTurn with injected timers |

### Horizontal Scaling (ADR-010 Complete)

- Interface: `src/session/SessionProcessManager.ts` (ADR-aligned with `onCrash` events)
- Implementation: `src/session/LocalSessionProcessManager.ts` (wraps N `ServerLifecycle` instances)
- Routing: `src/session/SessionManagerRegistry.ts` (tab→process mapping, wired into extension.ts)
- Port allocation: `src/utils/portPool.ts` (atomic reservation, no TOCTOU race)
- Crash resilience: `TabRestorationState` in `src/session/sessionTypes.ts`, persisted via `TabManager`
- Process strategy: `opencode.sessions.processStrategy` setting (`"shared"` or `"per-tab"`)
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
