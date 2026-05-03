# System Architecture Design — OpenCode Harness

**Version:** 1.0  
**Date:** 2026-05-02  
**Status:** Draft

---

## 1. Architectural Overview

### 1.1 High-Level Architecture

OpenCode Harness follows a **Client-Server model** where:
- **Server**: The opencode HTTP server (`opencode serve`), exposing a full OpenAPI 3.1 REST API + SSE event stream on a local port
- **Client**: The VS Code extension, communicating via the official `@opencode-ai/sdk` npm package

The extension does NOT embed or spawn the opencode CLI directly for chat. Instead, it manages the server process lifecycle and interacts through typed SDK calls.

```
┌──────────────────────────────────────────────────────────┐
│                  VS Code Extension Host                   │
│  ┌──────────┐ ┌───────────┐ ┌──────────────┐            │
│  │ Chat     │ │ Context   │ │ Session      │            │
│  │ Provider │ │ Engine    │ │ Manager      │            │
│  │ (Webview)│ │ (Worker)  │ │ (SDK wrapper)│            │
│  └──────────┘ └───────────┘ └──────┬───────┘            │
│  ┌──────────┐ ┌───────────┐        │                    │
│  │ Diff     │ │ Checkpoint│        │                    │
│  │ Applier  │ │ Manager   │        │                    │
│  └──────────┘ └───────────┘        │                    │
│  ┌──────────┐ ┌───────────┐        │                    │
│  │ Inline   │ │ Skill     │        │                    │
│  │ Actions  │ │ Manager   │        │                    │
│  └──────────┘ └───────────┘        │                    │
│  ┌──────────┐ ┌───────────┐        │                    │
│  │ Context  │ │ Terminal  │        │                    │
│  │ Monitor  │ │ Bridge    │        │                    │
│  └──────────┘ └───────────┘        │                    │
└────────────────────────────────────┼────────────────────┘
                                     │ @opencode-ai/sdk
                                     ▼
                         ┌───────────────────┐
                         │ opencode serve    │
                         │ (HTTP :4096)      │
                         │ REST + SSE        │
                         └───────────────────┘
```

### 1.2 Design Principles

1. **Provider-agnostic**: The extension has zero knowledge of LLM providers. All model communication flows through opencode's server.
2. **Event-driven**: SSE streaming provides real-time visibility into agent state. No polling.
3. **Non-blocking**: All intensive work (context gathering, diff generation) runs in worker threads.
4. **Transactional writes**: Code changes are never applied directly. Diff → Review → Apply via VS Code's undoable edit API.
5. **Graceful degradation**: Every component handles the case where opencode is unavailable.

---

## 2. Component Design

### 2.1 Extension Entry Point (`src/extension.ts`)

```
activate(context: vscode.ExtensionContext):
  1. Initialize SessionManager (does NOT start server yet)
  2. Register ChatProvider webview
  3. Register InlineActionProvider (CodeLens + context menus)
  4. Register SkillManager tree view
  5. Register ContextMonitor status bar item
  6. Register TerminalBridge output channel
  7. Register all commands + keyboard shortcuts
  8. Register URI handler (vscode://opencode-harness/open)
  9. On first chat open → start opencode server

deactivate():
  1. Stop opencode server process
  2. Dispose all subscriptions
  3. Persist chat history to workspace state
```

**Key decisions:**
- Lazy server startup: server starts when user first opens chat, not at extension activation (minimizes startup overhead).
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

**Crash recovery:**
1. Monitor server process for `exit` event
2. If unexpected exit: set reconnect timer (1s, 2s, 4s, 8s exponential backoff)
3. On reconnect: restore last session ID from workspace state
4. Emit `server:reconnected` event → ChatProvider restores state

**SDK error handling:**
All SDK calls are wrapped in try/catch. Errors are classified:
- `ConnectionError` → server unreachable, trigger reconnect
- `SessionNotFoundError` → stale session reference
- `PermissionRequiredError` → emit to ChatProvider for user approval
- `TimeoutError` → model took too long, present retry option

---

### 2.3 ContextEngine (`src/context/ContextEngine.ts`)

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

**Context size management:**
- Total context package capped at ~50KB of text
- Files larger than 8KB are truncated with a marker: `[File truncated: 12KB shown of 45KB total]`
- If package exceeds limit, files are prioritized: active editor > visible tabs > background tabs
- Token count estimated via simple heuristic (4 chars ≈ 1 token), not external library (avoids dependency bloat and matches opencode's internal estimation within reasonable margin)

---

### 2.4 ChatProvider (`src/chat/ChatProvider.ts` + `src/chat/webview/`)

**Responsibility:** Manage the webview chat panel — the primary user interaction point.

**Architecture:** Two-part system following VS Code's webview pattern.

**Extension host side (`ChatProvider.ts`):**
- Implements `vscode.WebviewViewProvider`
- Manages message routing between webview ↔ SessionManager
- Handles `postMessage` protocol
- Persists chat history to workspace state

**Webview side (`src/chat/webview/`):**
- Plain HTML/CSS/JS (no framework dependency, minimizes bundle size)
- Uses VS Code CSS variables for automatic theme compatibility
- Renders interactive message blocks: text, tool cards, skill cards, diff blocks
- Handles @-mention autocomplete
- Permission mode selector UI

**PostMessage protocol:**

```
// Host → Webview
{ type: "message", message: ChatMessage }
{ type: "stream_start", messageId: string }
{ type: "stream_chunk", messageId: string, chunk: PartBlock }
{ type: "stream_end", messageId: string }
{ type: "context_usage", percentage: number, tokens: number }
{ type: "server_status", status: "idle" | "thinking" | "error" }
{ type: "session_list", sessions: SessionSummary[] }

// Webview → Host
{ type: "send_prompt", text: string, attachments: Attachment[] }
{ type: "accept_diff", messageId: string, blockId: string, edits?: Edit[] }
{ type: "reject_diff", messageId: string, blockId: string }
{ type: "accept_permission", permissionId: string, response: "allow" | "deny" }
{ type: "change_mode", mode: "normal" | "plan" | "auto_accept" }
{ type: "abort" }
{ type: "resume_session", sessionId: string }
{ type: "new_session" }
```

**Message rendering types:**

| Block Type | Visual Representation |
|-----------|----------------------|
| TextBlock | Markdown-rendered text with syntax-highlighted code blocks |
| ToolCallCard | Expandable card: tool name + input args (collapsed) + result (expandable). Color-coded by tool type. |
| SkillCard | Badge with skill name + duration indicator. Expandable for activation output. |
| ThinkingBlock | Collapsible reasoning text (default collapsed). |
| DiffBlock | Side-by-side or unified diff with Accept All / Accept Line / Reject / Edit buttons. |
| ContextBlock | Summary of what context was gathered (file count, diagnostic count). Collapsible. |
| PermissionPrompt | Inline prompt: "Allow X to run Y?" with Allow Once / Allow Always / Deny buttons. |
| PlanBlock | Markdown document opened as a VS Code document for inline commenting. |

**@-mention system:**
When user types `@` in chat input:
1. Webview sends `{ type: "mention_search", query: string }` to host
2. Host queries VS Code API for file matches
3. Special prefixes trigger different sources:
   - `@file` — fuzzy file path search
   - `@folder` — directory search, injects all files
   - `@problems` — injects workspace errors/warnings
   - `@url` — fetch and convert to markdown
   - `@terminal` — capture terminal output
4. Results returned as `{ type: "mention_results", items: MentionItem[] }`
5. Selected mention inserts reference text: `@src/services/auth.ts#L12-34`

---

### 2.5 DiffApplier (`src/diff/DiffApplier.ts`)

**Responsibility:** Parse AI-generated code, compute diff against current file state, present for review, apply via VS Code API.

```
class DiffApplier {
  // Parse code blocks from message parts
  parseCodeBlocks(parts: Part[]): ProposedEdit[]

  // Generate unified diff text between original and proposed
  generateDiff(filePath: string, proposed: string): string

  // Apply accepted diff via workspace.applyEdit
  async acceptEdit(edit: ProposedEdit): Promise<boolean>

  // Calculate context-preserving partial diff for line-level accept
  async acceptPartialEdit(edit: ProposedEdit, acceptedLines: number[]): Promise<boolean>

  // Reject edit (no file change, just dismiss UI)
  rejectEdit(edit: ProposedEdit): void
}

interface ProposedEdit {
  filePath: string
  originalContent: string   // snapshot of file before AI suggestion
  proposedContent: string   // what the AI wants to write
  messageId: string
  blockId: string
}
```

**Diff application flow:**
1. AI response contains code block with language identifier and file path hint
2. DiffApplier reads current file content from VS Code API
3. If file path is explicit (e.g., `// src/foo.ts` in code fence), use that. Otherwise, infer from context.
4. Compute diff using `fast-diff` library (or minimal implementation)
5. Present diff in webview as `DiffBlock`
6. On accept: `workspace.applyEdit()` with a `WorkspaceEdit` containing the text replacement → fully undoable via Ctrl+Z
7. On partial accept: only specific hunks are applied
8. On reject: dismiss the diff block, no file change

**Safety:**
- Never apply to files outside the workspace
- Never apply if file was modified since the diff was computed (stale diff → warn user)
- All edits go through VS Code's undo stack

---

### 2.6 CheckpointManager (`src/checkpoint/CheckpointManager.ts`)

**Responsibility:** Create lightweight git snapshots before AI file writes, enabling instant rollback.

```
class CheckpointManager {
  // Take a snapshot of the current workspace state
  async snapshot(sessionId: string, messageId: string): Promise<Checkpoint>

  // Restore workspace to a specific checkpoint
  async restore(checkpointId: string, mode: "workspace_only" | "full"): Promise<boolean>

  // List all checkpoints for a session
  async listCheckpoints(sessionId: string): Promise<Checkpoint[]>

  // Compare workspace with a checkpoint (return file list + diffs)
  async compare(checkpointId: string): Promise<FileDiff[]>

  // Clean up old checkpoints
  async prune(sessionId: string): Promise<void>
}

interface Checkpoint {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  filesChanged: string[]
  gitRef: string        // the git ref (branch/tag/commit) for this snapshot
}
```

**Implementation:**
- Uses `git worktree add` to create a linked working tree from a snapshot commit
- Worktree is created in `.opencode-harness/checkpoints/{id}/`
- Snapshot commit is created via `git commit --allow-empty -m "checkpoint: {sessionId}:{messageId}"`
- Rollback: `git checkout {gitRef}` in the main worktree, then `git worktree remove` the checkpoint
- Workspace state (VS Code settings, open tabs) is NOT affected — only files
- Checkpoints are auto-pruned after session ends (keep last 5)

**Limitations:**
- Requires the workspace to be a git repository with no uncommitted changes conflicting with rollback
- Detached HEAD state: uncommitted changes on detached HEAD are preserved via `git stash` before rollback
- Bare repositories: not supported (checkpoint is disabled, user warned)

---

### 2.7 InlineActionProvider (`src/inline/InlineActionProvider.ts`)

**Responsibility:** Provide CodeLens annotations and context menu actions for selected code.

```
class InlineActionProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[]
  resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.CodeLens
}

// Registered commands:
// opencode-harness.explainCode
// opencode-harness.refactorCode
// opencode-harness.generateTests
// opencode-harness.optimizeCode
// opencode-harness.reviewCode
// opencode-harness.findBugs
```

**CodeLens placement:** Functions, classes, methods, and exported constants. Lenses appear only on lines with recognizable code structures (detected via simple regex + optional Language Server Protocol symbol query).

**Action execution:**
1. User clicks CodeLens or uses context menu
2. Selected code + file context gathered
3. Prompt constructed: `{action}: {code}` with surrounding file context
4. Sent to opencode via SessionManager as a new inline session
5. Response diff shown inline in the editor (not requiring chat panel open)

---

### 2.8 SkillManager (`src/skills/SkillManager.ts`)

**Responsibility:** Tree view for browsing, enabling, and disabling opencode skills.

```
class SkillManager implements vscode.TreeDataProvider<SkillItem> {
  getTreeItem(element: SkillItem): vscode.TreeItem
  getChildren(element?: SkillItem): vscode.ProviderResult<SkillItem[]>

  async refresh(): Promise<void>
  async enableSkill(skillId: string): Promise<void>
  async disableSkill(skillId: string): Promise<void>
  async getSkillStatus(skillId: string): Promise<SkillStatus>
}
```

**Tree structure:**
```
Skills
├── Built-in Skills
│   ├── brainstorming (enabled) ●
│   ├── systematic-debugging (enabled) ●
│   └── test-driven-development (disabled) ○
└── Custom Skills
    └── my-company-workflow (enabled) ●
```

**Implementation:**
- Skill list fetched from opencode's config/skills directory
- Enable/disable modifies `.opencode/skills/` or opencode config
- Status bar icon shows a badge when any skill is actively loaded
- Double-click a skill to view its source `.md` file

---

### 2.9 ContextMonitor (`src/monitor/ContextMonitor.ts`)

**Responsibility:** Status bar ring indicator showing context window usage.

```
class ContextMonitor {
  private statusBarItem: vscode.StatusBarItem
  private currentPercentage: number

  updateUsage(tokensUsed: number, tokensTotal?: number): void
  showWarning(message: string): void
  dispose(): void
}
```

**Status bar item rendering:**
- Text: `◉ OC 42%` (filled circle + percentage)
- Tooltip: `OpenCode Harness — 42,350 / 100,000 tokens`
- Color: green (<50%), yellow (50-75%), red (>75%), flashing red (>90%)
- Command on click: open context detail view or trigger `/compact`

**Token estimation:**
- ContextPackage text length / 4 (heuristic: ~4 chars per token for English text + code)
- Server-side verification: query session status for actual token count when available
- Display both when available: `42% (est.)` vs `42% (live)`

---

### 2.10 TerminalBridge (`src/terminal/TerminalBridge.ts`)

**Responsibility:** Dedicated output channel for raw server logs and terminal output capture.

```
class TerminalBridge {
  private outputChannel: vscode.OutputChannel

  log(level: string, message: string): void
  captureTerminalSelection(terminal: vscode.Terminal): Promise<string>
  dispose(): void
}
```

**Output channel:**
- Named "OpenCode Harness"
- Shows: server startup logs, SDK calls (method + path), errors, performance metrics
- PII redaction: API keys, tokens, passwords are masked

**Terminal capture:**
- User selects text in any VS Code terminal
- Runs command "OpenCode Harness: Capture Terminal Selection"
- Captured text stored, available as `@terminal` mention in chat

---

## 3. Data Flow

### 3.1 User Sends a Chat Message

```
User types message
       │
       ▼
ChatProvider (webview)
       │ postMessage { type: "send_prompt" }
       ▼
ChatProvider (host)
       │
       ├─→ ContextEngine.gatherContext() ──→ ContextPackage
       │   (worker thread, non-blocking)
       │
       ├─→ CheckpointManager.snapshot()
       │   (git worktree, before any potential writes)
       │
       └─→ SessionManager.sendPrompt(sessionId, parts, context)
              │
              ├─→ POST /session/:id/message ──→ opencode server
              │
              ├─→ SSE /event stream ──→ real-time tool/skill/thinking events
              │   │
              │   └─→ ChatProvider (host) ──→ ChatProvider (webview)
              │       (render tool cards, skill cards, thinking blocks in real-time)
              │
              └─→ Response received (AssistantMessage with parts[])
                     │
                     ├─→ DiffApplier.parseCodeBlocks()
                     │   │
                     │   └─→ ChatProvider (webview): render DiffBlock
                     │       │
                     │       └─→ User clicks Accept → DiffApplier.acceptEdit()
                     │           workspace.applyEdit() → native undo stack
                     │
                     └─→ ContextMonitor.updateUsage()
```

### 3.2 Inline Code Action

```
User clicks CodeLens "Generate Tests" on a function
       │
       ▼
InlineActionProvider
       │
       ├─→ ContextEngine.gatherContext({ mode: "basic" })
       │
       └─→ SessionManager.sendPrompt(inlineSession, [
             { type: "text", text: "Generate unit tests for the following function:
             { type: "text", text: selectedCode }
           ])
              │
              ▼
           DiffApplier → inline diff in editor (not chat panel)
              │
              └─→ Accept/Reject → workspace.applyEdit()
```

### 3.3 Server Crash Recovery

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
        "title": "OpenCode Harness",
        "icon": "$(sparkle)"
      }]
    },
    "views": {
      "opencode-harness": [
        { "id": "opencode-harness.chat", "name": "Chat" },
        { "id": "opencode-harness.sessions", "name": "Sessions" },
        { "id": "opencode-harness.skills", "name": "Skills" }
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
      { "command": "opencode-harness.rollback", "title": "Rollback Workspace" }
    ],
    "keybindings": [
      { "command": "opencode-harness.toggleFocus", "key": "ctrl+escape" },
      { "command": "opencode-harness.newSession", "key": "ctrl+shift+escape" },
      { "command": "opencode-harness.insertMention", "key": "alt+k" }
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

## 6. Error Handling Strategy

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

---

## 7. Security Considerations

1. **No API key storage**: The extension never receives, stores, or transmits LLM API keys. Authentication is handled entirely by the opencode server.
2. **Localhost only**: The opencode server binds to `127.0.0.1` only — not reachable from other machines.
3. **Dynamic port**: Random high port (49152-65535), stored only in VS Code's secure workspace state.
4. **Workspace trust**: In Restricted Mode, the extension disables all file-writing operations and terminal command execution.
5. **PII redaction**: Output channel masks API keys, tokens, and passwords.
6. **No telemetry by default**: Any data collection requires explicit opt-in.

---

## 8. Testing Strategy

| Level | Scope | Tool |
|-------|-------|------|
| Unit | Individual modules (ContextEngine, DiffApplier, etc.) | Mocha + Chai |
| Integration | SessionManager + opencode server interaction | `@vscode/test-electron` |
| Webview | Chat UI rendering and interaction | Playwright (via `@vscode/test-webview`) |
| Platform | Arch Linux + Fedora smoke tests | Manual + CI (GitHub Actions with Docker) |
| Performance | Startup time, context gathering latency | Custom benchmarks |
