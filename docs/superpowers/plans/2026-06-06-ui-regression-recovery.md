# UI Regression Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the June 6 UI/voice/session behavior that regressed in the installed OpenCode Harness extension.

**Architecture:** Fix the display producers instead of hiding symptoms: status-strip rendering must respect welcome visibility, observed provider quota must not render a decorative progress track, changed-files state must update the bottom strip without leaking a header count, shortcuts must converge on the same tab/session creation route, and voice setup must reconnect to the existing pure setup planner.

**Tech Stack:** VS Code extension host, TypeScript, webview DOM modules, node:test/tsx tests, esbuild/vsce reinstall flow.

---

### Task 1: Status Strip And Context UI

**Files:**
- Modify: `src/chat/webview/main.ts`
- Modify: `src/chat/webview/ui/tokenCostDisplay.ts`
- Modify: `src/chat/webview/context-usage-dropdown.ts`
- Modify: `src/chat/webview/css/context-usage.css`
- Test: `src/chat/webview/main.test.ts`
- Test: `src/chat/webview/ui/tokenCostDisplay.context.test.ts`

- [x] Add a welcome-visible guard so `showStatusStrip()` cannot reveal context/token/quota UI while the welcome screen is visible.
- [x] Ensure `hideStatusStrip()` also hides context usage and context-window-unknown affordances.
- [x] Remove the fallback path that derives context usage from cumulative `tokenUsage.total`.
- [x] Keep observed provider quota text, but hide the progress track for observed-only usage.
- [x] Restyle the context dropdown as a compact bounded popover and make the context-window-unknown chip a normal inline chip.
- [x] Add/adjust tests for welcome guards and observed quota behavior.

### Task 2: Changed Files Count Leak

**Files:**
- Modify: `src/chat/webview/changed-files-dropdown.ts`
- Modify: `src/chat/webview/main.ts`
- Test: `src/chat/webview/changed-files-isolation.test.ts`

- [x] Allow the changed-files dropdown to run without a toolbar badge.
- [x] Pass no badge from the real webview setup so the old header `15` count cannot render.
- [x] Preserve bottom changed-files strip behavior and per-session isolation.

### Task 3: Keyboard Shortcuts

**Files:**
- Modify: `package.json`
- Modify: `src/chat/webview/main.ts`
- Modify: `src/chat/webview/inputHandlers.ts`
- Modify: `src/chat/ChatProvider.ts`
- Modify: `src/commands/session.ts`
- Test: `src/chat/webview/main.test.ts`
- Test: `tests/integration/modes.test.mjs` if needed

- [x] Fix contributed keybindings that reference `opencode-harness.chatView`; the view id is `opencode-harness.chat`.
- [x] Add document-level webview handling for tab navigation/session creation where VS Code does not deliver prompt-scoped shortcuts.
- [x] Make host `opencode-harness.newSession` create/open a webview session through `ChatProvider` when the chat provider is available.

### Task 4: Voice/STT Setup

**Files:**
- Modify: `src/chat/ChatProvider.ts`
- Modify: `src/commands/session.ts` only if command wiring needs a shared interface
- Test: `src/chat/voiceSetup.test.ts` or a focused structural host test

- [x] Reconnect `opencode-harness.setupVoiceInput` to `voiceSetup.ts`.
- [x] Probe recorder and STT availability using the existing voice capture selectors.
- [x] If setup is needed, show install/manual steps and run available commands in a user-visible terminal only after user confirmation.
- [x] Refresh voice settings after setup is launched.

### Task 5: Session Identity Audit

**Files:**
- Review: `src/session/sessionMigration.ts`
- Review: `src/session/SessionStore.ts`
- Review: `src/chat/TabManager.ts`
- Review: `docs/session-identity.md`
- Test: `src/session/sessionMigration.test.ts`
- Test: `src/session/sessionUtils.test.ts`

- [x] Confirm local session keys remain immutable and server ids stay in `cliSessionId`.
- [x] Fix only if a regression is present.
- [x] Run targeted session identity tests.

### Task 6: Verification And Preservation

**Files:**
- Modify: `package.json` / `package-lock.json` via `npm run reinstall`

- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Run targeted tests for changed files, token/context display, voice setup, shortcuts, and session identity.
- [x] Run `npm run test:unit`.
- [x] Run `npm run reinstall`.
- [x] Commit the exact changed files.
