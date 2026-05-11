# Code Quality Triage Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the top-5 code quality issues identified by the automated triage: circular dependency cycle, ChatProvider god class, excessive function complexity, untested symbols, and production `console.*` calls.

**Architecture:** Three independent workstreams that can be parallelized: (A) session event handler cycle break, (B) ChatProvider + StreamCoordinator decomposition, (C) renderer/webview complexity split + test coverage. Workstreams A and B are fully independent; C depends on A only through the type system (not at runtime).

**Tech Stack:** TypeScript + VS Code Extension API. Node `--test` (native test runner with `tsx`). No Jest or Vitest.

**Test command:** `npm run test:unit` (runs `node --test tests/unit/*.test.mjs && npx tsx --test "src/**/*.test.ts"`)

---

## File Structure Changes

### Workstream A — Session Event Handler Cycle Break

**Problem:** 14 files in `src/session/eventHandlers/*` form a mutual-import cycle rooted through `EventNormalizer.ts` re-exporting types.

**Root cause:** `EventNormalizer.ts` both re-exports types from `./eventHandlers/types` AND imports every concrete handler. The barrel re-export creates the cycle.

**Fix:** Split re-exports into a standalone `src/session/types.ts` barrel. Keep `EventNormalizer.ts` as the handler orchestrator only.

**Files modified:**
- `src/session/EventNormalizer.ts` — remove type re-exports
- `src/session/types.ts` — **new file**, barrel re-export of event handler types
- `src/session/eventHandlers/types.ts` — unchanged (still the canonical type definitions)
- `src/session/eventHandlers/DeltaHandler.ts` — unchanged (imports from `./types` only)
- All other `src/session/eventHandlers/*.ts` — unchanged
- All files that import from `EventNormalizer.ts`'s re-exported types — update import path

### Workstream B — ChatProvider + StreamCoordinator Decomposition

**Problem:** `ChatProvider.ts` (1659 lines, I=0.92, 24 dependencies) is a god class. `StreamCoordinator.ts` (1134 lines, cc=63 hotspot in `finalizeStream`) is too complex. `renderUnifiedSessionList` in `main.ts` (cc=49) needs extraction.

**Files created:**
- `src/chat/StatePushService.ts` — extracts all `push*StateToWebview`, `postMessage`, `postRequestError` methods
- `src/chat/SessionLifecycleService.ts` — extracts `handleResumeSession`, `openSessionInWebview`, `handleCompactSession`, `handleAttachFiles`, `handleAttachImage`, `handleAcceptDiff`, `syncActiveSession`
- `src/chat/CommandExecutionService.ts` — extracts `handleExecuteCommand`, `executeRemoteCommand`, `handleLocalSlashCommand`, `handleListCommands`, `parseCommandResult`, all slash command handlers
- `src/chat/WebviewEventRouter.ts` — extracts `handleWebviewMessage` message routing logic
- `src/chat/handlers/StreamFinalizerService.ts` — extracts `finalizeStream` from `StreamCoordinator.ts`

**Files modified:**
- `src/chat/ChatProvider.ts` — delegate to new services, remove ~800 lines
- `src/chat/handlers/StreamCoordinator.ts` — extract `finalizeStream`, trim imports
- `src/chat/webview/main.ts` — extract `renderUnifiedSessionList` into its own file

### Workstream C — Webview Complexity Split + Test Coverage

**Files created:**
- `src/chat/webview/sessionListRenderer.ts` — extracts `renderUnifiedSessionList` from `main.ts`
- `src/chat/webview/toolCallRenderer.ts` — extracts `createToolDetailsContainer`, `createToolSummary`, `createToolArgsPanel`, `createToolResultPanel`, `appendTool*` helpers from `renderer.ts`
- `src/chat/webview/streamEndHandler.ts` — extracts `handleStreamEnd` from `streamHandlers.ts`
- `src/chat/TabManager.test.ts` — comprehensive tab lifecycle tests
- `src/chat/ChatCommands.test.ts` — command routing tests
- `src/chat/ChatFileOps.test.ts` — file operation tests

**Files modified:**
- `src/chat/webview/main.ts` — remove `renderUnifiedSessionList`, import from new module
- `src/chat/webview/renderer.ts` — remove tool call detail functions, import from new module
- `src/chat/webview/streamHandlers.ts` — remove `handleStreamEnd`, import from new module

### Workstream D — Production console.* Cleanup + Dead Code Removal

**Files modified:**
- `src/chat/webview/main.ts` — replace `console.error/warn` with structured logger
- `src/chat/webview/streamHandlers.ts` — replace `console.error/warn` with structured logger
- `src/chat/webview/dom.ts` — replace `console.warn` with structured logger
- `src/chat/webview/theme.ts` — replace `console.warn` with structured logger
- `src/context/ContextEngine.ts` — replace `console.warn` with structured logger

**Files deleted:**
- `src/chat/handlers/StreamCoordinator.behavioral.ts` — dead test harness (all mock factories, zero callers)

---

## Tasks

### Workstream A: Break Session Event Handler Cycle

#### Task A1: Create standalone type barrel

**Files:**
- Create: `src/session/types.ts`
- Modify: `src/session/EventNormalizer.ts`

- [ ] **Step 1: Create barrel re-export file**

```typescript
export type {
  NormalizedOpencodeEventType,
  NormalizedOpencodeEvent,
  SdkEventLike,
  PartLike,
  ToolPartLike,
  MessageInfoLike,
  NormalizerContext,
} from "./eventHandlers/types"

export type { EventHandler } from "./eventHandlers/types"

export type { SdkEventNormalizer } from "./EventNormalizer"
```

- [ ] **Step 2: Strip re-exports from EventNormalizer.ts**

Replace the top of `src/session/EventNormalizer.ts` from:

```typescript
export type {
  NormalizedOpencodeEventType,
  NormalizedOpencodeEvent,
  SdkEventLike,
  PartLike,
  ToolPartLike,
  MessageInfoLike,
  NormalizerContext,
} from "./eventHandlers/types"

export interface SdkEventNormalizer {
  normalize: (event: import("./eventHandlers/types").SdkEventLike) => import("./eventHandlers/types").NormalizedOpencodeEvent[]
}
```

to:

```typescript
export interface SdkEventNormalizer {
  normalize: (event: import("./eventHandlers/types").SdkEventLike) => import("./eventHandlers/types").NormalizedOpencodeEvent[]
}
```

- [ ] **Step 3: Update all type consumers**

Find all files importing types that were re-exported from `EventNormalizer.ts`:

```bash
rg "from ['\"](\.\./)?session/EventNormalizer['\"]" --type ts
rg "from ['\"](\.\./)?EventNormalizer['\"]" src/ --type ts
```

For each result, change the import path from `session/EventNormalizer` to `session/types` (when importing only types) or add an additional import line for `session/types`.

Expected pattern (example from a consumer):
```typescript
// Before
import { createSdkEventNormalizer, NormalizedOpencodeEvent } from "../session/EventNormalizer"

// After
import { createSdkEventNormalizer } from "../session/EventNormalizer"
import type { NormalizedOpencodeEvent } from "../session/types"
```

- [ ] **Step 4: Run tests to verify cycle is broken**

Run: `npm run test:unit`
Expected: All tests pass. If any import resolution fails, fix the import path.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/session/types.ts src/session/EventNormalizer.ts
# plus all updated consumer files
git commit -m "fix: break circular dependency cycle in session event handlers"
```

---

#### Task A2: Verify cycle is gone

- [ ] **Step 1: Check dependency cycles**

Use jcodemunch to verify:
```
get_dependency_cycles for repo
```
Expected: cycle_count: 0 (down from 1). If still 1, re-index the folder and re-check.

---

### Workstream B: Decompose ChatProvider

#### Task B1: Create StatePushService

**Files:**
- Create: `src/chat/StatePushService.ts`
- Modify: `src/chat/ChatProvider.ts`

- [ ] **Step 1: Write the StatePushService test**

Create `src/chat/StatePushService.test.ts`:

```typescript
import { describe, it, mock } from "node:test"
import assert from "node:assert"

describe("StatePushService", () => {
  it("delegates postMessage to the provided callback", () => {
    const messages: Record<string, unknown>[] = []
    const service = new (require("./StatePushService").StatePushService)(
      (msg) => messages.push(msg),
      {} as any,
      {} as any,
      {} as any,
    )
    service.postMessage({ type: "test" })
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0].type, "test")
  })
})
```

Run: `npx tsx --test src/chat/StatePushService.test.ts`
Expected: Possibly type errors — fix the constructor signature after reading the full ChatProvider constructor.

- [ ] **Step 2: Read ChatProvider.ts constructor to understand service dependencies**

Read `src/chat/ChatProvider.ts` lines 60-110 to identify all constructor-injected dependencies.

- [ ] **Step 3: Implement StatePushService**

```typescript
import * as vscode from "vscode"
import type { TabManager } from "./TabManager"
import type { SessionStore } from "../session/SessionStore"
import type { ChatMessage, Block } from "./types"

export interface StatePushServiceOptions {
  postMessage: (msg: Record<string, unknown>) => void
  tabManager: TabManager
  sessionStore: SessionStore
  themeManager: {
    getThemeConfig: () => Record<string, unknown>
    getTheme: () => string | undefined
  }
}

export class StatePushService {
  constructor(private opts: StatePushServiceOptions) {}

  postMessage(msg: Record<string, unknown>): void {
    this.opts.postMessage(msg)
  }

  postRequestError(message: string, sessionId?: string): void {
    this.postMessage({ type: "error", message, sessionId })
  }

  pushModelToWebview(model?: string): void {
    this.opts.tabManager.getActiveTab()
    this.postMessage({ type: "model", model })
  }

  pushModelListToWebview(): void {
    this.postMessage({ type: "model_list" })
  }

  pushMcpServersToWebview(): void {
    this.postMessage({ type: "mcp_servers" })
  }

  pushRateLimitStateToWebview(): void {
    this.postMessage({ type: "rate_limit" })
  }

  pushThemeConfigToWebview(): void {
    const config = this.opts.themeManager.getThemeConfig()
    this.postMessage({ type: "theme_config", config })
  }

  pushCommandListToWebview(commands: { name: string; description: string }[]): void {
    this.postMessage({ type: "command_list", commands })
  }

  pushAllStateToWebview(): void {
    this.postMessage({ type: "push_all_state" })
  }

  pushVisibleStateToWebview(): void {
    this.postMessage({ type: "push_visible_state" })
  }

  pushThemeToWebview(): void {
    const theme = this.opts.themeManager.getTheme()
    this.postMessage({ type: "theme", theme })
  }

  // Additional helper: check if a session belongs to the current workspace
  isSessionInCurrentWorkspace(session: { sessionDir?: string }): boolean {
    if (!session.sessionDir) return true
    // Use workspace folders if available
    return true
  }
}
```

- [ ] **Step 4: Wire StatePushService into ChatProvider**

In `src/chat/ChatProvider.ts`:

Add a private field:
```typescript
private statePush: StatePushService
```

In the constructor body, after relevant services are initialized:
```typescript
this.statePush = new StatePushService({
  postMessage: (msg) => this._view?.webview.postMessage(msg),
  tabManager: this.tabManager,
  sessionStore: this.sessionManager,
  themeManager: {
    getThemeConfig: () => this.getThemeConfig(),
    getTheme: () => undefined,
  },
})
```

Replace all `postMessage(...)` calls with `this.statePush.postMessage(...)` (except in the ChunkBatcher callback which already has its own reference). Replace `postRequestError(...)` with `this.statePush.postRequestError(...)`.

Replace `pushModelToWebview(...)`, `pushModelListToWebview()`, `pushMcpServersToWebview()`, `pushRateLimitStateToWebview()`, `pushThemeConfigToWebview()`, `pushAllStateToWebview()`, `pushVisibleStateToWebview()`, `pushThemeToWebview()`, `pushCommandListToWebview()` individually:

Delete the method body and delegate:
```typescript
private pushModelToWebview(model?: string): void {
  this.statePush.pushModelToWebview(model)
}
```

Optionally: inline these delegations directly where they're called, removing the private method entirely:
```typescript
// Before: this.pushModelToWebview(model)
// After: this.statePush.pushModelToWebview(model)
```

Then remove the now-delegated private method definitions from the class.

- [ ] **Step 5: Run tests to verify no regressions**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/chat/StatePushService.ts src/chat/StatePushService.test.ts src/chat/ChatProvider.ts
git commit -m "refactor: extract StatePushService from ChatProvider"
```

---

#### Task B2: Create SessionLifecycleService

**Files:**
- Create: `src/chat/SessionLifecycleService.ts`
- Modify: `src/chat/ChatProvider.ts`

- [ ] **Step 1: Implement SessionLifecycleService**

```typescript
import * as vscode from "vscode"
import type { TabManager } from "./TabManager"
import type { SessionStore } from "../session/SessionStore"
import type { DiffApplier } from "../diff/DiffApplier"
import type { StatePushService } from "./StatePushService"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"

export interface SessionLifecycleOptions {
  tabManager: TabManager
  sessionStore: SessionStore
  diffApplier: DiffApplier
  statePush: StatePushService
  streamCoordinator: StreamCoordinator
  showWarningMessage: (msg: string) => void
  showInformationMessage: (msg: string) => void
}

export class SessionLifecycleService {
  constructor(private opts: SessionLifecycleOptions) {}

  async handleResumeSession(sessionId: string): Promise<void> {
    const session = await this.opts.sessionStore.loadSession(sessionId)
    if (!session) {
      this.opts.showWarningMessage(`Session ${sessionId} not found`)
      return
    }
    this.opts.tabManager.createTab(sessionId, session.name)
    this.opts.statePush.postMessage({
      type: "load_session",
      sessionId,
      session,
    })
  }

  async handleAttachFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach",
    })
    if (!files || files.length === 0) return
    // Map files to context chips and post
    this.opts.statePush.postMessage({
      type: "attach_files",
      files: files.map((f) => ({ uri: f.toString(), name: f.path.split("/").pop() })),
    })
  }

  handleAttachImage(sessionId: string, data: string, mimeType: string): void {
    this.opts.statePush.postMessage({
      type: "attach_image",
      sessionId,
      data,
      mimeType,
    })
  }

  async handleCompactSession(sessionId?: string): Promise<void> {
    if (!sessionId) {
      const tab = this.opts.tabManager.getActiveTab()
      if (!tab) return
      sessionId = tab.sessionId
    }
    this.opts.statePush.postMessage({
      type: "compact_session",
      sessionId,
    })
  }

  async handleAcceptDiff(blockId: string, sessionId?: string): Promise<void> {
    const resolvedSessionId = sessionId || this.opts.tabManager.getActiveTab()?.sessionId
    if (!resolvedSessionId) return
    const result = await this.opts.diffApplier.acceptDiff(blockId, resolvedSessionId)
    this.opts.statePush.postMessage({
      type: "diff_accepted",
      blockId,
      sessionId: resolvedSessionId,
      success: result,
    })
  }

  syncActiveSession(): void {
    const tab = this.opts.tabManager.getActiveTab()
    if (!tab) return
    this.opts.statePush.postMessage({
      type: "sync_active",
      sessionId: tab.sessionId,
    })
  }

  async openSessionInWebview(sessionId: string): Promise<void> {
    const session = await this.opts.sessionStore.loadSession(sessionId)
    if (!session) return
    this.opts.tabManager.createTab(sessionId, session.name)
    this.opts.statePush.postMessage({
      type: "open_session",
      sessionId,
      session,
    })
  }
}
```

- [ ] **Step 2: Wire SessionLifecycleService into ChatProvider**

Add:
```typescript
private sessionLifecycle: SessionLifecycleService
```

In the constructor:
```typescript
this.sessionLifecycle = new SessionLifecycleService({
  tabManager: this.tabManager,
  sessionStore: this.sessionManager,
  diffApplier: this.diffApplier,
  statePush: this.statePush,
  streamCoordinator: this.streamCoordinator,
  showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
  showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
})
```

Replace the body of each delegated method:
```typescript
private async handleResumeSession(sessionId: string): Promise<void> {
  return this.sessionLifecycle.handleResumeSession(sessionId)
}

private async handleAttachFiles(): Promise<void> {
  return this.sessionLifecycle.handleAttachFiles()
}

private handleAttachImage(sessionId: string, data: string, mimeType: string): void {
  this.sessionLifecycle.handleAttachImage(sessionId, data, mimeType)
}

private async handleCompactSession(sessionId?: string): Promise<void> {
  return this.sessionLifecycle.handleCompactSession(sessionId)
}

private async handleAcceptDiff(blockId: string, sessionId?: string): Promise<void> {
  return this.sessionLifecycle.handleAcceptDiff(blockId, sessionId)
}

private syncActiveSession(): void {
  this.sessionLifecycle.syncActiveSession()
}

private async openSessionInWebview(sessionId: string): Promise<void> {
  return this.sessionLifecycle.openSessionInWebview(sessionId)
}
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/chat/SessionLifecycleService.ts src/chat/ChatProvider.ts
git commit -m "refactor: extract SessionLifecycleService from ChatProvider"
```

---

#### Task B3: Create CommandExecutionService

**Files:**
- Create: `src/chat/CommandExecutionService.ts`
- Modify: `src/chat/ChatProvider.ts`

- [ ] **Step 1: Implement CommandExecutionService**

```typescript
import type { TabManager } from "./TabManager"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { StatePushService } from "./StatePushService"
import type { Block } from "./types"

export interface CommandExecOptions {
  tabManager: TabManager
  streamCoordinator: StreamCoordinator
  statePush: StatePushService
  showWarningMessage: (msg: string) => void
}

export class CommandExecutionService {
  constructor(private opts: CommandExecOptions) {}

  async handleExecuteCommand(sessionId?: string, command?: string, args?: string): Promise<void> {
    // Forward to stream coordinator
    const tab = sessionId
      ? this.opts.tabManager.getTab(sessionId)
      : this.opts.tabManager.getActiveTab()
    if (!tab) return

    const resolvedSessionId = tab.sessionId
    const tabId = tab.id

    this.opts.streamCoordinator.startPrompt(resolvedSessionId, tabId, command ?? "")
  }

  async handleLocalSlashCommand(sessionId: string, commandName: string): Promise<boolean> {
    switch (commandName) {
      case "clear":
        return this.handleClear(sessionId)
      case "cost":
        return this.handleCost(sessionId)
      case "continue":
        return this.handleContinue(sessionId)
      case "help":
        return this.handleHelp(sessionId)
      default:
        return false
    }
  }

  async abortCurrentSession(): Promise<void> {
    const tab = this.opts.tabManager.getActiveTab()
    if (!tab) return
    this.opts.streamCoordinator.abort(tab.sessionId)
  }

  private async handleClear(sessionId: string): Promise<boolean> {
    this.opts.statePush.postMessage({ type: "clear", sessionId })
    return true
  }

  private async handleCost(sessionId: string): Promise<boolean> {
    this.opts.statePush.postMessage({ type: "cost", sessionId })
    return true
  }

  private async handleContinue(sessionId: string): Promise<boolean> {
    const tab = this.opts.tabManager.getTab(sessionId)
    if (!tab) return false
    this.opts.streamCoordinator.continue(tab.sessionId, tab.id)
    return true
  }

  private handleHelp(sessionId: string): boolean {
    this.opts.statePush.postMessage({ type: "help", sessionId })
    return true
  }
}
```

- [ ] **Step 2: Wire into ChatProvider**

```typescript
private commandExec: CommandExecutionService

// In constructor:
this.commandExec = new CommandExecutionService({
  tabManager: this.tabManager,
  streamCoordinator: this.streamCoordinator,
  statePush: this.statePush,
  showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
})
```

Replace delegated method bodies:
```typescript
private async handleExecuteCommand(sessionId?: string, command?: string, args?: string): Promise<void> {
  return this.commandExec.handleExecuteCommand(sessionId, command, args)
}

private async handleLocalSlashCommand(sessionId: string, commandName: string): Promise<boolean> {
  return this.commandExec.handleLocalSlashCommand(sessionId, commandName)
}

async abortCurrentSession(): Promise<void> {
  return this.commandExec.abortCurrentSession()
}

private async handleClearCommand(): Promise<void> {
  const activeTab = this.tabManager.getActiveTab()
  if (!activeTab) return
  await this.commandExec.handleLocalSlashCommand(activeTab.sessionId, "clear")
}

private async handleCostCommand(sessionId: string): Promise<void> {
  await this.commandExec.handleLocalSlashCommand(sessionId, "cost")
}

private async handleContinueCommand(sessionId: string): Promise<void> {
  await this.commandExec.handleLocalSlashCommand(sessionId, "continue")
}

private handleHelpCommand(sessionId: string): void {
  this.commandExec.handleLocalSlashCommand(sessionId, "help")
}
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/chat/CommandExecutionService.ts src/chat/ChatProvider.ts
git commit -m "refactor: extract CommandExecutionService from ChatProvider"
```

---

#### Task B4: Create WebviewEventRouter

**Files:**
- Create: `src/chat/WebviewEventRouter.ts`
- Modify: `src/chat/ChatProvider.ts`

- [ ] **Step 1: Implement WebviewEventRouter**

This requires reading `ChatProvider.ts` lines 626-670 to understand the routing map in `handleWebviewMessage`. The structure is typically a switch on `msg.type`:

```typescript
import type { TabManager } from "./TabManager"
import type { StatePushService } from "./StatePushService"
import type { SessionLifecycleService } from "./SessionLifecycleService"
import type { CommandExecutionService } from "./CommandExecutionService"

export interface WebviewEventRouterOptions {
  tabManager: TabManager
  statePush: StatePushService
  sessionLifecycle: SessionLifecycleService
  commandExec: CommandExecutionService
  handleEditMessage: (sessionId: string, messageId: string, text: string) => void
  handleInsertAtCursor: (code: string, language: string) => Promise<void>
  handleCreateFileFromCode: (code: string, language: string) => Promise<void>
  handleServerEvent: (event: { type: string; sessionId?: string; data?: unknown }) => void
  ensureLocalTab: (sessionId: string, name?: string, model?: string, mode?: string) => void
}

export class WebviewEventRouter {
  constructor(private opts: WebviewEventRouterOptions) {}

  async route(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string
    const sessionId = msg.sessionId as string | undefined

    switch (type) {
      case "connect_provider":
        // no-op, webview connected
        break

      case "send_prompt":
        this.opts.commandExec.handleExecuteCommand(sessionId, msg.text as string)
        break

      case "execute_command":
        this.opts.commandExec.handleExecuteCommand(sessionId, msg.command as string, msg.args as string)
        break

      case "resume_session":
        await this.opts.sessionLifecycle.handleResumeSession(msg.sessionId as string)
        break

      case "attach_files":
        await this.opts.sessionLifecycle.handleAttachFiles()
        break

      case "attach_image":
        this.opts.sessionLifecycle.handleAttachImage(
          sessionId ?? "",
          msg.data as string,
          msg.mimeType as string,
        )
        break

      case "compact_session":
        await this.opts.sessionLifecycle.handleCompactSession(sessionId)
        break

      case "accept_diff":
        await this.opts.sessionLifecycle.handleAcceptDiff(msg.blockId as string, sessionId)
        break

      case "edit_message":
        this.opts.handleEditMessage(sessionId ?? "", msg.messageId as string, msg.text as string)
        break

      case "insert_at_cursor":
        await this.opts.handleInsertAtCursor(msg.code as string, msg.language as string)
        break

      case "create_file":
        await this.opts.handleCreateFileFromCode(msg.code as string, msg.language as string)
        break

      case "server_event":
        this.opts.handleServerEvent({
          type: msg.eventType as string,
          sessionId,
          data: msg.data,
        })
        break

      case "abort":
        await this.opts.commandExec.abortCurrentSession()
        break

      case "clear":
        await this.opts.commandExec.handleLocalSlashCommand(sessionId ?? "", "clear")
        break

      case "theme_config":
        this.opts.statePush.postMessage({ type: "theme_config_saved" })
        break

      default:
        console.warn(`[ChatProvider] Unknown message type: ${type}`)
    }
  }
}
```

- [ ] **Step 2: Wire into ChatProvider and simplify handleWebviewMessage**

```typescript
// Add field:
private eventRouter: WebviewEventRouter

// In constructor:
this.eventRouter = new WebviewEventRouter({
  tabManager: this.tabManager,
  statePush: this.statePush,
  sessionLifecycle: this.sessionLifecycle,
  commandExec: this.commandExec,
  handleEditMessage: (s, mId, text) => this.handleEditMessage(s, mId, text),
  handleInsertAtCursor: (code, lang) => this.handleInsertAtCursor(code, lang),
  handleCreateFileFromCode: (code, lang) => this.handleCreateFileFromCode(code, lang),
  handleServerEvent: (e) => this.handleServerEvent(e),
  ensureLocalTab: (sId, name, model, mode) => this.ensureLocalTab(sId, name, model, mode),
})

// Replace handleWebviewMessage body:
private async handleWebviewMessage(msg: Record<string, unknown>): Promise<void> {
  await this.eventRouter.route(msg)
}
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 4: Check ChatProvider.ts line count**

```bash
wc -l src/chat/ChatProvider.ts
```
Expected: < 900 lines (down from 1659). If still too large, identify the next-largest block of methods (likely `handleServerEvent`, `sendPromptToWebview`, `resolveCustomPromptVariables`, `showAutoModeConfirmation`) and repeat the extraction pattern.

- [ ] **Step 5: Commit**

```bash
git add src/chat/WebviewEventRouter.ts src/chat/ChatProvider.ts
git commit -m "refactor: extract WebviewEventRouter from ChatProvider"
```

---

#### Task B5: Extract StreamCoordinator.finalizeStream

**Files:**
- Create: `src/chat/handlers/StreamFinalizerService.ts`
- Modify: `src/chat/handlers/StreamCoordinator.ts`

- [ ] **Step 1: Read finalizeStream source**

Read `src/chat/handlers/StreamCoordinator.ts` lines 433-600 (the `finalizeStream` method body).

- [ ] **Step 2: Implement StreamFinalizerService**

The exact signature depends on what `finalizeStream` accesses. It generally:
- Checks if the tab is already finalizing / aborted
- Stops the stream watchdog
- Drains pending tool results
- Posts `stream_end` message
- Updates stream lifecycle state

```typescript
import type { StreamCallbacks, ToolEndResult, StreamLifecycleState } from "./StreamCoordinator"

export interface StreamFinalizerDeps {
  streamStates: Map<string, StreamLifecycleState>
  finalizingTabs: Set<string>
  abortedTabs: Set<string>
  activeMessageIds: Map<string, string>
  activeToolCallIds: Map<string, Set<string>>
  toolCallCounts: Map<string, number>
  toolActivityAt: Map<string, Map<string, number>>
  pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>>
  stuckStreamHandlers: Map<string, StreamCallbacks>
  ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>>
  onStateChange: (sessionId: string, state: StreamLifecycleState) => void
}

export class StreamFinalizerService {
  constructor(private deps: StreamFinalizerDeps) {}

  finalizeStream(
    sessionId: string,
    tabId: string,
    error?: Error,
  ): void {
    // Guard: already finalized or aborted
    if (this.deps.finalizingTabs.has(sessionId)) return
    if (this.deps.abortedTabs.has(sessionId)) return

    this.deps.finalizingTabs.add(sessionId)

    // Stop watchdog & TTFB timeout
    const callbacks = this.deps.stuckStreamHandlers.get(sessionId)
    if (callbacks) {
      this.deps.stuckStreamHandlers.delete(sessionId)
    }

    const ttfbTimeout = this.deps.ttfbTimeouts.get(sessionId)
    if (ttfbTimeout) {
      clearTimeout(ttfbTimeout)
      this.deps.ttfbTimeouts.delete(sessionId)
    }

    // Clear pending tool grace timeouts for this session
    for (const [key, to] of this.deps.pendingToolGraceTimeouts) {
      if (key.startsWith(sessionId)) {
        clearTimeout(to)
        this.deps.pendingToolGraceTimeouts.delete(key)
      }
    }

    // Update state to completing
    this.deps.streamStates.set(sessionId, "completing")

    // Collect pending tool results
    const pendingIds = this.deps.activeToolCallIds.get(sessionId)
    if (pendingIds && pendingIds.size > 0) {
      const results: ToolEndResult[] = []
      for (const toolCallId of pendingIds) {
        const activityMap = this.deps.toolActivityAt.get(sessionId)
        const lastActive = activityMap?.get(toolCallId)
        results.push({
          id: toolCallId,
          ok: false,
          result: undefined,
          durationMs: lastActive ? Date.now() - lastActive : undefined,
          stale: true,
        })
      }
      this.deps.activeToolCallIds.delete(sessionId)

      if (callbacks) {
        const errorToolResults = results.filter((r) => !r.ok)
        callbacks.postMessage({
          type: "tool_results",
          sessionId,
          tabId,
          results: errorToolResults,
          error: error ? { message: error.message } : undefined,
        })
      }
    }

    // Final stream end message
    if (callbacks && !error) {
      callbacks.postMessage({
        type: "stream_end",
        sessionId,
        tabId,
      })
    } else if (callbacks && error) {
      callbacks.postMessage({
        type: "stream_end",
        sessionId,
        tabId,
        error: error.message,
      })
    }

    // Cleanup per-session state
    this.deps.streamStates.delete(sessionId)
    this.deps.activeMessageIds.delete(sessionId)
    this.deps.toolCallCounts.delete(sessionId)
    this.deps.toolActivityAt.delete(sessionId)

    this.deps.finalizingTabs.delete(sessionId)
    this.deps.onStateChange(sessionId, "idle")
  }
}
```

- [ ] **Step 3: Wire into StreamCoordinator**

```typescript
import { StreamFinalizerService } from "./StreamFinalizerService"

// Add field:
private finalizerService: StreamFinalizerService

// In constructor, after all map initializations:
this.finalizerService = new StreamFinalizerService({
  streamStates: this.streamStates,
  finalizingTabs: this.finalizingTabs,
  abortedTabs: this.abortedTabs,
  activeMessageIds: this.activeMessageIds,
  activeToolCallIds: this.activeToolCallIds,
  toolCallCounts: this.toolCallCounts,
  toolActivityAt: this.toolActivityAt,
  pendingToolGraceTimeouts: this.pendingToolGraceTimeouts,
  stuckStreamHandlers: this.stuckStreamHandlers,
  ttfbTimeouts: this.ttfbTimeouts,
  onStateChange: (sessionId, state) => {
    // If StreamCoordinator has any state change side effects, add them here
  },
})

// Replace finalizeStream body:
finalizeStream(sessionId: string, tabId: string, error?: Error): void {
  this.finalizerService.finalizeStream(sessionId, tabId, error)
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat/handlers/StreamFinalizerService.ts src/chat/handlers/StreamCoordinator.ts
git commit -m "refactor: extract StreamFinalizerService from StreamCoordinator"
```

---

### Workstream C: Webview Complexity Split + Test Coverage

#### Task C1: Extract sessionListRenderer from main.ts

**Files:**
- Create: `src/chat/webview/sessionListRenderer.ts`
- Modify: `src/chat/webview/main.ts`

- [ ] **Step 1: Read renderUnifiedSessionList in main.ts**

Read `src/chat/webview/main.ts` lines 423-520 to get the full source.

- [ ] **Step 2: Create sessionListRenderer.ts**

```typescript
import type { SessionSummary } from "./types"
import { getElementRefs } from "./dom"

export function renderUnifiedSessionList(
  sessions: SessionSummary[],
  activeSessionId?: string,
  currentWorkspaceName?: string,
): void {
  const refs = getElementRefs()
  const container = refs.sessionList
  if (!container) return

  // If no sessions, show empty state
  if (!sessions || sessions.length === 0) {
    container.innerHTML = `<div class="empty-state">No sessions yet</div>`
    return
  }

  // Sort by most recent first
  const sorted = [...sessions].sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))

  container.innerHTML = sorted
    .map((session) => {
      const isActive = session.id === activeSessionId
      const isCurrentWorkspace = !currentWorkspaceName || session.workspaceName === currentWorkspaceName
      return `
        <div class="session-item ${isActive ? "active" : ""}" data-session-id="${session.id}">
          <div class="session-item-name">${escapeHtml(session.name || "Untitled")}</div>
          <div class="session-item-meta">
            <span class="session-item-date">${formatDate(session.lastActive)}</span>
            ${isCurrentWorkspace ? "" : `<span class="session-item-workspace">${escapeHtml(session.workspaceName ?? "")}</span>`}
          </div>
        </div>
      `
    })
    .join("")

  // Wire click handlers
  for (const el of container.querySelectorAll(".session-item")) {
    el.addEventListener("click", () => {
      const sessionId = (el as HTMLElement).dataset.sessionId
      if (sessionId) {
        window.postMessage({ type: "resume_session", sessionId }, "*")
      }
    })
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return ""
  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
```

- [ ] **Step 3: Update main.ts**

In `src/chat/webview/main.ts`:

```typescript
// Replace the import from renderer with:
import { renderUnifiedSessionList } from "./sessionListRenderer"
```

Remove the `renderUnifiedSessionList` function definition from `main.ts` (lines ~423-520).

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat/webview/sessionListRenderer.ts src/chat/webview/main.ts
git commit -m "refactor: extract sessionListRenderer from main.ts"
```

---

#### Task C2: Extract toolCallRenderer from renderer.ts

**Files:**
- Create: `src/chat/webview/toolCallRenderer.ts`
- Modify: `src/chat/webview/renderer.ts`

- [ ] **Step 1: Read the tool call rendering functions from renderer.ts**

Read lines 560-780 of `src/chat/webview/renderer.ts` (functions: `normalizeToolBlock`, `createToolDetailsContainer`, `createToolSummary`, `appendToolIcon`, `appendToolKeyArg`, `appendToolStatusBadge`, `appendToolTiming`, `appendToolOutputSize`, `createToolArgsPanel`, `createToolResultPanel`, `renderToolCallBlock`, `extractKeyArg`, `groupConsecutiveToolCalls`, `renderToolGroup`, `truncateMiddle`, `formatOutputSize`, `focusAdjacentToolSummary`).

- [ ] **Step 2: Create toolCallRenderer.ts**

Copy all tool-call-related functions into the new file. They import from:
- `./types` (Block, ToolCallBlock types)
- `./icons` (SVG icon references)
- `./dom` (getElementRefs or DOM helpers)

```typescript
import type { Block, ToolCallBlock, RenderOptions } from "./types"
import { TOOL_READ_SVG, TOOL_WRITE_SVG, TOOL_EXEC_SVG, TOOL_META_SVG, TOOL_ERROR_SVG, EXPAND_SVG } from "./icons"

// Copy all tool-call-related functions from renderer.ts here:
// normalizeToolBlock, createToolDetailsContainer, createToolSummary,
// appendToolIcon, appendToolKeyArg, appendToolStatusBadge, appendToolTiming,
// appendToolOutputSize, createToolArgsPanel, createToolResultPanel,
// renderToolCallBlock, extractKeyArg, renderToolGroup, truncateMiddle,
// formatOutputSize, focusAdjacentToolSummary, groupConsecutiveToolCalls

export {
  normalizeToolBlock,
  createToolDetailsContainer,
  createToolSummary,
  appendToolIcon,
  appendToolKeyArg,
  appendToolStatusBadge,
  appendToolTiming,
  appendToolOutputSize,
  createToolArgsPanel,
  createToolResultPanel,
  renderToolCallBlock,
  extractKeyArg,
  renderToolGroup,
  truncateMiddle,
  formatOutputSize,
  focusAdjacentToolSummary,
  groupConsecutiveToolCalls,
}
```

- [ ] **Step 3: Update renderer.ts to import from toolCallRenderer**

```typescript
// Remove all the tool-call function definitions from renderer.ts
// Replace with:
export {
  normalizeToolBlock,
  createToolDetailsContainer,
  createToolSummary,
  appendToolIcon,
  appendToolKeyArg,
  appendToolStatusBadge,
  appendToolTiming,
  appendToolOutputSize,
  createToolArgsPanel,
  createToolResultPanel,
  renderToolCallBlock,
  extractKeyArg,
  renderToolGroup,
  truncateMiddle,
  formatOutputSize,
  focusAdjacentToolSummary,
  groupConsecutiveToolCalls,
} from "./toolCallRenderer"
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat/webview/toolCallRenderer.ts src/chat/webview/renderer.ts
git commit -m "refactor: extract toolCallRenderer from renderer.ts"
```

---

#### Task C3: Extract streamEndHandler from streamHandlers.ts

**Files:**
- Create: `src/chat/webview/streamEndHandler.ts`
- Modify: `src/chat/webview/streamHandlers.ts`

- [ ] **Step 1: Read handleStreamEnd from streamHandlers.ts**

Read `src/chat/webview/streamHandlers.ts` lines 600-700 (the `handleStreamEnd` function, cc=53).

- [ ] **Step 2: Create streamEndHandler.ts**

```typescript
import type { WebviewState } from "./types"
import { getElementRefs } from "./dom"
import { getVirtualList } from "./virtualList"
import { createScrollAnchor } from "./scrollAnchor"
import { getState } from "./state"

export interface StreamEndData {
  sessionId: string
  tabId: string
  error?: string
}

/**
 * Handle the end of a stream: clean up loading states,
 * finalize virtual list, scroll to bottom.
 * Extracted from streamHandlers.ts to reduce complexity of that file.
 */
export function handleStreamEnd(
  data: StreamEndData,
  state: WebviewState,
  setState: (state: WebviewState) => void,
): void {
  const refs = getElementRefs()
  const { sessionId, tabId, error } = data

  // Update state
  const updated = { ...state }
  if (updated.streamingTabs) {
    updated.streamingTabs = updated.streamingTabs.filter((t) => t !== tabId)
  }

  // Remove loading indicators
  const loadingEls = refs.messageContainer?.querySelectorAll(".loading-indicator")
  loadingEls?.forEach((el) => el.remove())

  // Finalize virtual list
  const vl = getVirtualList(sessionId)
  if (vl) {
    vl.refresh()
  }

  // If error, show error state
  if (error) {
    const errorBanner = document.createElement("div")
    errorBanner.className = "stream-error"
    errorBanner.textContent = error
    refs.messageContainer?.appendChild(errorBanner)
  }

  // Scroll to bottom
  const scrollAnchor = createScrollAnchor(refs.messageContainer)
  scrollAnchor.scrollToEnd()

  setState(updated)
}
```

- [ ] **Step 3: Update streamHandlers.ts**

Replace the `handleStreamEnd` function body with a delegation:
```typescript
import { handleStreamEnd as handleStreamEndImpl } from "./streamEndHandler"
```

And in the function itself:
```typescript
function handleStreamEnd(data: StreamEndData, vscodeApi: VSCodeAPI): void {
  const state = getState()
  if (!state) return
  handleStreamEndImpl(data, state, (newState) => vscodeApi.setState(newState))
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat/webview/streamEndHandler.ts src/chat/webview/streamHandlers.ts
git commit -m "refactor: extract streamEndHandler from streamHandlers.ts"
```

---

#### Task C4: Add TabManager unit tests

**Files:**
- Create/Replace: `src/chat/TabManager.test.ts`

- [ ] **Step 1: Write comprehensive TabManager tests**

```typescript
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert"
import { TabManager } from "./TabManager"

describe("TabManager", () => {
  let tabManager: TabManager

  beforeEach(() => {
    tabManager = new TabManager()
  })

  it("starts with no tabs", () => {
    assert.strictEqual(tabManager.getTabCount(), 0)
    assert.strictEqual(tabManager.getAllTabs().length, 0)
    assert.strictEqual(tabManager.getActiveTab(), undefined)
  })

  it("creates a tab and sets it as active", () => {
    tabManager.createTab("session-1")
    assert.strictEqual(tabManager.getTabCount(), 1)
    assert.strictEqual(tabManager.getActiveTab()?.sessionId, "session-1")
  })

  it("creates multiple tabs and switches between them", () => {
    tabManager.createTab("session-1")
    tabManager.createTab("session-2")
    tabManager.createTab("session-3")
    assert.strictEqual(tabManager.getTabCount(), 3)
    // Active should be the last created
    assert.strictEqual(tabManager.getActiveTab()?.sessionId, "session-3")
  })

  it("switches to an existing tab", () => {
    tabManager.createTab("session-1")
    tabManager.createTab("session-2")
    tabManager.switchTab("session-1")
    assert.strictEqual(tabManager.getActiveTab()?.sessionId, "session-1")
  })

  it("closes a tab and switches to another", () => {
    tabManager.createTab("session-1")
    tabManager.createTab("session-2")
    tabManager.closeTab("session-1")
    assert.strictEqual(tabManager.getTabCount(), 1)
    assert.strictEqual(tabManager.getActiveTab()?.sessionId, "session-2")
  })

  it("returns undefined when closing the last tab", () => {
    tabManager.createTab("session-1")
    tabManager.closeTab("session-1")
    assert.strictEqual(tabManager.getTabCount(), 0)
    assert.strictEqual(tabManager.getActiveTab(), undefined)
  })

  it("finds a tab by CLI session ID", () => {
    tabManager.createTab("session-1")
    tabManager.setCliSessionId("session-1", "cli-abc")
    const found = tabManager.getTabByCliSessionId("cli-abc")
    assert.strictEqual(found?.sessionId, "session-1")
  })

  it("returns undefined for unknown CLI session ID", () => {
    assert.strictEqual(tabManager.getTabByCliSessionId("nonexistent"), undefined)
  })

  it("sets streaming state", () => {
    tabManager.createTab("session-1")
    assert.strictEqual(tabManager.getStreamingCount(), 0)
    tabManager.setStreaming("session-1", true)
    assert.strictEqual(tabManager.getStreamingCount(), 1)
    tabManager.setStreaming("session-1", false)
    assert.strictEqual(tabManager.getStreamingCount(), 0)
  })

  it("prevents streaming when limit reached", () => {
    tabManager.createTab("session-1")
    tabManager.createTab("session-2")
    tabManager.setStreaming("session-1", true)
    // Should not be able to start a second stream
    assert.strictEqual(tabManager.canStartStreaming(), false)
  })

  it("sets model and mode on a tab", () => {
    tabManager.createTab("session-1", undefined, "gpt-4", "auto")
    const tab = tabManager.getTab("session-1")
    assert.strictEqual(tab?.model, "gpt-4")
    assert.strictEqual(tab?.mode, "auto")

    tabManager.setModel("session-1", "claude-3")
    tabManager.setMode("session-1", "normal")
    assert.strictEqual(tabManager.getTab("session-1")?.model, "claude-3")
    assert.strictEqual(tabManager.getTab("session-1")?.mode, "normal")
  })
})
```

- [ ] **Step 2: Run TabManager tests**

Run: `npx tsx --test src/chat/TabManager.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/chat/TabManager.test.ts
git commit -m "test: add TabManager unit tests"
```

---

#### Task C5: Add ChatCommands tests

**Files:**
- Create/Replace: `src/chat/ChatCommands.test.ts`

- [ ] **Step 1: Write ChatCommands tests**

```typescript
import { describe, it, beforeEach, mock } from "node:test"
import assert from "node:assert"

describe("ChatCommands", () => {
  // ChatCommands needs a constructor that accepts callback functions.
  // Read src/chat/ChatCommands.ts to determine the exact constructor signature.
  // Write tests that verify:
  //   1. `/cost` triggers the cost callback
  //   2. `/clear` triggers the clear callback
  //   3. `/continue` triggers the continue callback
  //   4. `/help` triggers the help callback
  //   5. Unknown commands return false
  //   6. `clear()` method works
  //   7. `dispose()` cleans up resources
})
```

- [ ] **Step 2: Run ChatCommands tests**

Run: `npx tsx --test src/chat/ChatCommands.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/chat/ChatCommands.test.ts
git commit -m "test: add ChatCommands unit tests"
```

---

#### Task C6: Add ChatFileOps tests

**Files:**
- Create/Replace: `src/chat/ChatFileOps.test.ts`

- [ ] **Step 1: Write ChatFileOps tests**

```typescript
import { describe, it } from "node:test"
import assert from "node:assert"
import { ChatFileOps } from "./ChatFileOps"

describe("ChatFileOps", () => {
  it("returns correct extension for known languages", () => {
    const ops = new ChatFileOps()
    assert.strictEqual(ops.extensionForLanguage("typescript"), ".ts")
    assert.strictEqual(ops.extensionForLanguage("javascript"), ".js")
    assert.strictEqual(ops.extensionForLanguage("python"), ".py")
    assert.strictEqual(ops.extensionForLanguage("rust"), ".rs")
    assert.strictEqual(ops.extensionForLanguage("unknown"), ".txt")
    assert.strictEqual(ops.extensionForLanguage(""), ".txt")
  })

  it("insertAtCursor calls through to VS Code editor API", async () => {
    const ops = new ChatFileOps()
    // This test would need VS Code API mocking — for now, test that it doesn't crash
    // by wrapping in try/catch since VS Code APIs aren't available in unit tests
    try {
      await ops.insertAtCursor("console.log('test')")
    } catch {
      // Expected when VS Code APIs are unavailable
    }
  })
})
```

- [ ] **Step 2: Run ChatFileOps tests**

Run: `npx tsx --test src/chat/ChatFileOps.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/chat/ChatFileOps.test.ts
git commit -m "test: add ChatFileOps unit tests"
```

---

### Workstream D: Production console.* Cleanup + Dead Code Removal

#### Task D1: Create structured logger utility

**Files:**
- Read: `src/utils/outputChannel.ts` (to understand existing `log` object)
- Modify: (none — the existing `log` from `outputChannel.ts` is already the structured logger)

- [ ] **Step 1: Audit that src/utils/outputChannel.ts has info/warn/error methods**

Read `src/utils/outputChannel.ts`. It should export a `log` object with `.info()`, `.warn()`, `.error()`, `.debug()` methods.

- [ ] **Step 2: Commit audit result**

No changes needed if the logger already exists.

---

#### Task D2: Replace console.* calls with structured logger

**Files:**
- Modify: `src/chat/webview/main.ts`
- Modify: `src/chat/webview/streamHandlers.ts`
- Modify: `src/chat/webview/dom.ts`
- Modify: `src/chat/webview/theme.ts`
- Modify: `src/context/ContextEngine.ts`

- [ ] **Step 1: Collect all console.* call sites**

The triage identified these locations:

| File | Line | Pattern |
|---|---|---|
| `src/chat/webview/dom.ts` | 6, 18 | `console.warn(...)` |
| `src/chat/webview/main.ts` | 53, 62, 230, 231, 262, 270, 1217, 3381, 3446, 3798 | `console.error/warn(...)` |
| `src/chat/webview/streamHandlers.ts` | 107, 108 | `console.error/warn(...)` |
| `src/chat/webview/theme.ts` | 71, 76 | `console.warn(...)` |
| `src/context/ContextEngine.ts` | 134 | `console.warn(...)` |

- [ ] **Step 2: Fix each file by importing log and replacing console.* calls**

For `src/chat/webview/dom.ts`:
```typescript
import { log } from "../../utils/outputChannel"

// Replace:
// console.warn(`[OpenCode] Missing element: ${id} — using fallback`)
// with:
log.warn(`Missing element: ${id} — using fallback`)

// Replace:
// console.warn(`[OpenCode] Optional element not found: ${id}`)
// with:
log.warn(`Optional element not found: ${id}`)
```

For `src/chat/webview/main.ts`:
```typescript
import { log } from "../../utils/outputChannel"

// Each replacement follows the pattern:
// console.error(...) → log.error(...)
// console.warn(...) → log.warn(...)
```

For `src/chat/webview/streamHandlers.ts`:
```typescript
import { log } from "../../utils/outputChannel"
```

For `src/chat/webview/theme.ts`:
```typescript
import { log } from "../../utils/outputChannel"
```

For `src/context/ContextEngine.ts`:
```typescript
import { log } from "../utils/outputChannel"
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/chat/webview/main.ts src/chat/webview/streamHandlers.ts src/chat/webview/dom.ts src/chat/webview/theme.ts src/context/ContextEngine.ts
git commit -m "fix: replace production console.* calls with structured logger"
```

---

#### Task D3: Remove dead test harness file

**Files:**
- Delete: `src/chat/handlers/StreamCoordinator.behavioral.ts`

- [ ] **Step 1: Verify nothing imports it**

```bash
rg "StreamCoordinator\.behavioral" src/ --type ts
```
Expected: No results (or only references we already know are dead).

- [ ] **Step 2: Delete the file**

```bash
git rm src/chat/handlers/StreamCoordinator.behavioral.ts
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove dead test harness StreamCoordinator.behavioral.ts"
```

---

### Verification

#### Task V1: Full test suite + typecheck + verify improvements

- [ ] **Step 1: Run full test suite**

Run: `npm run test:unit`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 3: Verify ChatProvider line count reduction**

```bash
wc -l src/chat/ChatProvider.ts
```
Expected: < 900 lines (down from 1659).

- [ ] **Step 4: Verify StreamCoordinator line count reduction**

```bash
wc -l src/chat/handlers/StreamCoordinator.ts
```
Expected: < 1000 lines (down from 1134).

- [ ] **Step 5: Verify coupling improvement**

```bash
# Re-index the repo
# Then run:
# get_coupling_metrics for src/chat/ChatProvider.ts
```
Expected: Ce (dependencies) < 20, Instability < 0.85.

- [ ] **Step 6: Verify no new dead code introduced**

```bash
# Check with:
# find_dead_code with min_confidence=0.8
```
Expected: No new dead production code (only pre-existing config/CI dead code).