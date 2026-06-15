# Keyboard Shortcut Audit — Phase 2

**Date:** 2026-06-14
**Method:** grep of main.ts, inputHandlers.ts, package.json, keyboardShortcuts.ts, modeDropdown.ts, commands-modal.ts, mentions.ts

## Complete shortcut inventory

### VS Code-level keybindings (visible in Keyboard Shortcuts editor)

| Shortcut | Command | Scope | Source |
|---|---|---|---|
| `Ctrl+I` | `opencode-harness.quickChat` | editorTextFocus | package.json L249-252 |
| `Ctrl+Alt+O` | `opencode-harness.toggleFocus` | any | package.json L253-256 |
| `Ctrl+Alt+N` | `opencode-harness.newSession` | any | package.json L257-260 |
| `Alt+K` | `opencode-harness.insertMention` | editorTextFocus | package.json L262-265 |
| `Ctrl+Shift+Esc` | `opencode-harness.stop` | chatFocused | package.json L267-275 |
| `Ctrl+Shift+/` | `opencode-harness.openCommandsPalette` | chatFocused | package.json L272-279 |
| `Ctrl+Alt+]` | `opencode-harness.nextTab` | chatFocused | package.json L277-285 |
| `Ctrl+Alt+[` | `opencode-harness.prevTab` | chatFocused | package.json L281-289 |
| `Ctrl+Alt+R` | `opencode-harness.retryLast` | chatFocused | package.json L287-295 |
| `Alt+1` | `opencode-harness.suppressKey` (noop) | chatFocused (absorb chord) | package.json L292-295 |
| `Alt+2` | same | same | L296-299 |
| `Alt+3` | same | same | L300-303 |
| `Alt+Shift+Tab` | same | same | L306-309 |
| `Ctrl+Shift+M` | same | same | L312-315 |
| `Ctrl+Shift+T` | same | same | L316-319 |
| `Ctrl+T` | same | same | L321-324 |
| `Ctrl+W` | same | same | L326-329 |
| `Ctrl+Tab` | same | same | L331-334 |
| `Ctrl+Shift+Tab` | same | same | L336-339 |
| `Ctrl+K` | same | same | L341-345 |

### Webview-side shortcuts (NOT in VS Code Keyboard Shortcuts editor)

| Shortcut | Action | Source | Handler type |
|---|---|---|---|
| `Ctrl+T` | New tab | main.ts:911-915 | document keydown |
| `Ctrl+W` | Close active tab | main.ts:916-923 | document keydown |
| `Ctrl+Tab` | Next tab | main.ts:924-929 | document keydown |
| `Ctrl+Shift+Tab` | Prev tab | main.ts:924-929 | document keydown |
| `Ctrl+L` | Focus prompt (not text input) | main.ts:933-937 | document keydown |
| `Ctrl+F` | Toggle search bar (not text input) | main.ts:938-950 | document keydown |
| `Shift+/` | Open keyboard shortcuts modal | main.ts:953-957 | document keydown |
| `Ctrl+Shift+Alt+L` | Toggle timeline | main.ts:960-964 | document keydown |
| `Ctrl+Shift+Alt+T` | Toggle todos | main.ts:965-969 | document keydown |
| `Ctrl+Shift+Alt+K` | Toggle checkpoints | main.ts:970-974 | document keydown |
| `Ctrl+Shift+Alt+A` | Toggle subagents | main.ts:975-979 | document keydown |
| `Ctrl+Shift+Alt+S` | Toggle skills | main.ts:980-984 | document keydown |
| `Ctrl+Shift+Alt+N` | New session | main.ts:985-989 | document keydown |
| `Ctrl+Shift+Alt+H` | Open history | main.ts:990-995 | document keydown |
| `Enter` | Send (idle) / Queue (streaming) | inputHandlers.ts:69 | textarea keydown |
| `Ctrl+Enter` | Send (idle) / Interrupt (streaming) | inputHandlers.ts:62 | textarea keydown |
| `Ctrl+T` | New tab (text focused) | inputHandlers.ts:63 | textarea keydown |
| `Ctrl+W` | Close tab (text focused) | inputHandlers.ts:64 | textarea keydown |
| `Ctrl+Tab` | Next tab (text focused) | inputHandlers.ts:65 | textarea keydown |
| `Ctrl+Shift+Tab` | Prev tab (text focused) | inputHandlers.ts:65 | textarea keydown |
| `Ctrl+K` | Commands palette (text focused) | inputHandlers.ts:66 | textarea keydown |
| `Alt+1` | Set Plan mode | modeDropdown.ts:cycleModeForward | mode dropdown |
| `Alt+2` | Set Build mode | modeDropdown.ts | mode dropdown |
| `Alt+3` | Set Auto mode | modeDropdown.ts | mode dropdown |
| `Alt+Shift+Tab` | Cycle mode forward | modeDropdown.ts | mode dropdown |
| `Ctrl+Shift+T` | Toggle thinking blocks | thinkingToggle.ts | thinking toggle |
| `Ctrl+F` | Message search | messageSearch.ts | search bar |
| `Escape` | Close top modal/overlay/stop stream | escapeCoordinator.ts:103-127 | document keydown |
| `ArrowUp/Down` | Navigate dropdown items | multiple files | dropdown keydown |
| `Home/End` | First/last dropdown item | multiple files | dropdown keydown |
| `F2` | Edit queue chip | queueRenderer.ts | queue keydown |
| `Alt+ArrowUp/Down` | Reorder queue chip | queueRenderer.ts | queue keydown |
| `Delete/Backspace` | Remove queue chip | queueRenderer.ts | queue keydown |
| `Cmd/Ctrl+1/2/3` | Steer modes (REMOVED per inputHandlers.ts comment) | inputHandlers.ts:51 | (formerly) |

### SuppressKey analysis

13 of 21 VS Code `keybindings` are `suppressKey` stubs. These exist to absorb chord conflicts that would otherwise:
1. Trigger VS Code's default action (e.g. `Ctrl+T` opens a new terminal)
2. Not reach the webview's DOM event handlers

The webview's `setupGlobalKeyboardShortcuts` then handles these keys instead. This works but has two problems:
- Users cannot remap these shortcuts in VS Code's Keyboard Shortcuts editor
- The `suppressKey` pattern is fragile — if a future VS Code version changes default keybindings, the suppression blocks the user's preferred mapping

### Conflict matrix

| Shortcut | VS Code default | OS default | Webview handler conflict | Risk |
|---|---|---|---|---|
| `Ctrl+T` | New terminal | — | inputHandlers + doc handler both fire | **High** (C4/C6 fixed: `isTextInput` guard) |
| `Ctrl+W` | Close editor tab | — | inputHandlers + doc handler both fire | **High** (C4/C6 fixed) |
| `Ctrl+Tab` | Next editor group | — | inputHandlers + doc handler both fire | **High** (C4/C6 fixed) |
| `Ctrl+Shift+Tab` | Prev editor group | — | inputHandlers + doc handler both fire | **High** (C4/C6 fixed) |
| `Ctrl+K` | VS Code chord prefix | — | inputHandlers + doc handler both fire | **High** (C4/C6 fixed) |
| `Ctrl+L` | Go to line | — | doc handler only (guarded by isTextInput) | **Low** |
| `Ctrl+F` | Find in file | — | doc handler only (guarded by isTextInput) | **Low** |
| `Ctrl+Shift+T` | Reopen closed editor | — | doc handler only (suppressKey absorbs) | **Low** |
| `Shift+/` | — | — | No conflict | **None** |
| `Ctrl+Alt+]` | — | — | No conflict | **None** |
| `Ctrl+Alt+[` | — | — | No conflict | **None** |
| `Ctrl+Alt+R` | — | — | No conflict | **None** |
| `Esc` | — | Close overlay (some) | Coordinated via escapeCoordinator | **Low** |

### Discoverability

- Only VS Code-level `keybindings` are visible in Keyboard Shortcuts editor
- 8 real commands exposed, 13 suppressKey stubs, 25+ webview-only shortcuts invisible
- `keyboardShortcutsModal.ts` shows a reference card — but only for the webview shortcuts the maintainers remembered to add
- `Shift+/` opens the modal — good entry point

### Cross-platform

- All webview handlers check `e.ctrlKey || e.metaKey` — correct for Win/Mac
- `Ctrl+Alt+]` and `Ctrl+Alt+[` use bracket keys — may conflict on non-US keyboards
- `Alt+1/2/3` for mode selection — standard, works cross-platform

### Recommendations

1. **Migrate 8 real webview shortcuts to VS Code `commands` + `keybindings`** — so they appear in Keyboard Shortcuts editor. Specifically: `Ctrl+L` (focus prompt), `Ctrl+F` (search), `Shift+/` (shortcuts modal), `Ctrl+Shift+Alt+L/T/K/A/S/H` (panel toggles).
2. **Replace `suppressKey` stubs with proper `when` clause usage** — VS Code's `when` clause for `webviewFocus` is more maintainable.
3. **Verify `keyboardShortcutsModal.ts` content matches actual shortcuts** — add any missing.
4. **Document every shortcut in the modal** — the modal should be a single source of truth.
