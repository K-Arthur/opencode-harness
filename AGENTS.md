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

**CI bundle size limits:** extension.js ≤ 510KB, main.js ≤ 680KB (paydown target: 600KB by moving `highlight.js` into the worker; see `docs/plans/highlight-worker-separation.md` and `scripts/check-bundle-size.mjs`).

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
1. **SDK errors** (`@opencode-ai/sdk`) arrive at `ChatProvider.ts` as `server_error` events with shapes like `ProviderAuthError`, `APIError`, `MessageOutputLengthError`, `MessageAbortedError`
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
- **Action buttons**: Support `primary`/`secondary`/`disabled` states, Enter/Space keyboard activation, `metadata` for URL-based actions. Dismiss removes both DOM and persisted state.

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

### Provider-Specific Error Mapping
`opencodeErrorMapper.ts` handles third-party OpenAI-compatible providers (GLM, DeepSeek, etc.):
- `insufficient_quota`/`quota exceeded` in response body → QUOTA_EXCEEDED error with "Switch provider" action
- HTTP 402 → payment/usage exhausted
- HTTP 429 → rate-limited with provider name in message
- `ProviderAuthError` → auth failure with provider name

### Test Coverage
- **Unit**: `blocks.test.ts`, `queue.test.ts`, `errorHandler.test.ts`, `errorTypes.test.ts`, `opencodeErrorMapper.test.ts`, `quotaMonitor.test.ts`, `toolLifecycle.test.ts`
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
- **Debounce**: Mode cycling is debounced at 200ms to prevent accidental rapid cycles.
- **Modal gating**: `Alt+Shift+Tab` and global shortcuts are suppressed when `[aria-modal="true"]` elements are visible.
- **Text input protection**: Global shortcuts do not fire when the active element is an input, textarea, select, or contenteditable — preserving normal typing behavior.
- **Focus traps**: `Tab`/`Shift+Tab` within modals wrap focus (see `src/chat/webview/focus-trap.ts`).
- **Mode cycling**: Defined in `src/chat/webview/ui/modeDropdown.ts` → `cycleModeForward()`. Uses `MODE_ORDER = ["plan", "build", "auto"]`.
