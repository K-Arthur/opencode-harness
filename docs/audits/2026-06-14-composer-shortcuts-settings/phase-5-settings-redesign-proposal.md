# Settings Panel Redesign Proposal — Phase 5

**Date:** 2026-06-14
**Based on:** Phase 2 settings audit (35-key cross-ref, multi-source findings)
**Status:** Proposed, not implemented

## Current state
- 80% of settings (28/35) have no UI — users must edit settings.json directly
- Settings are scattered across 4 backends: VS Code config, workspaceState, globalState, SecretStorage
- MCP config has 3 sources of truth (opencode.json, VS Code config, webview UI)
- No search, no validation feedback, no reset controls

## Proposed architecture

### Category hierarchy

```
General
├── Model (model) → model dropdown (EXISTS)
├── Default mode (defaultMode) → welcome screen (EXISTS)
├── Model per mode (modeModels) → ❌ NEW
├── Context window override (contextWindowOverride) → ❌ NEW
├── Auto-install CLI (autoInstall) → ❌ NEW
│
AI Behavior
├── Auto-compact (autoCompact, autoCompactThreshold) → ❌ NEW
├── Max concurrent streams (maxConcurrentStreams) → ❌ NEW
├── Process strategy (shared/per-tab) → ❌ NEW
├── Methodology hint (methodology.enabled) → ❌ NEW
├── TDD (tdd.enabled, tdd.minCoverage, tdd.maxIterations) → ❌ NEW
├── SADD (sadd.enabled, sadd.maxSubagents) → ❌ NEW
│
Voice Input
├── Enabled (voice.enabled) → mic button (EXISTS)
├── Auto-send (voice.autoSend) → ❌ NEW
├── Language (voice.language) → ❌ NEW
├── Insert mode (voice.insertMode) → ❌ NEW
├── Max recording (voice.maxRecordingSeconds) → ❌ NEW
├── Model (voice.model) → ❌ NEW
├── Custom command (voice.localCommand, voice.recordCommand) → ❌ NEW (expert)
│
Sessions
├── Restore open tabs (sessions.restoreOpenTabs) → ❌ NEW
├── Empty session TTL (sessions.emptySessionTtlMinutes) → ❌ NEW (expert)
├── Cleanup interval (sessions.cleanupIntervalMinutes) → ❌ NEW (expert)
│
Rate Limits
├── Warning threshold (rateLimitWarningThreshold) → ❌ NEW (expert)
├── Critical threshold (rateLimitCriticalThreshold) → ❌ NEW (expert)
├── Per-provider limits (rateLimits) → ❌ NEW (expert)
│
Appearance
├── Theme (theme) → themeCustomizer (EXISTS)
├── ANSI rendering (toolOutput.renderAnsi) → ❌ NEW
│
Advanced (collapsed by default)
├── Binary path (binaryPath) → ❌ NEW
├── Server URL (serverUrl) → command (EXISTS)
├── Debug logging (debugLogging) → ❌ NEW
├── MCP servers (mcpServers) → mcp-config (EXISTS)
├── Inline suggestions (inlineSuggestions.*) → ❌ NEW (preview)
```

### UX patterns

1. **Inline search** — filter settings by key or label text
2. **Validation** — invalid numeric values (e.g., threshold < 0) show inline red error
3. **Reset controls** — per-setting "Reset to default" button; "Reset all" at category level
4. **Expert toggle** — "Show advanced settings" collapses/expands the Expert section
5. **Save feedback** — brief "Saved" toast or checkmark on successful persistence
6. **Keyboard navigation** — ArrowUp/Down/Home/End/Tab with visible focus ring

### Implementation approach

The settings panel should be a **new dedicated modal** (not inline in the composer toolbar). The current `ui/settingsMenu.ts` is only 5 symbols (open/close/keyboard nav) — move its responsibilities to a new `ui/settings-panel.ts`:

```
src/chat/webview/ui/settings-panel.ts    — panel modal + keyboard nav (NEW)
src/chat/webview/ui/settings-category.ts — category accordion component (NEW)
src/chat/webview/css/settings-panel.css  — panel styles (NEW)
```

**Persistence:** All settings go through VS Code's `workspace.getConfiguration().update()` which handles persistence natively. No need for a custom storage layer.

**MCP config unification:** The `mcp-config.ts` UI should write to `opencode.json` (the primary source per AGENTS.md) instead of VS Code config. This is a backend change in `McpServerManager.ts`.
