# Living Feature Manifest

> **Ground truth** of every user-facing feature in the OpenCode Harness VS Code
> extension. This file is the absolute reference point — every ID here is
> asserted by `tests/unit/feature-manifest.test.mjs` (structural) and will be
> asserted by `tests/integration/commands.test.mjs` (behavioral, Phase 2).
>
> **Update this file BEFORE removing or renaming a feature — never after.**
> The structural test will fail the build if `package.json` drifts from this
> manifest.

## Conventions

- **Feature ID prefix**:
  - `FM-CMD-*` — VS Code command contribution
  - `FM-CFG-*` — Configuration key contribution
  - `FM-KB-*`  — Keybinding contribution
  - `FM-MENU-*`— Menu / context-menu contribution
  - `FM-VIEW-*`— View / view-container contribution
  - `FM-UI-*`  — Webview DOM control (element ID in `index.html`)
  - `FM-SC-*`  — Local slash command (webview-resolved)
  - `FM-STATE-*`— Persisted state key (globalState / workspaceState / SecretStorage)
  - `FM-ACT-*` — Activation event
- **Status**: `stable` | `preview` | `internal` | `deprecated`
- **Entry point**: file path (relative to repo root) of the handler or schema.

---

## 1. Activation Events (FM-ACT-*)

| ID | Event | Status |
|---|---|---|
| FM-ACT-001 | `onStartupFinished` | stable |
| FM-ACT-002 | `onView:opencode-harness.chatView` | stable |

---

## 2. Commands (FM-CMD-*)

| ID | Command ID | Title | Status | Entry point |
|---|---|---|---|---|
| FM-CMD-001 | `opencode-harness.openChat` | Open Chat | stable | `src/commands/session.ts` |
| FM-CMD-002 | `opencode-harness.newSession` | New Session | stable | `src/commands/session.ts` |
| FM-CMD-003 | `opencode-harness.toggleFocus` | Toggle Chat Focus | stable | `src/commands/session.ts` |
| FM-CMD-004 | `opencode-harness.explainCode` | Explain Code | stable | `src/inline/InlineActionProvider.ts` |
| FM-CMD-005 | `opencode-harness.refactorCode` | Refactor Code | stable | `src/inline/InlineActionProvider.ts` |
| FM-CMD-006 | `opencode-harness.generateTests` | Generate Tests | stable | `src/inline/InlineActionProvider.ts` |
| FM-CMD-007 | `opencode-harness.insertMention` | Insert File Reference | stable | `src/commands/session.ts` |
| FM-CMD-008 | `opencode-harness.captureTerminal` | Capture Terminal Output | stable | `src/commands/theme.ts` |
| FM-CMD-009 | `opencode-harness.rollback` | Rollback Changes | stable | `src/commands/rollback.ts` |
| FM-CMD-010 | `opencode-harness.showRateLimits` | View Rate Limits | stable | `src/commands/misc.ts` |
| FM-CMD-011 | `opencode-harness.selectModel` | Choose Model | stable | `src/commands/model.ts` |
| FM-CMD-012 | `opencode-harness.setContextWindowOverride` | Set Context Window Override | stable | `src/commands/model.ts` |
| FM-CMD-013 | `opencode-harness.checkCli` | Test CLI Connection | stable | `src/commands/misc.ts` |
| FM-CMD-014 | `opencode-harness.installCli` | Install CLI | stable | `src/commands/misc.ts` |
| FM-CMD-015 | `opencode-harness.listSessions` | View Sessions | stable | `src/commands/session.ts` |
| FM-CMD-016 | `opencode-harness.openStoredSession` | Open Stored Session | internal | `src/commands/session.ts` |
| FM-CMD-017 | `opencode-harness.deleteSession` | Delete Session | stable | `src/commands/session.ts` |
| FM-CMD-018 | `opencode-harness.renameSession` | Rename Session | stable | `src/commands/session.ts` |
| FM-CMD-019 | `opencode-harness.exportConversation` | Export Conversation | stable | `src/commands/export.ts` |
| FM-CMD-020 | `opencode-harness.importConversationJson` | Import Conversation from JSON | stable | `src/commands/export.ts` |
| FM-CMD-021 | `opencode-harness.previewTheme` | Preview Theme | stable | `src/commands/theme.ts` |
| FM-CMD-022 | `opencode-harness.clearTestSessions` | Clear Test Sessions | internal | `src/commands/session.ts` |
| FM-CMD-023 | `opencode-harness.continueLastSession` | Continue Last Session | stable | `src/commands/session.ts` |
| FM-CMD-024 | `opencode-harness.chooseHistorySession` | Open Past Session | stable | `src/commands/session.ts` |
| FM-CMD-025 | `opencode-harness.attachRemote` | Connect to Remote Server | stable | `src/commands/session.ts` |
| FM-CMD-026 | `opencode-harness.addFileToSession` | Add File to Session | stable | `src/commands/session.ts` |
| FM-CMD-027 | `opencode-harness.addSelectionToSession` | Add Selection to Session | stable | `src/commands/session.ts` |
| FM-CMD-028 | `opencode-harness.stop` | Stop | stable | `src/commands/misc.ts` |
| FM-CMD-029 | `opencode-harness.quickChat` | Quick Chat | stable | `src/inline/QuickChatCommand.ts` |
| FM-CMD-030 | `opencode-harness.generateAgentsMd` | Generate AGENTS.md | stable | `src/commands/methodology.ts` |
| FM-CMD-031 | `opencode-harness.openCommandsPalette` | Open Commands Palette | stable | `src/commands/misc.ts` |
| FM-CMD-032 | `opencode-harness.clearSession` | Clear Active Session | stable | `src/chat/ChatCommands.ts` |
| FM-CMD-033 | `opencode-harness.showCost` | Show Session Cost | stable | `src/chat/ChatCommands.ts` |
| FM-CMD-034 | `opencode-harness.showHelp` | Show Slash Commands | stable | `src/chat/ChatCommands.ts` |
| FM-CMD-035 | `opencode-harness.cycleMode` | Cycle Session Mode | stable | `src/extension.ts` |
| FM-CMD-036 | `opencode-harness.setBuildMode` | Set Session Mode to Build | stable | `src/extension.ts` |
| FM-CMD-037 | `opencode-harness.setPlanMode` | Set Session Mode to Plan | stable | `src/extension.ts` |
| FM-CMD-038 | `opencode-harness.setAutoMode` | Set Session Mode to Auto | stable | `src/extension.ts` |
| FM-CMD-039 | `opencode-harness.setDefaultMode` | Set Default Session Mode | stable | `src/extension.ts` |
| FM-CMD-040 | `opencode-harness.setupVoiceInput` | Set Up Voice Input | stable | `src/extension.ts` |
| FM-CMD-041 | `opencode-harness.retryLast` | Retry Last Failed Run | stable | `src/extension.ts` |
| FM-CMD-042 | `opencode-harness.nextTab` | Next Tab | stable | `src/extension.ts` |
| FM-CMD-043 | `opencode-harness.prevTab` | Previous Tab | stable | `src/extension.ts` |
| FM-CMD-044 | `opencode-harness.openSettings` | Open Settings | stable | `src/extension.ts` |
| FM-CMD-045 | `opencode-harness.jumpToRunningTask` | Jump to Running Session | stable | `src/commands/runningTask.ts` |
| FM-CMD-046 | `opencode-harness.suppressKey` | (internal) Suppress conflicting key | internal | `src/extension.ts` |

---

## 3. Configuration Keys (FM-CFG-*)

| ID | Key | Type | Default | Scope | Status |
|---|---|---|---|---|---|
| FM-CFG-001 | `opencode.binaryPath` | string | `""` | machine | stable |
| FM-CFG-002 | `opencode.autoInstall` | enum | `"prompt"` | machine | stable |
| FM-CFG-003 | `opencode.serverUrl` | string | `""` | machine | stable |
| FM-CFG-004 | `opencode.serverAuthToken` | string | `""` | machine | deprecated |
| FM-CFG-005 | `opencode.mcpServers` | object | `{}` | window | stable |
| FM-CFG-006 | `opencode.chat.fontSize` | integer | `14` | window | stable |
| FM-CFG-007 | `opencode.chat.fontFamily` | string | `""` | window | stable |
| FM-CFG-008 | `opencode.theme` | object | `{preset:"cli-default",overrides:{}}` | window | stable |
| FM-CFG-009 | `opencode.model` | string | `""` | window | stable |
| FM-CFG-010 | `opencode.contextWindowOverride` | number | `0` | window | stable |
| FM-CFG-011 | `opencode.rateLimits` | object | `{}` | window | stable |
| FM-CFG-012 | `opencode.rateLimitWarningThreshold` | number | `0.1` | window | stable |
| FM-CFG-013 | `opencode.rateLimitCriticalThreshold` | number | `0.05` | window | stable |
| FM-CFG-014 | `opencode.inlineSuggestions.enabled` | boolean | `false` | window | preview |
| FM-CFG-015 | `opencode.inlineSuggestions.triggerDelay` | number | `300` | window | preview |
| FM-CFG-016 | `opencode.autoCompact` | enum | `"ask"` | window | stable |
| FM-CFG-017 | `opencode.autoCompactThreshold` | number | `80` | window | stable |
| FM-CFG-018 | `opencode.autoCompactPerModelThreshold` | object | `{}` | window | stable |
| FM-CFG-019 | `opencode.sessions.emptySessionTtlMinutes` | number | `60` | window | stable |
| FM-CFG-020 | `opencode.sessions.cleanupIntervalMinutes` | number | `15` | window | stable |
| FM-CFG-021 | `opencode.sessions.maxSessions` | number | `50` | window | stable |
| FM-CFG-022 | `opencode.sessions.persistMaxMessages` | number | `200` | window | stable |
| FM-CFG-023 | `opencode.sessions.restoreOpenTabs` | boolean | `true` | window | stable |
| FM-CFG-024 | `opencode.debugLogging` | boolean | `false` | window | stable |
| FM-CFG-025 | `opencode.toolOutput.renderAnsi` | boolean | `false` | window | stable |
| FM-CFG-026 | `opencode.tdd.enabled` | boolean | `false` | window | stable |
| FM-CFG-027 | `opencode.sadd.enabled` | boolean | `false` | window | stable |
| FM-CFG-031 | `opencode.methodology.enabled` | boolean | `true` | window | stable |
| FM-CFG-032 | `opencode.sessions.maxConcurrentStreams` | number | `5` | window | stable |
| FM-CFG-033 | `opencode.streaming.ttfbTimeoutMs` | number | `180000` | window | stable |
| FM-CFG-034 | `opencode.sessions.maxTabs` | number | `20` | window | stable |
| FM-CFG-036 | `opencode.sessions.processStrategy` | enum | `"shared"` | window | stable |
| FM-CFG-037 | `opencode.sessions.processIdleTimeoutMinutes` | number | `5` | window | stable |
| FM-CFG-039 | `opencode.defaultMode` | enum | `"build"` | window | stable |
| FM-CFG-040 | `opencode.modeModels` | object | `{}` | window | stable |
| FM-CFG-041 | `opencode.voice.enabled` | boolean | `true` | window | stable |
| FM-CFG-042 | `opencode.voice.autoSend` | boolean | `false` | window | stable |
| FM-CFG-043 | `opencode.voice.language` | string | `"auto"` | window | stable |
| FM-CFG-044 | `opencode.voice.insertMode` | enum | `"append"` | window | stable |
| FM-CFG-045 | `opencode.voice.maxRecordingSeconds` | number | `60` | window | stable |
| FM-CFG-046 | `opencode.voice.model` | string | `""` | machine | stable |
| FM-CFG-047 | `opencode.voice.localCommand` | string | `""` | machine | stable |
| FM-CFG-048 | `opencode.voice.recordCommand` | string | `""` | machine | stable |

---

## 4. Keybindings (FM-KB-*)

| ID | Command | Key | When clause | Status |
|---|---|---|---|---|
| FM-KB-001 | `opencode-harness.quickChat` | `ctrl+i` | `editorTextFocus` | stable |
| FM-KB-002 | `opencode-harness.toggleFocus` | `ctrl+alt+o` | — | stable |
| FM-KB-003 | `opencode-harness.newSession` | `ctrl+alt+n` | — | stable |
| FM-KB-004 | `opencode-harness.insertMention` | `alt+k` | `editorTextFocus` | stable |
| FM-KB-005 | `opencode-harness.stop` | `ctrl+shift+escape` | chat-focused | stable |
| FM-KB-006 | `opencode-harness.openCommandsPalette` | `ctrl+shift+/` | chat-focused | stable |
| FM-KB-007 | `opencode-harness.nextTab` | `ctrl+alt+]` | chat-focused | stable |
| FM-KB-008 | `opencode-harness.prevTab` | `ctrl+alt+[` | chat-focused | stable |
| FM-KB-009 | `opencode-harness.retryLast` | `ctrl+alt+r` | chat-focused | stable |
| FM-KB-010 | `opencode-harness.suppressKey` | `alt+1` | chat-focused | internal |
| FM-KB-011 | `opencode-harness.suppressKey` | `alt+2` | chat-focused | internal |
| FM-KB-012 | `opencode-harness.suppressKey` | `alt+3` | chat-focused | internal |
| FM-KB-013 | `opencode-harness.suppressKey` | `alt+shift+tab` | chat-focused | internal |
| FM-KB-014 | `opencode-harness.suppressKey` | `ctrl+shift+m` | chat-focused | internal |
| FM-KB-015 | `opencode-harness.suppressKey` | `ctrl+shift+t` | chat-focused | internal |
| FM-KB-016 | `opencode-harness.suppressKey` | `ctrl+t` | chat-focused | internal |
| FM-KB-017 | `opencode-harness.suppressKey` | `ctrl+w` | chat-focused | internal |
| FM-KB-018 | `opencode-harness.suppressKey` | `ctrl+tab` | chat-focused | internal |
| FM-KB-019 | `opencode-harness.suppressKey` | `ctrl+shift+tab` | chat-focused | internal |
| FM-KB-020 | `opencode-harness.suppressKey` | `ctrl+k` | chat-focused | internal |

> **chat-focused** = `focusedView == 'opencode-harness.chat' || opencodeHarness.chatFocused`

---

## 5. Menus & Context Contributions (FM-MENU-*)

### 5a. Command Palette (`commandPalette`)

| ID | Command | When | Status |
|---|---|---|---|
| FM-MENU-001 | `opencode-harness.showRateLimits` | `opencodeHarness.chatFocused` | stable |
| FM-MENU-002 | `opencode-harness.checkCli` | `opencodeHarness.chatFocused` | stable |
| FM-MENU-003 | `opencode-harness.installCli` | `opencodeHarness.chatFocused` | stable |
| FM-MENU-004 | `opencode-harness.previewTheme` | `opencodeHarness.chatFocused` | stable |
| FM-MENU-005 | `opencode-harness.clearTestSessions` | `false` (hidden) | internal |
| FM-MENU-006 | `opencode-harness.openStoredSession` | `false` (hidden) | internal |
| FM-MENU-007 | `opencode-harness.suppressKey` | `false` (hidden) | internal |

### 5b. Editor Context Menu (`editor/context`)

| ID | Command | Group | When | Status |
|---|---|---|---|---|
| FM-MENU-008 | `opencode-harness.explainCode` | `opencode@1` | `editorHasSelection` | stable |
| FM-MENU-009 | `opencode-harness.refactorCode` | `opencode@2` | `editorHasSelection` | stable |
| FM-MENU-010 | `opencode-harness.generateTests` | `opencode@3` | `editorHasSelection` | stable |
| FM-MENU-011 | `opencode-harness.addSelectionToSession` | `opencode@4` | `editorHasSelection` | stable |

### 5c. Explorer Context Menu (`explorer/context`)

| ID | Command | Group | When | Status |
|---|---|---|---|---|
| FM-MENU-012 | `opencode-harness.addFileToSession` | `opencode@1` | `resourceScheme == file` | stable |

---

## 6. Views & View Containers (FM-VIEW-*)

| ID | View ID | Container ID | Type | Status |
|---|---|---|---|---|
| FM-VIEW-001 | `opencode-harness.chat` | `opencode-harness` (activitybar) | webview | stable |

---

## 7. Webview UI Controls (FM-UI-*)

All element IDs are in `src/chat/webview/index.html`.

### 7a. Header

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-001 | `timeline-toggle-header-btn` | Conversation timeline toggle | stable |
| FM-UI-002 | `history-btn` | Session history | stable |
| FM-UI-003 | `skills-btn` | Manage skills | stable |
| FM-UI-004 | `settings-btn` | More options (settings menu) | stable |

### 7b. Settings Menu

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-005 | `todos-toggle-btn` | Toggle todos panel | stable |
| FM-UI-006 | `activity-toggle-btn` | Toggle activity timeline | stable |
| FM-UI-007 | `tasks-toggle-btn` | Toggle commands panel | stable |
| FM-UI-008 | `terminal-toggle-btn` | Toggle terminal panel | internal |
| FM-UI-009 | `subagents-toggle-btn` | Toggle subagent panel | stable |
| FM-UI-010 | `checkpoint-toggle-btn` | Toggle checkpoint panel | stable |
| FM-UI-011 | `timeline-toggle-btn` | Toggle conversation timeline | stable |
| FM-UI-012 | `thinking-toggle-menu-item` | Show thinking blocks | stable |
| FM-UI-013 | `mcp-btn` | Manage MCP servers | stable |
| FM-UI-014 | `provider-panel-btn` | Connect providers | stable |
| FM-UI-015 | `perm-config-btn` | Configure tool permissions | stable |
| FM-UI-016 | `theme-customizer-btn` | Customize theme colors | stable |
| FM-UI-017 | `shortcuts-help-btn` | Open keyboard shortcuts | stable |
| FM-UI-018 | `prompt-stash-toggle-btn` | Open prompt stash | stable |

### 7c. Modals

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-019 | `skills-modal` | Manage skills modal | stable |
| FM-UI-020 | `commands-modal` | Commands palette modal | stable |
| FM-UI-021 | `session-modal` | Session history modal | stable |

### 7d. Side Panels

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-022 | `todos-panel` | Todos & Files panel | stable |
| FM-UI-023 | `activity-panel` | Activity panel | stable |
| FM-UI-024 | `tasks-panel` | Commands panel | stable |
| FM-UI-025 | `terminal-panel` | Terminal panel | internal |
| FM-UI-026 | `subagent-panel` | Subagent activity panel | stable |
| FM-UI-027 | `checkpoint-panel` | Checkpoint panel | stable |

### 7e. Status Strip

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-028 | `status-model` | Active model display | stable |
| FM-UI-029 | `status-cost` | Session cost display | stable |
| FM-UI-030 | `status-tokens` | Token usage display | stable |
| FM-UI-031 | `context-usage` | Context usage bar | stable |
| FM-UI-032 | `quota-bar` | Provider quota bar | stable |
| FM-UI-033 | `status-methodology` | Methodology indicator | stable |
| FM-UI-034 | `status-branch` | Git branch display | stable |

### 7f. Input Area

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-035 | `prompt-input` | Composer textarea | stable |
| FM-UI-036 | `mention-dropdown` | File mention dropdown | stable |
| FM-UI-037 | `slash-autocomplete` | Slash command autocomplete | stable |
| FM-UI-038 | `voice-input-status` | Voice input status | stable |

### 7g. Bottom Bar — Left

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-039 | `mention-btn` | Add context mention (@) | stable |
| FM-UI-040 | `commands-palette-btn` | Open commands palette | stable |
| FM-UI-041 | `attach-btn` | Attach files | stable |
| FM-UI-042 | `voice-input-btn` | Start voice input (mic) | stable |
| FM-UI-043 | `instructions-gear-btn` | Custom instructions for this tab | stable |
| FM-UI-044 | `dir-toggle-btn` | Toggle text direction (LTR/RTL) | stable |

### 7h. Bottom Bar — Right

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-045 | `mode-dropdown-btn` | Select session mode | stable |
| FM-UI-046 | `mode-opt-plan` | Plan mode option | stable |
| FM-UI-047 | `mode-opt-build` | Build mode option | stable |
| FM-UI-048 | `mode-opt-auto` | Auto mode option | stable |
| FM-UI-049 | `model-selector-btn` | Select model | stable |
| FM-UI-050 | `variant-selector-btn` | Select thinking level | stable |
| FM-UI-051 | `steer-mode-queue` | Queue steer mode | stable |
| FM-UI-052 | `steer-mode-interrupt` | Interrupt steer mode | stable |
| FM-UI-053 | `send-btn` | Send / Stop button | stable |
| FM-UI-054 | `send-queue-count` | Queued prompts count | stable |

### 7i. Welcome / Empty State

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-055 | `welcome-view` | Welcome container | stable |
| FM-UI-056 | `welcome-continue-btn` | Continue last session | stable |
| FM-UI-057 | `welcome-new-btn` | Start new session | stable |
| FM-UI-058 | `welcome-search-input` | Search sessions | stable |
| FM-UI-059 | `welcome-recent-sessions` | Recent sessions list | stable |
| FM-UI-060 | `welcome-shortcuts-btn` | View keyboard shortcuts | stable |

### 7j. Overlay Bars

| ID | Element ID | Label | Status |
|---|---|---|---|
| FM-UI-061 | `question-bar` | Question from model bar | stable |
| FM-UI-062 | `question-bar-submit` | Submit answer button | stable |
| FM-UI-063 | `permission-bar` | Permission request bar | stable |
| FM-UI-064 | `permission-bar-actions` | Permission response actions | stable |
| FM-UI-065 | `changed-files-strip` | Changed files compact strip | stable |
| FM-UI-066 | `changed-files-panel` | Changed files inline panel | stable |
| FM-UI-067 | `instructions-editor` | Custom instructions editor | stable |

---

## 8. Local Slash Commands (FM-SC-*)

Resolved in the webview via `src/chat/webview/slash-commands.ts` (`LOCAL_SLASH_COMMANDS`).

| ID | Name | Aliases | Category | Status |
|---|---|---|---|---|
| FM-SC-001 | `clear` | — | session | stable |
| FM-SC-002 | `model` | — | session | stable |
| FM-SC-003 | `cost` | — | session | stable |
| FM-SC-004 | `new` | — | session | stable |
| FM-SC-005 | `continue` | — | session | stable |
| FM-SC-006 | `compact` | — | session | stable |
| FM-SC-007 | `stash` | — | prompt | stable |
| FM-SC-008 | `stashes` | — | prompt | stable |
| FM-SC-009 | `template` | — | prompt | stable |
| FM-SC-010 | `queue` | — | prompt | stable |
| FM-SC-011 | `commands` | — | conversation | stable |
| FM-SC-012 | `methodology` | — | session | stable |
| FM-SC-013 | `export` | `export-md` | export | stable |
| FM-SC-014 | `export-json` | — | export | stable |
| FM-SC-015 | `export-text` | — | export | stable |
| FM-SC-016 | `copy` | — | export | stable |
| FM-SC-017 | `diagnose:generation` | — | debug | internal |
| FM-SC-018 | `help` | — | conversation | stable |

---

## 9. Persisted State Schemas (FM-STATE-*)

### 9a. globalState

| ID | Key | Shape | Owner | Migration | Status |
|---|---|---|---|---|---|
| FM-STATE-001 | `opencode-harness.favoriteModels` | `string[]` | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-002 | `opencode-harness.disabledModels` | `string[]` | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-003 | `opencode-harness.recentModels` | `string[]` (cap 10) | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-004 | `opencode-harness.chatDirection` | `"ltr" \| "rtl"` | `src/chat/ChatProvider.ts` | — | stable |
| FM-STATE-005 | `opencode-server-port` | `number \| undefined` | `src/extension.ts` | — | stable |
| FM-STATE-006 | `opencode-methodology-outcomes` | `OutcomeEvent[]` | `src/extension.ts` | — | stable |
| FM-STATE-007 | `opencode-install-declined` | `boolean` | `src/install/OpencodeInstaller.ts` | — | stable |
| FM-STATE-008 | `opencode-harness.sessions` | `Record<string, PersistedSession>` | `src/session/SessionStore.ts` | `safeReadStringArray` guards malformed arrays | stable |
| FM-STATE-009 | `opencode-harness.modelCache` | `ModelInfo[]` | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-010 | `opencode-harness.openRouterCache` | `Record<string, number>` | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-011 | `opencode-harness.openRouterCacheTs` | `number` | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-012 | `opencode-harness.modelsDevCache` | `Record<string, { contextWindow: number; outputLimit?: number }>` | `src/model/ModelManager.ts` | — | stable |
| FM-STATE-013 | `opencode-harness.modelsDevCacheTs` | `number` | `src/model/ModelManager.ts` | — | stable |

### 9b. workspaceState

| ID | Key | Shape | Owner | Migration | Status |
|---|---|---|---|---|---|
| FM-STATE-014 | `opencode.panelVisibility` | `Record<string, boolean>` | `src/chat/ChatProvider.ts` | — | stable |
| FM-STATE-015 | `opencode-harness.openTabs` | `string[]` | `src/chat/TabManager.ts` | — | stable |
| FM-STATE-016 | `opencode-harness.activeTab` | `string` | `src/chat/TabManager.ts` | — | stable |
| FM-STATE-017 | `opencode-harness.tabRestoration` | `Record<string, TabRestorationState>` | `src/chat/TabManager.ts` | — | stable |
| FM-STATE-018 | `opencode.hostPromptQueue` | `Record<string, QueuedPrompt[]>` | `src/chat/HostPromptQueue.ts` | "sending"→"queued" on restore | stable |

### 9c. SecretStorage

| ID | Key | Shape | Owner | Migration | Status |
|---|---|---|---|---|---|
| FM-STATE-019 | `opencode-harness.serverAuthToken` | `string` | `src/migrations/authTokenMigration.ts` | `opencode.serverAuthToken` setting → SecretStorage (one-time, clears plaintext) | stable |

---

## 10. Gap Analysis — Existing Test Coverage

| Manifest section | Existing structural test | Existing behavioral test |
|---|---|---|
| Commands | `tests/unit/regression-smoke.test.mjs` (source presence) | `tests/integration/extension.test.mjs` (partial) |
| Configuration | `tests/unit/configuration-schema.test.mjs` | — |
| Keybindings | `tests/unit/keybindings-contract.test.mjs` | — |
| Slash commands | `tests/unit/slash-commands.test.mjs` | — |
| Webview UI | `tests/unit/ui-regression.test.ts` (partial) | `tests/visual/*.spec.ts`, `tests/webview/*.spec.ts` |
| State schemas | `tests/unit/auth-token-migration.test.mjs` | — |
| Model manager | `src/model/ModelManager.test.ts` | — |

**Gaps the Phase 2 guardrail suite will close:**
1. No single test asserting *every* manifest command is registered in `package.json` AND has a handler in source.
2. No test asserting *every* config key in the manifest is present in `package.json` (only spot-checks exist).
3. No test asserting *every* webview UI element ID in the manifest exists in `index.html`.
4. No integration test programmatically executing every command via `vscode.commands.executeCommand`.
5. No test asserting state-key backward-compatibility mappings are present when schemas change.

---

## 11. Anti-Staleness Contract (FM-ANTISTALE-*)

These entries are not user-facing features; they are engineering guardrails that prevent the "silent staleness anti-pattern" (trusting a cached or stale value instead of re-deriving from the live source of truth). They are asserted by source-presence tests in `tests/unit/feature-manifest.test.mjs`.

| ID | Contract | Live source of truth | Handler / file | Invariant |
|---|---|---|---|---|
| FM-ANTISTALE-001 | Context usage never downgrades from `actual` to empty | `ContextMonitor` token emission | `src/chat/webview/main.ts` `context_usage` handler | Empty/estimated `context_usage` does not overwrite a prior `actual` reading for the same session. |
| FM-ANTISTALE-002 | Tab switch restores live session context | `session.contextUsage` | `src/chat/webview/tabSwitcher.ts` | `switchTab` calls `ctxDropdownApi.updateUsage` and `updateContextUsageBar` for the newly active session. |
| FM-ANTISTALE-003 | `context_window_unknown` hides the bar when the window is unknown | `ContextMonitor` unknown-window signal | `src/chat/webview/main.ts` `context_window_unknown` handler | Handler hides the context usage bar and shows an indeterminate usage state when fill data exists. |
| FM-ANTISTALE-004 | MCP/tool changes re-push command list | `SessionManager.listCommands()` + `listSkills()` + `PromptManager` | `src/chat/ChatProvider.ts` `refreshCommandListQuietly` / `pushCommandListToWebview` | `command_list` is pushed after MCP connection changes and prompt file changes. |
| FM-ANTISTALE-005 | Command list updates all consumers | `command_list` message | `src/chat/webview/main.ts` `command_list` handler | `cachedRemoteCommands`, `commandsModal`, and `mention` are all updated from the same payload. |
| FM-ANTISTALE-006 | Host model push cannot clobber per-session model | `model_update` message | `src/chat/webview/main.ts` `model_update` handler | `model_update` updates the global preference and dropdown but does **not** call `setSessionModel` on the active session. |
| FM-ANTISTALE-007 | Model dropdown re-syncs by canonical id | `model-dropdown.ts` DOM | `src/chat/webview/model-dropdown.ts` `setCurrentModel` | Selection re-sync matches `data-model-id` rather than positional index. |
| FM-ANTISTALE-008 | Long-text containers have CSS containment | Static CSS | `src/chat/webview/css/*.css` | Every text container that renders dynamic content has `overflow-wrap: anywhere` or `word-break: break-word` and `max-width: 100%`. |
| FM-ANTISTALE-009 | Font and direction config changes propagate immediately | `vscode.workspace.onDidChangeConfiguration` | `src/chat/ChatProvider.ts` | `pushChatFontConfigToWebview` and `pushChatDirectionToWebview` are called on relevant config changes and during init. |
| FM-ANTISTALE-010 | Per-process data isolation on spawn | `SessionManagerRegistry.spawnAndRegisterSession` | `src/session/SessionManagerRegistry.ts` | Each spawned process receives a unique `OPENCODE_DATA_DIR` via `mkdtempSync`. |
| FM-ANTISTALE-011 | Windows binary wrapper fallback | `CliDiagnostics.resolveBinaryPath` | `src/diagnostics/CliDiagnostics.ts` | `.cmd` and `.ps1` wrappers on Windows fall back to `opencode` in PATH because they cannot be spawned with `shell: false`. |
