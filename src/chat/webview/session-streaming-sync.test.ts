import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { createState } from "./state"

function makeVsCodeStub() {
  let saved: unknown = null
  const calls: unknown[] = []
  return {
    getState: () => saved,
    setState: (s: unknown) => { saved = s; calls.push(JSON.parse(JSON.stringify(s))) },
    postMessage: () => {},
    calls,
  } as any
}

describe("session-streaming-sync — streaming state is session-scoped", () => {
  it("setStreaming only affects the specified session", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")
    const s2 = sm.createSession("B")

    sm.setStreaming(s1.id, true)

    assert.equal(sm.getSession(s1.id)?.isStreaming, true)
    assert.equal(sm.getSession(s2.id)?.isStreaming, false)
  })

  it("creating a new session while another is streaming doesn't carry streaming state", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")
    sm.setStreaming(s1.id, true)

    const s2 = sm.createSession("B")

    assert.equal(sm.getSession(s1.id)?.isStreaming, true)
    assert.equal(sm.getSession(s2.id)?.isStreaming, false)
  })

  it("setStreaming triggers a save", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")
    const before = vs.calls.length

    sm.setStreaming(s1.id, true)
    sm.flush()

    assert.ok(vs.calls.length > before, "setState must be called after setStreaming")
  })
})

describe("session-streaming-sync — token usage persistence", () => {
  it("updateTokenUsage saves per-session", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")
    const s2 = sm.createSession("B")

    sm.updateTokenUsage(s1.id, { prompt: 100, completion: 50, total: 150 })
    sm.updateTokenUsage(s2.id, { prompt: 200, completion: 80, total: 280 })
    sm.flush()

    const saved = vs.getState() as any
    assert.equal(saved.sessions[s1.id].tokenUsage.total, 150)
    assert.equal(saved.sessions[s2.id].tokenUsage.total, 280)
  })

  it("after flush(), state is immediately persisted", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")

    sm.updateTokenUsage(s1.id, { prompt: 10, completion: 5, total: 15 })
    sm.flush()

    const saved = vs.getState() as any
    assert.equal(saved.sessions[s1.id].tokenUsage.total, 15)
  })

  it("token usage for one session doesn't bleed into another", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")
    const s2 = sm.createSession("B")

    sm.updateTokenUsage(s1.id, { prompt: 10, completion: 5, total: 15 })

    assert.equal(sm.getSession(s1.id)?.tokenUsage?.total, 15)
    assert.equal(sm.getSession(s2.id)?.tokenUsage, undefined)
  })

  it("debounced save doesn't lose data on immediate flush", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")

    sm.updateTokenUsage(s1.id, { prompt: 1, completion: 1, total: 2 })
    sm.updateTokenUsage(s1.id, { prompt: 10, completion: 10, total: 20 })
    sm.flush()

    const saved = vs.getState() as any
    assert.equal(saved.sessions[s1.id].tokenUsage.total, 20)
  })
})

describe("session-streaming-sync — session switching preserves independent state", () => {
  it("switching between sessions preserves streaming and token state", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const sA = sm.createSession("A")
    const sB = sm.createSession("B")

    sm.setStreaming(sA.id, true)
    sm.updateTokenUsage(sA.id, { prompt: 100, completion: 50, total: 150 })
    sm.updateTokenUsage(sB.id, { prompt: 999, completion: 1, total: 1000 })

    sm.setActiveSession(sB.id)
    assert.equal(sm.getActiveSession()?.isStreaming, false)
    assert.equal(sm.getActiveSession()?.tokenUsage?.total, 1000)

    sm.setActiveSession(sA.id)
    assert.equal(sm.getActiveSession()?.isStreaming, true)
    assert.equal(sm.getActiveSession()?.tokenUsage?.total, 150)
  })
})

describe("session-streaming-sync — save debounce and flush", () => {
  it("multiple save() calls within debounce window only trigger one setState", async () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")

    const before = vs.calls.length
    sm.setStreaming(s1.id, true)
    sm.setStreaming(s1.id, false)
    sm.setStreaming(s1.id, true)

    assert.equal(vs.calls.length, before, "debounce should not have fired yet")
  })

  it("flush() immediately writes to setState regardless of debounce", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")

    const before = vs.calls.length
    sm.setStreaming(s1.id, true)
    sm.flush()

    assert.ok(vs.calls.length > before, "flush must call setState synchronously")
    const saved = vs.getState() as any
    assert.equal(saved.sessions[s1.id].isStreaming, true)
  })

  it("token usage written before flush is preserved", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")

    sm.updateTokenUsage(s1.id, { prompt: 42, completion: 7, total: 49 })
    sm.flush()

    const saved = vs.getState() as any
    assert.equal(saved.sessions[s1.id].tokenUsage.total, 49)
  })
})

describe("session-streaming-sync — beforeunload safety", () => {
  it("flush is exported and callable", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    assert.equal(typeof sm.flush, "function")
  })

  it("flush calls setState immediately", () => {
    const vs = makeVsCodeStub()
    const sm = createState(vs)
    const s1 = sm.createSession("A")
    sm.updateTokenUsage(s1.id, { prompt: 5, completion: 3, total: 8 })

    const before = vs.calls.length
    sm.flush()

    assert.equal(vs.calls.length, before + 1, "flush must call setState exactly once")
    const saved = vs.getState() as any
    assert.equal(saved.sessions[s1.id].tokenUsage.total, 8)
  })
})
