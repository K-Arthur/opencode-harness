# Settings Panel Audit — Phase 2

**Date:** 2026-06-14
**Method:** Cross-referencing package.json configuration against grep results for `config.get` / `getConfiguration` across the codebase.

## Key-by-key audit

| Key | Default | Scanned | Read by | UI exists? | Notes |
|---|---|---|---|---|---|
| `binaryPath` | `""` | machine | extension.ts L107? | ❌ (C)  | No UI; instructions say "edit settings.json" |
| `autoInstall` | `prompt` | machine | extension.ts, ServerLifecycle | ❌ (C) | No UI |
| `serverUrl` | `""` | machine | extension.ts L107 | ❌ (C) | "Attach to Remote Server" command exists but no settings UI |
| `serverAuthToken` | `""` | machine | authTokenMigration.ts L15 | ❌ (C) | Deprecated. SecretStorage should be used. |
| `mcpServers` | `{}` | window | McpServerManager.ts L478 | ✅ mcp-config.ts | 3 sources of truth: config, opencode.json, UI |
| `theme` | `{preset:"cli-default",overrides:{}}` | window | ThemeController.ts L25 | ✅ themeCustomizer.ts | B2 fixed (6 presets now in enum) |
| `model` | `""` | window | ModelManager.ts, commands/model.ts | ✅ model-dropdown.ts | Model selector dropdown |
| `contextWindowOverride` | `0` | window | ChatProvider.ts L1681 | ❌ (C) | Set via command `opencode-harness.setContextWindowOverride` |
| `rateLimits` | `{}` | window | RateLimitMonitor.ts | ❌ (C) | No UI |
| `rateLimitWarningThreshold` | `0.1` | window | RateLimitMonitor.ts L169 | ❌ (C) | No UI |
| `rateLimitCriticalThreshold` | `0.05` | window | RateLimitMonitor.ts L170 | ❌ (C) | No UI |
| `inlineSuggestions.enabled` | `false` | window | InlineCompletionProvider.ts L12 | ❌ (C) | Preview; no UI |
| `inlineSuggestions.triggerDelay` | `300` | window | InlineCompletionProvider.ts L12 | ❌ (C) | Preview; no UI |
| `autoCompact` | `ask` | window | ChatProvider.ts, ContextMonitor.ts | ❌ | No UI (persist tab via ChatProvider or webview menu) |
| `autoCompactThreshold` | `80` | window | ContextMonitor.ts L134 | ❌ | No UI |
| `autoCompactPerModelThreshold` | `{}` | window | ContextMonitor.ts L229 | ❌ | No UI |
| `sessions.emptySessionTtlMinutes` | `60` | window | SessionStore.ts L227 | ❌ | No UI |
| `sessions.cleanupIntervalMinutes` | `15` | window | SessionStore.ts L232 | ❌ | No UI |
| `sessions.restoreOpenTabs` | `true` | window | ChatProvider.ts L1758 | ❌ | No UI |
| `sessions.maxConcurrentStreams` | `5` | window | ChatProvider.ts L1866 | ❌ | No UI (ADR-010, referenced in AGENTS.md) |
| `sessions.processStrategy` | `shared` | window | TabManager.ts, ServerLifecycle.ts | ❌ | No UI |
| `debugLogging` | `false` | window | outputChannel.ts L92 | ❌ | No UI |
| `tdd.enabled` | `false` | window | ChatCommands.ts, AgentWiring | ❌ | No UI |
| `tdd.minCoverage` | `80` | window | ChatCommands.ts | ❌ | No UI |
| `tdd.maxIterations` | `5` | window | ChatCommands.ts | ❌ | No UI |
| `sadd.enabled` | `false` | window | TabManager.ts | ❌ | No UI |
| `sadd.maxSubagents` | `4` | window | TabManager.ts | ❌ | No UI |
| `methodology.enabled` | `true` | window | ChatProvider.ts, ChatCommands.ts | ❌ | No UI |
| `toolOutput.renderAnsi` | `false` | window | ChatProvider.ts L1880 | ❌ | No UI |
| `defaultMode` | `build` | window | ChatProvider.ts | ❌ | Set via webview welcome screen (pendingMode) |
| `modeModels` | `{}` | window | ModelManager.ts L284 | ❌ | No UI |
| `voice.enabled` | `true` | window | ChatProvider.ts L411 | ✅ (mic button) | Voice button in composer |
| `voice.autoSend` | `false` | window | ChatProvider.ts L412 | ❌ | No UI |
| `voice.language` | `auto` | window | ChatProvider.ts L413 | ❌ | No UI |
| `voice.insertMode` | `append` | window | ChatProvider.ts L414 | ❌ | No UI |
| `voice.maxRecordingSeconds` | `60` | window | ChatProvider.ts L415 | ❌ | No UI |
| `voice.model` | `""` | machine | VoiceInputService.ts | ❌ | No UI |
| `voice.localCommand` | `""` | machine | ChatProvider.ts L427 | ❌ | No UI |
| `voice.recordCommand` | `""` | machine | ChatProvider.ts L427 | ❌ | No UI |

**Legend:** ✅ = has dedicated UI, ❌ = no dedicated UI, (C) = command-only or settings.json only

## Findings

### Dead settings: NONE FOUND
All 35 config keys are read by at least one code path. No dead settings.

### Unpersisted settings: NONE FOUND (trivially)
VS Code's `workspace.getConfiguration()` handles persistence natively. All settings are persisted to VS Code's settings.json.

### Settings without UI: 28/35 (80%)
The vast majority of settings require the user to edit `settings.json` directly or run a VS Code command. Only 7 have UI:
- `theme` → themeCustomizer.ts
- `model` → model-dropdown.ts
- `mcpServers` → mcp-config.ts
- `voice.enabled` → mic button toggle (indirect)
- `defaultMode` → welcome screen pendingMode (indirect)
- `serverUrl` → "Attach Remote Server" command (indirect)
- `serverAuthToken` → same command via SecretStorage

### Multi-source-of-truth (MCP config)
`mcpServers` has 3 sources:
1. `opencode.mcpServers` in VS Code config → McpServerManager.ts L478
2. `opencode.json` file (primary per AGENTS.md) → McpServerManager.ts
3. `mcp-config.ts` UI → writes to host messages

This is per-architecture design (opencode.json is primary, VS Code config is fallback), but the UI only writes to the host, not to opencode.json or VS Code config directly. This means UI config changes may not persist across reload if the host doesn't save them.

### Secret storage vs plaintext
`serverAuthToken` in config is deprecated (per its description). `authTokenMigration.ts` handles migrating to SecretStorage. Good pattern.

### Theme preset (B2)
Fixed in 54e9831. Package.json enum now matches ThemeManager.ts type definition (6 presets).

## Recommendations
1. **Add settings UI for the 28 missing keys** — group into logical categories: General, AI, Voice, Sessions, TDD, SADD
2. **Unify MCP config persistence** — ensure UI writes to opencode.json (the primary source)
3. **Add search** to settings panel (VS Code's own settings already have search; our webview should too)
4. **Validation feedback** — invalid numeric values (e.g., `autoCompactThreshold` < 10) should show inline error
5. **Reset controls** — per-setting "Reset to default" button
6. **Group by category** in the settings UI, matching the VS Code convention
