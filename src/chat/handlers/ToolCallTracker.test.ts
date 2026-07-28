/**
 * Behavioral tests for ToolCallTracker's bounded-reconciliation primitives:
 * reconcilePendingToolCallsFromServer and markUnresolvedPendingToolCalls.
 *
 * These are the mechanisms responsible for converging a tab's pending tool
 * calls to a terminal state once the server reports idle/completed — the
 * exact machinery a "tool call spins forever" bug means either isn't being
 * called, or isn't working. Real function calls against a real
 * ToolCallTracker instance with fake (dependency-injected) collaborators, not
 * source-text assertions — see CLAUDE.md "No mocks in source: mocks only in
 * test files, use dependency injection".
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { ToolCallTracker, type ToolCallTrackerDeps } from "./ToolCallTracker"
import type { TabManager, TabState } from "../TabManager"
import type { SessionManager } from "../../session/SessionManager"
import type { RunActivityTracker } from "./RunActivityTracker"
import type { StreamCallbacks } from "./StreamCoordinatorTypes"
import type { Block } from "../types"

const TAB_ID = "tab-1"

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: TAB_ID,
    cliSessionId: "cli-1",
    streamingBuffer: "",
    waitingForCompletion: true,
    completionTimeout: null,
    isStreaming: true,
    model: "",
    mode: "build",
    lastActivityTime: Date.now(),
    blocksBuffer: [],
    ...overrides,
  }
}

function toolCallBlock(id: string, name = "read"): Block {
  return { type: "tool-call", id, name } as Block
}

/** Minimal fake SDK message row shaped like SessionManager.getSessionMessages's result. */
function assistantRow(parts: Array<Record<string, unknown>>, messageId = "msg-1") {
  return {
    info: { id: messageId, role: "assistant" } as unknown,
    parts,
  } as unknown as { info: { role: "assistant" | "user"; id?: string }; parts: Record<string, unknown>[] }
}

function toolPart(opts: { id: string; tool: string; status: string; output?: string; error?: string }) {
  return {
    type: "tool",
    id: opts.id,
    tool: opts.tool,
    state: {
      status: opts.status,
      ...(opts.output !== undefined ? { output: opts.output } : {}),
      ...(opts.error !== undefined ? { error: opts.error } : {}),
    },
  }
}

interface Harness {
  tracker: ToolCallTracker
  tab: TabState
  activeToolCallIds: Map<string, Set<string>>
  postedMessages: Record<string, unknown>[]
  activityRecords: Array<{ tabId: string; activity: unknown }>
  callbacks: StreamCallbacks
  setServerMessages: (rows: ReturnType<typeof assistantRow>[]) => void
  getSessionMessagesCallCount: () => number
}

function buildHarness(tabOverrides: Partial<TabState> = {}): Harness {
  const tab = makeTab(tabOverrides)
  const activeToolCallIds = new Map<string, Set<string>>()
  const postedMessages: Record<string, unknown>[] = []
  const activityRecords: Array<{ tabId: string; activity: unknown }> = []
  let serverRows: ReturnType<typeof assistantRow>[] = []
  let callCount = 0

  const fakeTabManager = {
    getTab: (id: string) => (id === tab.id ? tab : undefined),
  } as unknown as TabManager

  const fakeSessionManager = {
    getSessionMessages: async (_cliSessionId: string) => {
      callCount++
      return serverRows
    },
  } as unknown as SessionManager

  const callbacks: StreamCallbacks = {
    postMessage: (msg) => {
      postedMessages.push(msg)
      return true
    },
    postRequestError: () => {},
  }

  const deps: ToolCallTrackerDeps = {
    tabManager: fakeTabManager,
    activityTracker: {} as RunActivityTracker,
    activeToolCallIds,
    toolCallCounts: new Map(),
    toolActivityAt: new Map(),
    pendingToolGraceTimeouts: new Map(),
    TOOL_FINALIZE_GRACE_MS: 30000,
    getSm: () => fakeSessionManager,
    stopToolPartialPolling: () => {},
    recordToolRunActivity: (tabId, activity) => {
      activityRecords.push({ tabId, activity })
    },
    postRunActivitySnapshot: () => {},
    maybeFinalizeStream: async () => false,
  }

  return {
    tracker: new ToolCallTracker(deps),
    tab,
    activeToolCallIds,
    postedMessages,
    activityRecords,
    callbacks,
    setServerMessages: (rows) => {
      serverRows = rows
    },
    getSessionMessagesCallCount: () => callCount,
  }
}

describe("ToolCallTracker.reconcilePendingToolCallsFromServer", () => {
  it("is a no-op when nothing is pending (zero pending tools)", async () => {
    const h = buildHarness()
    await h.tracker.reconcilePendingToolCallsFromServer(TAB_ID, h.callbacks)
    assert.equal(h.getSessionMessagesCallCount(), 0, "must not hit the server when there is nothing to reconcile")
    assert.deepEqual(h.postedMessages, [])
  })

  it("resolves a single pending tool the server reports completed", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"))
    h.setServerMessages([
      assistantRow([toolPart({ id: "tool-1", tool: "read", status: "completed", output: "file contents" })]),
    ])

    await h.tracker.reconcilePendingToolCallsFromServer(TAB_ID, h.callbacks)

    assert.equal(h.activeToolCallIds.get(TAB_ID), undefined, "resolved tool must be cleared from the pending set")
    const end = h.postedMessages.find((m) => m.type === "stream_tool_end")
    assert.ok(end, "must post stream_tool_end for the resolved tool")
    assert.equal((end!.result as { ok: boolean }).ok, true)
  })

  it("resolves a pending tool the server reports errored", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "bash"))
    h.setServerMessages([
      assistantRow([toolPart({ id: "tool-1", tool: "bash", status: "error", error: "exit 1" })]),
    ])

    await h.tracker.reconcilePendingToolCallsFromServer(TAB_ID, h.callbacks)

    assert.equal(h.activeToolCallIds.get(TAB_ID), undefined)
    const end = h.postedMessages.find((m) => m.type === "stream_tool_end")
    assert.equal((end!.result as { ok: boolean }).ok, false)
  })

  it("leaves a tool pending when the server still reports it running (non-terminal)", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"))
    h.setServerMessages([
      assistantRow([toolPart({ id: "tool-1", tool: "read", status: "running" })]),
    ])

    await h.tracker.reconcilePendingToolCallsFromServer(TAB_ID, h.callbacks)

    assert.deepEqual(h.activeToolCallIds.get(TAB_ID), new Set(["tool-1"]), "still-running tool must stay pending")
    assert.equal(h.postedMessages.find((m) => m.type === "stream_tool_end"), undefined)
  })

  it("resolves only the terminal calls out of multiple pending tools", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1", "tool-2"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"), toolCallBlock("tool-2", "bash"))
    h.setServerMessages([
      assistantRow([
        toolPart({ id: "tool-1", tool: "read", status: "completed", output: "ok" }),
        toolPart({ id: "tool-2", tool: "bash", status: "running" }),
      ]),
    ])

    await h.tracker.reconcilePendingToolCallsFromServer(TAB_ID, h.callbacks)

    assert.deepEqual(h.activeToolCallIds.get(TAB_ID), new Set(["tool-2"]))
  })

  it("does not throw when the server fetch fails (graceful degradation)", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"))
    const failingSm = {
      getSessionMessages: async () => { throw new Error("network down") },
    } as unknown as SessionManager
    const deps: ToolCallTrackerDeps = {
      tabManager: { getTab: () => h.tab } as unknown as TabManager,
      activityTracker: {} as RunActivityTracker,
      activeToolCallIds: h.activeToolCallIds,
      toolCallCounts: new Map(),
      toolActivityAt: new Map(),
      pendingToolGraceTimeouts: new Map(),
      TOOL_FINALIZE_GRACE_MS: 30000,
      getSm: () => failingSm,
      stopToolPartialPolling: () => {},
      recordToolRunActivity: () => {},
      postRunActivitySnapshot: () => {},
      maybeFinalizeStream: async () => false,
    }
    const tracker = new ToolCallTracker(deps)

    await assert.doesNotReject(() => tracker.reconcilePendingToolCallsFromServer(TAB_ID, h.callbacks))
    assert.deepEqual(h.activeToolCallIds.get(TAB_ID), new Set(["tool-1"]), "pending state survives a failed fetch")
  })
})

describe("ToolCallTracker.markUnresolvedPendingToolCalls", () => {
  it("is idempotent — a second call with nothing pending is a safe no-op", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"))
    h.setServerMessages([]) // reconciliation can't resolve it → falls through to unresolved

    await h.tracker.markUnresolvedPendingToolCalls(TAB_ID, h.callbacks)
    assert.equal(h.activeToolCallIds.get(TAB_ID), undefined)
    const firstUnresolvedCount = h.postedMessages.filter((m) => m.type === "stream_tool_unresolved").length
    assert.equal(firstUnresolvedCount, 1)

    // Second call: nothing pending anymore — must not post a duplicate.
    await h.tracker.markUnresolvedPendingToolCalls(TAB_ID, h.callbacks)
    const secondUnresolvedCount = h.postedMessages.filter((m) => m.type === "stream_tool_unresolved").length
    assert.equal(secondUnresolvedCount, 1, "must not re-emit stream_tool_unresolved for an already-resolved tab")
  })

  it("marks a tool the server can't confirm as unresolved with an honest message", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"))
    h.setServerMessages([
      assistantRow([toolPart({ id: "tool-1", tool: "read", status: "running" })]),
    ])

    await h.tracker.markUnresolvedPendingToolCalls(TAB_ID, h.callbacks)

    assert.equal(h.activeToolCallIds.get(TAB_ID), undefined, "pending set must be cleared — nothing left spinning")
    const unresolved = h.postedMessages.find((m) => m.type === "stream_tool_unresolved")
    assert.ok(unresolved, "must post stream_tool_unresolved")
    assert.equal(unresolved!.toolCallId, "tool-1")
    assert.equal(unresolved!.message, "Tool did not emit a completion event before the server became idle.")
    const activity = h.activityRecords.find((r) => (r.activity as { id: string }).id === "tool-1")
    assert.equal((activity!.activity as { status: string }).status, "unresolved", "activity timeline must also converge")
  })

  it("resolves via reconciliation first — a tool the server confirms completed is NOT marked unresolved", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "read"))
    h.setServerMessages([
      assistantRow([toolPart({ id: "tool-1", tool: "read", status: "completed", output: "ok" })]),
    ])

    await h.tracker.markUnresolvedPendingToolCalls(TAB_ID, h.callbacks)

    assert.equal(h.postedMessages.find((m) => m.type === "stream_tool_unresolved"), undefined)
    const end = h.postedMessages.find((m) => m.type === "stream_tool_end")
    assert.ok(end, "a confirmable completion must win over the unresolved fallback")
  })

  it("handles zero, one, and multiple pending tools", async () => {
    const zero = buildHarness()
    await zero.tracker.markUnresolvedPendingToolCalls(TAB_ID, zero.callbacks)
    assert.deepEqual(zero.postedMessages, [])

    const many = buildHarness()
    many.activeToolCallIds.set(TAB_ID, new Set(["tool-1", "tool-2", "tool-3"]))
    many.tab.blocksBuffer.push(toolCallBlock("tool-1"), toolCallBlock("tool-2"), toolCallBlock("tool-3"))
    many.setServerMessages([])
    await many.tracker.markUnresolvedPendingToolCalls(TAB_ID, many.callbacks)
    assert.equal(many.activeToolCallIds.get(TAB_ID), undefined)
    assert.equal(many.postedMessages.filter((m) => m.type === "stream_tool_unresolved").length, 3)
  })

  it("skips an unanswered question block — it is waiting on the user, not orphaned", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["q-1"]))
    h.tab.blocksBuffer.push({ type: "question", id: "q-1", answered: false } as Block)
    h.setServerMessages([])

    await h.tracker.markUnresolvedPendingToolCalls(TAB_ID, h.callbacks)

    assert.deepEqual(h.activeToolCallIds.get(TAB_ID), new Set(["q-1"]), "unanswered question must stay pending")
    assert.equal(h.postedMessages.find((m) => m.type === "stream_tool_unresolved"), undefined)
  })

  it("skips a subagent tool call — tracked by the heartbeat mechanism instead", async () => {
    const h = buildHarness()
    h.activeToolCallIds.set(TAB_ID, new Set(["tool-1"]))
    h.tab.blocksBuffer.push(toolCallBlock("tool-1", "task"))
    h.setServerMessages([])

    await h.tracker.markUnresolvedPendingToolCalls(TAB_ID, h.callbacks)

    assert.deepEqual(h.activeToolCallIds.get(TAB_ID), new Set(["tool-1"]), "subagent tool call must stay pending")
    assert.equal(h.postedMessages.find((m) => m.type === "stream_tool_unresolved"), undefined)
  })
})
