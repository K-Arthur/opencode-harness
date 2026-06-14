import { describe, it, beforeEach, mock } from "node:test"
import assert from "node:assert/strict"
import Module from "node:module"
import type { SteerPrompt } from "../webview/types"

// SteerPromptHandler transitively imports `vscode` via `outputChannel`. In a
// pure node test runner the `vscode` module doesn't exist, so we install a
// minimal CJS shim into the loader cache before requiring the handler.
const ModuleAny = Module as unknown as {
  _resolveFilename: (id: string, parent: NodeModule, ...rest: unknown[]) => string
  _cache: Record<string, { id: string; exports: unknown; loaded: boolean }>
}
const originalResolve = ModuleAny._resolveFilename
ModuleAny._resolveFilename = function (id: string, parent: NodeModule, ...rest: unknown[]) {
  if (id === "vscode") return "vscode-stub"
  return originalResolve.call(this, id, parent, ...rest)
}
ModuleAny._cache["vscode-stub"] = {
  id: "vscode-stub",
  loaded: true,
  exports: {
    window: {
      createOutputChannel: () => ({
        appendLine: () => {},
        append: () => {},
        show: () => {},
        dispose: () => {},
      }),
      showInformationMessage: () => Promise.resolve(undefined),
      showWarningMessage: () => Promise.resolve(undefined),
      showErrorMessage: () => Promise.resolve(undefined),
    },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    env: { openExternal: () => Promise.resolve(false) },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
  },
}

const { SteerPromptHandler } = require("./SteerPromptHandler") as typeof import("./SteerPromptHandler")

type Captured = Record<string, unknown>[]

function makeCallbacks() {
  const posted: Captured = []
  const errors: { message: string; sessionId?: string }[] = []
  return {
    posted,
    errors,
    postMessage: (msg: Record<string, unknown>) => { posted.push(msg) },
    postRequestError: (message: string, sessionId?: string) => { errors.push({ message, sessionId }) },
  }
}

function makeStreamCoordinator(overrides: Partial<Record<string, (...args: unknown[]) => unknown>> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const stub = (name: string, fn?: (...args: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      calls.push({ name, args })
      return fn ? fn(...args) : undefined
    }
  const sc = {
    abort: stub("abort", overrides.abort),
    startPrompt: stub("startPrompt", overrides.startPrompt),
    registerAppendCallback: ((sessionId: string, cb: () => Promise<void>) => {
      calls.push({ name: "registerAppendCallback", args: [sessionId, cb] })
    }) as unknown as (sessionId: string, cb: () => Promise<void>) => void,
    calls,
  }
  return sc
}

function makeSessionStore(sessions: Record<string, unknown> = {}) {
  return {
    get(id: string) {
      return sessions[id]
    },
  } as unknown as import("../../session/SessionStore").SessionStore
}

describe("SteerPromptHandler.sendSteerPrompt", () => {
  let callbacks: ReturnType<typeof makeCallbacks>
  let coord: ReturnType<typeof makeStreamCoordinator>
  let handler: InstanceType<typeof SteerPromptHandler>

  function makeMockHostQueue() {
    const items: any[] = []
    return {
      enqueue: (sessionId: string, item: any) => {
        const id = `qp-mock-${items.length + 1}`
        items.push({ ...item, id, state: "queued", createdAt: Date.now() })
        return id
      },
      getAll: () => items,
      peek: () => items[0],
      dequeue: () => items.shift(),
      remove: mock.fn(),
      clear: mock.fn(),
      hasQueued: () => items.length > 0,
      queuedCount: () => items.filter((i: any) => i.state === "queued").length,
      markStuckSendingAsQueued: mock.fn(),
      markFailed: mock.fn(),
      reorder: mock.fn(() => true),
      snapshot: () => ({}),
      persist: mock.fn(),
      restore: mock.fn(),
      clearAll: mock.fn(),
    }
  }

  let queuedItems: any[] = []
  const mockHostQueue: {
    enqueue: (sessionId: string, item: any) => string | null
    getAll: () => any[]
    peek: () => any
    dequeue: () => any
    remove: (...args: any[]) => boolean
    clear: (...args: any[]) => void
    hasQueued: () => boolean
    queuedCount: () => number
    markStuckSendingAsQueued: (...args: any[]) => void
    markFailed: (...args: any[]) => void
    reorder: (...args: any[]) => boolean
    snapshot: () => Record<string, any>
    persist: (...args: any[]) => void
    restore: (...args: any[]) => void
    clearAll: (...args: any[]) => void
  } = {
    enqueue: (sessionId: string, item: any) => {
      const id = "qp-mock-1"
      queuedItems.push({ ...item, id, state: "queued", createdAt: Date.now() })
      return id
    },
    getAll: () => queuedItems,
    peek: () => queuedItems[0],
    dequeue: () => queuedItems.shift(),
    remove: mock.fn(),
    clear: mock.fn(),
    hasQueued: () => queuedItems.length > 0,
    queuedCount: () => queuedItems.filter((i: any) => i.state === "queued").length,
    markStuckSendingAsQueued: mock.fn(),
    markFailed: mock.fn(),
    reorder: mock.fn(() => true),
    snapshot: () => ({}),
    persist: mock.fn(),
    restore: mock.fn(),
    clearAll: mock.fn(),
  }

  beforeEach(() => {
    queuedItems = []
    callbacks = makeCallbacks()
    coord = makeStreamCoordinator()
    handler = new SteerPromptHandler(
      coord as unknown as import("./StreamCoordinator").StreamCoordinator,
      makeSessionStore({ "session-1": { id: "session-1" } }),
      mockHostQueue as unknown as import("../HostPromptQueue").HostPromptQueue,
    )
  })

  describe("validation", () => {
    it("posts an error and returns when sessionId is missing", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "redirect", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("", prompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /Session ID is required/)
      assert.equal(coord.calls.length, 0)
    })

    it("posts an error when steer text is empty/whitespace", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "   ", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /cannot be empty/)
      assert.equal(coord.calls.length, 0)
    })

    it("allows an attachment-only steer prompt", async () => {
      const prompt: SteerPrompt = {
        id: "p1",
        text: "   ",
        mode: "interrupt",
        attachments: [{ data: "aGVsbG8=", mimeType: "image/png" }],
        timestamp: 1,
        sessionId: "session-1",
      }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      assert.equal(callbacks.errors.length, 0)
      assert.deepEqual(coord.calls.map(c => c.name), ["abort", "startPrompt"])
      assert.deepEqual(coord.calls[1]!.args[4], [{ data: "aGVsbG8=", mimeType: "image/png" }])
    })

    it("posts an error when the session is not found", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "redirect", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("unknown-session", prompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /Session not found/)
    })

    it("queues an unknown steer mode instead of erroring (never drop user input)", async () => {
      const prompt = { id: "p1", text: "redirect", mode: "unknown" as unknown as "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("session-1", prompt as SteerPrompt, callbacks)
      assert.equal(callbacks.errors.length, 0, "unknown mode must not raise an error")
      assert.equal(callbacks.posted[0]!.type, "prompt_queued")
      assert.equal(queuedItems.length, 1)
    })
  })

  describe("interrupt mode", () => {
    it("aborts the current stream and starts a new prompt", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "redirect", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      assert.deepEqual(coord.calls.map(c => c.name), ["abort", "startPrompt"])
      const startArgs = coord.calls[1]!.args
      assert.equal(startArgs[0], "session-1")
      assert.equal(startArgs[1], "redirect")
    })

    it("surfaces errors thrown by the stream coordinator", async () => {
      const failing = makeStreamCoordinator({
        abort: () => { throw new Error("boom") },
      })
      const h = new SteerPromptHandler(
        failing as unknown as import("./StreamCoordinator").StreamCoordinator,
        makeSessionStore({ "session-1": { id: "session-1" } }),
        mockHostQueue as unknown as import("../HostPromptQueue").HostPromptQueue,
      )
      const prompt: SteerPrompt = { id: "p1", text: "redirect", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await h.sendSteerPrompt("session-1", prompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /Failed to send steer prompt/)
    })
  })

  describe("legacy / unknown mode", () => {
    // The "append" mode was removed (folded into queue). A stale webview or persisted
    // item carrying it must be queued, never dropped and never silently aborted.
    it("coerces a removed 'append' mode to queue (no abort, no append callback)", async () => {
      const prompt = { id: "p1", text: "and another thing", mode: "append", attachments: [], timestamp: 1, sessionId: "session-1" } as unknown as SteerPrompt
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      // Queued (prompt_queued + queue_state), not routed through the stream coordinator.
      assert.equal(callbacks.errors.length, 0)
      assert.equal(coord.calls.length, 0)
      assert.equal(callbacks.posted[0]!.type, "prompt_queued")
      assert.equal(callbacks.posted[1]!.type, "queue_state")
      assert.equal(queuedItems.length, 1)
      assert.equal(queuedItems[0]!.text, "and another thing")
    })
  })

  describe("queue mode", () => {
    it("enqueues to HostPromptQueue and sends queue_state to webview", async () => {
      const prompt: SteerPrompt = {
        id: "p1",
        text: "queue me",
        mode: "queue",
        attachments: [{ data: "x", mimeType: "image/png" }], timestamp: 1, sessionId: "session-1",
      }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      // Should have posted prompt_queued + queue_state
      assert.equal(callbacks.posted.length, 2)
      const promptQueued = callbacks.posted[0]!
      assert.equal(promptQueued.type, "prompt_queued")
      assert.equal(promptQueued.sessionId, "session-1")
      const queueState = callbacks.posted[1]!
      assert.equal(queueState.type, "queue_state")
      assert.equal(queueState.sessionId, "session-1")
      assert.ok(Array.isArray(queueState.items))
      // Host queue should have the item
      assert.equal(queuedItems.length, 1)
      assert.equal(queuedItems[0]!.text, "queue me")
      assert.equal(queuedItems[0]!.isSteerPrompt, true)
      // Queue mode does NOT touch the stream coordinator
      assert.equal(coord.calls.length, 0)
    })

    it("returns error when HostPromptQueue is full", async () => {
      // Fill queue by triggering enqueue return null
      const originalEnqueue = mockHostQueue.enqueue
      mockHostQueue.enqueue = () => null
      try {
        const prompt: SteerPrompt = {
          id: "p2", text: "full queue", mode: "queue", attachments: [], timestamp: 1, sessionId: "session-1",
        }
        await handler.sendSteerPrompt("session-1", prompt, callbacks)
        assert.equal(callbacks.errors.length, 1)
        assert.match(callbacks.errors[0]!.message, /Queue is full/)
      } finally {
        mockHostQueue.enqueue = originalEnqueue
      }
    })
  })
})
