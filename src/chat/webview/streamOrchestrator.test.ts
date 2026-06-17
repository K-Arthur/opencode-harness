/**
 * Characterization tests for `createStreamOrchestrator`.
 *
 * These tests pin down the observable behavior of the orchestrator's public
 * API (StreamOrchestratorAPI) BEFORE any refactor extraction begins, so the
 * refactor cannot silently change stream finalization, timer cleanup, or
 * pending-tool-update lifecycle.
 *
 * Style follows the established webview test pattern: JSDOM + a hand-rolled
 * fake deps object (see steerMode.test.ts, send-logic-behavioral.test.ts).
 * Real timers with short `await sleep(N)` waits — `timers` singleton stores
 * real setTimeout ids, so fake timers would interact awkwardly with the
 * TimerRegistry's internal Set bookkeeping.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { ChatMessage } from "../../types"
import type { StreamHandlers } from "./stream"
import type { ToolCallState } from "./types"
import { createStreamOrchestrator, type StreamOrchestratorDeps } from "./streamOrchestrator"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body>
    <div id="tab-panels"></div>
    <div id="input-area"><div class="input-wrapper"></div></div>
    <div id="agent-status-led"></div>
    <span id="agent-status-text"></span>
  </body></html>`)
  const g = globalThis as any
  g.window = dom.window
  g.document = dom.window.document
  g.HTMLElement = dom.window.HTMLElement
  g.Node = dom.window.Node
  // CSS.escape is used by handleStreamChunk's tab-panel guard; JSDOM doesn't
  // expose CSS.escape by default, so we install a minimal polyfill.
  g.CSS = { escape: (s: string) => String(s).replace(/[^\w-]/g, (c) => "\\" + c) }
}

function teardownDom() {
  const g = globalThis as any
  delete g.window
  delete g.document
  delete g.HTMLElement
  delete g.Node
  delete g.CSS
  if (dom) dom.window.close()
}

// ---------------------------------------------------------------------------
// Fake collaborators
// ---------------------------------------------------------------------------

interface FakeSession {
  id: string
  name: string
  model: string
  mode: string
  messages: ChatMessage[]
  isStreaming: boolean
  cost?: number
  changedFiles?: string[]
}

/** Minimal StreamHandlers double that records every call. The orchestrator
 *  only invokes a subset of these methods — we record all to be safe. */
function makeFakeStream(): StreamHandlers & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const rec = (method: string) => (...args: unknown[]) => calls.push({ method, args })
  return {
    calls,
    handleStreamStart: rec("handleStreamStart"),
    handleStreamToken: rec("handleStreamToken"),
    handleStreamChunk: rec("handleStreamChunk"),
    handleStreamEnd: rec("handleStreamEnd"),
    handleStreamError: rec("handleStreamError"),
    handleRequestError: rec("handleRequestError"),
    handleToolStart: rec("handleToolStart"),
    handleToolUpdate: rec("handleToolUpdate"),
    handleToolPartial: rec("handleToolPartial"),
    handleToolEnd: rec("handleToolEnd"),
    handleSkillIndicator: rec("handleSkillIndicator"),
    handleDiff: rec("handleDiff"),
    handleDiffResult: rec("handleDiffResult"),
    handleServerStatus: rec("handleServerStatus"),
    handleRunActivityUpdate: rec("handleRunActivityUpdate"),
    showTypingIndicator: rec("showTypingIndicator"),
    hideTypingIndicator: rec("hideTypingIndicator"),
    finalizePendingTools: rec("finalizePendingTools"),
    clearMessages: rec("clearMessages"),
    isStreaming: false,
    streamingMessageId: null,
    chunkSeq: 0,
    forceRerender: rec("forceRerender"),
  }
}

interface Harness {
  api: ReturnType<typeof createStreamOrchestrator>
  deps: StreamOrchestratorDeps & { _posted: Array<Record<string, unknown>> }
  sessions: Map<string, FakeSession>
  streams: Map<string, ReturnType<typeof makeFakeStream>>
  calls: Record<string, unknown[][]>
  activeSessionId: string | null
  setActive(id: string | null): void
  addSession(s: FakeSession): void
  addStream(id: string): ReturnType<typeof makeFakeStream>
  /** Render fakes: per-session message-list container. */
  messageLists: Map<string, HTMLDivElement>
  setMessageList(id: string, el: HTMLDivElement | null): void
  /** Swappable behavior: dep callbacks read through this object so a test can
   *  mutate them AFTER the orchestrator has captured its closure (the inner
   *  destructure captures the *function reference* — so we route via an
   *  object property that the function reads each call). */
  behavior: {
    setStreaming: (id: string, v: boolean) => void
  }
}

function makeHarness(): Harness {
  const sessions = new Map<string, FakeSession>()
  const streams = new Map<string, ReturnType<typeof makeFakeStream>>()
  const messageLists = new Map<string, HTMLDivElement>()
  const posted: Array<Record<string, unknown>> = []
  const calls: Record<string, unknown[][]> = {}
  const rec = (name: string) => (...args: unknown[]) => {
    ;(calls[name] ||= []).push(args)
  }
  let activeSessionId: string | null = null
  const globalModel = "test/model"

  // Behavior hook — tests can mutate these AFTER the orchestrator is built
  // (the deps callbacks delegate through this object on every call).
  const behavior = {
    setStreaming: (id: string, v: boolean) => {
      const s = sessions.get(id)
      if (s) s.isStreaming = v
    },
  }

  const inputArea = document.querySelector("#input-area") as HTMLDivElement
  const inputWrapper = document.querySelector("#input-area .input-wrapper") as HTMLDivElement
  const agentStatusLed = document.querySelector("#agent-status-led") as HTMLDivElement
  const agentStatusText = document.querySelector("#agent-status-text") as HTMLSpanElement
  const tabPanels = document.querySelector("#tab-panels") as HTMLDivElement

  const deps = {
    _posted: posted,
    vscode: { postMessage: (m: Record<string, unknown>) => posted.push(m) },
    els: {
      inputArea,
      inputWrapper,
      agentStatusLed,
      agentStatusText,
      tabPanels,
    },
    streamHandlers: streams as unknown as Map<string, StreamHandlers>,
    getState: () => ({ activeSessionId, globalModel }),
    getSession: (id: string) => sessions.get(id),
    getAllSessions: () => Array.from(sessions.values()),
    ensureSession: (init: { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean }) => {
      const s: FakeSession = { ...init }
      sessions.set(s.id, s)
      return s
    },
    setStreaming: (id: string, v: boolean) => behavior.setStreaming(id, v),
    save: rec("save"),
    createWebviewId: (prefix: string) => `${prefix}-fake-${Math.random().toString(36).slice(2, 6)}`,
    addMessage: rec("addMessage"),
    showSystemMessage: rec("showSystemMessage"),
    createTabUI: (tabId: string) => {
      // Real createTabUI builds a panel; we just register a message-list container
      // so getMessageList returns something. Skip if already set.
      if (!messageLists.has(tabId)) {
        const el = document.createElement("div")
        el.className = "message-list"
        el.dataset.tabId = tabId
        messageLists.set(tabId, el)
      }
      calls.createTabUI ||= []
      calls.createTabUI.push([tabId])
    },
    switchTab: rec("switchTab"),
    hideWelcomeView: rec("hideWelcomeView"),
    updateTabBar: rec("updateTabBar"),
    updateModeSelectorStateLocal: rec("updateModeSelectorStateLocal"),
    updateSendButtonIcon: rec("updateSendButtonIcon"),
    updateSendButton: rec("updateSendButton"),
    getMessageList: (tabId: string) => messageLists.get(tabId) ?? null,
    createStreamHandlersForTab: (_tabId: string) => {
      const s = makeFakeStream()
      streams.set(_tabId, s)
      return s as unknown as StreamHandlers
    },
    setupJumpToBottom: rec("setupJumpToBottom"),
    debouncedUpdateScrollMarkers: rec("debouncedUpdateScrollMarkers"),
    debouncedTimelineRefresh: rec("debouncedTimelineRefresh"),
    refreshConversationTimeline: rec("refreshConversationTimeline"),
    toolElapsedTracker: {
      clearAll: rec("toolElapsedTracker.clearAll"),
    },
    promptQueues: new Map(),
    renderQueue: rec("renderQueue"),
    syncModeUI: rec("syncModeUI"),
    renderRecentSessionsList: rec("renderRecentSessionsList"),
    persistQueues: rec("persistQueues"),
  } as unknown as StreamOrchestratorDeps & { _posted: Array<Record<string, unknown>> }

  const api = createStreamOrchestrator(deps)

  return {
    api,
    deps,
    sessions,
    streams,
    calls,
    activeSessionId,
    behavior,
    setActive(id) { activeSessionId = id },
    addSession(s) { sessions.set(s.id, s) },
    addStream(id) {
      const s = makeFakeStream()
      streams.set(id, s)
      return s
    },
    messageLists,
    setMessageList(id, el) {
      if (el === null) messageLists.delete(id)
      else messageLists.set(id, el)
    },
  }
}

function session(id: string, over: Partial<FakeSession> = {}): FakeSession {
  return {
    id,
    name: "Session " + id,
    model: "test/model",
    mode: "build",
    messages: [],
    isStreaming: false,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createStreamOrchestrator", () => {
  beforeEach(() => setupDom())
  afterEach(() => teardownDom())

  // -------------------------------------------------------------------------
  // updateAgentStatus
  // -------------------------------------------------------------------------
  describe("updateAgentStatus", () => {
    it("sets the LED class and text content for each status", () => {
      const h = makeHarness()
      h.api.updateAgentStatus("thinking")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led thinking")
      assert.equal((h.deps.els as any).agentStatusText.textContent, "THINKING")

      h.api.updateAgentStatus("executing")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led executing")
      assert.equal((h.deps.els as any).agentStatusText.textContent, "EXECUTING")

      h.api.updateAgentStatus("idle")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led idle")
      assert.equal((h.deps.els as any).agentStatusText.textContent, "SYSTEM READY")
    })
  })

  // -------------------------------------------------------------------------
  // showSkillIndicator
  // -------------------------------------------------------------------------
  describe("showSkillIndicator", () => {
    it("creates the .skill-indicators container if absent and appends a pill", () => {
      const h = makeHarness()
      h.api.showSkillIndicator("s1", "tdd")
      const container = (h.deps.els as any).inputArea.querySelector(".skill-indicators")
      assert.ok(container, "container created")
      const pills = container.querySelectorAll(".skill-pill")
      assert.equal(pills.length, 1)
      assert.equal(pills[0]!.textContent, "tdd")
    })

    it("appends a pill to the existing container without recreating it", () => {
      const h = makeHarness()
      h.api.showSkillIndicator("s1", "first")
      h.api.showSkillIndicator("s1", "second")
      const containers = (h.deps.els as any).inputArea.querySelectorAll(".skill-indicators")
      assert.equal(containers.length, 1, "container not duplicated")
      const pills = containers[0]!.querySelectorAll(".skill-pill")
      assert.equal(pills.length, 2)
    })

    it("removes the pill after the TTL elapses", async () => {
      const h = makeHarness()
      h.api.showSkillIndicator("s1", "ephemeral")
      const container = (h.deps.els as any).inputArea.querySelector(".skill-indicators")!
      assert.equal(container.querySelectorAll(".skill-pill").length, 1)
      await sleep(3050)
      assert.equal(container.querySelectorAll(".skill-pill").length, 0, "pill removed after TTL")
    })
  })

  // -------------------------------------------------------------------------
  // scheduleToolUpdate / flushToolUpdate — debounce + merge lifecycle
  // -------------------------------------------------------------------------
  describe("scheduleToolUpdate / flushToolUpdate", () => {
    it("fires handleToolUpdate once after the debounce when a single update is scheduled", async () => {
      const h = makeHarness()
      const s = h.addSession(session("s1"))
      const stream = h.addStream("s1")

      h.api.scheduleToolUpdate("s1", "tool-1", { state: "running" as ToolCallState })
      // Before the 50ms debounce: stream not called yet.
      assert.equal(stream.calls.filter((c) => c.method === "handleToolUpdate").length, 0)

      await sleep(70)
      const updates = stream.calls.filter((c) => c.method === "handleToolUpdate")
      assert.equal(updates.length, 1)
      assert.deepEqual(updates[0]!.args, ["tool-1", { state: "running" }])
    })

    it("merges multiple scheduled updates for the same tool into one debounced call", async () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const stream = h.addStream("s1")

      h.api.scheduleToolUpdate("s1", "tool-1", { state: "running" as ToolCallState })
      h.api.scheduleToolUpdate("s1", "tool-1", { args: { progress: 50 } })
      h.api.scheduleToolUpdate("s1", "tool-1", { state: "result" as ToolCallState })

      await sleep(70)
      const updates = stream.calls.filter((c) => c.method === "handleToolUpdate")
      assert.equal(updates.length, 1, "only one debounced call")
      assert.deepEqual(updates[0]!.args, [
        "tool-1",
        { state: "result", args: { progress: 50 } },
      ])
    })

    it("flushToolUpdate fires immediately and clears the pending timer", async () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const stream = h.addStream("s1")

      h.api.scheduleToolUpdate("s1", "tool-1", { state: "running" as ToolCallState })
      h.api.scheduleToolUpdate("s1", "tool-1", { args: { x: 1 } })
      h.api.flushToolUpdate("s1", "tool-1")

      const updates = stream.calls.filter((c) => c.method === "handleToolUpdate")
      assert.equal(updates.length, 1, "flush fires immediately")
      assert.deepEqual(updates[0]!.args, ["tool-1", { state: "running", args: { x: 1 } }])

      // Wait past original debounce — must NOT fire a second time.
      await sleep(70)
      assert.equal(stream.calls.filter((c) => c.method === "handleToolUpdate").length, 1)
    })

    it("flushToolUpdate is a no-op when nothing is pending", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const stream = h.addStream("s1")
      h.api.flushToolUpdate("s1", "tool-1") // must not throw
      assert.equal(stream.calls.length, 0)
    })

    it("does not coalesce updates across distinct tools", async () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const stream = h.addStream("s1")

      h.api.scheduleToolUpdate("s1", "tool-A", { state: "running" as ToolCallState })
      h.api.scheduleToolUpdate("s1", "tool-B", { state: "running" as ToolCallState })
      await sleep(70)

      const updates = stream.calls.filter((c) => c.method === "handleToolUpdate")
      assert.equal(updates.length, 2)
    })
  })

  // -------------------------------------------------------------------------
  // markToolChainProgress / clearToolChainProgress
  // -------------------------------------------------------------------------
  describe("markToolChainProgress / clearToolChainProgress", () => {
    it("appends a .tool-chain-progress element to the message list after the 900ms delay", async () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const msgList = document.createElement("div")
      h.setMessageList("s1", msgList)

      h.api.markToolChainProgress("s1")
      // Before the 900ms timer: no element yet.
      assert.equal(msgList.querySelectorAll(".tool-chain-progress").length, 0)

      await sleep(920)
      const els = msgList.querySelectorAll(".tool-chain-progress")
      assert.equal(els.length, 1)
      assert.equal(els[0]!.textContent, "Tool chain running...")
      assert.equal(els[0]!.getAttribute("role"), "status")
      assert.equal(els[0]!.getAttribute("aria-live"), "polite")
    })

    it("does not double-create when called twice within the delay window", async () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const msgList = document.createElement("div")
      h.setMessageList("s1", msgList)

      h.api.markToolChainProgress("s1")
      h.api.markToolChainProgress("s1") // ignored while timer pending
      await sleep(920)
      assert.equal(msgList.querySelectorAll(".tool-chain-progress").length, 1)
    })

    it("clearToolChainProgress cancels the pending timer and removes any existing element", async () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const msgList = document.createElement("div")
      h.setMessageList("s1", msgList)

      h.api.markToolChainProgress("s1")
      h.api.clearToolChainProgress("s1")
      await sleep(920)
      assert.equal(msgList.querySelectorAll(".tool-chain-progress").length, 0, "timer cancelled")

      // Also removes elements already rendered.
      const prog = document.createElement("div")
      prog.className = "tool-chain-progress"
      msgList.appendChild(prog)
      h.api.clearToolChainProgress("s1")
      assert.equal(msgList.querySelectorAll(".tool-chain-progress").length, 0, "rendered element removed")
    })
  })

  // -------------------------------------------------------------------------
  // handleStreamStart
  // -------------------------------------------------------------------------
  describe("handleStreamStart", () => {
    it("ensures the session when none exists, creating it with globalModel + mode=build", () => {
      const h = makeHarness()
      h.api.handleStreamStart("s-new")
      const s = h.sessions.get("s-new")
      assert.ok(s, "session was ensured")
      assert.equal(s!.name, "New Session")
      assert.equal(s!.mode, "build")
      assert.equal(s!.model, "test/model")
      // The warn log was posted.
      assert.ok(h.deps._posted.some((m) => m.level === "warn" && String(m.message).includes("not in state")))
    })

    it("creates the tab UI when the message list is missing", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      // No messageLists entry → getMessageList returns null
      h.api.handleStreamStart("s1")
      assert.ok((h.calls.createTabUI || []).length >= 1, "createTabUI called")
      assert.ok(h.deps._posted.some((m) => String(m.message).includes("creating tab UI")))
    })

    it("creates a stream handler when none exists for the session", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      // Pre-populate a message list so createTabUI is not invoked
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamStart("s1")
      assert.ok(h.streams.has("s1"), "stream registered")
      assert.ok(h.deps._posted.some((m) => String(m.message).includes("creating...")))
    })

    it("switches to the tab when it is not the active session", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.setMessageList("s1", document.createElement("div"))
      h.addStream("s1")
      h.setActive("other")
      h.api.handleStreamStart("s1")
      assert.ok((h.calls.switchTab || []).some((c) => c[0] === "s1"))
    })

    it("does NOT switch when the session is already active", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.setMessageList("s1", document.createElement("div"))
      h.addStream("s1")
      h.setActive("s1")
      h.api.handleStreamStart("s1")
      assert.equal((h.calls.switchTab || []).length, 0)
    })

    it("calls stream.handleStreamStart, sets streaming true, sets agent status to thinking", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.setMessageList("s1", document.createElement("div"))
      const stream = h.addStream("s1")
      h.api.handleStreamStart("s1", "msg-1")
      assert.deepEqual(stream.calls.find((c) => c.method === "handleStreamStart")?.args, ["msg-1", undefined])
      assert.equal(h.sessions.get("s1")!.isStreaming, true)
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led thinking")
    })

    it("hides the welcome view and refreshes the tab bar", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.setMessageList("s1", document.createElement("div"))
      h.addStream("s1")
      h.api.handleStreamStart("s1")
      assert.ok((h.calls.hideWelcomeView || []).length >= 1)
      assert.ok((h.calls.updateTabBar || []).length >= 1)
    })

    it("sets up jump-to-bottom if the message list has none yet, and refreshes scroll markers", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const msgList = document.createElement("div")
      h.setMessageList("s1", msgList)
      h.addStream("s1")
      h.api.handleStreamStart("s1")
      assert.ok((h.calls.setupJumpToBottom || []).some((c) => c[0] === "s1"))
      assert.ok((h.calls.debouncedUpdateScrollMarkers || []).some((c) => c[0] === "s1"))
    })

    it("does NOT re-setup jump-to-bottom if one already exists", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const msgList = document.createElement("div")
      const existing = document.createElement("div")
      existing.className = "jump-to-bottom"
      msgList.appendChild(existing)
      h.setMessageList("s1", msgList)
      h.addStream("s1")
      h.api.handleStreamStart("s1")
      assert.equal((h.calls.setupJumpToBottom || []).length, 0)
    })
  })

  // -------------------------------------------------------------------------
  // handleStreamChunk
  // -------------------------------------------------------------------------
  describe("handleStreamChunk", () => {
    it("ensures the session if missing (no warn log)", () => {
      const h = makeHarness()
      // Pre-populate tab-panel + stream so we exercise only the ensure branch.
      h.setMessageList("missing", document.createElement("div"))
      ;(h.deps.els as any).tabPanels.appendChild(messageListAsTabPanel("missing"))
      h.addStream("missing")
      h.api.handleStreamChunk("missing", "hi")
      assert.ok(h.sessions.has("missing"))
    })

    it("creates a stream handler if none exists", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      ;(h.deps.els as any).tabPanels.appendChild(messageListAsTabPanel("s1"))
      h.api.handleStreamChunk("s1", "hi")
      assert.ok(h.streams.has("s1"))
    })

    it("logs the first three chunks and then every 100th", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      ;(h.deps.els as any).tabPanels.appendChild(messageListAsTabPanel("s1"))
      const stream = h.addStream("s1")

      for (let i = 0; i < 105; i++) {
        h.api.handleStreamChunk("s1", "x")
      }
      stream.calls.find((c) => c.method === "handleStreamChunk")

      const logs = h.deps._posted.filter((m) => m.type === "webview_log" && String(m.message).includes("handleStreamChunk: chunk"))
      // First 3 + chunk #100 → 4 log lines.
      assert.equal(logs.length, 4)
    })

    it("logs when a chunk payload exceeds 1000 chars regardless of counter", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      ;(h.deps.els as any).tabPanels.appendChild(messageListAsTabPanel("s1"))
      h.addStream("s1")
      // Advance counter past initial 3.
      h.api.handleStreamChunk("s1", "x")
      h.api.handleStreamChunk("s1", "x")
      h.api.handleStreamChunk("s1", "x")
      h.api.handleStreamChunk("s1", "x") // #4 — not logged
      const before = h.deps._posted.filter((m) => String(m.message).includes("handleStreamChunk: chunk")).length
      h.api.handleStreamChunk("s1", "y".repeat(1001))
      const after = h.deps._posted.filter((m) => String(m.message).includes("handleStreamChunk: chunk")).length
      assert.equal(after, before + 1, "long chunk logged")
    })

    it("forwards the chunk text + messageId to stream.handleStreamChunk", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      ;(h.deps.els as any).tabPanels.appendChild(messageListAsTabPanel("s1"))
      const stream = h.addStream("s1")
      h.api.handleStreamChunk("s1", "payload", "msg-7")
      const call = stream.calls.find((c) => c.method === "handleStreamChunk")
      assert.deepEqual(call!.args, ["payload", "msg-7"])
    })
  })

  // -------------------------------------------------------------------------
  // handleStreamEnd
  // -------------------------------------------------------------------------
  describe("handleStreamEnd", () => {
    it("calls stream.handleStreamEnd, finalizes streaming text, sets streaming false, agent idle", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      const msgList = document.createElement("div")
      const liveText = document.createElement("span")
      liveText.className = "streaming-text"
      msgList.appendChild(liveText)
      h.setMessageList("s1", msgList)

      h.api.handleStreamEnd("s1", "msg-1")

      assert.ok(stream.calls.some((c) => c.method === "handleStreamEnd" && JSON.stringify(c.args) === JSON.stringify(["msg-1", undefined])))
      assert.equal(h.sessions.get("s1")!.isStreaming, false)
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led idle")
      // finalizeStreamingText demotes .streaming-text (it loses the class).
      assert.equal(msgList.querySelectorAll(".streaming-text").length, 0)
    })

    it("clears tool-elapsed tracker and tool-chain progress for the session", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      h.addStream("s1")
      const msgList = document.createElement("div")
      h.setMessageList("s1", msgList)
      h.api.handleStreamEnd("s1")
      assert.ok((h.calls["toolElapsedTracker.clearAll"] || []).length >= 1)
    })

    it("removes a pending tool-update for the ended session without firing it", async () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))

      h.api.scheduleToolUpdate("s1", "tool-1", { state: "running" as ToolCallState })
      h.api.handleStreamEnd("s1")
      await sleep(70) // past original debounce
      assert.equal(stream.calls.filter((c) => c.method === "handleToolUpdate").length, 0, "pending cleared without firing")
    })

    it("processes stream-end blocks: removes an empty placeholder and adds the assistant message", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      const msgList = document.createElement("div")
      const placeholder = document.createElement("div")
      placeholder.dataset.messageId = "msg-1"
      placeholder.className = "message-bubble"
      msgList.appendChild(placeholder) // empty placeholder, no rendered content
      h.setMessageList("s1", msgList)

      const blocks = [{ type: "text", text: "hello" }] as unknown as ChatMessage["blocks"]
      h.api.handleStreamEnd("s1", "msg-1", blocks)

      assert.equal(msgList.querySelector('[data-message-id="msg-1"]'), null, "empty placeholder removed")
      assert.ok((h.calls.addMessage || []).length >= 1)
      const addArgs = (h.calls.addMessage || []).find((c) => (c[0] === "s1"))
      assert.ok(addArgs, "addMessage called for s1")
      const added = addArgs![1] as ChatMessage
      assert.equal(added.role, "assistant")
      assert.equal(added.id, "msg-1")
      assert.equal(added.blocks, blocks)
    })

    it("does NOT remove a placeholder that contains rendered tool/diff/skill blocks", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      const msgList = document.createElement("div")
      const placeholder = document.createElement("div")
      placeholder.dataset.messageId = "msg-1"
      // NON_TEXT_BLOCK_SELECTOR matches `details.tool-call`, not bare `.tool-call`.
      const tool = document.createElement("details")
      tool.className = "tool-call"
      placeholder.appendChild(tool)
      msgList.appendChild(placeholder)
      h.setMessageList("s1", msgList)

      h.api.handleStreamEnd("s1", "msg-1", [{ type: "text", text: "x" }] as any)

      assert.ok(msgList.querySelector('[data-message-id="msg-1"]'), "non-empty placeholder kept")
    })

    it("does nothing block-wise when blocks is missing/empty (no addMessage)", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1")
      assert.equal((h.calls.addMessage || []).length, 0, "no addMessage when blocks empty")
    })

    it("shows the ttfb_timeout reason message", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "ttfb_timeout")
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => c[0] === "s1" && String(c[1]).includes("took too long to start responding"),
        ),
      )
    })

    it("shows the timeout (non-partial) reason message", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "timeout", false)
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => String(c[1]).includes("Response timed out"),
        ),
      )
    })

    it("shows the timeout (partial) reason message", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "timeout", true)
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => String(c[1]).includes("Response was cut off (timeout)"),
        ),
      )
    })

    it("shows the hard_timeout reason message", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "hard_timeout")
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => String(c[1]).includes("Stream interrupted after extended run"),
        ),
      )
    })

    it("shows the aborted (user interrupt) reason message", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "aborted")
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => String(c[1]).includes("Generation interrupted by user"),
        ),
        "must show 'Generation interrupted by user.' system message for aborted reason"
      )
    })

    it("aborted reason is NOT retryable", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "aborted")
      // The third argument to showSystemMessage is retryable
      const abortedCall = (h.calls.showSystemMessage || []).find(
        (c) => String(c[1]).includes("Generation interrupted by user"),
      )
      assert.ok(abortedCall, "must find the aborted message call")
      assert.equal(abortedCall![2], false, "aborted reason must NOT be retryable")
    })

    it("shows a generic error message only when there is NO recent error card", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "error")
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => String(c[1]).includes("An error occurred while generating"),
        ),
      )
    })

    it("does NOT stack a generic error card when the session already has a recent error", () => {
      const h = makeHarness()
      // Build a session whose last message is a system/error block.
      h.addSession(session("s1", {
        messages: [
          {
            role: "system",
            id: "sys-1",
            blocks: [{ type: "error", title: "Failure", message: "boom" } as any],
            timestamp: Date.now(),
          } as ChatMessage,
        ],
      }))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.api.handleStreamEnd("s1", "msg-1", undefined, "error")
      const sysCalls = (h.calls.showSystemMessage || []).filter((c) => String(c[1]).includes("An error occurred while generating"))
      assert.equal(sysCalls.length, 0, "no stacked generic card")
    })

    it("refreshes the send button when the ended session is active", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.setActive("s1")
      h.api.handleStreamEnd("s1")
      assert.ok((h.calls.updateSendButtonIcon || []).some((c) => c[0] === false))
      assert.ok((h.calls.updateSendButton || []).length >= 1)
    })

    it("does NOT touch the send button when a different session is active", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.setActive("other")
      h.api.handleStreamEnd("s1")
      assert.equal((h.calls.updateSendButtonIcon || []).length, 0)
    })

    it("logs a warn and skips stream.handleStreamEnd when no stream is registered, but still finalizes", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      // NOTE: no stream registered
      const msgList = document.createElement("div")
      const live = document.createElement("span")
      live.className = "streaming-text"
      msgList.appendChild(live)
      h.setMessageList("s1", msgList)
      h.api.handleStreamEnd("s1")
      assert.ok(h.deps._posted.some((m) => m.level === "warn" && String(m.message).includes("No stream found")))
      assert.equal(msgList.querySelectorAll(".streaming-text").length, 0, "finalize still ran")
      assert.equal(h.sessions.get("s1")!.isStreaming, false)
    })

    it("enters the recovery path when a post-stream step throws: still clears streaming + shows system message", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      // The inner try/catch swallows a stream.handleStreamEnd throw; to reach
      // the outer recovery path we make a step AFTER that throw bail out.
      // `setStreaming` is called once in the main body and again (in its own
      // try/catch) during recovery — the first call throws, the second
      // delegates to the real fake to actually clear the streaming flag.
      const real = h.behavior.setStreaming
      let throwOnce = true
      h.behavior.setStreaming = (id, v) => {
        if (throwOnce) {
          throwOnce = false
          throw new Error("setStreaming broken")
        }
        real(id, v)
      }
      h.api.handleStreamEnd("s1", "msg-1", undefined, "ttfb_timeout")
      assert.ok(h.deps._posted.some((m) => m.level === "error" && String(m.message).includes("handleStreamEnd error")))
      assert.equal(h.sessions.get("s1")!.isStreaming, false, "recovery set streaming false on second call")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led idle", "recovery set agent idle")
      assert.ok(
        (h.calls.showSystemMessage || []).some((c) => String(c[1]).includes("Model took too long")),
        "recovery showed reason-specific message",
      )
      // The stream handler was still invoked before the throw.
      assert.ok(stream.calls.some((c) => c.method === "handleStreamEnd"))
    })

    it("recovers with a generic message for unknown reasons when the body throws", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      let throwOnce = true
      h.behavior.setStreaming = () => {
        if (throwOnce) {
          throwOnce = false
          throw new Error("boom")
        }
      }
      h.api.handleStreamEnd("s1", "msg-1", undefined, undefined)
      assert.ok(
        (h.calls.showSystemMessage || []).some((c) => String(c[1]) === "Unexpected error."),
      )
    })
  })

  // -------------------------------------------------------------------------
  // handleServerStatus
  // -------------------------------------------------------------------------
  describe("handleServerStatus", () => {
    it("no-ops when there is no stream registered for the session", () => {
      const h = makeHarness()
      h.api.handleServerStatus("s1", "executing")
      assert.equal((h.deps.els as any).agentStatusLed.className, "", "no agent mutation")
    })

    it("sets agent status to 'executing' on executing/running", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const stream = h.addStream("s1")
      h.api.handleServerStatus("s1", "executing")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led executing")
      assert.deepEqual(stream.calls.find((c) => c.method === "handleServerStatus")!.args, ["executing", undefined])

      h.api.handleServerStatus("s1", "running")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led executing")
    })

    it("on idle: sets agent idle, finalizes streaming text, finalizes pending tools", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const stream = h.addStream("s1")
      const msgList = document.createElement("div")
      const live = document.createElement("span")
      live.className = "streaming-text"
      msgList.appendChild(live)
      h.setMessageList("s1", msgList)

      h.api.handleServerStatus("s1", "idle")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led idle")
      assert.equal(msgList.querySelectorAll(".streaming-text").length, 0, "streaming-text finalized")
      assert.ok(stream.calls.some((c) => c.method === "finalizePendingTools"))
    })
  })

  // -------------------------------------------------------------------------
  // handleRequestError
  // -------------------------------------------------------------------------
  describe("handleRequestError", () => {
    it("returns early when sessionId is missing AND no session is streaming", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.api.handleRequestError(undefined, "boom")
      // Nothing should have been called.
      assert.equal((h.calls.setStreaming || []).length, 0)
      // (getSession was not called on any stream, etc.)
    })

    it("resolves to the streaming session when sessionId is omitted", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      h.addSession(session("s2"))
      const stream = h.addStream("s1")
      const msgList = document.createElement("div")
      h.setMessageList("s1", msgList)

      h.api.handleRequestError(undefined, "failure")
      assert.equal(h.sessions.get("s1")!.isStreaming, false)
      assert.ok(stream.calls.some((c) => c.method === "handleRequestError" && c.args[0] === "failure"))
      assert.ok(stream.calls.some((c) => c.method === "finalizePendingTools"))
    })

    it("clears streaming, finalizes streaming-text + pending tools when sessionId is provided", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      const msgList = document.createElement("div")
      const live = document.createElement("span")
      live.className = "streaming-text"
      msgList.appendChild(live)
      h.setMessageList("s1", msgList)

      h.api.handleRequestError("s1", "broken")
      assert.equal(h.sessions.get("s1")!.isStreaming, false)
      assert.equal(msgList.querySelectorAll(".streaming-text").length, 0)
      assert.ok(stream.calls.some((c) => c.method === "handleRequestError"))
      assert.ok(stream.calls.some((c) => c.method === "finalizePendingTools"))
    })

    it("refreshes the send button when the failed session is active", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setMessageList("s1", document.createElement("div"))
      h.setActive("s1")
      h.api.handleRequestError("s1")
      assert.ok((h.calls.updateSendButtonIcon || []).some((c) => c[0] === false))
    })
  })

  // -------------------------------------------------------------------------
  // handleDiffResult
  // -------------------------------------------------------------------------
  describe("handleDiffResult", () => {
    it("targets the named session's stream when sessionId is provided", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      const a = h.addStream("s1")
      const b = h.addStream("s2")
      h.api.handleDiffResult("s1", "blk-1", true, "ok")
      assert.ok(a.calls.some((c) => c.method === "handleDiffResult" && JSON.stringify(c.args) === JSON.stringify(["blk-1", true, "ok"])))
      assert.equal(b.calls.filter((c) => c.method === "handleDiffResult").length, 0, "other session untouched")
    })

    it("broadcasts to every session's stream when sessionId is omitted", () => {
      const h = makeHarness()
      const a = h.addStream("s1")
      const b = h.addStream("s2")
      h.api.handleDiffResult(undefined, "blk", true, "ok")
      assert.ok(a.calls.some((c) => c.method === "handleDiffResult"))
      assert.ok(b.calls.some((c) => c.method === "handleDiffResult"))
    })

    it("announces a checkpoint when ok AND checkpointCreated AND there is an active session", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setActive("s1")
      h.api.handleDiffResult("s1", "blk", true, "ok", true)
      assert.ok(
        (h.calls.showSystemMessage || []).some(
          (c) => c[0] === "s1" && String(c[1]).includes("Checkpoint saved"),
        ),
      )
    })

    it("does not announce a checkpoint when ok=false OR checkpointCreated=false", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      h.setActive("s1")
      h.api.handleDiffResult("s1", "blk", false, "nope", true)
      h.api.handleDiffResult("s1", "blk", true, "ok", false)
      assert.equal((h.calls.showSystemMessage || []).length, 0)
    })
  })

  // -------------------------------------------------------------------------
  // handleHostMessage
  // -------------------------------------------------------------------------
  describe("handleHostMessage", () => {
    it("ignores messages with no sessionId", () => {
      const h = makeHarness()
      h.api.handleHostMessage({ role: "assistant", id: "x", blocks: [], timestamp: 0 } as ChatMessage)
      assert.equal((h.calls.addMessage || []).length, 0)
    })

    it("for an assistant message: hides typing, adds the message, sets streaming false, agent idle, syncs mode", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      const msg: ChatMessage = {
        role: "assistant",
        id: "msg-x",
        sessionId: "s1",
        blocks: [{ type: "text", text: "hi" } as any],
        timestamp: 1,
      }
      h.api.handleHostMessage(msg)
      assert.ok(stream.calls.some((c) => c.method === "hideTypingIndicator"))
      assert.ok((h.calls.addMessage || []).some((c) => c[0] === "s1" && c[1] === msg))
      assert.equal(h.sessions.get("s1")!.isStreaming, false)
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led idle")
      assert.ok((h.calls.syncModeUI || []).length >= 1)
    })

    it("for a non-assistant message: does not finalize / hide typing / change streaming", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      const msg: ChatMessage = {
        role: "user",
        id: "u1",
        sessionId: "s1",
        blocks: [{ type: "text", text: "q" } as any],
        timestamp: 1,
      }
      h.api.handleHostMessage(msg)
      assert.equal(stream.calls.filter((c) => c.method === "hideTypingIndicator").length, 0)
      assert.equal(h.sessions.get("s1")!.isStreaming, true, "streaming untouched")
      assert.equal((h.deps.els as any).agentStatusLed.className, "", "agent untouched")
    })

    it("B5: an assistant message carrying a pending question block does NOT terminate streaming or flip the tab to idle", () => {
      // Regression: ChatProvider.ensureQuestionBlock posts an assistant message
      // to render the inline pointer card. Without this guard, handleHostMessage
      // treated *any* assistant message as a final turn → setStreaming(false),
      // updateSendButton, updateAgentStatus("idle") — so the user saw an idle
      // composer while the agent was actually waiting for an answer. Typing
      // into the composer sent a fresh prompt instead of answering the question.
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      const msg: ChatMessage = {
        role: "assistant",
        id: "msg-q",
        sessionId: "s1",
        blocks: [{
          type: "question",
          id: "q-1",
          toolCallId: "q-1",
          requestID: "req-q-1",
          groups: [{ question: "Pick one", options: ["A", "B"], multiSelect: false }],
          text: "Pick one",
          options: ["A", "B"],
          allowFreeText: true,
        } as any],
        timestamp: 1,
      }
      h.api.handleHostMessage(msg)
      // The pointer message IS still added to the transcript…
      assert.ok((h.calls.addMessage || []).some((c) => c[0] === "s1" && c[1] === msg), "pointer message rendered")
      // …but streaming MUST NOT terminate…
      assert.equal(h.sessions.get("s1")!.isStreaming, true, "streaming must stay true while waiting for an answer")
      // …and the agent status MUST NOT flip to idle.
      const ledClass = (h.deps.els as any).agentStatusLed.className
      assert.ok(!ledClass.includes("idle"), "agent status must not flip to idle for a question message")
      assert.equal(stream.calls.filter((c) => c.method === "hideTypingIndicator").length, 0, "typing indicator preserved")
    })

    it("B5: an answered question in an assistant message still terminates streaming normally (only PENDING questions hold the stream open)", () => {
      const h = makeHarness()
      h.addSession(session("s1", { isStreaming: true }))
      const stream = h.addStream("s1")
      const msg: ChatMessage = {
        role: "assistant",
        id: "msg-q-answered",
        sessionId: "s1",
        blocks: [{
          type: "question",
          id: "q-2",
          toolCallId: "q-2",
          requestID: "req-q-2",
          groups: [{ question: "Done?", options: ["Yes"], multiSelect: false }],
          text: "Done?",
          options: ["Yes"],
          allowFreeText: false,
          answered: true,
          answer: "Yes",
        } as any],
        timestamp: 1,
      }
      h.api.handleHostMessage(msg)
      assert.equal(h.sessions.get("s1")!.isStreaming, false, "answered question terminates stream normally")
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led idle")
      assert.ok(stream.calls.some((c) => c.method === "hideTypingIndicator"))
    })
  })

  // -------------------------------------------------------------------------
  // handleCostUpdate
  // -------------------------------------------------------------------------
  describe("handleCostUpdate", () => {
    it("stores a finite cost on the session, saves, and refreshes the recent list", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.api.handleCostUpdate("s1", 0.042)
      assert.equal((h.sessions.get("s1") as any).cost, 0.042)
      assert.ok((h.calls.save || []).length >= 1)
      assert.ok((h.calls.renderRecentSessionsList || []).length >= 1)
    })

    it("ignores NaN / Infinity / non-numeric values", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.api.handleCostUpdate("s1", Number.NaN)
      h.api.handleCostUpdate("s1", Number.POSITIVE_INFINITY)
      assert.equal((h.sessions.get("s1") as any).cost, undefined)
      assert.equal((h.calls.save || []).length, 0)
    })

    it("does nothing when the session does not exist", () => {
      const h = makeHarness()
      h.api.handleCostUpdate("ghost", 1)
      assert.equal((h.calls.save || []).length, 0)
    })
  })

  // -------------------------------------------------------------------------
  // sendQueuedPrompt
  // -------------------------------------------------------------------------
  describe("sendQueuedPrompt", () => {
    it("posts a send_prompt with the active session's model/mode, adds the user message, sets streaming true, sets agent thinking", () => {
      const h = makeHarness()
      h.addSession(session("s1", { model: "anthropic/claude-x", mode: "plan" }))
      h.addStream("s1")
      h.api.sendQueuedPrompt("s1", "hello world")
      assert.equal(h.sessions.get("s1")!.isStreaming, true)
      assert.equal((h.deps.els as any).agentStatusLed.className, "status-led thinking")
      const sendMsg = h.deps._posted.find((m) => m.type === "send_prompt") as any
      assert.ok(sendMsg)
      assert.equal(sendMsg.text, "hello world")
      assert.equal(sendMsg.sessionId, "s1")
      assert.equal(sendMsg.model, "anthropic/claude-x")
      assert.equal(sendMsg.mode, "plan")
      assert.ok(typeof sendMsg.messageId === "string" && sendMsg.messageId.startsWith("msg"))
    })

    it("is a no-op when the session does not exist", () => {
      const h = makeHarness()
      h.api.sendQueuedPrompt("ghost", "x")
      assert.equal(h.deps._posted.find((m) => m.type === "send_prompt"), undefined)
    })

    it("includes attachments on the outgoing send_prompt when provided", () => {
      const h = makeHarness()
      h.addSession(session("s1"))
      h.addStream("s1")
      const atts = [{ data: "base64==", mimeType: "image/png" }]
      h.api.sendQueuedPrompt("s1", "see image", atts)
      const sendMsg = h.deps._posted.find((m) => m.type === "send_prompt") as any
      assert.ok(sendMsg.attachments)
      assert.deepEqual(sendMsg.attachments, atts)
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a `.tab-panel[data-tab-id]` element matching the chunk guard. */
function messageListAsTabPanel(tabId: string): HTMLDivElement {
  const panel = document.createElement("div")
  panel.className = "tab-panel"
  panel.dataset.tabId = tabId
  return panel
}
