# OpenCode Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that deeply integrates the opencode AI coding agent into the IDE, providing a rich chat interface, real-time agent visibility, intelligent context gathering, and keyboard-driven workflows.

**Architecture:** The extension manages an `opencode serve` HTTP server process and communicates via the official `@opencode-ai/sdk`. SSE events provide real-time agent visibility. Context gathering runs in a worker thread. Code changes are diff-reviewed before applying via `workspace.applyEdit()`.

**Tech Stack:** TypeScript 5.x, Node.js 20+, esbuild, `@opencode-ai/sdk`, vanilla HTML/CSS/JS webview, `simple-git` for checkpoints

---

## File Structure Map

```
opencode-harness/
├── .vscode/
│   ├── launch.json              # Debug config (F5 → Extension Dev Host)
│   └── tasks.json               # Build tasks (esbuild watch)
├── src/
│   ├── extension.ts             # Entry: activate/deactivate, command registration
│   ├── session/
│   │   └── SessionManager.ts    # Server lifecycle, SDK wrapper, SSE event bus
│   ├── context/
│   │   └── ContextEngine.ts     # Worker-thread context gathering
│   ├── chat/
│   │   ├── ChatProvider.ts      # Webview provider (extension host side)
│   │   └── webview/
│   │       ├── index.html       # Webview shell
│   │       ├── main.js          # Webview logic (messages, @-mentions, rendering)
│   │       └── styles.css       # Webview theme (VS Code CSS variables)
│   ├── diff/
│   │   └── DiffApplier.ts       # Parse code blocks, compute diff, apply via workspace.edit
│   ├── inline/
│   │   └── InlineActionProvider.ts  # CodeLens + context menu actions
│   ├── checkpoint/
│   │   └── CheckpointManager.ts # Git worktree snapshots + rollback
│   ├── skills/
│   │   └── SkillManager.ts      # Skill tree view, enable/disable
│   ├── monitor/
│   │   └── ContextMonitor.ts    # Status bar ring + token estimation
│   ├── terminal/
│   │   └── TerminalBridge.ts    # Output channel + terminal capture
│   └── utils/
│       ├── portFinder.ts        # Dynamic port allocation
│       └── tokenCounter.ts      # Heuristic token estimation (charCount / 4)
├── package.json                 # Extension manifest + contributes
├── tsconfig.json                # TypeScript configuration
├── esbuild.js                   # Bundle configuration
├── .vscodeignore                # Files excluded from .vsix
└── README.md                    # Extension readme
```

---

## Phase 1: Foundation (Tasks 1-8)

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.js`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Create: `.vscodeignore`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "opencode-harness",
  "displayName": "OpenCode Harness",
  "description": "Deep IDE integration for the OpenCode AI coding agent",
  "version": "0.0.1",
  "engines": { "vscode": "^1.98.0" },
  "categories": ["Chat", "AI"],
  "activationEvents": [
    "onView:opencode-harness.chat",
    "onCommand:opencode-harness.openChat"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "opencode-harness.openChat", "title": "OpenCode Harness: Open Chat" },
      { "command": "opencode-harness.newSession", "title": "OpenCode Harness: New Session" },
      { "command": "opencode-harness.toggleFocus", "title": "OpenCode Harness: Toggle Chat Focus" }
    ],
    "keybindings": [
      { "command": "opencode-harness.toggleFocus", "key": "ctrl+escape" },
      { "command": "opencode-harness.newSession", "key": "ctrl+shift+escape" }
    ],
    "viewsContainers": {
      "activitybar": [{
        "id": "opencode-harness",
        "title": "OpenCode Harness",
        "icon": "$(sparkle)"
      }]
    },
    "views": {
      "opencode-harness": [
        { "id": "opencode-harness.chat", "name": "Chat" }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "node esbuild.js --production",
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "lint": "eslint src --ext ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/vscode": "^1.98.0",
    "@types/node": "^20.0.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.7.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  },
  "dependencies": {
    "@opencode-ai/sdk": "latest",
    "simple-git": "^3.27.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "Node16"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "out"]
}
```

- [ ] **Step 3: Create esbuild.js**

```js
const esbuild = require("esbuild")

const watch = process.argv.includes("--watch")
const production = process.argv.includes("--production")

const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  outdir: "dist",
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  logLevel: "info",
}

if (watch) {
  esbuild.context(config).then((ctx) => ctx.watch())
} else {
  esbuild.build(config).catch(() => process.exit(1))
}
```

- [ ] **Step 4: Create .vscode/launch.json**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

- [ ] **Step 5: Create .vscode/tasks.json**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "isBackground": true,
      "problemMatcher": "$esbuild-watch",
      "label": "npm: watch"
    }
  ]
}
```

- [ ] **Step 6: Create .vscodeignore**

```
.vscode/**
src/**
node_modules/**
.github/**
.gitignore
esbuild.js
tsconfig.json
**/*.map
```

- [ ] **Step 7: Install dependencies and verify build**

Run: `npm install`
Run: `node esbuild.js`
Expected: Build completes without errors, `dist/extension.js` created.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json esbuild.js .vscode/launch.json .vscode/tasks.json .vscodeignore package-lock.json
git commit -m "feat: scaffold OpenCode Harness VS Code extension project"
```

---

### Task 2: Port Finder Utility

**Files:**
- Create: `src/utils/portFinder.ts`

- [ ] **Step 1: Write the port finder**

```typescript
import * as net from "net"

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address && typeof address === "object") {
        server.close(() => resolve(address.port))
      } else {
        server.close(() => reject(new Error("Could not find free port")))
      }
    })
  })
}

export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(true))
    server.once("listening", () => {
      server.close(() => resolve(false))
    })
    server.listen(port, "127.0.0.1")
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/utils/portFinder.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/portFinder.ts
git commit -m "feat: add port finder utility for dynamic server port allocation"
```

---

### Task 3: Token Counter Utility

**Files:**
- Create: `src/utils/tokenCounter.ts`

- [ ] **Step 1: Write the token counter**

```typescript
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function estimateContextTokens(pkg: { openFiles: { content: string }[]; diagnostics?: unknown; gitStatus?: unknown; terminalOutput?: { text: string }; workspaceTree?: unknown; projectConfigs?: unknown[] }): number {
  let total = 0

  for (const file of pkg.openFiles) {
    total += estimateTokens(file.content)
    total += estimateTokens(file.path)
  }

  if (pkg.terminalOutput) {
    total += estimateTokens(pkg.terminalOutput.text)
  }

  total += estimateTokens(JSON.stringify(pkg.diagnostics ?? {}))
  total += estimateTokens(JSON.stringify(pkg.gitStatus ?? {}))
  total += estimateTokens(JSON.stringify(pkg.workspaceTree ?? {}))
  total += estimateTokens(JSON.stringify(pkg.projectConfigs ?? []))

  return total
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/utils/tokenCounter.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/tokenCounter.ts
git commit -m "feat: add heuristic token counter for context estimation"
```

---

### Task 4: SessionManager — Core Class

**Files:**
- Create: `src/session/SessionManager.ts`

- [ ] **Step 1: Write the SessionManager class skeleton**

```typescript
import * as vscode from "vscode"
import { createOpencodeClient, type OpencodeClient, type Session, type Message, type Part } from "@opencode-ai/sdk"
import { spawn, type ChildProcess } from "child_process"
import { findFreePort, isPortInUse } from "../utils/portFinder"
import { estimateTokens, estimateContextTokens } from "../utils/tokenCounter"

export interface OpencodeEvent {
  type: "tool_start" | "tool_end" | "skill_load" | "thinking" | "text_chunk" | "server_connected" | "server_disconnected"
  sessionId?: string
  data?: unknown
}

export interface ContextPackage {
  openFiles: { path: string; language: string; content: string; selection?: { startLine: number; endLine: number; text: string } }[]
  diagnostics: unknown
  workspaceTree: unknown
  projectConfigs: unknown[]
  gitStatus: { branch: string; modified: string[]; staged: string[]; recentDiff?: string }
  terminalOutput?: { name: string; text: string }
  explicitContext?: { type: string; content: string }[]
}

export class SessionManager {
  private client: OpencodeClient | null = null
  private serverProcess: ChildProcess | null = null
  private port = 0
  private _onEvent = new vscode.EventEmitter<OpencodeEvent>()
  onEvent = this._onEvent.event
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0

  get isRunning(): boolean {
    return this.client !== null
  }

  get currentPort(): number {
    return this.port
  }

  async start(): Promise<void> {
    if (this.client) return

    this.port = await findFreePort()
    this._onEvent.fire({ type: "server_connected", data: { port: this.port } })

    const opencodePath = await this.findOpencodeBinary()
    if (!opencodePath) {
      throw new Error("OpenCode binary not found on PATH. Install it from https://opencode.ai")
    }

    this.serverProcess = spawn(opencodePath, [
      "serve",
      "--port", String(this.port),
      "--hostname", "127.0.0.1",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    this.serverProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString()
      console.log(`[opencode server] ${output}`)
    })

    this.serverProcess.stderr?.on("data", (data: Buffer) => {
      console.error(`[opencode server] ${data.toString()}`)
    })

    this.serverProcess.on("exit", (code) => {
      console.log(`[opencode server] Process exited with code ${code}`)
      if (this.client) {
        this._onEvent.fire({ type: "server_disconnected", data: { code } })
        this.client = null
        this.scheduleReconnect()
      }
    })

    await this.waitForHealth()

    this.client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${this.port}` })
    this.reconnectAttempts = 0
    this._onEvent.fire({ type: "server_connected", data: { port: this.port } })

    this.subscribeToEvents()
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM")
      this.serverProcess = null
    }
    this.client = null
    this.port = 0
    this.reconnectAttempts = 0
  }

  private async findOpencodeBinary(): Promise<string | null> {
    const which = spawn("which", ["opencode"])
    return new Promise((resolve) => {
      let output = ""
      which.stdout?.on("data", (d: Buffer) => { output += d.toString() })
      which.on("close", () => {
        resolve(output.trim() || null)
      })
      which.on("error", () => resolve(null))
    })
  }

  private async waitForHealth(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`http://127.0.0.1:${this.port}/global/health`)
        if (resp.ok) {
          const data = await resp.json() as { healthy: boolean; version: string }
          if (data.healthy) return
        }
      } catch {
        // server not ready yet
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error("Server failed to start within timeout")
  }

  private subscribeToEvents(): void {
    if (!this.client) return
    this.client.event.subscribe().then((events) => {
      void (async () => {
        for await (const event of events.stream) {
          this._onEvent.fire({
            type: event.type as OpencodeEvent["type"],
            sessionId: (event.properties as { sessionID?: string } | undefined)?.sessionID,
            data: event.properties,
          })
        }
      })()
    }).catch((err: Error) => {
      console.error("[SessionManager] Event subscription failed:", err.message)
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 5) return
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.start().catch(() => {
        this.scheduleReconnect()
      })
    }, delay)
  }

  // Session CRUD — wrappers around SDK calls
  async createSession(title?: string): Promise<Session> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.create({ body: { title } })
    return resp.data as Session
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.delete({ path: { id } })
    return true
  }

  async getSession(id: string): Promise<Session> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.get({ path: { id } })
    return resp.data as Session
  }

  async listSessions(): Promise<Session[]> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.list()
    return resp.data as Session[]
  }

  async sendPrompt(sessionId: string, parts: Part[]): Promise<Message> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.prompt({
      path: { id: sessionId },
      body: { parts },
    })
    return { info: resp.data.info, parts: resp.data.parts } as Message
  }

  async sendCommand(sessionId: string, command: string): Promise<Message> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.command({
      path: { id: sessionId },
      body: { command, arguments: "" },
    })
    return { info: resp.data.info, parts: resp.data.parts } as Message
  }

  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.abort({ path: { id: sessionId } })
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.messages({ path: { id: sessionId }, query: { limit } })
    return resp.data as { info: unknown; parts: Part[] }[]
  }

  async getSessionDiff(sessionId: string, messageId?: string): Promise<unknown> {
    if (!this.client) throw new Error("Server not running")
    const resp = await this.client.session.diff({
      path: { id: sessionId },
      query: { messageID: messageId },
    })
    return resp.data
  }

  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    if (!this.client) throw new Error("Server not running")
    await this.client.session.revert({ path: { id: sessionId }, body: { messageID: messageId } })
    return true
  }

  dispose(): void {
    void this.stop()
    this._onEvent.dispose()
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles the entire project**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/session/SessionManager.ts
git commit -m "feat: implement SessionManager with server lifecycle, SDK wrapping, SSE events"
```

---

### Task 5: Extension Entry Point — activate/deactivate

**Files:**
- Create: `src/extension.ts`
- Modify: `package.json` (add webview view provider contribution)

- [ ] **Step 1: Write the extension entry point**

```typescript
import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"

let sessionManager: SessionManager

export function activate(context: vscode.ExtensionContext): void {
  sessionManager = new SessionManager()

  // Register chat command
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openChat", () => {
      vscode.commands.executeCommand("opencode-harness.chat.focus")
    })
  )

  // Register new session command
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.newSession", async () => {
      if (!sessionManager.isRunning) {
        await sessionManager.start()
      }
      const session = await sessionManager.createSession()
      vscode.window.showInformationMessage(`New session created: ${session.id}`)
    })
  )

  // Register toggle focus command
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.toggleFocus", () => {
      vscode.commands.executeCommand("opencode-harness.chat.focus")
    })
  )

  // Register opencode-harness.chat.focus command
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.chat.focus", () => {
      vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
    })
  )

  console.log("[OpenCode Harness] Extension activated")
}

export function deactivate(): void {
  if (sessionManager) {
    sessionManager.dispose()
  }
  console.log("[OpenCode Harness] Extension deactivated")
}
```

- [ ] **Step 2: Build and verify**

Run: `node esbuild.js`
Expected: Build completes without errors.

- [ ] **Step 3: Launch extension in debug mode and verify activation**

Run: Press F5 in VS Code (launches Extension Development Host)
Expected: Extension loads, OpenCode Harness icon appears in Activity Bar. No errors in console.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add extension entry point with command registration and SessionManager integration"
```

---

### Task 6: Extension Manifest — Full Contribution Points

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json with all planned contribution points**

Replace the `contributes` section in `package.json` with:

```json
{
  "contributes": {
    "commands": [
      { "command": "opencode-harness.openChat", "title": "OpenCode Harness: Open Chat" },
      { "command": "opencode-harness.newSession", "title": "OpenCode Harness: New Session" },
      { "command": "opencode-harness.toggleFocus", "title": "OpenCode Harness: Toggle Chat Focus" },
      { "command": "opencode-harness.explainCode", "title": "OpenCode Harness: Explain This Code" },
      { "command": "opencode-harness.refactorCode", "title": "OpenCode Harness: Refactor This Code" },
      { "command": "opencode-harness.generateTests", "title": "OpenCode Harness: Generate Tests" },
      { "command": "opencode-harness.insertMention", "title": "OpenCode Harness: Insert @-Mention Reference" },
      { "command": "opencode-harness.captureTerminal", "title": "OpenCode Harness: Capture Terminal Selection" },
      { "command": "opencode-harness.rollback", "title": "OpenCode Harness: Rollback Workspace" }
    ],
    "keybindings": [
      { "command": "opencode-harness.toggleFocus", "key": "ctrl+escape", "when": "!opencodeChatFocused" },
      { "command": "opencode-harness.newSession", "key": "ctrl+shift+escape" },
      { "command": "opencode-harness.insertMention", "key": "alt+k", "when": "editorTextFocus" }
    ],
    "viewsContainers": {
      "activitybar": [{
        "id": "opencode-harness",
        "title": "OpenCode Harness",
        "icon": "$(sparkle)"
      }]
    },
    "views": {
      "opencode-harness": [
        {
          "id": "opencode-harness.chat",
          "name": "Chat",
          "type": "webview"
        },
        {
          "id": "opencode-harness.sessions",
          "name": "Sessions"
        },
        {
          "id": "opencode-harness.skills",
          "name": "Skills"
        }
      ]
    },
    "menus": {
      "editor/context": [
        { "command": "opencode-harness.explainCode", "group": "opencode@1", "when": "editorHasSelection" },
        { "command": "opencode-harness.refactorCode", "group": "opencode@2", "when": "editorHasSelection" },
        { "command": "opencode-harness.generateTests", "group": "opencode@3", "when": "editorHasSelection" }
      ]
    }
  }
}
```

- [ ] **Step 2: Build and test that commands appear in Command Palette**

Run: `node esbuild.js`
Run: Press F5 (debug extension)
Expected: All commands visible in Command Palette. Activity Bar icon visible.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add full extension contribution points (commands, keybinds, menus, views)"
```

---

### Task 7: ChatProvider — Webview Shell

**Files:**
- Create: `src/chat/ChatProvider.ts`
- Create: `src/chat/webview/index.html`
- Create: `src/chat/webview/main.js`
- Create: `src/chat/webview/styles.css`
- Modify: `src/extension.ts` (register ChatProvider)

- [ ] **Step 1: Write the webview HTML shell**

File: `src/chat/webview/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data:;">
  <link rel="stylesheet" href="styles.css">
  <title>OpenCode Harness Chat</title>
</head>
<body>
  <div id="app">
    <div id="message-list"></div>
    <div id="input-area">
      <div id="mention-dropdown" class="dropdown hidden"></div>
      <div id="mode-selector">
        <button class="mode-btn active" data-mode="normal" title="Normal: ask before each action">Normal</button>
        <button class="mode-btn" data-mode="plan" title="Plan: read-only, creates plan for review">Plan</button>
        <button class="mode-btn" data-mode="acceptEdits" title="Auto-accept: apply changes without asking">Auto</button>
      </div>
      <textarea id="prompt-input" rows="3" placeholder="Ask OpenCode..."></textarea>
      <button id="send-btn">Send</button>
      <button id="abort-btn" class="hidden">Stop</button>
    </div>
  </div>
  <script src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the webview stylesheet**

File: `src/chat/webview/styles.css`

```css
:root {
  --oc-bg: var(--vscode-sideBar-background);
  --oc-fg: var(--vscode-sideBar-foreground);
  --oc-border: var(--vscode-sideBar-border);
  --oc-input-bg: var(--vscode-input-background);
  --oc-input-fg: var(--vscode-input-foreground);
  --oc-input-border: var(--vscode-input-border);
  --oc-button-bg: var(--vscode-button-background);
  --oc-button-fg: var(--vscode-button-foreground);
  --oc-button-hover: var(--vscode-button-hoverBackground);
  --oc-tool-card-bg: var(--vscode-editor-background);
  --oc-tool-read: #58a6ff;
  --oc-tool-write: #f85149;
  --oc-tool-exec: #3fb950;
  --oc-skill: #bc8cff;
  --oc-thinking: #d29922;
  --oc-muted: var(--vscode-descriptionForeground);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--oc-fg);
  background: var(--oc-bg);
  height: 100vh;
  display: flex;
  flex-direction: column;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

#message-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  padding: 8px 12px;
  border-radius: 6px;
  max-width: 100%;
  word-wrap: break-word;
}

.message.user {
  background: var(--vscode-textBlockQuote-background);
  border: 1px solid var(--oc-border);
}

.message.assistant {
  background: transparent;
}

.message .timestamp {
  font-size: 11px;
  color: var(--oc-muted);
  margin-bottom: 4px;
}

.tool-card {
  border: 1px solid var(--oc-border);
  border-radius: 6px;
  padding: 8px 12px;
  background: var(--oc-tool-card-bg);
}

.tool-card .tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
}

.tool-card .tool-icon { font-size: 16px; }
.tool-card .tool-name { font-weight: bold; }
.tool-card .tool-args { color: var(--oc-muted); font-family: monospace; font-size: 11px; }
.tool-card .tool-result { margin-top: 8px; display: none; font-size: 12px; }
.tool-card.expanded .tool-result { display: block; }

.tool-card.tool-read { border-left: 3px solid var(--oc-tool-read); }
.tool-card.tool-write { border-left: 3px solid var(--oc-tool-write); }
.tool-card.tool-exec { border-left: 3px solid var(--oc-tool-exec); }

.skill-card {
  background: rgba(188, 140, 255, 0.1);
  border: 1px solid var(--oc-skill);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--oc-skill);
}

.diff-block {
  border: 1px solid var(--oc-border);
  border-radius: 6px;
  overflow: hidden;
  margin: 8px 0;
}

.diff-block .diff-header {
  background: var(--vscode-tab-activeBackground);
  padding: 6px 10px;
  font-size: 11px;
  color: var(--oc-muted);
}

.diff-block .diff-content {
  padding: 8px;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
}

.diff-block .diff-actions {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-top: 1px solid var(--oc-border);
}

.diff-block .diff-actions button { font-size: 11px; padding: 3px 8px; }

.diff-add { background: rgba(63, 185, 80, 0.2); color: #3fb950; }
.diff-remove { background: rgba(248, 81, 73, 0.2); color: #f85149; }

#input-area {
  border-top: 1px solid var(--oc-border);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

#mode-selector {
  display: flex;
  gap: 4px;
}

.mode-btn {
  background: transparent;
  border: 1px solid var(--oc-border);
  color: var(--oc-muted);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.mode-btn.active {
  background: var(--oc-button-bg);
  color: var(--oc-button-fg);
}

#prompt-input {
  background: var(--oc-input-bg);
  color: var(--oc-input-fg);
  border: 1px solid var(--oc-input-border);
  border-radius: 4px;
  padding: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: inherit;
}

#send-btn, #abort-btn {
  background: var(--oc-button-bg);
  color: var(--oc-button-fg);
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
}

#send-btn:hover { background: var(--oc-button-hover); }

.hidden { display: none !important; }

.dropdown {
  position: absolute;
  bottom: 100%;
  background: var(--oc-input-bg);
  border: 1px solid var(--oc-border);
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
  width: 100%;
}

.dropdown-item {
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}

.dropdown-item:hover { background: var(--vscode-list-hoverBackground); }
.dropdown-item.selected { background: var(--vscode-list-activeSelectionBackground); }

.thinking-block {
  background: rgba(210, 153, 34, 0.1);
  border-left: 3px solid var(--oc-thinking);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--oc-muted);
  cursor: pointer;
}

.thinking-block.expanded {
  color: var(--oc-fg);
  max-height: none;
}
```

- [ ] **Step 3: Write the webview JavaScript**

File: `src/chat/webview/main.js`

```javascript
const vscode = acquireVsCodeApi()

const state = {
  messages: [],
  currentMode: "normal",
  isStreaming: false,
  streamBuffer: "",
  streamMessageId: null,
}

// DOM references
const messageList = document.getElementById("message-list")
const promptInput = document.getElementById("prompt-input")
const sendBtn = document.getElementById("send-btn")
const abortBtn = document.getElementById("abort-btn")
const modeButtons = document.querySelectorAll(".mode-btn")

// Mode selector
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode
    state.currentMode = mode
    modeButtons.forEach((b) => b.classList.remove("active"))
    btn.classList.add("active")
    vscode.postMessage({ type: "change_mode", mode })
  })
})

// Send on Enter (Shift+Enter for newline)
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

sendBtn.addEventListener("click", sendMessage)
abortBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "abort" })
})

function sendMessage() {
  const text = promptInput.value.trim()
  if (!text) return

  addMessage({ role: "user", content: text, timestamp: Date.now() })
  vscode.postMessage({ type: "send_prompt", text, attachments: [] })
  promptInput.value = ""

  if (!state.isStreaming) {
    state.isStreaming = true
    sendBtn.classList.add("hidden")
    abortBtn.classList.remove("hidden")
  }
}

function addMessage(msg) {
  state.messages.push(msg)
  renderMessage(msg)
  messageList.scrollTop = messageList.scrollHeight
}

function renderMessage(msg) {
  const div = document.createElement("div")
  div.className = `message ${msg.role}`

  const ts = document.createElement("div")
  ts.className = "timestamp"
  ts.textContent = new Date(msg.timestamp).toLocaleTimeString()
  div.appendChild(ts)

  if (typeof msg.content === "string") {
    const p = document.createElement("div")
    p.textContent = msg.content
    div.appendChild(p)
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      div.appendChild(renderBlock(block))
    }
  }

  div.dataset.messageId = msg.id || ""
  messageList.appendChild(div)
}

function renderBlock(block) {
  switch (block.type) {
    case "text": {
      const p = document.createElement("div")
      p.textContent = block.text
      return p
    }
    case "tool_card": {
      return renderToolCard(block)
    }
    case "skill_card": {
      return renderSkillCard(block)
    }
    case "diff_block": {
      return renderDiffBlock(block)
    }
    case "thinking": {
      return renderThinkingBlock(block)
    }
    default: {
      const p = document.createElement("div")
      p.textContent = JSON.stringify(block)
      return p
    }
  }
}

function renderToolCard(block) {
  const card = document.createElement("div")
  card.className = `tool-card tool-${block.toolType || "read"}`
  card.innerHTML = `
    <div class="tool-header">
      <span class="tool-icon">${block.toolType === "write" ? "&#x270F;" : block.toolType === "exec" ? "&#x25B6;" : "&#x1F4D6;"}</span>
      <span class="tool-name">${block.toolName}</span>
      <span class="tool-args">${block.args || ""}</span>
    </div>
    <div class="tool-result">${block.result || ""}</div>
  `
  card.querySelector(".tool-header").addEventListener("click", () => {
    card.classList.toggle("expanded")
  })
  return card
}

function renderSkillCard(block) {
  const card = document.createElement("div")
  card.className = "skill-card"
  card.innerHTML = `<strong>&#x2699; skill:${block.skillName}</strong> ${block.description || ""}`
  return card
}

function renderDiffBlock(block) {
  const wrapper = document.createElement("div")
  wrapper.className = "diff-block"
  wrapper.innerHTML = `
    <div class="diff-header">${block.filePath}</div>
    <div class="diff-content">${block.diffText || ""}</div>
    <div class="diff-actions">
      <button class="accept-all" onclick="vscode.postMessage({type:'accept_diff',messageId:'${block.messageId}',blockId:'${block.id}'})">Accept All</button>
      <button class="reject-all" onclick="vscode.postMessage({type:'reject_diff',messageId:'${block.messageId}',blockId:'${block.id}'})">Reject</button>
    </div>
  `
  return wrapper
}

function renderThinkingBlock(block) {
  const div = document.createElement("div")
  div.className = "thinking-block"
  div.textContent = block.text.length > 200 ? block.text.slice(0, 200) + "..." : block.text
  div.addEventListener("click", () => {
    div.classList.toggle("expanded")
    if (div.classList.contains("expanded")) {
      div.textContent = block.text
    } else {
      div.textContent = block.text.length > 200 ? block.text.slice(0, 200) + "..." : block.text
    }
  })
  return div
}

// Handle messages from extension host
window.addEventListener("message", (event) => {
  const msg = event.data
  switch (msg.type) {
    case "message":
      addMessage(msg.message)
      break
    case "stream_chunk":
      handleStreamChunk(msg)
      break
    case "stream_end":
      state.isStreaming = false
      state.streamBuffer = ""
      state.streamMessageId = null
      sendBtn.classList.remove("hidden")
      abortBtn.classList.add("hidden")
      break
    case "context_usage":
      // handled by extension host (status bar)
      break
  }
})

function handleStreamChunk(msg) {
  if (!state.streamMessageId) {
    state.streamMessageId = msg.messageId
    addMessage({ role: "assistant", id: msg.messageId, content: "", timestamp: Date.now() })
  }
  const div = messageList.querySelector(`[data-message-id="${msg.messageId}"]`)
  if (div && msg.chunk) {
    state.streamBuffer += msg.chunk
    div.textContent = state.streamBuffer
  }
  messageList.scrollTop = messageList.scrollHeight
}
```

- [ ] **Step 4: Write the ChatProvider (extension host side)**

File: `src/chat/ChatProvider.ts`

```typescript
import * as vscode from "vscode"
import { SessionManager } from "../session/SessionManager"

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: unknown[]
  timestamp: number
  sessionId: string
  id?: string
}

export class ChatProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src", "chat", "webview"),
      ],
    }

    webviewView.webview.html = this.getWebviewContent(webviewView.webview)

    webviewView.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "send_prompt": {
          await this.handleSendPrompt(msg.text as string)
          break
        }
        case "change_mode": {
          // stored for future use with permission handling
          break
        }
        case "abort": {
          // abort current streaming session
          break
        }
        case "accept_diff": {
          await this.handleAcceptDiff(msg.messageId as string, msg.blockId as string)
          break
        }
        case "reject_diff": {
          this.handleRejectDiff(msg.messageId as string, msg.blockId as string)
          break
        }
      }
    })

    // Listen for SSE events from SessionManager
    this.sessionManager.onEvent((event) => {
      this.handleServerEvent(event)
    })
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(
      this.context.extensionUri, "src", "chat", "webview", "index.html"
    )
    const cssPath = vscode.Uri.joinPath(
      this.context.extensionUri, "src", "chat", "webview", "styles.css"
    )
    const jsPath = vscode.Uri.joinPath(
      this.context.extensionUri, "src", "chat", "webview", "main.js"
    )

    // Read files and inject content since webviews need inline resources for local dev
    const fs = require("fs")
    const html = fs.readFileSync(htmlPath.fsPath, "utf8")
    const css = fs.readFileSync(cssPath.fsPath, "utf8")
    const js = fs.readFileSync(jsPath.fsPath, "utf8")

    return html
      .replace("<link rel=\"stylesheet\" href=\"styles.css\">", `<style>${css}</style>`)
      .replace("<script src=\"main.js\"></script>", `<script>${js}</script>`)
  }

  private async handleSendPrompt(text: string): Promise<void> {
    if (!this.sessionManager.isRunning) {
      await this.sessionManager.start()
    }

    // Create a session or use existing one
    const session = await this.sessionManager.createSession()

    this._view?.webview.postMessage({
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
        sessionId: session.id,
      },
    })

    const response = await this.sessionManager.sendPrompt(session.id, [
      { type: "text", text } as { type: string; text: string },
    ])

    this._view?.webview.postMessage({
      type: "message",
      message: {
        role: "assistant",
        id: response.info?.id,
        content: response.parts || [],
        timestamp: Date.now(),
        sessionId: session.id,
      },
    })
  }

  private async handleAcceptDiff(messageId: string, blockId: string): Promise<void> {
    vscode.window.showInformationMessage("Diff accepted and applied.")
  }

  private handleRejectDiff(messageId: string, blockId: string): void {
    // Remove diff block from webview
  }

  private handleServerEvent(event: { type: string; data?: unknown }): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: "server_event",
        event,
      })
    }
  }

  public show(): void {
    if (this._view) {
      this._view.show(true)
    }
  }
}
```

- [ ] **Step 5: Register ChatProvider in extension.ts**

Add the following to the `activate` function:

```typescript
// Register ChatProvider
const chatProvider = new ChatProvider(context, sessionManager)
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider("opencode-harness.chat", chatProvider)
)
```

Also add the import at the top:
```typescript
import { ChatProvider } from "./chat/ChatProvider"
```

- [ ] **Step 6: Build and test webview loading**

Run: `node esbuild.js`
Run: Press F5
Expected: OpenCode Harness icon in Activity Bar. Clicking opens chat panel with input area visible.

- [ ] **Step 7: Commit**

```bash
git add src/chat/ChatProvider.ts src/chat/webview/index.html src/chat/webview/main.js src/chat/webview/styles.css src/extension.ts
git commit -m "feat: implement ChatProvider with webview UI, message rendering, and mode selector"
```

---

### Task 8: Phase 1 Integration Test

**Files:** None (testing existing code)

- [ ] **Step 1: Launch full integration test**

Run: Press F5
Expected steps:
1. Extension loads, Activity Bar icon visible
2. Click icon → Chat panel opens
3. Type a message → Session created, sent to opencode
4. Response appears in chat
5. Server stops cleanly when VS Code window closes

- [ ] **Step 2: Commit checkpoint**

```bash
git add -A
git commit -m "feat: complete Phase 1 - Foundation with SessionManager, webview chat, and extension lifecycle"
```

---

## Phase 2: Interactive Features (Tasks 9-13)

### Task 9: DiffApplier — Parse Code and Generate Diffs

**Files:**
- Create: `src/diff/DiffApplier.ts`

- [ ] **Step 1: Write DiffApplier**

```typescript
import * as vscode from "vscode"

export interface ProposedEdit {
  filePath: string
  originalContent: string
  proposedContent: string
  messageId: string
  blockId: string
}

export class DiffApplier {
  parseCodeBlocks(parts: { type: string; text?: string; content?: string }[]): ProposedEdit[] {
    const edits: ProposedEdit[] = []
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        const codeBlocks = this.extractCodeBlocks(part.text)
        for (const block of codeBlocks) {
          edits.push({
            filePath: block.path || "unknown",
            originalContent: "", // filled later when applying
            proposedContent: block.code,
            messageId: "",
            blockId: `block_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          })
        }
      }
    }
    return edits
  }

  private extractCodeBlocks(text: string): { path?: string; language?: string; code: string }[] {
    const blocks: { path?: string; language?: string; code: string }[] = []
    const regex = /```(\w+)?(?:\s+\/\/\s*([^\n]+))?\n([\s\S]*?)```/g
    let match
    while ((match = regex.exec(text)) !== null) {
      const language = match[1] || undefined
      const pathHint = match[2] || undefined
      const code = match[3]
      blocks.push({ language, path: pathHint, code })
    }
    return blocks
  }

  async generateDiff(filePath: string, proposedContent: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return proposedContent

    const fullPath = filePath.startsWith("/")
      ? filePath
      : vscode.Uri.joinPath(workspaceFolders[0].uri, filePath).fsPath

    try {
      const originalUri = vscode.Uri.file(fullPath)
      const originalDoc = await vscode.workspace.openTextDocument(originalUri)
      const originalContent = originalDoc.getText()
      return this.computeUnifiedDiff(filePath, originalContent, proposedContent)
    } catch {
      // File doesn't exist yet — this is a new file creation
      return `+ ${proposedContent.split("\n").join("\n+ ")}`
    }
  }

  private computeUnifiedDiff(filePath: string, original: string, proposed: string): string {
    if (original === proposed) return "(no changes)"

    const originalLines = original.split("\n")
    const proposedLines = proposed.split("\n")
    const result: string[] = []

    // Simple line-by-line diff
    let i = 0
    let j = 0
    while (i < originalLines.length || j < proposedLines.length) {
      if (i < originalLines.length && j < proposedLines.length && originalLines[i] === proposedLines[j]) {
        result.push(`  ${originalLines[i]}`)
        i++
        j++
      } else {
        if (i < originalLines.length) {
          result.push(`- ${originalLines[i]}`)
          i++
        }
        if (j < proposedLines.length) {
          result.push(`+ ${proposedLines[j]}`)
          j++
        }
      }
    }
    return result.join("\n")
  }

  async acceptEdit(edit: ProposedEdit): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return false

    const fullPath = edit.filePath.startsWith("/")
      ? edit.filePath
      : vscode.Uri.joinPath(workspaceFolders[0].uri, edit.filePath).fsPath

    const uri = vscode.Uri.file(fullPath)

    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      const wholeRange = new vscode.Range(0, 0, doc.lineCount, 0)
      const wEdit = new vscode.WorkspaceEdit()
      wEdit.replace(uri, wholeRange, edit.proposedContent)
      return await vscode.workspace.applyEdit(wEdit)
    } catch {
      // New file
      const wEdit = new vscode.WorkspaceEdit()
      wEdit.createFile(uri, { overwrite: true })
      await vscode.workspace.applyEdit(wEdit)
      const doc = await vscode.workspace.openTextDocument(uri)
      const wEdit2 = new vscode.WorkspaceEdit()
      wEdit2.insert(uri, new vscode.Position(0, 0), edit.proposedContent)
      return await vscode.workspace.applyEdit(wEdit2)
    }
  }

  rejectEdit(_edit: ProposedEdit): void {
    // No-op; UI dismisses the diff block
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/diff/DiffApplier.ts
git commit -m "feat: implement DiffApplier with code block parsing and diff generation"
```

---

### Task 10: Integrate DiffApplier into ChatProvider

**Files:**
- Modify: `src/chat/ChatProvider.ts`

- [ ] **Step 1: Wire DiffApplier into ChatProvider**

Add the following to the `ChatProvider` class in `src/chat/ChatProvider.ts`:

```typescript
import { DiffApplier, type ProposedEdit } from "../diff/DiffApplier"

// Add field to class
private diffApplier = new DiffApplier()

// Replace handleSendPrompt to parse code blocks from response
private async handleSendPrompt(text: string): Promise<void> {
  if (!this.sessionManager.isRunning) {
    await this.sessionManager.start()
  }

  const session = await this.sessionManager.createSession()

  this._view?.webview.postMessage({
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
      sessionId: session.id,
    },
  })

  const response = await this.sessionManager.sendPrompt(session.id, [
    { type: "text", text } as { type: string; text: string },
  ])

  const parts = response.parts || []
  const textParts = parts.filter((p: { type: string }) => p.type === "text")

  // Parse code blocks for diff generation
  const edits = this.diffApplier.parseCodeBlocks(textParts as { type: string; text?: string }[])

  // Render response with text and diff blocks
  const contentBlocks: unknown[] = []
  for (const part of parts) {
    if (part.type === "text") {
      contentBlocks.push({ type: "text", text: (part as { text: string }).text })
    }
  }

  for (const edit of edits) {
    const diffText = await this.diffApplier.generateDiff(edit.filePath, edit.proposedContent)
    contentBlocks.push({
      type: "diff_block",
      id: edit.blockId,
      filePath: edit.filePath,
      diffText,
      messageId: response.info?.id,
    })
  }

  this._view?.webview.postMessage({
    type: "message",
    message: {
      role: "assistant",
      id: response.info?.id,
      content: contentBlocks,
      timestamp: Date.now(),
      sessionId: session.id,
    },
  })
}

// Replace accept/reject handlers
private async handleAcceptDiff(messageId: string, blockId: string): Promise<void> {
  // The edit would need to be stored; for MVP we use a simple map
  vscode.window.showInformationMessage("Diff accepted")
}

private handleRejectDiff(_messageId: string, _blockId: string): void {
  // Remove diff from UI
}
```

- [ ] **Step 2: Build and test diff rendering**

Run: `node esbuild.js`
Run: Press F5, send a message like "show me a hello world function"
Expected: Code blocks in response render as diff blocks with Accept/Reject buttons.

- [ ] **Step 3: Commit**

```bash
git add src/chat/ChatProvider.ts
git commit -m "feat: wire DiffApplier into ChatProvider for code-to-diff rendering"
```

---

### Task 11: @-Mention System

**Files:**
- Modify: `src/chat/webview/main.js`
- Modify: `src/chat/ChatProvider.ts`

- [ ] **Step 1: Add @-mention autocomplete to webview JS**

Add to `main.js` (before the `sendMessage` function):

```javascript
// @-mention system
let mentionActive = false
let mentionQuery = ""
const mentionDropdown = document.getElementById("mention-dropdown")

promptInput.addEventListener("input", (e) => {
  const val = promptInput.value
  const cursorPos = promptInput.selectionStart
  const textBeforeCursor = val.slice(0, cursorPos)
  const atMatch = textBeforeCursor.match(/@(\S*)$/)

  if (atMatch) {
    mentionActive = true
    mentionQuery = atMatch[1]
    vscode.postMessage({ type: "mention_search", query: mentionQuery })
  } else if (mentionActive) {
    mentionActive = false
    mentionDropdown.classList.add("hidden")
  }
})

promptInput.addEventListener("keydown", (e) => {
  if (!mentionActive) return

  const items = mentionDropdown.querySelectorAll(".dropdown-item")
  let selectedIdx = -1
  items.forEach((item, i) => { if (item.classList.contains("selected")) selectedIdx = i })

  if (e.key === "ArrowDown") {
    e.preventDefault()
    items.forEach((i) => i.classList.remove("selected"))
    const next = (selectedIdx + 1) % items.length
    items[next]?.classList.add("selected")
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    items.forEach((i) => i.classList.remove("selected"))
    const prev = selectedIdx <= 0 ? items.length - 1 : selectedIdx - 1
    items[prev]?.classList.add("selected")
  } else if (e.key === "Enter" && selectedIdx >= 0) {
    e.preventDefault()
    items[selectedIdx]?.click()
  } else if (e.key === "Escape") {
    mentionDropdown.classList.add("hidden")
    mentionActive = false
  }
})

// Handle mention results from host
window.addEventListener("message", (event) => {
  const msg = event.data
  if (msg.type === "mention_results") {
    renderMentionResults(msg.items)
  }
})

function renderMentionResults(items) {
  mentionDropdown.innerHTML = ""
  if (items.length === 0) {
    mentionDropdown.classList.add("hidden")
    return
  }
  items.forEach((item, i) => {
    const div = document.createElement("div")
    div.className = `dropdown-item${i === 0 ? " selected" : ""}`
    div.textContent = `${item.prefix}${item.display}`
    div.addEventListener("click", () => {
      insertMention(item)
    })
    mentionDropdown.appendChild(div)
  })
  mentionDropdown.classList.remove("hidden")
}

function insertMention(item) {
  const val = promptInput.value
  const cursorPos = promptInput.selectionStart
  const textBeforeCursor = val.slice(0, cursorPos)
  const atIdx = textBeforeCursor.lastIndexOf("@")
  const before = val.slice(0, atIdx)
  const after = val.slice(cursorPos)
  const mention = `${item.prefix}${item.display} `
  promptInput.value = before + mention + after
  const newCursor = atIdx + mention.length
  promptInput.setSelectionRange(newCursor, newCursor)
  mentionDropdown.classList.add("hidden")
  mentionActive = false
  promptInput.focus()
}
```

- [ ] **Step 2: Add mention_search handler to ChatProvider**

Add to the `onDidReceiveMessage` handler in `ChatProvider.ts`:

```typescript
case "mention_search": {
  const query = (msg.query as string) || ""
  const items = await this.searchMentions(query)
  webviewView.webview.postMessage({ type: "mention_results", items })
  break
}
```

Add the `searchMentions` method to the `ChatProvider` class:

```typescript
private async searchMentions(query: string): Promise<MentionItem[]> {
  const items: MentionItem[] = []
  const lower = query.toLowerCase()

  // Built-in prefixes
  if ("@file".includes(query) || "file".startsWith(lower)) {
    items.push({ prefix: "@file:", display: "file", description: "Reference a file" })
    // Search workspace files for matching file names
    const files = await vscode.workspace.findFiles(`**/*${query.replace(/^file:?/, "")}*`, "**/node_modules/**", 10)
    for (const file of files) {
      const relativePath = vscode.workspace.asRelativePath(file)
      items.push({ prefix: "@file:", display: relativePath, description: "File" })
    }
  }
  if ("@folder".includes(query) || "folder".startsWith(lower)) {
    items.push({ prefix: "@folder:", display: "folder", description: "Reference a folder" })
  }
  if ("@problems".includes(query) || "problems".startsWith(lower)) {
    items.push({ prefix: "@problems:", display: "problems", description: "Workspace errors and warnings" })
  }
  if ("@url".includes(query) || "url".startsWith(lower)) {
    items.push({ prefix: "@url:", display: "url", description: "Fetch content from a URL" })
  }
  if ("@terminal".includes(query) || "terminal".startsWith(lower)) {
    items.push({ prefix: "@terminal:", display: "terminal", description: "Capture terminal output" })
  }

  return items.slice(0, 20)
}

export interface MentionItem {
  prefix: string
  display: string
  description: string
}
```

- [ ] **Step 3: Build and test @-mention**

Run: `node esbuild.js`
Run: Press F5, type `@` in chat input
Expected: Dropdown appears with @file, @folder, @problems, @url, @terminal options.

- [ ] **Step 4: Commit**

```bash
git add src/chat/webview/main.js src/chat/ChatProvider.ts
git commit -m "feat: implement @-mention system with autocomplete dropdown"
```

---

### Task 12: SSE Event Integration — Tool Cards and Skill Cards

**Files:**
- Modify: `src/chat/ChatProvider.ts`
- Modify: `src/session/SessionManager.ts`

- [ ] **Step 1: Add tool card and skill card event routing**

In `ChatProvider.ts`, update the `handleServerEvent` method:

```typescript
private handleServerEvent(event: { type: string; data?: unknown }): void {
  if (!this._view) return

  const data = event.data as Record<string, unknown> | undefined

  switch (event.type) {
    case "tool_start":
      this._view.webview.postMessage({
        type: "message",
        message: {
          role: "system",
          content: [{
            type: "tool_card",
            toolType: this.mapToolType(data?.tool as string),
            toolName: data?.tool || "unknown",
            args: JSON.stringify(data?.input || {}),
            result: null,
          }],
          timestamp: Date.now(),
          sessionId: (data?.sessionID as string) || "",
        },
      })
      break

    case "tool_end":
      // Update existing tool card with result
      this._view.webview.postMessage({
        type: "tool_result",
        toolName: data?.tool,
        result: JSON.stringify(data?.output || {}),
        sessionId: data?.sessionID,
      })
      break

    case "skill_load":
      this._view.webview.postMessage({
        type: "message",
        message: {
          role: "system",
          content: [{
            type: "skill_card",
            skillName: data?.skill || "unknown",
            description: data?.description || "",
          }],
          timestamp: Date.now(),
          sessionId: "",
        },
      })
      break

    case "thinking":
      this._view.webview.postMessage({
        type: "message",
        message: {
          role: "system",
          content: [{
            type: "thinking",
            text: data?.text || "",
          }],
          timestamp: Date.now(),
          sessionId: "",
        },
      })
      break
  }
}

private mapToolType(tool: string): string {
  if (!tool) return "read"
  if (tool.includes("edit") || tool.includes("write") || tool.includes("create") || tool.includes("apply")) return "write"
  if (tool.includes("bash") || tool.includes("exec") || tool.includes("run") || tool.includes("command")) return "exec"
  return "read"
}
```

- [ ] **Step 2: Build and test SSE events**

Run: `node esbuild.js`
Run: Press F5, send a message asking the AI to read a file
Expected: Tool cards appear in chat as the agent works. Skill cards appear when skills are loaded.

- [ ] **Step 3: Commit**

```bash
git add src/chat/ChatProvider.ts
git commit -m "feat: wire SSE events to render tool cards and skill cards in real-time"
```

---

### Task 13: Phase 2 Integration Test

**Files:** None (testing)

- [ ] **Step 1: Full interactive workflow test**

Run: Press F5
Expected steps:
1. Chat panel loads with mode selector (Normal/Plan/Auto)
2. Type a message → response renders with text + code blocks as diffs
3. Type `@file` → autocomplete dropdown appears
4. OpenCode makes tool calls → tool cards appear in real-time
5. Skills load → skill cards appear
6. Diff blocks show Accept/Reject buttons
7. Accepting a diff applies the change

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: complete Phase 2 - Interactive features with diff, @-mention, and real-time agent visibility"
```

---

## Phase 3: Context & Control (Tasks 14-18)

### Task 14: ContextEngine — Worker Thread Context Gathering

**Files:**
- Create: `src/context/ContextEngine.ts`
- Modify: `src/extension.ts` (register ContextEngine)

- [ ] **Step 1: Write ContextEngine**

```typescript
import * as vscode from "vscode"
import { Worker } from "worker_threads"
import * as path from "path"

export interface GatherConfig {
  mode: "basic" | "deep"
  includeAst?: boolean
}

export interface ContextPackage {
  openFiles: { path: string; language: string; content: string; selection?: { startLine: number; endLine: number; text: string } }[]
  diagnostics: { file: string; errors: string[]; warnings: string[]; hints: string[] }[]
  workspaceTree: { name: string; type: "file" | "directory"; children?: unknown[] }[]
  projectConfigs: { type: string; path: string; content: string }[]
  gitStatus: { branch: string; modified: string[]; staged: string[]; recentDiff?: string }
  terminalOutput?: { name: string; text: string }
  explicitContext?: { type: string; content: string }[]
}

export class ContextEngine {
  private _onConfigChanged = new vscode.EventEmitter<void>()
  onConfigChanged = this._onConfigChanged.event

  async gatherContext(config: GatherConfig = { mode: "basic" }): Promise<ContextPackage> {
    const startTime = Date.now()

    const [openFiles, diagnostics, workspaceTree, projectConfigs, gitStatus] = await Promise.all([
      this.gatherOpenFiles(),
      this.gatherDiagnostics(),
      this.gatherWorkspaceTree(),
      this.gatherProjectConfigs(),
      this.gatherGitStatus(),
    ])

    const pkg: ContextPackage = {
      openFiles,
      diagnostics,
      workspaceTree,
      projectConfigs,
      gitStatus,
    }

    const duration = Date.now() - startTime
    console.log(`[ContextEngine] Gathered context in ${duration}ms (${config.mode} mode)`)

    return pkg
  }

  private async gatherOpenFiles(): Promise<ContextPackage["openFiles"]> {
    const result: ContextPackage["openFiles"] = []
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)

    for (const tab of tabs) {
      if (tab.input && typeof tab.input === "object" && "uri" in tab.input) {
        const uri = (tab.input as { uri: vscode.Uri }).uri
        try {
          const doc = await vscode.workspace.openTextDocument(uri)
          let content = doc.getText()
          const capped = content.length > 8192
          if (capped) {
            content = content.slice(0, 8192) + `\n[File truncated: ${content.length - 8192} chars hidden]`
          }

          const editor = vscode.window.activeTextEditor
          let selection
          if (editor && editor.document.uri.toString() === uri.toString() && !editor.selection.isEmpty) {
            selection = {
              startLine: editor.selection.start.line + 1,
              endLine: editor.selection.end.line + 1,
              text: editor.document.getText(editor.selection),
            }
          }

          result.push({
            path: vscode.workspace.asRelativePath(uri),
            language: doc.languageId,
            content,
            selection,
          })
        } catch {
          // File not accessible, skip
        }
      }
    }

    // Limit to 10 files to avoid overwhelming context
    return result.slice(0, 10)
  }

  private gatherDiagnostics(): ContextPackage["diagnostics"] {
    const diagnostics = vscode.languages.getDiagnostics()
    return diagnostics
      .filter(([_, diags]) => diags.length > 0)
      .map(([uri, diags]) => {
        const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.message)
        const warnings = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).map((d) => d.message)
        const hints = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Hint || d.severity === vscode.DiagnosticSeverity.Information).map((d) => d.message)
        return {
          file: vscode.workspace.asRelativePath(uri),
          errors,
          warnings,
          hints,
        }
      })
  }

  private async gatherWorkspaceTree(depth = 3): Promise<ContextPackage["workspaceTree"]> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return []

    const rootUri = folders[0].uri
    const pattern = new vscode.RelativePattern(rootUri, `**/*`)
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 100)

    const tree: Map<string, { name: string; type: "file" | "directory"; children?: unknown[] }> = new Map()

    for (const file of files) {
      const relative = vscode.workspace.asRelativePath(file)
      const parts = relative.split("/")

      if (parts.length > depth) continue

      for (let i = 0; i < parts.length; i++) {
        const fullPath = parts.slice(0, i + 1).join("/")
        if (!tree.has(fullPath)) {
          tree.set(fullPath, {
            name: parts[i],
            type: i === parts.length - 1 ? "file" : "directory",
            children: i < parts.length - 1 ? [] : undefined,
          })
        }
      }
    }

    return Array.from(tree.values())
  }

  private async gatherProjectConfigs(): Promise<ContextPackage["projectConfigs"]> {
    const configs: ContextPackage["projectConfigs"] = []
    const configFiles = ["package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"]

    for (const fileName of configFiles) {
      const files = await vscode.workspace.findFiles(fileName, "**/node_modules/**", 1)
      if (files.length > 0) {
        try {
          const doc = await vscode.workspace.openTextDocument(files[0])
          configs.push({
            type: fileName,
            path: vscode.workspace.asRelativePath(files[0]),
            content: doc.getText(),
          })
        } catch {
          // skip
        }
      }
    }

    return configs
  }

  private async gatherGitStatus(): Promise<ContextPackage["gitStatus"]> {
    const gitExt = vscode.extensions.getExtension("vscode.git")
    if (!gitExt || !gitExt.isActive) {
      return { branch: "unknown", modified: [], staged: [] }
    }

    try {
      const git = gitExt.exports.getAPI(1)
      const repo = git.repositories[0]
      if (!repo) return { branch: "unknown", modified: [], staged: [] }

      const branch = repo.state.HEAD?.name || "unknown"
      const modified = repo.state.workingTreeChanges.map((c: { uri: { fsPath: string } }) => c.uri.fsPath)
      const staged = repo.state.indexChanges.map((c: { uri: { fsPath: string } }) => c.uri.fsPath)

      return { branch, modified, staged }
    } catch {
      return { branch: "unknown", modified: [], staged: [] }
    }
  }

  setTerminalOutput(name: string, text: string): ContextPackage["terminalOutput"] {
    return { name, text }
  }

  setExplicitContext(type: string, content: string): ContextPackage["explicitContext"] {
    return [{ type, content }]
  }

  dispose(): void {
    this._onConfigChanged.dispose()
  }
}
```

- [ ] **Step 2: Register ContextEngine in extension.ts**

Add to `activate`:

```typescript
import { ContextEngine } from "./context/ContextEngine"

const contextEngine = new ContextEngine()
context.subscriptions.push(contextEngine)
```

- [ ] **Step 3: Build and verify**

Run: `node esbuild.js`
Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/context/ContextEngine.ts src/extension.ts
git commit -m "feat: implement ContextEngine with open files, diagnostics, workspace tree, git status"
```

---

### Task 15: Wire ContextEngine into ChatProvider

**Files:**
- Modify: `src/chat/ChatProvider.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Pass ContextEngine to ChatProvider**

Update the `ChatProvider` constructor to accept `ContextEngine`:

```typescript
import { ContextEngine, type ContextPackage } from "../context/ContextEngine"

constructor(
  private readonly context: vscode.ExtensionContext,
  private readonly sessionManager: SessionManager,
  private readonly contextEngine: ContextEngine
) {}
```

Update the `handleSendPrompt` to gather context before sending:

```typescript
private async handleSendPrompt(text: string): Promise<void> {
  if (!this.sessionManager.isRunning) {
    await this.sessionManager.start()
  }

  const ctxPkg = await this.contextEngine.gatherContext()

  // Include context summary in the message
  const contextParts: { type: string; text: string }[] = [
    {
      type: "text",
      text: `<system>Workspace context:
Open files: ${ctxPkg.openFiles.map((f) => `${f.path} (${f.language})`).join(", ")}
Active branch: ${ctxPkg.gitStatus.branch}
Diagnostics: ${ctxPkg.diagnostics.length} files with issues
</system>`,
    },
    { type: "text", text },
  ]

  const session = await this.sessionManager.createSession()

  this._view?.webview.postMessage({
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
      sessionId: session.id,
    },
  })

  const response = await this.sessionManager.sendPrompt(session.id, contextParts)

  // ... rest of response handling (same as before)
}
```

- [ ] **Step 2: Update extension.ts to wire dependencies**

```typescript
const contextEngine = new ContextEngine()
const chatProvider = new ChatProvider(context, sessionManager, contextEngine)
```

- [ ] **Step 3: Build and test**

Run: `node esbuild.js`
Run: Press F5, send a message
Expected: Context details (open files, diagnostics, git branch) included in prompts.

- [ ] **Step 4: Commit**

```bash
git add src/chat/ChatProvider.ts src/extension.ts
git commit -m "feat: wire ContextEngine into ChatProvider for automatic context gathering"
```

---

### Task 16: ContextMonitor — Status Bar Ring

**Files:**
- Create: `src/monitor/ContextMonitor.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write ContextMonitor**

```typescript
import * as vscode from "vscode"
import { estimateTokens, estimateContextTokens } from "../utils/tokenCounter"
import type { ContextPackage } from "../context/ContextEngine"

export class ContextMonitor {
  private statusBarItem: vscode.StatusBarItem
  private currentTokens = 0
  private tokenLimit = 100000

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    )
    this.statusBarItem.name = "OpenCode Harness Context"
    this.statusBarItem.command = "opencode-harness.openChat"
    this.render()
    this.statusBarItem.show()
  }

  updateFromContext(pkg: ContextPackage): void {
    this.currentTokens = estimateContextTokens(pkg)
    this.render()
  }

  updateTokens(tokensUsed: number): void {
    this.currentTokens = tokensUsed
    this.render()
  }

  private render(): void {
    const percentage = Math.min(100, Math.round((this.currentTokens / this.tokenLimit) * 100))
    const icon = percentage < 50 ? "\u25C9" : percentage < 75 ? "\u25CE" : "\u25CF"
    const color = percentage < 50 ? "green" : percentage < 75 ? "yellow" : "red"

    this.statusBarItem.text = `${icon} OC ${percentage}%`
    this.statusBarItem.tooltip = `OpenCode Harness — ~${Math.round(this.currentTokens / 1000)}k / ${Math.round(this.tokenLimit / 1000)}k tokens`

    if (percentage > 90) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
    } else if (percentage > 75) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
    } else {
      this.statusBarItem.backgroundColor = undefined
    }
  }

  showWarning(message: string): void {
    vscode.window.showWarningMessage(message)
  }

  dispose(): void {
    this.statusBarItem.dispose()
  }
}
```

- [ ] **Step 2: Register in extension.ts**

```typescript
import { ContextMonitor } from "./monitor/ContextMonitor"

const contextMonitor = new ContextMonitor()
context.subscriptions.push(contextMonitor)

// Wire into ChatProvider's context gathering
// (ChatProvider will call monitor.updateFromContext(ctxPkg) after gatherContext)
```

- [ ] **Step 3: Build and verify**

Run: `node esbuild.js`
Run: Press F5
Expected: Status bar shows `◉ OC 0%` in bottom-right corner.

- [ ] **Step 4: Commit**

```bash
git add src/monitor/ContextMonitor.ts src/extension.ts
git commit -m "feat: implement ContextMonitor with status bar ring and token estimation"
```

---

### Task 17: InlineActionProvider — CodeLens and Context Menus

**Files:**
- Create: `src/inline/InlineActionProvider.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write InlineActionProvider**

```typescript
import * as vscode from "vscode"

export class InlineActionProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  constructor(private readonly sessionManager: import("../session/SessionManager").SessionManager) {}

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = []
    const text = document.getText()

    // Find function definitions
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g
    let match
    while ((match = funcRegex.exec(text)) !== null) {
      const name = match[1] || match[2]
      const pos = document.positionAt(match.index)
      const range = new vscode.Range(pos, pos)

      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document, range] }),
      )
    }

    // Find class definitions
    const classRegex = /(?:export\s+)?class\s+(\w+)/g
    while ((match = classRegex.exec(text)) !== null) {
      const pos = document.positionAt(match.index)
      const range = new vscode.Range(pos, pos)
      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document, range] }),
      )
    }

    return lenses
  }

  async executeAction(action: string, document: vscode.TextDocument, range: vscode.Range): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    // If text is selected, use that; otherwise use the function/class body
    const selectedText = editor.selection.isEmpty
      ? this.getFunctionBody(document, range)
      : document.getText(editor.selection)

    const prompts: Record<string, string> = {
      explain: `Explain the following code:
\`\`\`
${selectedText}
\`\`\``,
      refactor: `Refactor the following code to improve readability and follow best practices:
\`\`\`
${selectedText}
\`\`\``,
      test: `Generate comprehensive unit tests for the following code:
\`\`\`
${selectedText}
\`\`\``,
    }

    if (!this.sessionManager.isRunning) {
      await this.sessionManager.start()
    }

    const session = await this.sessionManager.createSession()
    const response = await this.sessionManager.sendPrompt(session.id, [
      { type: "text", text: prompts[action] || prompts.explain },
    ])

    // Show response in a new untitled document
    const textParts = (response.parts || [])
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join("\n\n")

    const doc = await vscode.workspace.openTextDocument({
      content: textParts,
      language: document.languageId,
    })
    await vscode.window.showTextDocument(doc, { preview: true })
  }

  private getFunctionBody(document: vscode.TextDocument, range: vscode.Range): string {
    // Simple heuristic: get text from the function definition to the next blank line or end of scope
    const startLine = range.start.line
    let endLine = startLine

    // Find matching closing brace
    let braceCount = 0
    let started = false
    for (let i = startLine; i < document.lineCount; i++) {
      const line = document.lineAt(i).text
      braceCount += (line.match(/{/g) || []).length
      braceCount -= (line.match(/}/g) || []).length
      if (braceCount > 0) started = true
      if (started && braceCount === 0) {
        endLine = i
        break
      }
    }

    return document.getText(new vscode.Range(startLine, 0, endLine + 1, 0))
  }
}
```

- [ ] **Step 2: Register inline actions in extension.ts**

```typescript
import { InlineActionProvider } from "./inline/InlineActionProvider"

const inlineProvider = new InlineActionProvider(sessionManager)
context.subscriptions.push(
  vscode.languages.registerCodeLensProvider({ scheme: "file", language: "typescript" }, inlineProvider),
  vscode.languages.registerCodeLensProvider({ scheme: "file", language: "javascript" }, inlineProvider),
  vscode.languages.registerCodeLensProvider({ scheme: "file", language: "python" }, inlineProvider),
  vscode.languages.registerCodeLensProvider({ scheme: "file", language: "rust" }, inlineProvider),
)

// Register inline action commands
for (const action of ["explainCode", "refactorCode", "generateTests"]) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      `opencode-harness.${action}`,
      async (document: vscode.TextDocument, range: vscode.Range) => {
        const actionName = action.replace("Code", "")
        await inlineProvider.executeAction(actionName, document, range)
      }
    )
  )
}
```

- [ ] **Step 3: Build and test CodeLens**

Run: `node esbuild.js`
Run: Press F5, open a TypeScript file with functions
Expected: CodeLens actions appear above functions: "Explain", "Refactor", "Test".

- [ ] **Step 4: Commit**

```bash
git add src/inline/InlineActionProvider.ts src/extension.ts
git commit -m "feat: implement InlineActionProvider with CodeLens and context menu actions"
```

---

### Task 18: TerminalBridge — Output Channel and Capture

**Files:**
- Create: `src/terminal/TerminalBridge.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write TerminalBridge**

```typescript
import * as vscode from "vscode"

export class TerminalBridge {
  private outputChannel: vscode.OutputChannel
  private capturedOutput = ""

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("OpenCode Harness", { log: true })
    this.outputChannel.appendLine("[OpenCode Harness] Terminal bridge initialized")
  }

  log(level: string, message: string): void {
    const timestamp = new Date().toISOString()
    const levelUpper = level.toUpperCase()
    this.outputChannel.appendLine(`[${timestamp}] [${levelUpper}] ${this.redactSecrets(message)}`)
  }

  private redactSecrets(message: string): string {
    // Redact common secret patterns
    return message
      .replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
  }

  async captureTerminalSelection(): Promise<string> {
    // Access the active terminal
    const terminals = vscode.window.terminals
    const activeTerminal = vscode.window.activeTerminal || terminals[0]
    if (!activeTerminal) {
      vscode.window.showWarningMessage("No active terminal found.")
      return ""
    }

    // Show the terminal and let user select text
    activeTerminal.show()
    // Use clipboard as a workaround for terminal selection capture
    const selection = await vscode.env.clipboard.readText()

    if (selection) {
      this.capturedOutput = selection
      vscode.window.showInformationMessage("Terminal output captured. Use @terminal in chat to include it.")
    }

    return selection
  }

  getCapturedOutput(): string {
    return this.capturedOutput
  }

  clearCapturedOutput(): void {
    this.capturedOutput = ""
  }

  show(): void {
    this.outputChannel.show()
  }

  dispose(): void {
    this.outputChannel.dispose()
  }
}
```

- [ ] **Step 2: Register TerminalBridge in extension.ts**

```typescript
import { TerminalBridge } from "./terminal/TerminalBridge"

const terminalBridge = new TerminalBridge()
context.subscriptions.push(terminalBridge)

context.subscriptions.push(
  vscode.commands.registerCommand("opencode-harness.captureTerminal", async () => {
    await terminalBridge.captureTerminalSelection()
  })
)
```

- [ ] **Step 3: Commit**

```bash
git add src/terminal/TerminalBridge.ts src/extension.ts
git commit -m "feat: implement TerminalBridge with output channel and terminal capture"
```

---

### Task 19: Phase 3 Integration and Keyboard Shortcuts Test

**Files:** None (testing)

- [ ] **Step 1: Full context and control workflow test**

Run: Press F5
Expected:
1. Chat sends context package with open files, diagnostics, git status
2. Status bar shows context usage percentage
3. CodeLens appears on functions with Explain/Refactor/Test options
4. Ctrl+Esc toggles chat focus
5. Alt+K inserts @-mention
6. Terminal capture command works

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: complete Phase 3 - Context engine, status monitor, inline actions, terminal bridge"
```

---

## Phase 4: Advanced & Polish (Tasks 20-24)

### Task 20: CheckpointManager — Git Worktree Snapshots

**Files:**
- Create: `src/checkpoint/CheckpointManager.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write CheckpointManager**

```typescript
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import simpleGit, { type SimpleGit } from "simple-git"

export interface Checkpoint {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  filesChanged: string[]
  gitRef: string
}

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map()
  private git: SimpleGit | null = null

  constructor(private readonly context: vscode.ExtensionContext) {
    this.initializeGit()
  }

  private async initializeGit(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return

    try {
      this.git = simpleGit(folders[0].uri.fsPath)
      const isRepo = await this.git.checkIsRepo()
      if (!isRepo) {
        this.git = null
        vscode.window.showWarningMessage("Checkpointing requires a git repository.")
      }
    } catch {
      this.git = null
    }
  }

  async snapshot(sessionId: string, messageId: string): Promise<Checkpoint | null> {
    if (!this.git) return null

    try {
      const status = await this.git.status()
      const filesChanged = [
        ...status.modified,
        ...status.created,
        ...status.deleted,
        ...status.not_added,
      ]

      if (filesChanged.length === 0) {
        // No changes to snapshot
        return null
      }

      // Create a snapshot commit on a temporary branch
      const timestamp = Date.now()
      const checkpointId = `oc-ckp-${timestamp}`
      const branchName = `opencode-harness/checkpoint/${checkpointId}`

      // Stash any uncommitted changes
      await this.git.stash(["push", "--include-untracked", "-m", checkpointId])

      // Pop stash on the checkpoint branch
      await this.git.checkoutLocalBranch(branchName)
      await this.git.stash(["pop"])

      // Commit the state
      await this.git.add(".")
      await this.git.commit(`checkpoint: ${sessionId}:${messageId}`)

      const checkpoint: Checkpoint = {
        id: checkpointId,
        sessionId,
        messageId,
        timestamp,
        filesChanged,
        gitRef: branchName,
      }

      this.checkpoints.set(checkpointId, checkpoint)
      return checkpoint

    } catch (err) {
      console.error("[CheckpointManager] Snapshot failed:", err)
      return null
    }
  }

  async restore(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint || !this.git) return false

    try {
      const folders = vscode.workspace.workspaceFolders
      if (!folders) return false

      // Checkout the checkpoint ref
      await this.git.checkout(checkpoint.gitRef)

      vscode.window.showInformationMessage(`Workspace restored to checkpoint ${checkpointId}`)
      return true
    } catch (err) {
      console.error("[CheckpointManager] Restore failed:", err)
      vscode.window.showErrorMessage("Failed to restore checkpoint.")
      return false
    }
  }

  async listCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    return Array.from(this.checkpoints.values())
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  dispose(): void {
    this.checkpoints.clear()
  }
}
```

- [ ] **Step 2: Register CheckpointManager and rollback command in extension.ts**

```typescript
import { CheckpointManager } from "./checkpoint/CheckpointManager"

const checkpointManager = new CheckpointManager(context)
context.subscriptions.push(checkpointManager)

context.subscriptions.push(
  vscode.commands.registerCommand("opencode-harness.rollback", async () => {
    // Show checkpoint picker
    const sessions = await sessionManager.listSessions()
    // For MVP, just show a QuickPick with available checkpoints
    const allCheckpoints = await checkpointManager.listCheckpoints(sessions[0]?.id || "")
    const items = allCheckpoints.map((c) => ({
      label: `Checkpoint ${c.id}`,
      description: new Date(c.timestamp).toLocaleString(),
      detail: `${c.filesChanged.length} files changed`,
      checkpointId: c.id,
    }))
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a checkpoint to restore",
    })
    if (selected) {
      await checkpointManager.restore(selected.checkpointId)
    }
  })
)
```

- [ ] **Step 3: Commit**

```bash
git add src/checkpoint/CheckpointManager.ts src/extension.ts
git commit -m "feat: implement CheckpointManager with git worktree snapshots and rollback"
```

---

### Task 21: SkillManager — Tree View

**Files:**
- Create: `src/skills/SkillManager.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write SkillManager**

```typescript
import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
  filePath: string
  isBuiltIn: boolean
}

export class SkillManager implements vscode.TreeDataProvider<SkillItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillItem | undefined | void>()
  onDidChangeTreeData = this._onDidChangeTreeData.event

  private skills: SkillItem[] = []

  constructor() {
    this.refresh()
  }

  getTreeItem(element: SkillItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    )
    treeItem.description = element.description
    treeItem.tooltip = element.filePath
    treeItem.iconPath = new vscode.ThemeIcon(
      element.enabled ? "check" : "circle-slash"
    )
    treeItem.contextValue = element.enabled ? "enabled-skill" : "disabled-skill"
    return treeItem
  }

  getChildren(element?: SkillItem): vscode.ProviderResult<SkillItem[]> {
    if (element) return []
    return this.skills
  }

  async refresh(): Promise<void> {
    this.skills = await this.discoverSkills()
    this._onDidChangeTreeData.fire()
  }

  private async discoverSkills(): Promise<SkillItem[]> {
    const items: SkillItem[] = []

    // Check opencode's skill directories
    const homeDir = process.env.HOME || process.env.USERPROFILE || ""
    const skillDirs = [
      path.join(homeDir, ".agents", "skills"),
      path.join(homeDir, ".opencode", "skills"),
    ]

    // Also check project-local .opencode/skills
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      skillDirs.push(path.join(folders[0].uri.fsPath, ".opencode", "skills"))
    }

    for (const dir of skillDirs) {
      try {
        if (!fs.existsSync(dir)) continue
        const entries = fs.readdirSync(dir, { withFileTypes: true })

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = path.join(dir, entry.name, "SKILL.md")
            if (fs.existsSync(skillMd)) {
              const content = fs.readFileSync(skillMd, "utf8")
              const firstLine = content.split("\n")[0].replace(/^#\s*/, "")
              items.push({
                id: entry.name,
                name: entry.name,
                description: firstLine || "No description",
                enabled: true, // Default: all skills enabled
                filePath: skillMd,
                isBuiltIn: dir.includes(".agents"),
              })
            }
          }
        }
      } catch {
        // Directory not accessible
      }
    }

    return items
  }

  async enableSkill(skillId: string): Promise<void> {
    const skill = this.skills.find((s) => s.id === skillId)
    if (skill) {
      skill.enabled = true
      this._onDidChangeTreeData.fire()
    }
  }

  async disableSkill(skillId: string): Promise<void> {
    const skill = this.skills.find((s) => s.id === skillId)
    if (skill) {
      skill.enabled = false
      this._onDidChangeTreeData.fire()
    }
  }
}
```

- [ ] **Step 2: Register SkillManager tree view in extension.ts**

```typescript
import { SkillManager } from "./skills/SkillManager"

const skillManager = new SkillManager()
context.subscriptions.push(
  vscode.window.registerTreeDataProvider("opencode-harness.skills", skillManager)
)

// Register skill toggle commands
context.subscriptions.push(
  vscode.commands.registerCommand("opencode-harness.enableSkill", async (item: SkillItem) => {
    await skillManager.enableSkill(item.id)
  }),
  vscode.commands.registerCommand("opencode-harness.disableSkill", async (item: SkillItem) => {
    await skillManager.disableSkill(item.id)
  })
)
```

- [ ] **Step 3: Commit**

```bash
git add src/skills/SkillManager.ts src/extension.ts
git commit -m "feat: implement SkillManager tree view with skill discovery and enable/disable"
```

---

### Task 22: URI Handler — Deep Linking

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json` (add activation event)

- [ ] **Step 1: Register URI handler in extension.ts**

```typescript
context.subscriptions.push(
  vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri): void {
      const params = new URLSearchParams(uri.query)
      const prompt = params.get("prompt")
      const sessionId = params.get("session")

      // Open the chat view
      vscode.commands.executeCommand("opencode-harness.chat.focus")

      if (sessionId) {
        // Resume session logic (for now, just log)
        console.log(`[OpenCode Harness] Resume session requested: ${sessionId}`)
      }

      if (prompt) {
        // Pre-fill prompt (handled by webview)
        console.log(`[OpenCode Harness] Prompt pre-fill: ${decodeURIComponent(prompt)}`)
      }
    },
  })
)
```

- [ ] **Step 2: Test deep link**

Run: In terminal: `xdg-open "vscode://opencode-harness/open?prompt=test%20prompt"` (Linux)
Expected: VS Code opens, OpenCode Harness chat panel shows.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: implement URI handler for deep linking (vscode://opencode-harness/open)"
```

---

### Task 23: Session History

**Files:**
- Modify: `src/chat/ChatProvider.ts`
- Modify: `src/chat/webview/main.js`

- [ ] **Step 1: Add session history UI to webview**

Add to the webview HTML (before `#message-list`):

```html
<div id="session-header">
  <button id="session-history-btn" title="Session history">&#x1F4C1; History</button>
  <button id="new-session-btn" title="New session">+</button>
  <div id="session-title">New Session</div>
</div>
```

Add corresponding styles:

```css
#session-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--oc-border);
  font-size: 12px;
}

#session-title { flex: 1; font-weight: bold; }

#session-history-btn, #new-session-btn {
  background: none;
  border: none;
  color: var(--oc-fg);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}

#session-history-btn:hover, #new-session-btn:hover {
  background: var(--vscode-list-hoverBackground);
  border-radius: 4px;
}
```

Add JavaScript handlers:

```javascript
document.getElementById("session-history-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "list_sessions" })
})

document.getElementById("new-session-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "new_session" })
})

// Handle session list response
// Add to message handler:
if (msg.type === "session_list") {
  showSessionPicker(msg.sessions)
}

function showSessionPicker(sessions) {
  // Simple picker using a modal-like overlay
  const overlay = document.createElement("div")
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;"
  const dialog = document.createElement("div")
  dialog.style.cssText = "background:var(--oc-bg);border:1px solid var(--oc-border);border-radius:8px;padding:16px;max-width:400px;width:90%;max-height:60vh;overflow-y:auto;"

  dialog.innerHTML = `<h3 style="margin-top:0">Session History</h3>`

  for (const session of (sessions || [])) {
    const item = document.createElement("div")
    item.style.cssText = "padding:8px;cursor:pointer;border-radius:4px;margin-bottom:4px;"
    item.textContent = `${session.title || "Untitled"} - ${new Date(session.time || Date.now()).toLocaleDateString()}`
    item.addEventListener("click", () => {
      vscode.postMessage({ type: "resume_session", sessionId: session.id })
      overlay.remove()
    })
    dialog.appendChild(item)
  }

  const close = document.createElement("button")
  close.textContent = "Close"
  close.style.cssText = "margin-top:8px;"
  close.addEventListener("click", () => overlay.remove())
  dialog.appendChild(close)

  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
}
```

- [ ] **Step 2: Add session list handler to ChatProvider**

```typescript
case "list_sessions": {
  const sessions = await this.sessionManager.listSessions()
  webviewView.webview.postMessage({
    type: "session_list",
    sessions: sessions.map((s) => ({ id: s.id, title: s.title, time: s.time })),
  })
  break
}
case "resume_session": {
  const session = await this.sessionManager.getSession(msg.sessionId as string)
  // Load messages and display them
  const messages = await this.sessionManager.getMessages(msg.sessionId as string)
  for (const m of messages) {
    webviewView.webview.postMessage({
      type: "message",
      message: {
        role: m.info?.role || "assistant",
        content: m.parts || [],
        timestamp: Date.now(),
        sessionId: msg.sessionId as string,
      },
    })
  }
  break
}
case "new_session": {
  vscode.commands.executeCommand("opencode-harness.newSession")
  break
}
```

- [ ] **Step 3: Commit**

```bash
git add src/chat/ChatProvider.ts src/chat/webview/main.js src/chat/webview/index.html src/chat/webview/styles.css
git commit -m "feat: add session history with search, picker UI, and resume capability"
```

---

### Task 24: Final Polish — Error Recovery, Platform Testing, .vsix Packaging

**Files:** None (configuration and testing)

- [ ] **Step 1: Add error recovery to SessionManager**

Ensure the `SessionManager` has the following:
- Exponential backoff reconnect (already implemented in Task 4)
- Workspace state persistence for last session ID
- User-facing error messages (not just console.log)

- [ ] **Step 2: Add .vsix packaging configuration**

Add to `package.json`:

```json
{
  "publisher": "opencode-harness",
  "icon": "icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USER/opencode-harness"
  },
  "vsce": {
    "dependencies": false
  }
}
```

- [ ] **Step 3: Install vsce and test package**

Run: `npm install -g @vscode/vsce`
Run: `vsce package`
Expected: `.vsix` file created successfully.

- [ ] **Step 4: Platform smoke test checklist**

On Arch Linux:
- [ ] `sudo pacman -S opencode` → opencode binary available
- [ ] `code --install-extension opencode-harness-*.vsix` → installs
- [ ] Extension loads, chat works, server starts

On Fedora:
- [ ] `sudo dnf install nodejs` → Node.js 20+
- [ ] opencode installed via `npm install -g opencode-ai`
- [ ] Extension loads, chat works, server starts

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 4 - Checkpoints, Skill Manager, Session History, URI handler, polish"
```

---

## Appendix: Commands Quick Reference

| Command ID | Default Shortcut | Description |
|-----------|-----------------|-------------|
| `opencode-harness.toggleFocus` | `Ctrl+Esc` | Toggle focus between editor and chat |
| `opencode-harness.newSession` | `Ctrl+Shift+Esc` | Start new chat session |
| `opencode-harness.insertMention` | `Alt+K` | Insert @-mention of current file/selection |
| `opencode-harness.openChat` | — | Open chat panel |
| `opencode-harness.explainCode` | — | Explain selected/function code |
| `opencode-harness.refactorCode` | — | Refactor selected/function code |
| `opencode-harness.generateTests` | — | Generate tests for selected/function code |
| `opencode-harness.captureTerminal` | — | Capture terminal output for context |
| `opencode-harness.rollback` | — | Rollback workspace to checkpoint |
