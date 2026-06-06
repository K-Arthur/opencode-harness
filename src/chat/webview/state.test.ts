import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { createState } from "./state"

const source = readFileSync(path.join(__dirname, "state.ts"), "utf8")

function makeVsCodeStub() {
  let saved: unknown = null
  return {
    getState: () => saved,
    setState: (s: unknown) => { saved = s },
    postMessage: () => {},
  } as any
}

describe("state.ts", () => {
  it("exports createState", () => {
    assert.ok(source.includes("export function createState"))
  })

  it("defines DEFAULT_STATE with sessions, activeSessionId, globalModel, initialized", () => {
    assert.ok(source.includes("DEFAULT_STATE"))
    assert.ok(source.includes("sessions: {}"))
    assert.ok(source.includes("activeSessionId: null"))
    assert.ok(source.includes("globalModel"))
    assert.ok(source.includes("initialized"))
  })

  it("has migrateState function", () => {
    assert.ok(source.includes("function migrateState"))
  })

  it("migrates old 'normal' mode to 'build'", () => {
    assert.ok(source.includes('"normal" ? "build"'))
  })

  it("has save function with debounce", () => {
    assert.ok(source.includes("SAVE_DEBOUNCE_MS"))
    assert.ok(source.includes("function save()"))
  })

  it("has flush function for immediate save", () => {
    assert.ok(source.includes("function flush()"))
  })

  it("has restore, getState, createSession functions", () => {
    assert.ok(source.includes("function restore"))
    assert.ok(source.includes("function getState"))
    assert.ok(source.includes("function createSession"))
  })

  it("has loadSessions function", () => {
    assert.ok(source.includes("function loadSessions"))
  })

  it("returns the full API object", () => {
    const methods = [
      "getState", "save", "flush", "restore", "clear",
      "createSession", "ensureSession", "getSession", "getActiveSession",
	      "setActiveSession", "deleteSession", "renameSession",
	      "setSessionModel", "setSessionMode", "setStreaming", "appendMessage",
	      "getAllSessions", "getSessionCount", "setGlobalModel",
	      "loadSessions", "setInitialized", "isInitialized",
	      "toggleModelFavorite", "touchRecentModel", "applyModelState",
	    ]
    methods.forEach(m => {
      assert.ok(source.includes(m), `Missing method ${m} in return object`)
	  })

	  it("tracks model favorites and recents for selector sorting", () => {
	    assert.ok(source.includes("favoriteModels"), "must persist favorite models")
	    assert.ok(source.includes("recentModels"), "must persist recent models")
	    assert.ok(source.includes("recentRank"), "must annotate models with recent rank")
	  })
	})
})

describe("state.ts — per-session token usage isolation (Batch 2d)", () => {
  it("updateTokenUsage stores usage keyed by session id", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1", "anthropic/claude-opus-4-7")
    const s2 = sm.createSession("Tab 2", "anthropic/claude-opus-4-7")

    sm.updateTokenUsage(s1.id, { prompt: 100, completion: 50, total: 150 })
    sm.updateTokenUsage(s2.id, { prompt: 200, completion: 80, total: 280 })

    assert.equal(sm.getSession(s1.id)?.tokenUsage?.total, 150)
    assert.equal(sm.getSession(s2.id)?.tokenUsage?.total, 280)
  })

  it("updating one session's tokens never mutates the other session", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    const s2 = sm.createSession("Tab 2")

    sm.updateTokenUsage(s1.id, { prompt: 100, completion: 50, total: 150 })

    assert.equal(sm.getSession(s1.id)?.tokenUsage?.total, 150)
    assert.equal(sm.getSession(s2.id)?.tokenUsage, undefined)
  })

  it("getActiveSession returns the session whose tokens should drive the counter", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    const s2 = sm.createSession("Tab 2")

    sm.updateTokenUsage(s1.id, { prompt: 10, completion: 5, total: 15 })
    sm.updateTokenUsage(s2.id, { prompt: 999, completion: 1, total: 1000 })

    sm.setActiveSession(s1.id)
    assert.equal(sm.getActiveSession()?.tokenUsage?.total, 15)

    sm.setActiveSession(s2.id)
    assert.equal(sm.getActiveSession()?.tokenUsage?.total, 1000)
  })

  it("loadSessions preserves local usage when host init_state has no recovered totals yet", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    sm.updateTokenUsage(s1.id, { prompt: 10, completion: 5, total: 15 })
    sm.getSession(s1.id)!.cost = 0.1234

    sm.loadSessions([{ ...s1, messages: [], tokenUsage: undefined, cost: 0 }], s1.id, "anthropic/claude-opus-4-7")

    assert.equal(sm.getSession(s1.id)?.tokenUsage?.total, 15)
    assert.equal(sm.getSession(s1.id)?.cost, 0.1234)
  })

  it("loadSessions preserves local contextUsage when host data is missing", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    sm.getSession(s1.id)!.contextUsage = { percent: 40, tokens: 400, maxTokens: 1000, source: "actual", updatedAt: 2000 }

    sm.loadSessions([{ ...s1, messages: [], contextUsage: undefined }], s1.id, "anthropic/claude-opus-4-7")

    assert.equal(sm.getSession(s1.id)?.contextUsage?.tokens, 400)
    assert.equal(sm.getSession(s1.id)?.contextUsage?.source, "actual")
  })

  it("loadSessions does not clobber valid contextUsage with zero fallback host data", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    sm.getSession(s1.id)!.contextUsage = { percent: 65, tokens: 650, maxTokens: 1000, source: "actual", updatedAt: 3000 }

    sm.loadSessions([{
      ...s1,
      messages: [],
      contextUsage: { percent: 0, tokens: 0, maxTokens: 1000, source: "estimated", updatedAt: 4000 },
    }], s1.id, "anthropic/claude-opus-4-7")

    assert.equal(sm.getSession(s1.id)?.contextUsage?.tokens, 650)
    assert.equal(sm.getSession(s1.id)?.contextUsage?.percent, 65)
    assert.equal(sm.getSession(s1.id)?.contextUsage?.source, "actual")
  })

  it("loadSessions accepts meaningful host contextUsage updates", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    sm.getSession(s1.id)!.contextUsage = { percent: 20, tokens: 200, maxTokens: 1000, source: "estimated", updatedAt: 1000 }

    sm.loadSessions([{
      ...s1,
      messages: [],
      contextUsage: { percent: 55, tokens: 550, maxTokens: 1000, source: "actual", updatedAt: 5000 },
    }], s1.id, "anthropic/claude-opus-4-7")

    assert.equal(sm.getSession(s1.id)?.contextUsage?.tokens, 550)
    assert.equal(sm.getSession(s1.id)?.contextUsage?.source, "actual")
  })

  it("tracks per-session scroll positions in webview state", () => {
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    const s2 = sm.createSession("Tab 2")

    assert.equal(sm.setScrollPosition(s1.id, 123.6), true)
    assert.equal(sm.setScrollPosition(s2.id, 44), true)

    assert.equal(sm.getScrollPosition(s1.id), 124)
    assert.equal(sm.getScrollPosition(s2.id), 44)
  })
})

describe("state.ts — restore() must not resurrect stale isStreaming flags", () => {
  // Background: when the extension restarts mid-stream (or a previous stream
  // was orphaned by a dropped message_complete event), the webview's
  // vscode.setState() snapshot still has `isStreaming: true` for those
  // sessions. On reload, the stale flags inflated `getStreamCapacityState()`
  // until it reported isFull, and `sendMessage()` then silently bailed at
  // the "stream limit reached" guard — the user typed, pressed Enter, and
  // nothing happened. Across a webview reload, NO stream can possibly still
  // be running, so all isStreaming flags must reset to false on restore.

  function stubWithSaved(saved: unknown) {
    let s: unknown = saved
    return {
      getState: () => s,
      setState: (v: unknown) => { s = v },
      postMessage: () => {},
    } as any
  }

  it("clears isStreaming on every restored session", () => {
    const persisted = {
      sessions: {
        a: { id: "a", name: "Tab A", messages: [], isStreaming: true,  mode: "build", model: "x" },
        b: { id: "b", name: "Tab B", messages: [], isStreaming: false, mode: "build", model: "x" },
        c: { id: "c", name: "Tab C", messages: [], isStreaming: true,  mode: "build", model: "x" },
      },
      sessionOrder: ["a", "b", "c"],
      activeSessionId: "a",
      globalModel: "x",
      initialized: true,
    }

    const sm = createState(stubWithSaved(persisted))
    sm.restore()

    const streaming = sm.getAllSessions().filter((s) => s.isStreaming)
    assert.equal(streaming.length, 0, "no session may be marked streaming after a webview restore")
  })

  it("does not block the send button via a stale stream-cap from persisted flags", () => {
    // Reproduces the exact failure path the user reported: 3 stuck-streaming
    // sessions persisted → loadSessions/restore returns 3 streaming → capacity
    // reports full → sendMessage's guard fires before posting send_prompt.
    const persisted = {
      sessions: {
        s1: { id: "s1", name: "stuck1", messages: [], isStreaming: true, mode: "build", model: "x" },
        s2: { id: "s2", name: "stuck2", messages: [], isStreaming: true, mode: "build", model: "x" },
        s3: { id: "s3", name: "stuck3", messages: [], isStreaming: true, mode: "build", model: "x" },
      },
      sessionOrder: ["s1", "s2", "s3"],
      activeSessionId: "s1",
      globalModel: "x",
      initialized: true,
    }

    const sm = createState(stubWithSaved(persisted))
    sm.restore()
    const activeStreams = sm.getAllSessions().filter((s) => s.isStreaming).length

    // The bug: activeStreams === 3 → isFull → sendMessage bails.
    // The fix: activeStreams === 0 → capacity available → send goes through.
    assert.equal(activeStreams, 0, "stream-cap must not be inflated by stale persisted flags")
  })
})
