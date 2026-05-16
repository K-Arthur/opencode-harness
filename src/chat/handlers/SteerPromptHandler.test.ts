import { describe, it, beforeEach } from "node:test"
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

  beforeEach(() => {
    callbacks = makeCallbacks()
    coord = makeStreamCoordinator()
    handler = new SteerPromptHandler(
      coord as unknown as import("./StreamCoordinator").StreamCoordinator,
      makeSessionStore({ "session-1": { id: "session-1" } }),
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

    it("posts an error when the session is not found", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "redirect", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("unknown-session", prompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /Session not found/)
    })

    it("posts an error for unknown steer mode", async () => {
      const prompt = { id: "p1", text: "redirect", mode: "unknown" as unknown as "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("session-1", prompt as SteerPrompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /Unknown steer mode/)
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
      )
      const prompt: SteerPrompt = { id: "p1", text: "redirect", mode: "interrupt", attachments: [], timestamp: 1, sessionId: "session-1" }
      await h.sendSteerPrompt("session-1", prompt, callbacks)
      assert.equal(callbacks.errors.length, 1)
      assert.match(callbacks.errors[0]!.message, /Failed to send steer prompt/)
    })
  })

  describe("append mode", () => {
    it("registers a callback to fire after the current stream ends", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "and another thing", mode: "append", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      assert.equal(coord.calls.length, 1)
      assert.equal(coord.calls[0]!.name, "registerAppendCallback")
      assert.equal(coord.calls[0]!.args[0], "session-1")
    })

    it("the registered callback sends the prompt when invoked", async () => {
      const prompt: SteerPrompt = { id: "p1", text: "and another thing", mode: "append", attachments: [], timestamp: 1, sessionId: "session-1" }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      const cb = coord.calls[0]!.args[1] as () => Promise<void>
      await cb()
      const last = coord.calls[coord.calls.length - 1]!
      assert.equal(last.name, "startPrompt")
      assert.equal(last.args[1], "and another thing")
    })
  })

  describe("queue mode", () => {
    it("posts an add_to_queue message to the webview with the steer flag set", async () => {
      const prompt: SteerPrompt = {
        id: "p1",
        text: "queue me",
        mode: "queue",
        attachments: [{ data: "x", mimeType: "image/png" }], timestamp: 1, sessionId: "session-1",
      }
      await handler.sendSteerPrompt("session-1", prompt, callbacks)
      assert.equal(callbacks.posted.length, 1)
      const msg = callbacks.posted[0]!
      assert.equal(msg.type, "add_to_queue")
      assert.equal(msg.sessionId, "session-1")
      assert.equal(msg.text, "queue me")
      assert.equal(msg.isSteerPrompt, true)
      assert.deepEqual(msg.attachments, [{ data: "x", mimeType: "image/png" }])
      // Queue mode does NOT touch the stream coordinator
      assert.equal(coord.calls.length, 0)
    })
  })
})
