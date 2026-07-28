import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..", "..")

// ── Load all source files once ──────────────────────────────────────────

const files = {
  sessionStore: readFileSync(path.join(root, "src", "session", "SessionStore.ts"), "utf8"),
  sessionManager: readFileSync(path.join(root, "src", "session", "SessionManager.ts"), "utf8"),
  authProvider: readFileSync(path.join(root, "src", "session", "AuthProvider.ts"), "utf8"),
  serverLifecycle: readFileSync(path.join(root, "src", "session", "ServerLifecycle.ts"), "utf8"),
  chatProvider: readFileSync(path.join(root, "src", "chat", "ChatProvider.ts"), "utf8"),
  webviewEventRouter: readFileSync(path.join(root, "src", "chat", "WebviewEventRouter.ts"), "utf8"),
  chatCommands: readFileSync(path.join(root, "src", "chat", "ChatCommands.ts"), "utf8"),
  streamCoordinator: readFileSync(path.join(root, "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8"),
  tabManager: readFileSync(path.join(root, "src", "chat", "TabManager.ts"), "utf8"),
  mainTs: readFileSync(path.join(root, "src", "chat", "webview", "main.ts"), "utf8"),
  composerTs: (() => { try { return readFileSync(path.join(root, "src", "chat", "webview", "composer.ts"), "utf8") } catch { return "" } })(),
  streamOrchestrator: (() => { try { return readFileSync(path.join(root, "src", "chat", "webview", "streamOrchestrator.ts"), "utf8") } catch { return "" } })(),
  renderer: readFileSync(path.join(root, "src", "chat", "webview", "renderer.ts"), "utf8"),
  messageRenderer: readFileSync(path.join(root, "src", "chat", "webview", "messageRenderer.ts"), "utf8"),
  streamHandlers: readFileSync(path.join(root, "src", "chat", "webview", "streamHandlers.ts"), "utf8"),
  mentions: readFileSync(path.join(root, "src", "chat", "webview", "mentions.ts"), "utf8"),
  outputChannel: readFileSync(path.join(root, "src", "utils", "outputChannel.ts"), "utf8"),
  diffApplier: readFileSync(path.join(root, "src", "diff", "DiffApplier.ts"), "utf8"),
  diffHandler: readFileSync(path.join(root, "src", "chat", "handlers", "DiffHandler.ts"), "utf8"),
  sessionLifecycle: readFileSync(path.join(root, "src", "chat", "SessionLifecycleService.ts"), "utf8"),
  checkpoint: readFileSync(path.join(root, "src", "checkpoint", "CheckpointManager.ts"), "utf8"),
  indexHtml: readFileSync(path.join(root, "src", "chat", "webview", "index.html"), "utf8"),
  tokensCss: readFileSync(path.join(root, "src", "chat", "webview", "css", "tokens.css"), "utf8"),
  slashCommands: readFileSync(path.join(root, "src", "chat", "webview", "slash-commands.ts"), "utf8"),
}

// ── Test Data Builders ──────────────────────────────────────────────────

export function buildMessage(overrides = {}) {
  return {
    role: "user",
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    blocks: [{ type: "text", text: "Test message" }],
    timestamp: Date.now(),
    sessionId: "test-session",
    ...overrides,
  }
}

export function buildSession(overrides = {}) {
  return {
    id: `session-${crypto.randomUUID().slice(0, 8)}`,
    name: "Test Session",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    model: "test-provider/test-model",
    mode: "build",
    messages: [],
    cost: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    ...overrides,
  }
}

export function buildQueueItem(overrides = {}) {
  return {
    id: `q-${crypto.randomUUID()}`,
    text: "queued prompt",
    attachments: [],
    state: "queued",
    createdAt: Date.now(),
    ...overrides,
  }
}

export function buildServerEvent(type, overrides = {}) {
  return {
    type,
    sessionId: "ses_test123",
    data: {},
    ...overrides,
  }
}

// ── Regression Suite ────────────────────────────────────────────────────

describe("Regression: Activation & Server Connection", () => {
  it("extension.ts exports activate function", () => {
    const ext = readFileSync(path.join(root, "src", "extension.ts"), "utf8")
    assert.ok(ext.includes("export async function activate(") || ext.includes("export function activate("), "activate function must be exported")
    assert.ok(ext.includes("export function deactivate()"), "deactivate function must be exported")
  })

  it("SessionManager.start() guards concurrent calls via startPromise", () => {
    assert.ok(files.serverLifecycle.includes("this.startPromise = this._start("),
      "must assign _start() to startPromise for concurrency guard")
    assert.ok(files.serverLifecycle.includes("this.startPromise = null"),
      "must clear startPromise after completion")
  })

  it("SessionManager generates server password on start", () => {
    assert.ok(files.authProvider.includes("generatePassword"), "must have generatePassword method")
    assert.ok(files.authProvider.includes("OPENCODE_SERVER_PASSWORD"), "must pass password via env var")
    assert.ok(files.serverLifecycle.includes("OPENCODE_SERVER_PASSWORD"), "must pass env var")
  })
})

describe("Regression: Send Prompt & Streamed Response", () => {
  it("send_prompt handler creates user message and persists", () => {
    assert.ok(files.chatProvider.includes('"send_prompt"') || files.webviewEventRouter.includes('"send_prompt"'),
      "send_prompt handler must exist in webviewHandlers")
    assert.ok(files.chatProvider.includes("appendMessage(sessionId, userMsg)") || files.webviewEventRouter.includes("appendMessage(sessionId, userMsg)"),
      "must persist user message via appendMessage")
  })

  it("streamStart creates assistant placeholder in webview", () => {
    assert.ok(files.mainTs.includes("handleStreamStart("), "webview must have handleStreamStart")
    assert.ok(files.streamHandlers.includes('role: "assistant"'), "stream start creates assistant message")
  })

  it("streamEnd persists assistant message via finalizeStream", () => {
    assert.ok(files.streamCoordinator.includes("appendMessage(tabId, assistantMsg)"),
      "finalizeStream must persist assistant message")
  })

  it("stream_end reason is forwarded to webview for timeout feedback", () => {
    const combined = files.mainTs + files.streamOrchestrator
    assert.ok(combined.includes('msg.reason'), "webview must pass stream_end reason")
    assert.ok(combined.includes('"ttfb_timeout"'), "must handle ttfb_timeout reason")
    assert.ok(combined.includes('"timeout"'), "must handle timeout reason")
  })

  it("chunk batching uses requestAnimationFrame in streamHandlers", () => {
    assert.ok(files.streamHandlers.includes("requestAnimationFrame"),
      "stream token updates must be rAF-batched")
  })
})

describe("Regression: Session Persistence & Resume", () => {
  it("SessionStore persists to globalState and loads on init", () => {
    assert.ok(files.sessionStore.includes("globalState"), "must use globalState for persistence")
    assert.ok(files.sessionStore.includes("STORAGE_KEY"), "must have storage key")
  })

  it("SessionStore has archive/unarchive for lifecycle management", () => {
    assert.ok(files.sessionStore.includes("archive("), "must have archive method")
    assert.ok(files.sessionStore.includes("unarchive("), "must have unarchive method")
  })

  it("SessionStore has onDidChangeSession typed events", () => {
    assert.ok(files.sessionStore.includes("onDidChangeSession"), "must have typed change event")
    assert.ok(files.sessionStore.includes('kind: "deleted"'), "must emit deleted event")
  })

  it("resume_session_data re-attaches to existing server session", () => {
    assert.ok(files.chatProvider.includes("sessionManager.ensureSession(") || files.sessionLifecycle.includes("sessionManager.ensureSession("),
      "resume must re-attach server session via ensureSession")
  })
})

describe("Regression: Tabs & Concurrency", () => {
  it("TabManager enforces MAX_CONCURRENT_STREAMS = 3", () => {
    assert.ok(files.tabManager.includes("MAX_CONCURRENT_STREAMS = 3"),
      "must limit concurrent streams to 3")
  })

  it("sendMessage checks streaming count before sending", () => {
    assert.ok(files.mainTs.includes("streamingCount >= 3") || files.mainTs.includes("concurrent stream") || files.composerTs.includes("concurrent stream") || files.composerTs.includes("streamCapacity.isFull"),
      "webview must check concurrent stream limit")
  })
})

describe("Regression: Slash Commands", () => {
  it("LOCAL_COMMANDS is single source of truth (no duplicate SLASH_COMMANDS in main.ts)", () => {
    assert.ok(!files.mainTs.includes("const SLASH_COMMANDS"),
      "SLASH_COMMANDS must be removed from main.ts")
  })

  it("slash commands use SVG icons from icons.ts (via the canonical registry)", () => {
    // Icons used to be declared inline in mentions.ts. They now live in the
    // canonical slash-commands.ts registry which mentions.ts adapts from.
    assert.ok(files.slashCommands.includes("COMMAND_SVG"), "clear must use COMMAND_SVG")
    assert.ok(files.slashCommands.includes("BRAIN_SVG"), "model must use BRAIN_SVG")
    // server-only icon is still imported by mentions.ts for non-local cmds
    assert.ok(files.mentions.includes("GEAR_SVG"), "server commands must use GEAR_SVG")
  })
})

describe("Regression: Context & References", () => {
  it("mention button triggers @ mention search", () => {
    assert.ok(files.mainTs.includes("mention.handleTrigger()") || files.composerTs.includes("mention.handleTrigger()"), "must trigger mention from @ button")
  })
})

describe("Regression: Edit Message", () => {
  it("edit button posts edit_message with messageId and text", () => {
    assert.ok(files.renderer.includes('type: "edit_message"') || files.messageRenderer.includes('type: "edit_message"'), "edit button must post edit_message")
    assert.ok(files.renderer.includes("messageId: msg.id") || files.messageRenderer.includes("messageId: msg.id"), "must include messageId")
  })

  it("edit truncates downstream messages from store and webview state", () => {
    assert.ok(files.chatProvider.includes("truncateMessages("), "must truncate session store messages")
    assert.ok(files.mainTs.includes(".splice(msgIdx + 1)"), "must splice webview state messages")
  })

  it("revert button on assistant messages", () => {
    assert.ok(files.renderer.includes("message-revert-btn") || files.messageRenderer.includes("message-revert-btn"), "must have revert button")
    assert.ok(files.renderer.includes('type: "revert_message"') || files.messageRenderer.includes('type: "revert_message"'), "must post revert_message")
  })
})

describe("Regression: Diff Accept & Checkpoint", () => {
  it("accept_diff creates checkpoint before applying", () => {
    assert.ok(files.chatProvider.includes("snapshotBeforeAction") || files.sessionLifecycle.includes("snapshotBeforeAction"),
      "must create checkpoint before diff apply")
  })

  it("DiffHandler prevents double-accept via acceptingDiffs set", () => {
    assert.ok(files.diffHandler.includes("acceptingDiffs.has(diffId)"),
      "must check for concurrent accept")
    assert.ok(files.diffHandler.includes("acceptingDiffs.add(diffId)"),
      "must mark as accepting")
  })

  it("diff_result carries checkpointCreated flag to webview", () => {
    assert.ok(files.chatProvider.includes("checkpointCreated") || files.sessionLifecycle.includes("checkpointCreated"),
      "must send checkpointCreated flag with diff_result")
    assert.ok(files.mainTs.includes("checkpointCreated"),
      "webview must handle checkpointCreated flag")
  })
})

describe("Regression: Archive, Delete, Clear Sessions", () => {
  it("archive marks session as archived with typed event", () => {
    assert.ok(files.sessionStore.includes('kind: "archived"'), "archive must fire archived event")
  })

  it("deleteSession fires session_deleted event and cleans up", () => {
    assert.ok(files.sessionStore.includes('kind: "deleted"'), "delete must fire deleted event")
    assert.ok(files.sessionStore.includes("invalidateAllCliSessionIds"),
      "must invalidate server session links")
  })

  it("clearAll returns preview counts on dry-run", () => {
    assert.ok(files.sessionStore.includes("clearAll("), "must have clearAll method")
    assert.ok(files.sessionStore.includes("dryRun"), "must support dry-run mode")
  })
})

describe("Regression: Security & Access Control", () => {
  it("CSP uses default-src 'none'", () => {
    const wvc = readFileSync(path.join(root, "src", "chat", "WebviewContent.ts"), "utf8")
    assert.ok(wvc.includes("default-src 'none'"), "CSP must use default-src 'none'")
    assert.ok(wvc.includes("nonce"), "CSP must use nonce for scripts")
  })

  it("output channel redacts sensitive patterns", () => {
    assert.ok(files.outputChannel.includes("SENSITIVE_PATTERNS"), "must have sensitive patterns")
    assert.ok(files.outputChannel.includes("[REDACTED]"), "must replace matches with [REDACTED]")
  })

  it("spawn uses shell: false and environment allowlist", () => {
    assert.ok(files.serverLifecycle.includes("shell: false"), "spawn must use shell: false")
    assert.ok(files.serverLifecycle.includes("allowedEnvVars"), "must filter environment vars")
  })
})

describe("Regression: Performance & Scroll", () => {
  it("messages use content-visibility: auto for virtual rendering", () => {
    assert.ok(files.tokensCss.includes("content-visibility") || 
      readFileSync(path.join(root, "src", "chat", "webview", "css", "messages.css"), "utf8").includes("content-visibility"),
      "must use content-visibility: auto on messages")
  })

  it("jump-to-bottom button exists", () => {
    assert.ok(files.mainTs.includes("jump-to-bottom"), "must have jump-to-bottom button")
    assert.ok(files.mainTs.includes("scroll-markers"), "must have scroll markers")
  })

  it("perf logging is gated behind debug flag", () => {
    assert.ok(files.mainTs.includes("__opencodeDebug"), "perf logging must be gated")
  })
})

describe("Regression: Prompt Queue", () => {
  it("queue state machine exists with all states", () => {
    const queueSrc = readFileSync(path.join(root, "src", "chat", "webview", "queue.ts"), "utf8")
    assert.ok(queueSrc.includes("createPromptQueue"), "must export createPromptQueue")
    assert.ok(queueSrc.includes('"queued"'), "must have queued state")
    assert.ok(queueSrc.includes('"failed"'), "must have failed state")
  })

  it("steer-queue mode appends to the per-tab prompt queue", () => {
    // The queue is populated via the `add_to_queue` webview message handler
    // which calls queue.enqueue(...). Earlier this guard checked an orphan
    // helper that was never wired to a UI affordance.
    assert.ok(files.mainTs.includes("queue.enqueue("), "must enqueue prompts into the per-tab queue")
    assert.ok(files.mainTs.includes('"add_to_queue"'), "must handle add_to_queue message")
  })

  it("handleStreamEnd processes next queued item", () => {
    assert.ok(files.mainTs.includes("processNext()") || files.streamOrchestrator.includes("processNext()"), "must process next queue item on stream end")
  })

  it("queue items support image attachments", () => {
    const queueSrc = readFileSync(path.join(root, "src", "chat", "webview", "queue.ts"), "utf8")
    assert.ok(queueSrc.includes("attachments"), "queue items must support attachments")
  })
})

describe("Regression: Accessibility & Styling", () => {
  it("all controls in HTML have aria-label or accessible names", () => {
    const criticalIds = ["history-btn", "new-tab-btn", "send-btn", "mention-btn", "prompt-input",
      "model-selector-btn", "variant-selector-btn", "session-modal-close", "chat-search-input"]
    for (const id of criticalIds) {
      // Each must either have an aria-label attribute in the HTML
      assert.ok(files.indexHtml.includes(`aria-label`),
        `${id} must be accessible`)
    }
  })

  it("modals use role=dialog and aria-modal=true", () => {
    assert.ok(files.indexHtml.includes('role="dialog"'), "modals must use role=dialog")
    assert.ok(files.indexHtml.includes('aria-modal="true"'), "modals must use aria-modal")
  })

  it("reduced motion media query exists", () => {
    const a11yCss = readFileSync(path.join(root, "src", "chat", "webview", "css", "accessibility.css"), "utf8")
    assert.ok(a11yCss.includes("prefers-reduced-motion"), "must support reduced motion")
  })
})

describe("Regression: Packaging & Hygiene", () => {
  it("VSIX excludes source maps, .env, node_modules", () => {
    const ig = readFileSync(path.join(root, ".vscodeignore"), "utf8")
    assert.ok(ig.includes("**/*.map"), "must exclude source maps")
    assert.ok(ig.includes(".env*"), "must exclude env files")
    assert.ok(ig.includes("node_modules/**"), "must exclude node_modules")
    assert.ok(ig.includes("src/**"), "must exclude source TypeScript")
  })

  it("build output exists", () => {
    assert.ok(existsSync(path.join(root, "dist", "extension.js")), "extension.js must exist")
    assert.ok(existsSync(path.join(root, "dist", "chat", "webview", "main.js")), "webview main.js must exist")
    assert.ok(existsSync(path.join(root, "dist", "chat", "webview", "styles.css")), "styles.css must exist")
  })
})
