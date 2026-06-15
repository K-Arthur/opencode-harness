# Orientation — Composer, Shortcuts & Settings Audit

**Date:** 2026-06-14
**Build:** opencode-harness v0.3.61

## Proven findings (cite-grounded)

### A. Message accounting

| # | Finding | Evidence | Severity |
|---|---|---|---|
| A1 | `computeMessageCounts` does naive role-switch over `messages[]` — no dedup, no edit tracking, no subagent awareness | `src/chat/webview/messageCounter.ts:23-56` | **High** |
| A2 | Persistence cap `PERSIST_MAX_MESSAGES = 50`; if server has 200+, restored webview counts disagree | `src/chat/webview/state.ts:207` | **High** |
| A3 | `messageUpsert` regenerate vs append unclear | `src/chat/webview/messageUpsert.ts` | **High** |
| A4 | Subagent messages "bridged" via `bridgeSubagentFromTool` — counting semantics unclear | `src/chat/handlers/StreamCoordinator.ts:460-475` | **Medium** |
| A5 | `StreamCoordinator` ~2152 lines, 80+ methods — many places partial streaming messages could persist before finalize | `src/chat/handlers/StreamCoordinator.ts:66-2152` | **High** |
| A6 | Token accounting from 3 sources: `sdkTokenTotal` / `estimateMessageTokens` / SSE `tokens` — possible divergence | `src/chat/handlers/StreamCoordinator.ts:1200-1300` | **Medium** |
| A7 | Schema migration exists (`migrateWebviewState`, schemaVersion=1) — safe but message shapes must migrate | `src/chat/webview/state.ts:55-164` | **Low** |

### B. Settings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| B1 | No unified settings panel — `ui/settingsMenu.ts` only 5 symbols (open/close/keyboard nav) | `src/chat/webview/ui/settingsMenu.ts:1-58` | **High** |
| B2 | `package.json` enum declares 4 theme presets (`cli-default/light/dark/high-contrast`); AGENTS.md claims 6 | `package.json:531-539`; AGENTS.md "CSS / Theme" | **High** (doc/code drift) |
| B3 | `opencode.serverAuthToken` deprecated plaintext config | `package.json:452-462` | **Medium** |
| B4 | MCP config 3 sources: `opencode.mcpServers` (config), `opencode.json` (file), `mcp-config.ts` (UI) | `package.json:464-519`; `mcp-config.ts` | **Medium** |
| B5 | Settings persisted across 4 backends: config/workspaceState/globalState/SecretStorage | Cross-file | **Medium** |
| B6 | 35 config keys, 50+ theme overrides — no grouping/search/validation UI | `package.json:427-1074` | **Medium** |

### C. Keyboard shortcuts

| # | Finding | Evidence | Severity |
|---|---|---|---|
| C1 | 13/21 `keybindings` are `suppressKey` stubs — webview shortcuts hidden from VS Code UI | `package.json:247-345` | **High** |
| C2 | `createShortcutDispatcher` linear first-match — no specificity/chord support | `src/chat/webview/keyboardShortcuts.ts:44-62` | **High** |
| C3 | Settings keyboard nav partial: arrow/home/end/escape only — no Tab/type-ahead | `src/chat/webview/ui/settingsMenu.ts:35-58` | **Medium** |
| C4 | `wireComposer` and `setupGlobalKeyboardShortcuts` both attach document keydown — suspected double-fire | `src/chat/webview/main.ts:716, 888` | **High** |
| C5 | ESC has coordinator with 4 managed modals + 5 deferred popups — well structured | `src/chat/webview/main.ts:1011-1143` | **Info** |
| C6 | Webview dispatcher `isTextEntryTarget` correctly guards text inputs — but only in registry, not inline handlers | `src/chat/webview/keyboardShortcuts.ts:25-30` | **Medium** |

### D. Composer

| # | Finding | Evidence | Severity |
|---|---|---|---|
| D1 | `createComposer(deps): ComposerAPI` — clean factory, 15 methods, 286 lines | `src/chat/webview/composer.ts:117-286` | **Info** |
| D2 | `sendLogic` 18 methods, 374 lines; steer-mode toggle (interrupt/queue) | `src/chat/webview/sendLogic.ts:73-374` | **Info** |
| D3 | `inputHandlers` 121 lines; autoResize/paste/keydown | `src/chat/webview/inputHandlers.ts:34-121` | **Info** |
| D4 | Mode cycle debounced 200ms per AGENTS.md | `src/chat/webview/ui/modeDropdown.ts` | **Info** |
| D5 | **No `setPendingPrompt` in state.ts** — draft text lost on tab switch | `src/chat/webview/state.ts:534-541` | **High** |

### E. Accessibility

- `accessibility.css` exists (21 symbols) — contents not yet audited
- `focus-trap.ts`, `escapeCoordinator.ts` present
- ARIA patterns on dropdowns/modals unverified
- High-contrast theme support: unverified

## Competitor baseline (internal knowledge, [unverified] until Phase 1 WebFetch confirms)

| Feature | Claude Code CLI | Cursor | Continue | Cline | Roo | OpenCode |
|---|---|---|---|---|---|---|
| Composer placement | Bottom terminal | Sidebar | Sidebar | Editor panel | Editor panel | TUI |
| Cmd/Ctrl+L | New chat | Focus chat | Focus chat | none | none | (TUI) |
| Cmd/Ctrl+K | Clear | Inline edit | Quick command | Command palette | none | (TUI) |
| Settings taxonomy | TOML + flags | JSON + UI | JSON sidebar | VS Code settings | VS Code settings | JSON |
| Message counting | Per-turn (1u+1a) | Per-message | Per-message | Per-message | Per-message | Server |
| A11y screen reader | TTY partial | Partial | Good | Partial | Partial | TTY partial |
| High contrast | No (TTY) | Yes | Yes | Inherits VS Code | Inherits VS Code | No |

## VS Code standards applied

- **Webview UX Guidelines**: Webviews should be used sparingly, match VS Code's native patterns, support high-contrast themes. Our chat is a Webview View (sidebar) — this is correct.
- **Webview API**: Scripts enabled, `enableScripts: true`. `getState/setState` used for persistence. `retainContextWhenHidden` is NOT enabled — webview state resets when hidden. This compounds D5.
- **Keybinding guidelines**: Commands should be contributed via `package.json` `commands` + `keybindings` to appear in the Keyboard Shortcuts editor. 13/21 of ours are `suppressKey` stubs — this violates the guideline.

## Implementation order (locked)

**Phase 7 batch 1 (bugs — small, high-confidence):**
1. B2: Fix theme preset enum (4 vs 6) — quick, documentation + package.json
2. A1: Rewrite `computeMessageCounts` with dedup/edit/subagent awareness
3. D5: Add draft persistence to state.ts
4. C4/C6: Deduplicate keydown listeners in main.ts

**Phase 7 batch 2 (UX — composer redesign):**
5. Composer UX per Phase 3 redesign proposals

**Phase 8: Validation**
- typecheck → build → test:unit
- Verify message counts are correct
- Verify shortcuts don't double-fire
- Verify draft persists across tab switch

## File impact

**Modified:** `src/chat/webview/messageCounter.ts`, `src/chat/webview/state.ts`, `src/chat/webview/main.ts`, `src/chat/webview/keyboardShortcuts.ts`, `package.json`, `AGENTS.md`

**Tests:** Behavioral tests for new `computeMessageCounts`, draft persistence, shortcut dedup

**New (docs):** This directory with orientation + phased reports
