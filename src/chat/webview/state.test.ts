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

  it("ensureSession lets host-provided tokenUsage and cost replace local values", () => {
    // Host SessionStore is the canonical token/cost ledger. When the host
    // hands the webview a session snapshot, its values must win — keeping
    // stale local accumulations caused totals to jump around on tab
    // switch / reopen.
    const sm = createState(makeVsCodeStub())
    const s1 = sm.createSession("Tab 1")
    const local = sm.getSession(s1.id)!
    local.tokenUsage = { prompt: 9_999, completion: 9_999, total: 19_998 }
    local.cost = 9.99

    sm.ensureSession({
      ...s1,
      messages: [],
      tokenUsage: { prompt: 100, completion: 20, total: 120 },
      cost: 0.05,
    })

    assert.equal(sm.getSession(s1.id)?.tokenUsage?.total, 120, "host tokenUsage replaces local")
    assert.equal(sm.getSession(s1.id)?.cost, 0.05, "host cost replaces local even when smaller")
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

  it("marks non-terminal persisted subagentActivities as completed on restore", () => {
    // Same rationale as isStreaming: no subagent run survives a webview
    // reload, and run_activity_update never fires again for a finished run,
    // so persisted "running"/"pending" badges would otherwise be stuck forever.
    const persisted = {
      sessions: {
        a: {
          id: "a", name: "Tab A", messages: [], isStreaming: false, mode: "build", model: "x",
          subagentActivities: [
            { id: "sub-run", name: "Runner", status: "running", isLive: true },
            { id: "sub-pend", name: "Pending", status: "pending", isLive: true },
            { id: "sub-done", name: "Done", status: "completed", completedAt: 111 },
            { id: "sub-fail", name: "Failed", status: "failed", completedAt: 222 },
          ],
        },
      },
      sessionOrder: ["a"],
      activeSessionId: "a",
      globalModel: "x",
      initialized: true,
    }

    const sm = createState(stubWithSaved(persisted))
    sm.restore()

    const activities = sm.getSession("a")?.subagentActivities ?? []
    const byId = new Map(activities.map((a) => [a.id, a]))
    assert.equal(byId.get("sub-run")?.status, "completed")
    assert.equal(byId.get("sub-run")?.isLive, false)
    assert.ok(byId.get("sub-run")?.completedAt, "synthesized completedAt expected")
    assert.equal(byId.get("sub-pend")?.status, "completed")
    assert.equal(byId.get("sub-done")?.status, "completed")
    assert.equal(byId.get("sub-done")?.completedAt, 111)
    assert.equal(byId.get("sub-fail")?.status, "failed")
    assert.equal(byId.get("sub-fail")?.completedAt, 222)
  })
})

describe("state.ts — bounded persistence snapshot (two-session lag fix, 2026-06-11)", () => {
  // Background: save()/flush() used to pass the ENTIRE in-memory state to
  // vscode.setState — every session × every message × every block. With two
  // long sessions (~3 MB of state) each debounced save cost a full multi-MB
  // JSON serialization on the webview UI thread plus a multi-MB IPC to the
  // extension host. setState fires on every scroll save, stream block
  // boundary, token-usage update, etc., so the per-save cost scaled with
  // TOTAL transcript size, not with what changed — the root cause of the
  // "extension lags with only two open sessions" report. The fix: persist a
  // bounded snapshot (last N messages per session, matching the host's
  // init_state cap) while keeping the full transcript in memory. The host
  // store + server remain the source of truth for full history.

  function stubCapture() {
    let saved: any = null
    return {
      api: {
        getState: () => saved,
        setState: (s: unknown) => { saved = s },
        postMessage: () => {},
      } as any,
      get saved() { return saved },
    }
  }

  function pushMessages(sm: ReturnType<typeof createState>, id: string, count: number, textLen = 40) {
    for (let i = 0; i < count; i++) {
      sm.appendMessage(id, {
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        timestamp: i,
        blocks: [{ type: "text", text: "x".repeat(textLen) }],
      } as any)
    }
  }

  it("flush() persists at most 50 messages per session", () => {
    const cap = stubCapture()
    const sm = createState(cap.api)
    const s = sm.createSession("Long")
    pushMessages(sm, s.id, 120)
    sm.flush()
    const persisted = cap.saved.sessions[s.id]
    assert.equal(persisted.messages.length, 50, "persisted snapshot must cap messages per session")
    assert.equal(persisted.messages[0].id, "m-70", "persisted window must be the most recent messages")
    assert.equal(persisted.messages[49].id, "m-119")
  })

  it("flush() keeps the full transcript in memory (cap applies to the snapshot only)", () => {
    const cap = stubCapture()
    const sm = createState(cap.api)
    const s = sm.createSession("Long")
    pushMessages(sm, s.id, 120)
    sm.flush()
    assert.equal(sm.getSession(s.id)?.messages.length, 120, "in-memory transcript must not be trimmed by persistence")
  })

  it("flush() preserves session metadata and non-session fields in the snapshot", () => {
    const cap = stubCapture()
    const sm = createState(cap.api)
    const s = sm.createSession("Meta", "anthropic/claude-sonnet-4-6", "build")
    pushMessages(sm, s.id, 60)
    sm.setActiveSession(s.id)
    sm.setScrollPosition(s.id, 333)
    sm.setGlobalModel("anthropic/claude-sonnet-4-6")
    sm.flush()
    assert.equal(cap.saved.sessions[s.id].model, "anthropic/claude-sonnet-4-6")
    assert.equal(cap.saved.sessions[s.id].mode, "build")
    assert.equal(cap.saved.scrollPositions[s.id], 333)
    assert.equal(cap.saved.globalModel, "anthropic/claude-sonnet-4-6")
    assert.equal(cap.saved.activeSessionId, s.id)
  })

  it("short sessions are persisted without trimming", () => {
    const cap = stubCapture()
    const sm = createState(cap.api)
    const s = sm.createSession("Short")
    pushMessages(sm, s.id, 7)
    sm.flush()
    assert.equal(cap.saved.sessions[s.id].messages.length, 7)
  })

  it("falls back to a deeper trim when the bounded snapshot still exceeds the state budget", () => {
    const cap = stubCapture()
    const sm = createState(cap.api)
    const s = sm.createSession("Huge")
    // 40 messages × ~100KB ≈ 4MB — under the 50-message cap but over the 2MB budget.
    pushMessages(sm, s.id, 40, 100_000)
    sm.flush()
    const persisted = cap.saved.sessions[s.id]
    assert.ok(
      persisted.messages.length <= 10,
      `oversized snapshot must fall back to a deep trim (got ${persisted.messages.length} messages)`,
    )
  })

  it("snapshot round-trips through restore()", () => {
    const cap = stubCapture()
    const sm = createState(cap.api)
    const s = sm.createSession("RT")
    pushMessages(sm, s.id, 80)
    sm.setActiveSession(s.id)
    sm.flush()

    const sm2 = createState(cap.api)
    assert.equal(sm2.restore(), true)
    assert.equal(sm2.getSession(s.id)?.messages.length, 50)
    assert.equal(sm2.getState().activeSessionId, s.id)
  })

  it("no longer schedules full-state JSON.stringify prune passes", () => {
    // The old doPrune/schedulePrune path re-serialized the ENTIRE state just
    // to measure its size (and again per pruned session). The bounded
    // snapshot makes that machinery — and its hidden O(total-state) cost —
    // unnecessary.
    assert.ok(!source.includes("schedulePrune"), "schedulePrune must be gone")
    assert.ok(!source.includes("function doPrune"), "doPrune must be gone")
  })
})
