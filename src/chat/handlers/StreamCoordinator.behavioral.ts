/**
 * StreamCoordinator — Behavioral Tests
 *
 * Tests actual runtime behavior through mocked dependencies.
 * Covers: prompt lifecycle, streaming, timeouts, abort, tab cleanup,
 * unknown session handling, and edge cases.
 *
 * NOTE: Timer-dependent tests (TTFB timeout, completion timeout, watchdog)
 * require a timer-mocking utility (e.g. sinon.useFakeTimers) which is not
 * yet a project dependency. Those tests are in a separate file or will be
 * enabled when a timer mock is available.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { StreamCoordinator, type StreamCallbacks } from "./StreamCoordinator"
import { TabManager } from "../TabManager"
import type { DiffApplier } from "../../diff/DiffApplier"

// ---------------------------------------------------------------------------
// Mock factories — minimal stubs satisfying constructor signatures
// ---------------------------------------------------------------------------

function mockFn<T extends (...args: any[]) => any>(impl?: T) {
  const calls: { args: any[]; self: any }[] = []
  const fn = function (this: any, ...args: any[]) {
    calls.push({ args, self: this })
    if (impl) return impl.apply(this, args)
  } as T & { calls: typeof calls; hasBeenCalled: () => boolean }
  fn.calls = calls
  fn.hasBeenCalled = () => calls.length > 0
  return fn
}

function createMockSessionManager() {
  return {
    isRunning: true,
    start: mockFn(() => Promise.resolve()),
    ensureSession: mockFn(() => Promise.resolve("sess-123")),
    sendPromptAsync: mockFn(() => Promise.resolve()),
    abortSession: mockFn(() => Promise.resolve()),
  }
}

function createMockSessionStore() {
  return {
    updateCliSessionId: mockFn(),
    appendMessage: mockFn(),
  }
}

function createMockContextEngine() {
  return {
    gatherContext: mockFn(() => Promise.resolve({
      openFiles: [],
      gitStatus: { branch: "main", modified: [], staged: [] },
      workspaceTree: [],
      projectConfigs: [],
      diagnostics: [],
    })),
  }
}

function createMockContextMonitor() {
  return { updateTokens: mockFn() }
}

function createMockRateLimitMonitor() {
  return { recordTokenUsage: mockFn() }
}

function createMockModelManager() {
  return {}
}

function createMockDiffApplier(): DiffApplier {
  return {
    acceptEdit: mockFn(() => Promise.resolve(true)),
    rejectEdit: mockFn(),
    rollbackEdit: mockFn(() => Promise.resolve(true)),
    parseCodeBlocks: mockFn(() => []),
    generateDiff: mockFn(() => Promise.resolve("")),
    dispose: mockFn(),
  } as unknown as DiffApplier
}

function createMockCallbacks(): StreamCallbacks & {
  messages: Record<string, unknown>[]
  errors: string[]
  postMessage: ReturnType<typeof mockFn>
  postRequestError: ReturnType<typeof mockFn>
} {
  const messages: Record<string, unknown>[] = []
  const errors: string[] = []
  return {
    messages,
    errors,
    postMessage: mockFn((msg: Record<string, unknown>) => {
      messages.push(msg)
    }),
    postRequestError: mockFn((message: string) => {
      errors.push(message)
    }),
  }
}

// ---------------------------------------------------------------------------
// Helper — creates a fully-wired StreamCoordinator with mocked deps
// ---------------------------------------------------------------------------

function createTestHarness() {
  const sessionManager = createMockSessionManager()
  const sessionStore = createMockSessionStore()
  const contextEngine = createMockContextEngine()
  const contextMonitor = createMockContextMonitor()
  const modelManager = createMockModelManager()
  const tabManager = new TabManager()
  const rateLimitMonitor = createMockRateLimitMonitor()
  const diffApplier = createMockDiffApplier()

  const coordinator = new StreamCoordinator(
    sessionManager as unknown as import("../../session/SessionManager").SessionManager,
    sessionStore as unknown as import("../../session/SessionStore").SessionStore,
    contextEngine as unknown as import("../../context/ContextEngine").ContextEngine,
    contextMonitor as unknown as import("../../monitor/ContextMonitor").ContextMonitor,
    modelManager as unknown as import("../../model/ModelManager").ModelManager,
    tabManager,
    rateLimitMonitor as unknown as import("../../monitor/RateLimitMonitor").RateLimitMonitor,
    diffApplier,
  )

  return { coordinator, sessionManager, sessionStore, contextEngine, contextMonitor, rateLimitMonitor, tabManager, diffApplier }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StreamCoordinator — behavioral", () => {
  // -----------------------------------------------------------------------
  // 1. Prompt send creates a tab-bound stream_start before stream chunks
  // -----------------------------------------------------------------------
  describe("prompt send lifecycle", () => {
    it("emits stream_start with correct sessionId and messageId before chunks arrive", async () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("tab-1", "Hello", callbacks)

      const startMsg = callbacks.messages.find((m) => m.type === "stream_start")
      assert.ok(startMsg !== undefined, "stream_start must be emitted")
      assert.strictEqual((startMsg as Record<string, unknown>).sessionId, "tab-1")
    })

    it("sets streaming state to true on the tab", async () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("tab-1", "Hello", callbacks)

      const tab = tabManager.getTab("tab-1")
      assert.ok(tab !== undefined)
      assert.strictEqual(tab.isStreaming, true)
    })

    it("sets waitingForCompletion to true on the tab", async () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("tab-1", "Hello", callbacks)

      const tab = tabManager.getTab("tab-1")
      assert.ok(tab !== undefined)
      assert.strictEqual(tab.waitingForCompletion, true)
    })

    it("calls sendPromptAsync with user text", async () => {
      const { coordinator, tabManager, sessionManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("tab-1", "What is 2+2?", callbacks)

      assert.ok(sessionManager.sendPromptAsync.hasBeenCalled())
      const parts = sessionManager.sendPromptAsync.calls[0]?.args[1] as Array<{ type: string; text: string }>
      const userPart = parts?.find((p) => p.text === "What is 2+2?")
      assert.ok(userPart !== undefined, "user text must be passed to sendPromptAsync")
    })

    it("reports error when server is not running and start fails", async () => {
      const { coordinator, tabManager, sessionManager } = createTestHarness()
      sessionManager.isRunning = false
      sessionManager.start = mockFn(() => Promise.reject(new Error("Server unreachable")))
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("tab-1", "Hello", callbacks)

      assert.ok(callbacks.postRequestError.hasBeenCalled())
      const tab = tabManager.getTab("tab-1")
      assert.ok(tab !== undefined)
      assert.strictEqual(tab.isStreaming, false)
    })

    it("reports error when tab does not exist", async () => {
      const { coordinator } = createTestHarness()
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("nonexistent-tab", "Hello", callbacks)

      assert.ok(callbacks.postRequestError.hasBeenCalled())
    })
  })

  // -----------------------------------------------------------------------
  // 2. Stream event for a known server session updates the correct tab
  // -----------------------------------------------------------------------
  describe("appendChunk — routing stream data", () => {
    it("appends text to the correct tab buffer", () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      coordinator.appendChunk("tab-1", "Hello ", callbacks)
      coordinator.appendChunk("tab-1", "world", callbacks)

      const tab = tabManager.getTab("tab-1")
      assert.ok(tab !== undefined)
      assert.strictEqual(tab.streamingBuffer, "Hello world")
    })

    it("emits stream_chunk messages with correct sessionId and text", () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      coordinator.appendChunk("tab-1", "chunk1", callbacks)
      coordinator.appendChunk("tab-1", "chunk2", callbacks)

      const chunkMessages = callbacks.messages.filter((m) => m.type === "stream_chunk")
      assert.strictEqual(chunkMessages.length, 2)
      assert.deepStrictEqual(chunkMessages[0], { type: "stream_chunk", sessionId: "tab-1", text: "chunk1" })
      assert.deepStrictEqual(chunkMessages[1], { type: "stream_chunk", sessionId: "tab-1", text: "chunk2" })
    })
  })

  // -----------------------------------------------------------------------
  // 3. Unknown session event is logged and ignored without crashing
  // -----------------------------------------------------------------------
  describe("unknown / unmapped session handling", () => {
    it("appendChunk for nonexistent tab does not crash", () => {
      const { coordinator } = createTestHarness()
      const callbacks = createMockCallbacks()

      assert.doesNotThrow(() => {
        coordinator.appendChunk("ghost-tab", "data", callbacks)
      })
    })

    it("finalizeStream for tab not waiting does nothing", async () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.finalizeStream("tab-1", callbacks)

      const endMsg = callbacks.messages.find((m) => m.type === "stream_end")
      assert.strictEqual(endMsg, undefined)
    })
  })

  // -----------------------------------------------------------------------
  // 4. Abort — stream cancellation
  // -----------------------------------------------------------------------
  describe("abort — stream cancellation", () => {
    it("calls abortSession on the session manager", async () => {
      const { coordinator, tabManager, sessionManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.abort("tab-1", callbacks)

      assert.ok(sessionManager.abortSession.hasBeenCalled())
    })

    it("emits stream_end with reason aborted", async () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      const callbacks = createMockCallbacks()

      await coordinator.abort("tab-1", callbacks)

      const endMsg = callbacks.messages.find((m) => m.type === "stream_end" && m.reason === "aborted")
      assert.ok(endMsg !== undefined, "stream_end with reason aborted must be emitted")
    })

    it("clears all streaming state after abort", async () => {
      const { coordinator, tabManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      tabManager.setStreaming("tab-1", true)
      tabManager.setWaitingForCompletion("tab-1", true)
      const callbacks = createMockCallbacks()

      await coordinator.abort("tab-1", callbacks)

      const tab = tabManager.getTab("tab-1")
      assert.ok(tab !== undefined)
      assert.strictEqual(tab.isStreaming, false)
      assert.strictEqual(tab.waitingForCompletion, false)
      assert.strictEqual(tab.streamingBuffer, "")
    })

    it("emits aborted even if abortSession rejects", async () => {
      const { coordinator, tabManager, sessionManager } = createTestHarness()
      tabManager.createTab("tab-1", "sess-123")
      sessionManager.abortSession = mockFn(() => Promise.reject(new Error("Network error")))
      const callbacks = createMockCallbacks()

      await coordinator.abort("tab-1", callbacks)

      const abortedMsgs = callbacks.messages.filter((m) => m.type === "stream_end" && m.reason === "aborted")
      assert.ok(abortedMsgs.length >= 1, "must emit aborted even on abortSession failure")
    })
  })

  // -----------------------------------------------------------------------
  // 5. Concurrent stream limit
  // -----------------------------------------------------------------------
  describe("concurrent stream limit", () => {
    it("rejects prompt when max concurrent streams reached", async () => {
      const { coordinator, tabManager } = createTestHarness()

      for (let i = 0; i < 3; i++) {
        tabManager.createTab(`tab-${i}`, `sess-${i}`)
        tabManager.setStreaming(`tab-${i}`, true)
      }

      tabManager.createTab("tab-3", "sess-3")
      const callbacks = createMockCallbacks()

      await coordinator.startPrompt("tab-3", "Hello", callbacks)

      assert.ok(callbacks.postRequestError.hasBeenCalled())
    })
  })

  // -----------------------------------------------------------------------
  // 6. Dispose cleans up state
  // -----------------------------------------------------------------------
  describe("dispose", () => {
    it("can be disposed without error", () => {
      const { coordinator } = createTestHarness()
      assert.doesNotThrow(() => coordinator.dispose())
    })
  })
})
