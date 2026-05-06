# System Architecture Design — OpenCode Harness

**Version:** 0.2.0 (Multi-Tab Redesign)
**Date:** 2026-05-02
**Status:** Current

---

## 1. Architectural Overview

### 1.1 High-Level Architecture

OpenCode Harness follows a **Client-Server model** with **multi-tab worker support**:

- **Server**: The opencode HTTP server (`opencode serve`), exposing a full OpenAPI 3.1 REST API + SSE event stream on a local port
- **Client**: The VS Code extension, communicating via the official `@opencode-ai/sdk` npm package
- **Multi-Tab**: Each tab is an independent worker (server session) with its own model, mode, and conversation history. Up to 3 concurrent streams.

The extension does NOT embed or spawn the opencode CLI directly for chat. Instead, it manages the server process lifecycle and interacts through typed SDK calls.

```
┌──────────────────────────────────────────────────────────┐
│                  VS Code Extension Host                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Chat          │ │ TabManager   │ │ Session       │  │
│  │ Provider      │◄┤ (concurrency)│ │ Store         │  │
│  │ (orchestrator)│ └──────────────┘ │ (persistence) │  │
│  └──────┬───────┘ ┌──────────────┐ └──────────────┘  │
│         │           │ StreamCoord. │                    │
│         │           │ (per-tab      │                    │
│         │           │  streaming)   │                    │
│         ▼           └──────┬───────┘                    │
│  ┌──────────────┐         │                            │
│  │ MessageRouter│◄────────┘                            │
│  │ (webview msg  │                                      │
│  │  routing)     │                                      │
│  └──────┬───────┘                                      │
│         │           ┌──────────────┐ ┌──────────────┐   │
│         └──────────►│ DiffHandler  │ │ WebviewContent│   │
│                     │ (diff track) │ │ (HTML/CSS)    │   │
│                     └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Context       │ │ Model         │ │ Rate Limit    │   │
│  │ Engine        │ │ Manager       │ │ Monitor       │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Inline        │ │ ChunkBatcher  │ │ Checkpoint    │   │
│  │ Actions       │ │ (stream buf)  │ │ Manager       │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐                    │
│  │ Terminal      │ │ Theme         │                    │
│  │ Bridge        │ │ Manager       │                    │
│  └──────────────┘ └──────────────┘                    │
└────────────────────────────┼────────────────────────────┘
                             │ @opencode-ai/sdk
                             ▼
                 ┌───────────────────┐
                 │ opencode serve    │
                 │ (HTTP :4096)      │
                 │ REST + SSE        │
                 │ Multi-session     │
                 └───────────────────┘
```

### 1.2 Design Principles

1. **Provider-agnostic**: The extension has zero knowledge of LLM providers. All model communication flows through opencode's server.
2. **Event-driven**: SSE streaming provides real-time visibility into agent state. No polling.
3. **Non-blocking**: All intensive work (context gathering, diff generation) runs in worker threads.
4. **Transactional writes**: Code changes are never applied directly. Diff → Review → Apply via VS Code's undoable edit API.
5. **Graceful degradation**: Every component handles the case where opencode is unavailable.
6. **Multi-tab concurrency**: Each tab is a lightweight wrapper around a server session. Max 3 concurrent streams.
7. **Soft-close semantics**: Closing a tab stops the worker but preserves chat history in SessionStore.

---

## 2. Component Design

### 2.1 Extension Entry Point (`src/extension.ts`)

```
activate(context: vscode.ExtensionContext):
  1. Initialize SessionManager (does NOT start server yet)
  2. Register ChatProvider webview (with TabManager, StreamCoordinator, etc.)
  3. Register InlineActionProvider (CodeLens + context menus)
  4. Register ContextMonitor status bar item
  5. Register TerminalBridge output channel
  6. Register ModelManager status bar item
  7. Register all commands + keyboard shortcuts (including tab shortcuts)
  8. Register URI handler (vscode://opencode-harness/open)
  9. On first chat open → start opencode server

deactivate():
  1. Stop opencode server process
  2. Dispose all subscriptions
  3. Persist chat history to workspace state
```

**Key decisions:**
- Lazy server startup: server starts when user first opens chat, not at extension activation.
- `context.subscriptions.push(...)` pattern for automatic cleanup.
- Workspace state for persistence (chat history, server port).

---

### 2.2 SessionManager (`src/session/SessionManager.ts`)

**Responsibility:** Manage the opencode server process lifecycle and provide a typed SDK client.

```
class SessionManager {
  private client: OpencodeClient | null
  private serverProcess: ChildProcess | null
  private port: number
  private eventEmitter: vscode.EventEmitter<OpencodeEvent>
  private reconnectTimer: NodeJS.Timer | null

  // Lifecycle
  async start(): Promise<void>
  async stop(): Promise<void>
  async restart(): Promise<void>
  isRunning(): boolean

  // Session CRUD (wraps SDK calls)
  async createSession(title?: string): Promise<Session>
  async deleteSession(id: string): Promise<boolean>
  async getSession(id: string): Promise<Session>
  async listSessions(): Promise<Session[]>

  // Messaging
  async sendPrompt(sessionId: string, parts: Part[], context?: ContextPackage): Promise<Message>
  async sendCommand(sessionId: string, command: string): Promise<Message>
  async abortSession(sessionId: string): Promise<boolean>

  // Events
  onEvent: vscode.Event<OpencodeEvent>
  private async subscribeToEvents(): Promise<void>
}
```

**Port management algorithm:**
1. Check workspace state for last known port
2. Try health check on that port
3. If unreachable: find free port via `net.createServer().listen(0)`
4. Spawn `opencode serve --port {n} --hostname 127.0.0.1`
5. Poll `/global/health` every 200ms until response (max 5s timeout)
6. Create SDK client with `createOpencodeClient({ baseUrl })`
7. Subscribe to `/event` SSE stream
8. Store port in workspace state

---

### 2.3 SessionStore (`src/session/SessionStore.ts`)

**Responsibility:** Persistent session storage with backward-compatible migration.

```
class SessionStore {
  private sessions: Map<string, OpenCodeSession>
  private activeSessionId: string | null

  create(name?: string, id?: string): OpenCodeSession  // id defaults to crypto.randomUUID()
  ensure(id: string, name?: string, model?: string, mode?: string): OpenCodeSession
  get(id: string): OpenCodeSession | undefined
  getAll(): OpenCodeSession[]
  delete(id: string): boolean
  updateModel(id: string, model: string): void
  updateMode(id: string, mode: string): void
  setActive(id: string): void
  getActive(): OpenCodeSession | undefined
  setActiveModel(model: string): void
  // ... event emitters
}
```

**Session object:**
```typescript
interface OpenCodeSession {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string           // per-session model override
  mode: string            // "normal" | "plan" | "auto_accept"
  messages: ChatMessage[] // full conversation history
}
```

**Migration:** Automatically migrates from old flat format (`{ messages, currentMode, currentSessionId }`) to new multi-session format (`{ sessions, activeSessionId, nextSessionNum, globalModel }`).

---

### 2.4 ChatProvider (`src/chat/ChatProvider.ts`)

**Responsibility:** Main webview provider — orchestrates backend modules (refactored from 617 lines to ~280 lines).

**Architecture:** Delegates to focused handler modules:

```
class ChatProvider implements vscode.WebviewViewProvider {
  private tabManager: TabManager
  private streamCoordinator: StreamCoordinator
  private messageRouter: MessageRouter
  private webviewContent: WebviewContent

  resolveWebviewView(webviewView, context, token): Promise<void>
  // ... postMessage, dispose
}
```

**PostMessage protocol (Host → Webview):**

| Message Type | Payload | Purpose |
|---------------|----------|---------|
| `init` | `{ sessions, activeSessionId, models, activeModel, globalModel }` | Initial state sync |
| `create_tab` | `{ sessionId, name, model, mode }` | New tab created |
| `switch_tab` | `{ sessionId }` | Tab switched |
| `close_tab` | `{ sessionId }` | Tab closed (worker stopped) |
| `message` | `{ sessionId, message }` | New message received |
| `stream_start` | `{ sessionId, messageId }` | Streaming started |
| `stream_chunk` | `{ sessionId, messageId, chunk }` | Streaming chunk |
| `stream_end` | `{ sessionId, messageId }` | Streaming ended |
| `streaming_state` | `{ sessionId, isStreaming }` | Tab streaming state |
| `token_usage` | `{ sessionId, percentage, tokens, limit }` | Token usage update |
| `model_changed` | `{ sessionId, model }` | Model changed for tab |
| `mode_changed` | `{ sessionId, mode }` | Mode changed for tab |
| `task_complete` | `{ sessionId, status, message }` | Task completion banner |
| `request_error` | `{ sessionId, error, canRetry }` | Error with retry option |
| `diff` | `{ sessionId, messageId, blockId, diff }` | Diff block to display |
| `server_status` | `{ status }` | Server connectivity status |
| `sessions_list` | `{ sessions }` | Session list for picker |

**PostMessage protocol (Webview → Host):**

| Message Type | Payload | Purpose |
|---------------|----------|---------|
| `ready` | — | Webview loaded, request init |
| `create_tab` | `{ name, model, mode }` | Create new tab |
| `send_prompt` | `{ sessionId, text, attachments }` | Send user message |
| `abort` | `{ sessionId }` | Abort streaming for tab |
| `switch_tab` | `{ sessionId }` | Switch to tab |
| `close_tab` | `{ sessionId }` | Close tab (stops worker, keeps history) |
| `change_mode` | `{ sessionId, mode }` | Change mode for tab |
| `set_model` | `{ sessionId, model }` | Set model for tab |
| `accept_diff` | `{ sessionId, blockId, edits }` | Accept diff |
| `reject_diff` | `{ sessionId, blockId }` | Reject diff |
| `accept_permission` | `{ sessionId, permissionId, response }` | Respond to permission prompt |
| `resume_session` | `{ sessionId }` | Resume a session from history |
| `delete_session` | `{ sessionId }` | Delete session from history |
| `rename_session` | `{ sessionId, name }` | Rename session |
| `mention_search` | `{ query }` | Search for @-mention targets |
| `mention_results` | `{ items }` | Return mention search results |

---

### 2.5 TabManager (`src/chat/TabManager.ts`)

**Responsibility:** Per-tab state management with concurrency limits.

```
class TabManager {
  private tabs: Map<string, TabState>
  private activeTabId: string | null
  private readonly MAX_CONCURRENT = 3

  createTab(id: string, name?: string, model?: string, mode?: string): TabState
  getTab(id: string): TabState | undefined
  switchTab(id: string): void
  closeTab(id: string): boolean  // aborts streaming, removes tab state
  setStreaming(id: string, streaming: boolean): void
  setModel(id: string, model: string): void
  setMode(id: string, mode: string): void
  getActiveTab(): TabState | undefined
  canStartNewStream(): boolean  // checks MAX_CONCURRENT
  getStreamingTabs(): TabState[]  // for "too many streams" warning
  // ... event emitters
}
```

**Tab state:**
```typescript
interface TabState {
  id: string
  name: string
  model: string
  mode: string
  isStreaming: boolean
  completionTimeout: NodeJS.Timer | null
}
```

**Concurrency behavior:**
- Max 3 concurrent streams (`MAX_CONCURRENT = 3`)
- Attempting to start a 4th stream: shows warning with names of currently streaming tabs
- `canStartNewStream()` checks count before allowing new streams

---

### 2.6 StreamCoordinator (`src/chat/handlers/StreamCoordinator.ts`)

**Responsibility:** Per-tab streaming lifecycle management.

```
class StreamCoordinator {
  private activeStreams: Map<string, AbortController>

  async startStream(
    sessionId: string,
    prompt: string,
    context: ContextPackage,
    callbacks: StreamCallbacks
  ): Promise<void>

  async abort(sessionId: string, callbacks: StreamCallbacks): Promise<boolean>

  isStreaming(sessionId: string): boolean
  getActiveStreamCount(): number
  abortAll(): Promise<void>
}
```

**Stream lifecycle:**
1. `startStream()` creates an `AbortController`, calls `sessionManager.sendPrompt()`, subscribes to SSE events
2. Events routed to callbacks: `onChunk()`, `onComplete()`, `onError()`
3. `abort()` calls `abortSession()` on SessionManager, cleans up controller
4. Completion: sets up auto-refresh timer (`completionTimeout`) for session status polling

---

### 2.7 MessageRouter (`src/chat/handlers/MessageRouter.ts`)

**Responsibility:** Route webview messages to appropriate handlers.

```
class MessageRouter {
  constructor(
    tabManager: TabManager,
    streamCoordinator: StreamCoordinator,
    sessionManager: SessionManager,
    sessionStore: SessionStore,
    webviewContent: WebviewContent,
    // ... callbacks
  ) {}

  async route(msg: WebviewMessage, postMessage: PostMessage): Promise<void>
}
```

**Routing logic:**
- `send_prompt` → `streamCoordinator.startStream()` with context from `ContextEngine`
- `abort` → `streamCoordinator.abort()`
- `close_tab` → abort if streaming, then `tabManager.closeTab()`
- `switch_tab` → `tabManager.switchTab()`, sync state
- `change_mode` / `set_model` → update TabManager + SessionStore
- `accept_diff` / `reject_diff` → delegate to `DiffHandler`

---

### 2.8 DiffHandler (`src/chat/handlers/DiffHandler.ts`)

**Responsibility:** Track pending diffs and handle accept/reject actions.

```
class DiffHandler {
  private pendingDiffs: Map<string, DiffState>  // key: blockId

  async handleDiff(block: DiffBlock, sessionId: string): Promise<void>
  async accept(blockId: string, edits?: Edit[]): Promise<boolean>
  async reject(blockId: string): Promise<void>
  getPendingForSession(sessionId: string): DiffState[]
}
```

---

### 2.9 WebviewContent (`src/chat/WebviewContent.ts`)

**Responsibility:** Generate the HTML/CSS content for the webview panel.

```
class WebviewContent {
  constructor(extensionUri: vscode.Uri) {}

  build(webview: vscode.Webview, themeManager: ThemeManager): string
  private buildThemeStyleTag(vars: ThemeVariables, nonce: string): string
  private getNonce(): string
}
```

**CSS bundling:** Uses esbuild to bundle 8 modular CSS files into `dist/chat/webview/styles.css`:
- `tokens.css` — Design tokens (spacing, typography, colors, animation)
- `base.css` — Reset & utilities
- `layout.css` — Header, tab bar, input area
- `components.css` — Buttons, chips, badges
- `messages.css` — Message bubbles, task banners
- `blocks.css` — Code blocks, tool cards, diffs
- `animations.css` — Keyframes & transitions
- `accessibility.css` — Focus rings, reduced-motion, high-contrast

**Static webview assets:** `esbuild.js` copies `src/chat/webview/index.html` and `media/opencode-wordmark-dark.svg` into `dist/chat/webview/`. `WebviewContent` rewrites the wordmark image to a VS Code webview URI and allows `${webview.cspSource}` in `img-src`, so the branded welcome state works in both standalone Playwright tests and packaged VSIX installs.

---

### 2.10 Frontend Webview Modules (`src/chat/webview/`)

**Responsibility:** Client-side logic in the webview iframe.

| Module | Purpose |
|--------|---------|
| `main.ts` | Entry point — initializes state, wires up event listeners, handles multi-tab logic |
| `state.ts` | `StateManager` — multi-session state with migration from old format |
| `dom.ts` | `DOMElements` — cached references to all UI elements |
| `renderer.ts` | `MessageRenderer` — renders message blocks (text, tool calls, diffs, task banners) |
| `stream.ts` | `StreamHandler` — handles streaming messages with `StreamElements` interface |
| `tabs.ts` | `TabBar` — tab bar UI, create/switch/close tabs, streaming indicators |
| `model-dropdown.ts` | `ModelDropdown` — per-tab model picker with provider grouping |
| `theme.ts` | Context chips and usage bar rendering |
| `mentions.ts` | `@-mention` autocomplete for files, folders, problems, terminals |
| `sessions.ts` | Session picker overlay for resuming/deleting/renaming sessions |
| `theme.ts` | Context chips and usage bar rendering |

**State management (frontend):**
```typescript
interface AppState {
  sessions: Record<string, TabData>  // sessionId → messages + metadata
  activeSessionId: string | null
  nextSessionNum: number
  globalModel: string
}

interface TabData {
  id: string
  name: string
  model: string
  mode: string
  messages: ChatMessage[]
  isStreaming: boolean
}
```

**Tab switching:** Uses `display: none` for inactive tab contents (instant switching, no re-render). Active tab gets `display: flex`.

---

### 2.11 ContextEngine (`src/context/ContextEngine.ts`)

**Responsibility:** Gather workspace intelligence and package it for the AI. Runs in a Node.js `Worker` thread to avoid blocking the UI.

```
// Main thread API
class ContextEngine {
  private worker: Worker

  async gatherContext(config?: GatherConfig): Promise<ContextPackage>
  estimateTokens(pkg: ContextPackage): number
  onConfigChanged: vscode.Event<void>
  dispose(): void
}

// Worker thread message protocol
type WorkerMessage =
  | { type: "gather"; config: GatherConfig; requestId: string }
  | { type: "estimate"; pkg: ContextPackage; requestId: string }

type WorkerResponse =
  | { type: "context"; pkg: ContextPackage; requestId: string; duration: number }
  | { type: "estimate"; tokens: number; requestId: string }
```

**ContextPackage structure:**
```
interface ContextPackage {
  openFiles: {
    path: string
    language: string
    content: string        // capped at 8192 chars each
    selection?: { startLine: number; endLine: number; text: string }
  }[]
  diagnostics: {
    file: string
    errors: string[]       // message only, not full Diagnostic object
    warnings: string[]
    hints: string[]
  }[]
  workspaceTree: {
    name: string
    type: "file" | "directory"
    children?: ...         // recursion depth: 3
  }[]
  projectConfigs: {
    type: "package.json" | "tsconfig.json" | "pyproject.toml" | "Cargo.toml" | "other"
    path: string
    content: string        // full content for config files
  }[]
  gitStatus: {
    branch: string
    modified: string[]
    staged: string[]
    recentDiff?: string    // git diff HEAD~1 (deep mode only)
  }
  terminalOutput?: {
    name: string
    text: string
  }
  explicitContext?: {
    type: "url" | "folder" | "problems"
    content: string
  }[]
}
```

**Two gathering modes:**

| Mode | Data | Latency |
|------|------|---------|
| Basic | openFiles, diagnostics, git branch, workspaceTree | <10ms |
| Deep | Basic + full git diff, project configs, AST structure | <50ms |

---

### 2.12 ModelManager (`src/model/ModelManager.ts`)

**Responsibility:** Model selection, listing, and status bar indicator.

```
class ModelManager {
  private models: ModelInfo[]
  private statusBarItem: vscode.StatusBarItem

  async fetchModels(): Promise<ModelInfo[]>
  getModels(): ModelInfo[]
  getModel(id: string): ModelInfo | undefined
  setDefaultModel(model: string): void
  getDefaultModel(): string
  groupByProvider(): Record<string, ModelInfo[]>
  updateStatusBar(modelId: string): void
  // ... event emitters
}
```

**Model info:**
```typescript
interface ModelInfo {
  id: string            // e.g., "anthropic/claude-3-5-sonnet-20241022"
  name: string          // display name
  provider: string      // "Anthropic", "OpenAI", etc.
  contextWindow: number  // token limit
  supportsStreaming: boolean
}
```

---

### 2.13 Other Components

#### DiffApplier (`src/diff/DiffApplier.ts`)
**Responsibility:** Parse AI-generated code, compute diff against current file state, present for review, apply via VS Code API.

#### CheckpointManager (`src/checkpoint/CheckpointManager.ts`)
**Responsibility:** Create lightweight git snapshots before AI file writes, enabling instant rollback.

#### InlineActionProvider (`src/inline/InlineActionProvider.ts`)
**Responsibility:** Provide CodeLens annotations and context menu actions for selected code.

#### ChunkBatcher (`src/chat/ChunkBatcher.ts`)
**Responsibility:** Buffers streaming text chunks and flushes every 50ms to reduce postMessage overhead.

#### SessionExporter (`src/session/SessionExporter.ts`)
**Responsibility:** Export session conversations as Markdown files.

#### ContextMonitor (`src/monitor/ContextMonitor.ts`)
**Responsibility:** Status bar ring indicator showing context window usage.

#### RateLimitMonitor (`src/monitor/RateLimitMonitor.ts`)
**Responsibility:** Track API rate limits and surface warnings in the UI.

#### TerminalBridge (`src/terminal/TerminalBridge.ts`)
**Responsibility:** Dedicated output channel for raw server logs and terminal output capture.

#### ThemeManager (`src/theme/ThemeManager.ts`)
**Responsibility:** Resolve theme variables from presets, CLI config, and user overrides.

---

## 3. Data Flow

### 3.1 User Sends a Chat Message (Multi-Tab)

```
User types message in Tab A
       │
       ▼
ChatProvider (webview main.ts)
       │ postMessage { type: "send_prompt", sessionId: "tab-A" }
       ▼
MessageRouter
       │
       ├─→ TabManager.setStreaming("tab-A", true)
       │
       ├─→ ContextEngine.gatherContext() ──→ ContextPackage
       │   (worker thread, non-blocking)
       │
       ├─→ CheckpointManager.snapshot()
       │   (git worktree, before any potential writes)
       │
       └─→ StreamCoordinator.startStream("tab-A", prompt, context)
              │
              ├─→ SessionManager.sendPrompt(sessionId, parts, context)
              │      │
              │      ├─→ POST /session/:id/message ──→ opencode server
              │      │
              │      ├─→ SSE /event stream ──→ real-time tool/skill/thinking events
              │      │   │
              │      │   └─→ StreamCoordinator ──→ ChatProvider (host)
              │      │       │
              │      │       └─→ postMessage to webview: "stream_chunk"
              │      │           │
              │      │           └─→ MessageRenderer (webview)
              │      │               (render tool cards, skill cards, thinking blocks)
              │      │
              │      └─→ Response received (AssistantMessage with parts[])
              │             │
              │             ├─→ DiffApplier.parseCodeBlocks()
              │             │   │
              │             │   └─→ postMessage: "diff" block to webview
              │             │       │
              │             │       └─→ User clicks Accept → DiffApplier.acceptEdit()
              │             │           │
              │             │           └─→ workspace.applyEdit() → native undo stack
              │             │
              │             └─→ TokenIndicator.updateUsage()
              │
              └─→ TabManager.setStreaming("tab-A", false)
                     │
                     └─→ postMessage: "task_complete" banner
```

### 3.2 Tab Close Semantics

```
User clicks × on Tab A
       │
       ▼
TabBar (webview tabs.ts)
       │ Removes tab from UI (display: none for content)
       │ Calls stateManager.deleteSession("tab-A")
       │
       ▼
postMessage { type: "close_tab", sessionId: "tab-A" }
       │
       ▼
MessageRouter
       │
       ├─→ Check if tab is streaming:
       │   └─→ YES: StreamCoordinator.abort("tab-A") → SessionManager.abortSession()
       │
       └─→ TabManager.closeTab("tab-A")
              │ Removes tab state from TabManager
              │ (SessionStore is NOT deleted — history preserved)
              │
              ▼
       Webview receives confirmation
              │ Active tab switches to another if needed
              │ (Tab A's chat history remains in SessionStore for sidebar history)
```

**Key behaviors:**
- ✅ Active AI work is **STOPPED** (sessionManager.abortSession())
- ✅ Server session is **RELEASED** (server may persist to disk, but streaming stops)
- ✅ Chat history is **PRESERVED** (remains in SessionStore)
- ✅ Tab UI is **REMOVED** from webview
- ✅ Other tabs are **UNAFFECTED** (server process keeps running)

### 3.3 Inline Code Action

```
User clicks CodeLens "Generate Tests" on a function
       │
       ▼
InlineActionProvider
       │
       ├─→ ContextEngine.gatherContext({ mode: "basic" })
       │
       └─→ SessionManager.sendPrompt(inlineSession, [
             { type: "text", text: "Generate unit tests for the following function:" },
             { type: "text", text: selectedCode }
           ])
              │
              ▼
           DiffApplier → inline diff in editor (not chat panel)
              │
              └─→ Accept/Reject → workspace.applyEdit()
```

### 3.4 Server Crash Recovery

```
opencode server process exits unexpectedly
       │
       ▼
SessionManager detects 'exit' event
       │
       ├─→ Set status: "disconnected"
       ├─→ Emit event: server:disconnected
       ├─→ ChatProvider shows "Reconnecting..." banner
       │
       ├─→ Start reconnect timer (exponential backoff)
       │   │
       │   ├─→ 1s: try health check on old port
       │   ├─→ 2s: find new port, spawn new server
       │   ├─→ 4s: retry
       │   └─→ 8s: retry, then show manual reconnect button
       │
       └─→ On reconnect:
           ├─→ Restore session list from server
           ├─→ Restore last active session ID
           ├─→ Emit event: server:reconnected
           └─→ ChatProvider removes banner, restores chat history
```

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js 20+ | Required by VS Code extension host |
| Language | TypeScript 5.x | Type safety, VS Code API typings |
| Build | esbuild | Fast bundling, VS Code extension standard |
| CSS Bundling | esbuild with CSS plugin | Bundle 8 modular CSS files into single stylesheet |
| AI SDK | `@opencode-ai/sdk` | Official type-safe client for opencode server |
| Webview UI | Vanilla HTML/CSS/JS | No framework dependency; VS Code CSS variables for theming |
| Markdown rendering | `marked` (lightweight) | Render assistant text in webview |
| Diff computation | Custom minimal diff or `diff` npm package | Generate unified diffs for display |
| Token estimation | Heuristic (charCount / 4) | Zero-dependency, <1ms, adequate for progress rings |
| Git operations | `simple-git` or child_process git commands | Worktree management for checkpoints |
| Testing | `@vscode/test-electron` + Mocha | VS Code extension integration testing |

**Dependencies intentionally avoided:**
- No React/Vue/Svelte in webview (minimizes bundle, avoids framework version conflicts with VS Code)
- No external tokenizer (tiktoken adds 5MB+ to bundle, heuristic is sufficient for progress ring)
- No axios/fetch wrapper (VS Code's built-in `fetch` + SDK handles HTTP)

---

## 5. Extension Manifest (`package.json` contribution points)

```json
{
  "activationEvents": [
    "onView:opencode-harness.chat",
    "onCommand:opencode-harness.openChat",
    "onCommand:opencode-harness.inlineAction",
    "onUri"
  ],
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "opencode-harness",
        "title": "OpenCode",
        "icon": "media/opencode-activity.svg"
      }]
    },
    "views": {
      "opencode-harness": [
        { "id": "opencode-harness.chat", "name": "Chat", "type": "webview" }
      ]
    },
    "commands": [
      { "command": "opencode-harness.openChat", "title": "Open Chat" },
      { "command": "opencode-harness.newSession", "title": "New Session" },
      { "command": "opencode-harness.toggleFocus", "title": "Toggle Chat Focus" },
      { "command": "opencode-harness.explainCode", "title": "Explain This Code" },
      { "command": "opencode-harness.refactorCode", "title": "Refactor This Code" },
      { "command": "opencode-harness.generateTests", "title": "Generate Tests" },
      { "command": "opencode-harness.insertMention", "title": "Insert @-Mention Reference" },
      { "command": "opencode-harness.captureTerminal", "title": "Capture Terminal Selection" },
      { "command": "opencode-harness.rollback", "title": "Rollback Workspace" },
      { "command": "opencode-harness.selectModel", "title": "Select Model" },
      { "command": "opencode-harness.showRateLimits", "title": "Show Rate Limits" },
      { "command": "opencode-harness.checkCli", "title": "Check CLI Communication" },
      { "command": "opencode-harness.listSessions", "title": "List Sessions" },
      { "command": "opencode-harness.deleteSession", "title": "Delete Session" },
      { "command": "opencode-harness.renameSession", "title": "Rename Session" }
    ],
    "keybindings": [
      { "command": "opencode-harness.toggleFocus", "key": "ctrl+alt+o" },
      { "command": "opencode-harness.newSession", "key": "ctrl+alt+n" },
      { "command": "opencode-harness.insertMention", "key": "alt+k" },
      { "command": "opencode-harness.newTab", "key": "ctrl+t", "when": "view == opencode-harness.chat" },
      { "command": "opencode-harness.closeTab", "key": "ctrl+w", "when": "view == opencode-harness.chat" },
      { "command": "opencode-harness.nextTab", "key": "ctrl+tab", "when": "view == opencode-harness.chat" },
      { "command": "opencode-harness.prevTab", "key": "ctrl+shift+tab", "when": "view == opencode-harness.chat" }
    ],
    "menus": {
      "editor/context": [
        { "command": "opencode-harness.explainCode", "group": "opencode" },
        { "command": "opencode-harness.refactorCode", "group": "opencode" },
        { "command": "opencode-harness.generateTests", "group": "opencode" }
      ]
    }
  }
}
```

---

## 6. Design Token System

OpenCode uses a token-based design system for consistent values across the entire interface.

### Spacing Scale (4px baseline)
All padding, margins, and gaps use a consistent scale:
- `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`, `--space-10: 40px`, `--space-12: 48px`, `--space-16: 64px`

### Typography Scale
- `--text-xs: 11px` (labels, timestamps)
- `--text-sm: 12px` (buttons, metadata)
- `--text-base: 13px` (body text, matches VS Code)
- `--text-md: 14px` (headings)
- `--text-lg: 16px` (section titles)

### Border Radius Scale
- `--radius-sm: 3px` (small badges, tags)
- `--radius-md: 6px` (buttons, inputs)
- `--radius-lg: 8px` (cards, message bubbles)
- `--radius-xl: 10px` (modals, panels)

### Shadow Scale
- `--shadow-xs: 0 1px 2px rgba(0,0,0,0.06)`
- `--shadow-sm: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)`
- `--shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)`
- `--shadow-lg: 0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.05)`

### Animation Tokens
- `--duration-fast: 150ms` (button hovers, toggles)
- `--duration-normal: 250ms` (dropdowns, panels)
- `--duration-slow: 350ms` (message entrance)
- `--duration-slower: 500ms` (page transitions)
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (primary easing)
- `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)` (symmetrical)

---

## 7. Accessibility

OpenCode is built with accessibility as a first-class concern:

| Feature | Implementation |
|---------|-----------------|
| **Keyboard navigation** | Full support for Tab, Enter, Escape, arrow keys, and shortcuts |
| **Focus management** | Visible `focus-visible` rings on all interactive elements (2px solid, offset 2px) |
| **Touch targets** | All interactive elements meet WCAG 2.5.5 minimum (24×24px) |
| **Reduced motion** | Respects `prefers-reduced-motion` — animations become instant fades |
| **High contrast** | `forced-colors: active` media query ensures borders and focus states are visible |
| **ARIA roles** | Tab bar uses `tablist`/`tab`/`tabpanel`, mode selector uses `radiogroup`/`radio` |
| **Screen reader** | Skip link, aria-labels on icon buttons, live regions for status updates |
| **Color contrast** | All text meets WCAG 2.2 AA (4.5:1 for normal text, 3:1 for large text) |

---

## 8. Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| opencode binary not found on PATH | Show setup wizard: "Install opencode" with link to opencode.ai |
| Server fails to start (port in use) | Try next port, max 5 attempts, then show manual port config |
| Server crashes mid-session | Auto-reconnect with exponential backoff; preserve chat history |
| SDK call timeout (model not responding) | Show "Model timed out" with retry button |
| Permission required for tool call | Show inline permission prompt in chat |
| File was modified since diff computed | Warn user, show side-by-side: current vs AI vs original |
| Git worktree creation fails | Fall back to `git stash` + manual restoration |
| Webview postMessage size exceeded | Chunk large messages; show progress indicator |
| Context package too large for token limit | Truncate lowest-priority files; show truncation summary |
| Max concurrent streams (3) exceeded | Show warning with names of currently streaming tabs |
| Tab close with active stream | Auto-abort the stream before closing tab |

---

## 9. Security Considerations

1. **No API key storage**: The extension never receives, stores, or transmits LLM API keys. Authentication is handled entirely by the opencode server.
2. **Localhost only**: The opencode server binds to `127.0.0.1` only — not reachable from other machines.
3. **Dynamic port**: Random high port (49152-65535), stored only in VS Code's secure workspace state.
4. **Workspace trust**: In Restricted Mode, the extension disables all file-writing operations and terminal command execution.
5. **PII redaction**: Output channel masks API keys, tokens, and passwords.
6. **No telemetry by default**: Any data collection requires explicit opt-in.

---

## 10. Testing Strategy

| Level | Scope | Tool |
|-------|-------|------|
| Unit | Individual modules (ContextEngine, DiffApplier, TabManager, etc.) | Mocha + Chai |
| Integration | SessionManager + opencode server interaction | `@vscode/test-electron` |
| Webview | Chat UI rendering and interaction (multi-tab) | Playwright (via `@vscode/test-webview`) |
| Platform | Arch Linux + Fedora smoke tests | Manual + CI (GitHub Actions with Docker) |
| Performance | Startup time, context gathering latency | Custom benchmarks |

---

## 11. Build & Development

### Project Structure

```
src/
├── chat/
│   ├── ChatProvider.ts          # Main webview provider (orchestrator)
│   ├── TabManager.ts            # Per-tab state & concurrency limit
│   ├── ChunkBatcher.ts          # Streaming text chunk batching (50ms flush)
│   ├── WebviewContent.ts        # HTML/CSS injection for webview
│   ├── handlers/
│   │   ├── StreamCoordinator.ts # Per-tab streaming lifecycle
│   │   ├── MessageRouter.ts     # Webview message routing
│   │   └── DiffHandler.ts       # Diff apply/reject tracking
│   └── webview/
│       ├── index.html           # Webview HTML structure
│       ├── main.ts              # Webview entry point (multi-tab)
│       ├── state.ts             # Multi-session state management
│       ├── dom.ts               # DOM element references
│       ├── renderer.ts          # Message block rendering
│       ├── stream.ts            # Streaming message handlers
│       ├── tabs.ts              # Tab bar UI & logic
│       ├── model-dropdown.ts    # Model picker dropdown
│       ├── token-indicator.ts   # Token usage pill
│       ├── mentions.ts          # @-mention autocomplete
│       ├── sessions.ts          # Session picker overlay
│       ├── theme.ts             # Context chips & usage bar
│       ├── types.ts             # TypeScript interfaces
│       └── css/
│           ├── tokens.css       # Design tokens (spacing, type, color)
│           ├── base.css         # Reset & utilities
│           ├── layout.css       # Header, tab bar, input
│           ├── components.css   # Buttons, chips, badges
│           ├── messages.css     # Message bubbles, banners
│           ├── blocks.css       # Code, tools, diffs
│           ├── animations.css   # Keyframes & transitions
│           ├── accessibility.css # Focus rings, reduced-motion
│           └── styles.css       # Entry point (imports all)
├── session/
│   ├── SessionManager.ts        # opencode server lifecycle
│   ├── SessionStore.ts          # Persistent session storage
│   └── SessionExporter.ts       # Markdown export of sessions
├── context/
│   └── ContextEngine.ts         # Workspace context gathering
├── diff/
│   └── DiffApplier.ts           # Diff parsing & application
├── monitor/
│   ├── ContextMonitor.ts        # Context usage status bar
│   └── RateLimitMonitor.ts      # Rate limit tracking
├── model/
│   └── ModelManager.ts          # Model selection & status bar
├── theme/
│   └── ThemeManager.ts          # Theme variable resolution
├── inline/
│   └── InlineActionProvider.ts  # CodeLens actions
├── terminal/
│   └── TerminalBridge.ts        # Terminal output capture
├── checkpoint/
│   └── CheckpointManager.ts     # Git snapshots
├── utils/
│   ├── outputChannel.ts         # Logging utility
│   ├── tokenCounter.ts          # Token estimation
│   └── portFinder.ts            # Free port discovery
└── extension.ts                 # Extension entry point
```

### Build Commands

```bash
# Build the extension (production)
npm run build

# TypeScript type checking
npm run typecheck

# Watch mode for development
npm run watch

# Package as .vsix
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

### Build Output

```
dist/
├── extension.js              # Bundled extension (335.6kb)
└── chat/
    └── webview/
        ├── main.js          # Bundled webview JS (287.0kb)
        ├── main.js.map      # Source map
        ├── styles.css       # Bundled CSS (42.3kb)
        └── index.html      # Webview entry point
```
