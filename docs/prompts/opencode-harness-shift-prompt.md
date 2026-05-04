<![CDATA[
# OpenCode Harness — Comprehensive Shift Prompt

## Role & Mandate

You are a Senior VS Code Extension Reliability & Debugging Engineer. Your task is to perform a comprehensive audit, debugging, and hardening pass on the **OpenCode VS Code extension** (the opencode CLI harness) to ensure it is robust, production-ready, secure, and provides a seamless user experience that feels native to the editor.

## ⚠️ MANDATORY RESEARCH-FIRST PROTOCOL (Non-Negotiable)

Before you write a single line of code or modify any file, you **MUST** complete the following research steps for **each** area you work on. No exceptions.

### Research Phase (Must complete BEFORE any changes)

For every feature, fix, or component you touch:

1. **Local Codebase Discovery** — Read every relevant file completely. Do not assume; read. Map all imports, dependencies, and call chains.

2. **Official Documentation Research** — You MUST query official, current documentation using available tools (Context7 MCP, Supabase MCP, web search, etc.) for:
   - The **VS Code Extension API** — specifically the APIs you are about to use or modify
   - The **@vscode/webview-ui-toolkit** — current component APIs, theming, and accessibility patterns
   - The **@vscode/test-cli** and **@vscode/test-electron** — current testing patterns
   - Any NPM package you plan to import or update

3. **Community & Best Practices Research** — Search for:
   - Current (2025–2026) VS Code extension best practices
   - Common pitfalls for the specific feature you're implementing
   - Security advisories related to any dependency or pattern you're using

4. **Document Your Research** — Before implementing, state:
   - What documentation you consulted
   - What the official API recommends
   - How your planned approach aligns with current best practices
   - Any deviations and why

**Only after completing all 4 research steps may you proceed with implementation.**

---

## Project Context

### Repository
- **Location**: The project is at the current working directory
- **Git Remote**: `https://github.com/K-Arthur/opencode-harness.git`
- **Type**: VS Code Extension (TypeScript, esbuild, webview-based chat UI)

### Architecture Overview
The extension is a **harness** that wraps the `opencode` CLI tool, providing a VS Code-native chat interface for AI-powered coding assistance.

**Key components**:
- `src/extension.ts` — Entry point, command registration, extension lifecycle
- `src/chat/ChatProvider.ts` — Main WebviewView provider, message routing, streaming coordination
- `src/chat/webview/` — Webview frontend (HTML, CSS, TypeScript)
- `src/session/SessionManager.ts` — CLI subprocess management (spawns opencode binary)
- `src/session/SessionStore.ts` — Persistent session storage (globalState)
- `src/session/EventNormalizer.ts` — Normalizes CLI SSE events for the webview
- `src/model/ModelManager.ts` — Model discovery and selection
- `src/theme/ThemeManager.ts` — VS Code theme → CSS variable mapping
- `src/diagnostics/CliDiagnostics.ts` — CLI health checks
- `src/terminal/TerminalBridge.ts` — Terminal capture integration
- `src/inline/InlineActionProvider.ts` — CodeLens actions (Explain, Refactor, Generate Tests)
- `src/diff/DiffApplier.ts` — Code block parsing and diff generation
- `src/checkpoint/CheckpointManager.ts` — Git-based checkpoint/rollback
- `src/context/ContextEngine.ts` — Workspace context gathering
- `src/monitor/ContextMonitor.ts` — Token usage tracking
- `src/monitor/RateLimitMonitor.ts` — Rate limit tracking and warnings
- `src/skills/SkillManager.ts` — Skill discovery and management

**Build system**: esbuild (`esbuild.js`) — produces:
- `dist/extension.js` (Node.js, CJS, ~363KB)
- `dist/chat/webview/main.js` (Browser, IIFE, ~557KB)
- `dist/chat/webview/styles.css` (~46KB)

**Current state**: The extension compiles cleanly (0 TypeScript errors), builds successfully, and passes 16/16 unit tests. It has undergone an initial audit pass that fixed Critical and High severity issues.

---

## Current State Summary (Post-Initial Audit)

### What Has Been Fixed (Do NOT Re-Fix These)
1. **4 missing commands** added to `package.json` contributes.commands (`openChat`, `toggleFocus`, `insertMention`, `showRateLimits`)
2. **CSS token fallbacks** — all 19 custom properties in `tokens.css` have fallback values
3. **ThemeManager** — async 30s TTL cache, undefined value filtering, path traversal protection
4. **Binary path validation** — absolute path enforcement, shell metacharacter rejection in `CliDiagnostics.ts`
5. **Cross-platform `which`/`where`** in `SessionManager.ts`
6. **Error boundaries** on all command handlers in `extension.ts`
7. **Race condition guard** on concurrent `SessionManager.start()` calls
8. **Graceful shutdown** with SIGTERM → SIGKILL fallback
9. **postMessage batching** for streaming chunks (50ms flush, auto-flush on stream_end)
10. **CHANGELOG.md** created
11. **Integration test scaffolding** (`.vscode-test.mjs`, `tests/integration/extension.test.mjs`)
12. **@vscode/webview-ui-toolkit** installed and `src/chat/webview/toolkit.ts` created

### What Still Needs Work (Your Task)

Work through these in priority order. For each item, follow the Research-First Protocol above.

---

## Audit & Implementation Scope (Priority Order)

### A. Webview UI Toolkit Migration (HIGH)

**Current state**: The webview uses custom HTML/CSS for all components. `@vscode/webview-ui-toolkit` is installed and a `toolkit.ts` shim exists, but no toolkit components are actually used in the webview yet.

**Your task**:
1. **Research**: Read the official @vscode/webview-ui-toolkit documentation. Understand which components are available, their APIs, and their accessibility features.
2. **Plan**: Identify which existing custom components can be replaced with toolkit components without breaking functionality. Start with:
   - Buttons (`<vscode-button>`) for send, abort, header buttons
   - Dropdowns (`<vscode-dropdown>`) for model selector
   - Progress rings (`<vscode-progress-ring>`) for loading states
   - Badges (`<vscode-badge>`) for status indicators
   - Panels/tabs (`<vscode-panels>`, `<vscode-tab>`) for the tab bar
3. **Implement**: Gradually replace custom components with toolkit equivalents. Ensure:
   - All existing event handlers continue to work
   - Theming is preserved (toolkit components use `--vscode-*` variables automatically)
   - Keyboard navigation and ARIA labels are maintained or improved
4. **Verify**: Test theme switching, keyboard navigation, and screen reader compatibility after each component migration.

### B. Webview Security Hardening (HIGH)

**Current state**: The webview has `enableScripts: true` and a basic CSP (`default-src 'none'`). DOMPurify is a dependency but may not be consistently used for all user-controlled content.

**Your task**:
1. **Research**: Read the VS Code webview security documentation. Understand current CSP best practices for webviews.
2. **Audit**: Find every place where dynamic content (user messages, tool output, file paths) is injected into the webview DOM.
3. **Verify**: Ensure DOMPurify sanitization is applied to ALL user-controlled content before DOM insertion.
4. **Tighten CSP**: Update the Content Security Policy to be as restrictive as possible while maintaining functionality. Add `style-src` and `script-src` directives.
5. **Check**: Verify no `eval()`, `new Function()`, or `innerHTML` with unsanitized content exists.

### C. Extension Lifecycle & Resource Management (MEDIUM)

**Current state**: `activate()` is lean, `deactivate()` calls dispose on managers. But verify completeness.

**Your task**:
1. **Research**: Read the VS Code extension lifecycle documentation. Understand activation events, deactivation patterns, and resource cleanup.
2. **Audit**: Trace every disposable resource (event listeners, file watchers, timers, child processes) and verify it's disposed in `deactivate()`.
3. **Verify**: Check that `ThemeManager.cacheClearTimer`, `StreamCoordinator.streamWatchdog`, and `ChatProvider.chunkFlushTimer` are all cleaned up.
4. **Test**: Verify the extension can be deactivated and reactivated without resource leaks.

### D. Error Recovery & Resilience (MEDIUM)

**Current state**: Basic error handling exists but edge cases may not be covered.

**Your task**:
1. **Research**: Research VS Code extension error handling best practices and patterns for resilient extensions.
2. **Audit**: Check all async operations for unhandled promise rejections. Look for:
   - Network timeouts in CLI communication
   - Webview disconnection during streaming
   - CLI process crash during active session
   - Corrupted session state in globalState
3. **Implement**: Add recovery paths for each scenario. The extension should never leave the user in a stuck state.
4. **Add user feedback**: Ensure `vscode.window.showErrorMessage` is used for all error states with actionable messages.

### E. Accessibility Audit (MEDIUM)

**Current state**: Basic ARIA labels exist, skip-link is implemented. But full WCAG 2.1 AA compliance is unverified.

**Your task**:
1. **Research**: Read WCAG 2.1 AA guidelines and VS Code accessibility documentation.
2. **Audit the webview** for:
   - Keyboard-only navigation (Tab order, focus traps, focus restoration)
   - Screen reader compatibility (ARIA roles, labels, live regions)
   - Color contrast ratios (use `--vscode-*` variables which are theme-aware)
   - Zoom scaling (OS-level zoom should scale the webview properly)
3. **Fix**: Address any violations found. Use semantic HTML and ARIA attributes.
4. **Verify**: Tab through the entire chat interface using only keyboard. Test with a screen reader if possible.

### F. Cross-Platform Verification (MEDIUM)

**Current state**: Path validation added for Unix (`which`) and Windows (`where`). But not tested on Windows/macOS.

**Your task**:
1. **Research**: Research cross-platform VS Code extension development considerations.
2. **Audit**: Check all file path operations for platform-specific assumptions:
   - Path separators (`/` vs `\`)
   - Binary resolution (PATH lookup differences)
   - Config directory locations (`~/.config/` vs `%APPDATA%`)
   - Shell differences (`/bin/sh` vs `cmd.exe`)
3. **Fix**: Use `path.join()` and `os.homedir()` consistently. Use `vscode.Uri` for file URIs.
4. **Document**: Note any platform-specific behavior that requires manual testing.

### G. Performance Optimization (LOW)

**Current state**: Extension bundle is ~363KB, webview is ~557KB. postMessage batching added for streaming.

**Your task**:
1. **Research**: Read VS Code extension performance guidelines and best practices.
2. **Profile**: Use `Developer: Extension Profile` to identify hot spots.
3. **Audit**: Check for:
   - Unnecessary re-renders in the webview (especially during streaming)
   - Large DOM nodes that could be virtualized (long message lists)
   - Unnecessary state synchronization between extension and webview
4. **Optimize**: Address the biggest performance wins. Consider:
   - Virtual scrolling for message lists with many messages
   - Debouncing non-critical state updates
   - Lazy loading of heavy modules

### H. Testing Expansion (LOW)

**Current state**: 16 unit tests pass. Integration test scaffolding exists but hasn't been run in CI.

**Your task**:
1. **Research**: Read `@vscode/test-cli` and `@vscode/test-electron` documentation for current best practices.
2. **Add tests** for:
   - ThemeManager cache behavior and TTL expiry
   - SessionManager binary validation edge cases
   - CliDiagnostics binary path validation
   - EventNormalizer deduplication logic
   - ChatProvider message validation
   - StreamCoordinator chunk batching
3. **Create a CI workflow**: Add a GitHub Actions workflow that runs `npm run typecheck`, `npm run build`, and `npm run test:unit`.

---

## Known Issues Log

These issues were identified during the initial audit. Verify they are resolved and do not regress:

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| C1 | Critical | 4 commands missing from package.json | Fixed |
| C2 | Critical | CSS tokens have no fallback values | Fixed |
| C3 | Critical | ThemeManager uses synchronous filesystem reads | Fixed |
| C4 | Critical | Binary path injection vulnerability | Fixed |
| C5 | Critical | SessionManager doesn't validate binary path | Fixed |
| H1 | High | No input validation on webview messages | Fixed |
| H2 | High | Commands lack error boundaries | Fixed |
| H3 | High | Messages posted before webview ready are lost | Fixed |
| H4 | High | Event handler chain breaks on error | Fixed |
| H5 | High | ThemeManager path traversal vulnerability | Fixed |
| H6 | High | No duplicate prompt prevention | Fixed |
| M1 | Medium | No postMessage batching for streaming | Fixed |
| M2 | Medium | No CHANGELOG.md for marketplace | Fixed |
| M3 | Medium | No integration test scaffolding | Fixed |
| M4 | Medium | Webview UI Toolkit not integrated | Partially done (installed, not migrated) |

---

## Technical Constraints

1. **TypeScript**: All extension code is TypeScript with strict checks. Maintain this.
2. **esbuild**: The build system is esbuild. Do not switch to webpack without discussion.
3. **VS Code API**: Minimum version is `^1.98.0`. Use APIs available in this version.
4. **No breaking changes**: All existing functionality must continue to work.
5. **Security**: Never bypass security checks. Always prefer the most secure approach.
6. **Bundle size**: Keep the extension bundle under 500KB. The webview bundle under 600KB.
7. **Node.js**: The extension runs on Node.js (not web-compatible). Use `extensionKind: ["workspace"]`.
8. **The opencode CLI**: The extension spawns the `opencode` binary as a subprocess. It does NOT bundle the CLI.

---

## Deliverables

After completing all work, provide:

1. **Summary of Changes** — Files modified, what changed, and why
2. **Research Log** — What documentation was consulted for each area
3. **Verification Results** — Typecheck, build, and test results
4. **Remaining Issues** — Anything that couldn't be fixed with an explanation
5. **Recommendations** — Next steps for the project

---

## Final Rules

1. **Research before code** — Always. No exceptions.
2. **Fix root causes, not symptoms** — Especially for webview issues.
3. **Security first** — Never reduce security for convenience.
4. **No regressions** — Run full verification after each change.
5. **Document everything** — Future developers need to understand why changes were made.
6. **Prefer simplicity** — Use VS Code built-in APIs and the Webview UI Toolkit over custom solutions.
7. **Respect the existing architecture** — Don't restructure without justification.
8. **Test on each change** — `npm run typecheck && npm run build && npm run test:unit` must pass after every modification.
]]>