# Navigation & Wayfinding Guide

How to move around OpenCode Harness, what each surface is for, and the guarantees
behind back/Escape/focus behavior. Companion to the audit
(`docs/specs/2026-06-12-navigation-audit-and-plan.md`) and ADR-015.

## Surfaces at a glance

| Surface | Purpose |
|---|---|
| Activity Bar → OpenCode | Opens the chat webview view (`opencode-harness.chat`). |
| Chat webview | Everything: session tabs, composer, message list, side region. |
| Session tabs (top of webview) | One tab per session. Active tab has an accent border; a streaming tab shows a pulsing dot. Arrow keys move between tabs. |
| Side region (right) | Todos / Activity / Commands / Subagents. Toggle from the gear menu or keyboard. Pin to keep it open; Escape closes it (when unpinned). |
| Status bar (left) | Connection state. While any session streams it becomes `$(sync~spin) OpenCode: N running` and clicking it jumps to the running session. |
| Status bar (right) | Methodology lightbulb → settings. |
| Command Palette | All `OpenCode: …` commands. |
| Quick Picks | Session switcher, running-session picker, history, model. |

## Core flows (target: ≤2 actions)

| Goal | How |
|---|---|
| New session | Tab `+`, `Ctrl+Alt+N`, or welcome "New session". |
| Resume last session | Welcome "Continue last session" or `OpenCode: Continue Last Session`. |
| Switch to an open session | Click its tab, or `Ctrl+Alt+]` / `Ctrl+Alt+[`. |
| Switch to any session | `OpenCode: View Sessions` → pick (reveals chat + opens the tab). |
| Jump to what's running | `OpenCode: Jump to Running Session`, or click the status-bar running indicator. |
| Answer a model question | The question bar appears above the input on that session's tab. |
| Switch Plan/Build/Auto | Mode dropdown, `Ctrl+Shift+M` (cycle), or `Ctrl/Cmd+Alt+1/2/3`. |
| Stop the run | `Ctrl+Shift+Esc` (always), or Escape when no overlay is open. |
| Open a subagent | Subagents pane → card → detail. Back returns to the list; "Open session" opens its child session as a tab. |

## Escape behavior (ADR-015)

**One Escape press affects exactly one surface.** The central coordinator closes
the single topmost open overlay and consumes the event, so a press meant to
dismiss a dropdown can never also abort your running task.

Priority order (highest closes first): modals → dropdowns/menus → nested detail
views → transient bars → side panels. Example: with the subagent detail open
inside the side region, the first Escape returns to the list, a second closes the
region — never both at once.

Escape **stops the active stream only when nothing is open**. The coordinator
steps aside for combobox popups (mention/slash autocomplete, mode/model/variant
menus), `aria-modal` dialogs it does not manage (instructions editor, model
manager, MCP config, permission config, mode warning), the native `<dialog>`
theme customizer (managed by `themeOrchestrator.ts`), and non-prompt text
fields. `Ctrl+Shift+Esc` is the always-on, unambiguous stop.

## Accessibility guarantees

- Escape is consistent and non-destructive (above).
- Modals trap Tab and restore focus to the invoking control on close
  (session modal, keyboard-shortcuts modal). Subagent detail Back/Close return
  focus to the originating card.
- Tabs follow the WAI-ARIA tabs pattern (arrow keys, roving tabindex).
- Active/streaming state is conveyed by icon **and** text, not color alone
  (status bar count, codicons in the session picker).
- Streaming updates do not steal the visible tab (`sessionFocus.ts`): the
  webview owns which tab is shown; the host's active id is only a hint.

## Commands added/changed

| Command ID | Title | Change |
|---|---|---|
| `opencode-harness.jumpToRunningTask` | OpenCode: Jump to Running Session | **New.** |
| `opencode-harness.listSessions` | OpenCode: View Sessions | Now navigates (reveal + open), with richer items. ID unchanged. |
| `opencode-harness.openStoredSession` | OpenCode: Open Stored Session | Hidden from the palette (argument-only API command). ID unchanged. |
| `opencode-harness.stop` | OpenCode: Stop | Plain-`escape` keybinding removed; `Ctrl+Shift+Esc` retained. |

## Backward compatibility / rollback

- No command IDs, settings keys, persisted state, SSE/streaming, or message
  contract changed.
- **Rollback Escape coordinator:** remove the `setupEscapeCoordinator()` call in
  `main.ts` and restore the two removed `package.json` keybindings
  (`escape → stop`, `f1 → openCommandsPalette`).
- **Rollback session switcher:** `registerListSessionsCommand` falls back to the
  prior `setActive` + toast when called without the `nav` argument.
- **Rollback running indicator:** unregister `jumpToRunningTask` and drop the
  `wireRunningIndicator` call; the status bar reverts to connection state only.

## Known limitations / follow-ups (see plan, S/L tiers)

- Side-panel toggles still live in the gear menu (S-1).
- No cross-tab badge yet for pending questions/permissions on inactive tabs (S-2).
- "Open Latest Diff" command not yet added (S-3).
- In-webview shortcuts not yet unified under one registry (S-6).
- Session tree view in the Activity Bar is a long-term item (L-2).
