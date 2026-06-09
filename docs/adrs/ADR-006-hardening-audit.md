# ADR-006: Production Hardening Audit

**Date:** 2026-05-04  
**Status:** Accepted  
**Decision Driver:** Production-readiness audit identified 151 issues across 5 severity levels.

## Context

A full production-readiness audit of the OpenCode Harness extension revealed systemic issues: 17 critical, 43 high, 56 medium, and 35 low severity. The most impactful included:

- Circular self-import in `SessionRepository.ts` (compilation blocker)
- Dead `ChatService.ts` with zero consumers (compilation blocker)
- Global `promptInFlight` lock blocking multi-tab concurrency
- Unbounded memory growth in `EventNormalizer` internal Maps
- CSS property injection via `applyThemeVars` (no key/value validation)
- `process.env` leaked to child processes in entirety
- `vscode-button` used non-existent `appearance` attribute

## Decisions

### 1. Enable `noUncheckedIndexedAccess` project-wide (Critical)
**Before:** `"strict": true` without `noUncheckedIndexedAccess`, allowing silent undefined access.
**After:** Added `"noUncheckedIndexedAccess": true` to `tsconfig.json`. Fixed 40 potential undefined crashes across 20 files.
**Rationale:** The project constitution already required this flag (clause 18), but it was not enforced. Enabling it at the TypeScript level provides compile-time safety against one of the most common JavaScript crash patterns.

### 2. Per-tab lock replaces global prompt lock (Critical)
**Before:** Single `promptInFlight: boolean` blocked all tabs when any tab had an active prompt.
**After:** `promptsInFlight: Set<string>` per-tab lock allowing concurrent prompts across different tabs.
**Rationale:** The architecture was designed for multi-tab concurrency (TabManager.MAX_CONCURRENT_STREAMS = 3), but the global lock defeated it. The Set-based per-tab lock is O(1) and avoids any single-tab failure from blocking all work.

### 3. `process.env` filtered to allowlist for child processes (High)
**Before:** `env: { ...process.env }` leaked the full extension host environment to spawned opencode CLI processes.
**After:** Only essential vars passed: `PATH`, `HOME`, `USERPROFILE`, `APPDATA`, `XDG_CONFIG_HOME`, `LANG`, `TERM`, `SHELL`, `TMPDIR`, `TEMP`, `TMP`.
**Rationale:** The extension host may contain API keys, tokens, and other secrets in environment variables that the opencode CLI process does not need. Leaking them could expose credentials in CLI debug output, crash logs, or if the child process is compromised.

### 4. `vscode-button` uses `secondary` property, not `appearance` attribute (High)
**Before:** HTML: `appearance="primary"`, JS: `setAttribute("appearance", "primary")`, CSS: `[appearance="primary"]`.
**After:** HTML: `secondary` attribute, JS: `.secondary = true/false`, CSS: `--vscode-button-*` custom properties.
**Rationale:** The `@vscode-elements/elements` `<vscode-button>` custom element does not have an `appearance` attribute. It uses a `secondary: boolean` Lit property (reflected to a `secondary` HTML attribute). The `appearance` attribute was silently ignored, causing the Plan/Build mode toggle to never actually change visual state. This affected 3 buttons (mode-plan, mode-build, send) in the HTML and 8 usages in the JS.

### 5. `enableScripts` and `retainContextWhenHidden` verified correct (Info)
`enableScripts: true` (ChatProvider.ts:90) and `retainContextWhenHidden: true` (extension.ts:459) were already correctly configured. No change needed.

### 6. `vscode` module correctly marked external in esbuild (Info)
`external: ["vscode"]` (esbuild.js:11) was already correct. The VS Code API is provided by the runtime and should never be bundled.

### 7. `acquireVsCodeApi()` declared with proper fallback (Info)
The `declare const acquireVsCodeApi` type declaration (main.ts:14) and `getVsCodeApi()` wrapper (main.ts:26) with browser testing fallback were already correctly implemented.

## Consequences

**Positive:**
- Extension now compiles with zero type errors (was 3 compilation + 40 noUncheckedIndexedAccess)
- 356 tests passing (includes 61 real behavioral tests, 38 text-grep structural tests confirmed for matching current code)
- Multi-tab concurrent streaming works (per-tab lock, synchronous slot reservation)
- No secrets leaked to child processes
- Mode toggle buttons properly respond to clicks (plain HTML `<button>` elements)
- EventNormalizer memory bounded at 10k entries per map
- Diff apply race conditions prevented by atomic mutex
- VSIX reduced 12.6MB → 261KB via .vscignore cleanup
- All `@vscode-elements/elements` components replaced with plain HTML
- Custom tab bar with left-to-right ordering, no Shadow DOM conflicts
- Session history modal overlay
- Empty sessions filtered from persistence
- Welcome screen with suggestion cards renders correctly

**Negative:**
- Removed ChatService.ts (dead code) — any code depending on it must use ChatProvider directly
- Removed `@vscode-elements/elements` dependency — any code expecting `vscode-button` etc. will not find them

## Revision History

### 2026-05-04 (Revision 3)
- **Buttons broken**: `requireElement("recent-sessions")` crashed during init because welcome content was removed from static HTML. Fixed with `optionalElement` + null guards.
- **Empty sessions persisted**: `SessionStore.flush()` now filters sessions with no messages before writing to `globalState`. `load()` also skips empty sessions on startup.
- **61 real behavioral tests added**: SessionStore, EventNormalizer, DiffApplier, mode normalization, map size limiting — all test actual function behavior, not text patterns.

### 2026-05-04 (Revision 2)
- All `@vscode-elements/elements` custom element components replaced with plain HTML (`<button>`, `<div>`)
- Custom tab bar replacing `vscode-tabs+vscode-tab-header+vscode-tab-panel`
- `vscode-progress-ring` replaced with CSS spinner
- `vscode-button` replaced with `.icon-btn`, `.send-btn`, `.abort-btn`, `.suggestion-card`, `.model-selector-btn`
- `bundled.js` removed from esbuild copy step and HTML template

### 2026-05-04 (Revision 1)
- Initial hardening: compilation fixes, security, concurrency, type safety
