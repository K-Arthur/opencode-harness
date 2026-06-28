import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  }
  ;(globalThis as any).CustomEvent = dom.window.CustomEvent
}

void describe("subagent auto-open policy", () => {
  beforeEach(() => setupDom())

  void it("reconcileSubagentStatuses transitions dropped subagents from running to completed", async () => {
    const mod = await import("./subagentReconciler")
    const prev = [
      { id: "s1", name: "Agent 1", status: "running" as const, isLive: true, unreadActivityCount: 0 },
      { id: "s2", name: "Agent 2", status: "running" as const, isLive: true, unreadActivityCount: 0 },
    ]
    const incoming = [
      { id: "s2", name: "Agent 2", status: "completed" as const, isLive: false, unreadActivityCount: 0 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, incoming)
    const s1 = result.find(a => a.id === "s1")!
    assert.ok(s1, "s1 must be in result")
    assert.equal(s1.status, "completed", "dropped subagent must be reconciled to completed")
    assert.ok(s1.completedAt, "completedAt must be set")
    assert.equal(s1.isLive, false, "isLive must be false")

    const s2 = result.find(a => a.id === "s2")!
    assert.ok(s2, "s2 must be in result")
    assert.equal(s2.status, "completed", "s2 keeps its incoming status")
  })

  void it("reconcileSubagentStatuses keeps completed subagents unchanged when still present", async () => {
    const mod = await import("./subagentReconciler")
    const prev = [
      { id: "s1", name: "Agent 1", status: "completed" as const, isLive: false, unreadActivityCount: 0 },
    ]
    const incoming = [
      { id: "s1", name: "Agent 1", status: "completed" as const, isLive: false, unreadActivityCount: 0 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, incoming)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.status, "completed")
  })

  void it("reconcileSubagentStatuses preserves running status when still in snapshot", async () => {
    const mod = await import("./subagentReconciler")
    const prev = [
      { id: "s1", name: "Agent 1", status: "running" as const, isLive: true, unreadActivityCount: 0 },
    ]
    const incoming = [
      { id: "s1", name: "Agent 1", status: "running" as const, isLive: true, unreadActivityCount: 1 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, incoming)
    assert.equal(result[0]!.status, "running")
    assert.equal(result[0]!.unreadActivityCount, 1)
  })

  void it("reconcileSubagentStatuses handles empty incoming (all dropped)", async () => {
    const mod = await import("./subagentReconciler")
    const prev = [
      { id: "s1", name: "Agent 1", status: "running" as const, isLive: true, unreadActivityCount: 0 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, [])
    assert.equal(result[0]!.status, "completed", "all dropped live subagents must become completed")
    assert.equal(result[0]!.isLive, false)
  })

  void it("reconcileSubagentStatuses does not transition already-completed dropped subagents", async () => {
    const mod = await import("./subagentReconciler")
    const prev = [
      { id: "s1", name: "Agent 1", status: "failed" as const, isLive: false, unreadActivityCount: 0 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, [])
    assert.equal(result[0]!.status, "failed", "already-terminal subagent keeps its status")
  })

  void it("computeNewSubagentIds returns only ids not in previous set", async () => {
    const mod = await import("./subagentReconciler")
    const prevIds = new Set(["s1", "s2"])
    const incoming = [
      { id: "s2", name: "Agent 2" },
      { id: "s3", name: "Agent 3" },
    ]
    const newIds = mod.computeNewSubagentIds(prevIds, incoming)
    assert.deepEqual(newIds, new Set(["s3"]), "only s3 is new")
  })

  void it("computeNewSubagentIds returns empty set when all are known", async () => {
    const mod = await import("./subagentReconciler")
    const prevIds = new Set(["s1", "s2"])
    const incoming = [
      { id: "s1", name: "Agent 1" },
      { id: "s2", name: "Agent 2" },
    ]
    const newIds = mod.computeNewSubagentIds(prevIds, incoming)
    assert.equal(newIds.size, 0, "no new ids")
  })

  void it("capCompletedSubagents keeps at most MAX_COMPLETED newest completed, all live", async () => {
    const mod = await import("./subagentReconciler")
    const MAX = 10
    const activities = [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`, name: `Completed ${i}`, status: "completed" as const,
        isLive: false, unreadActivityCount: 0, completedAt: 1000 + i,
      })),
      { id: "r1", name: "Runner", status: "running" as const, isLive: true, unreadActivityCount: 0 },
    ]
    const result = mod.capCompletedSubagents(activities, MAX)
    const completed = result.filter(a => a.status === "completed")
    const live = result.filter(a => a.isLive)
    assert.equal(completed.length, MAX, "must cap completed at MAX")
    assert.equal(live.length, 1, "must keep all live subagents")
    assert.ok(completed[0]!.completedAt! >= completed[9]!.completedAt!, "must be newest-first")
  })
})

void describe("subagent isLive recompute (stale flag fix)", () => {
  beforeEach(() => setupDom())

  void it("computeIsLive returns true for running/pending/queued/waiting/unknown", async () => {
    const mod = await import("./subagentReconciler")
    assert.equal(mod.computeIsLive("running"), true)
    assert.equal(mod.computeIsLive("pending"), true)
    assert.equal(mod.computeIsLive("queued"), true)
    assert.equal(mod.computeIsLive("waiting"), true)
    assert.equal(mod.computeIsLive("unknown"), true)
  })

  void it("computeIsLive returns false for completed/failed/cancelled", async () => {
    const mod = await import("./subagentReconciler")
    assert.equal(mod.computeIsLive("completed"), false)
    assert.equal(mod.computeIsLive("failed"), false)
    assert.equal(mod.computeIsLive("cancelled"), false)
  })

  void it("recomputeActivityLiveness flips stale isLive=true to false on completed status", async () => {
    const mod = await import("./subagentReconciler")
    const stale = {
      id: "s1", name: "Agent 1", status: "completed" as const,
      isLive: true, unreadActivityCount: 0, // stale isLive=true despite completed
    }
    const result = mod.recomputeActivityLiveness(stale)
    assert.equal(result.isLive, false, "isLive must be recomputed to false for completed status")
    assert.equal(result.status, "completed", "status must be preserved")
    assert.ok(result.completedAt, "completedAt must be set on terminal status")
  })

  void it("recomputeActivityLiveness preserves existing completedAt", async () => {
    const mod = await import("./subagentReconciler")
    const existing = {
      id: "s1", name: "Agent 1", status: "failed" as const,
      isLive: true, unreadActivityCount: 0, completedAt: 12345,
    }
    const result = mod.recomputeActivityLiveness(existing)
    assert.equal(result.completedAt, 12345, "existing completedAt must not be overwritten")
    assert.equal(result.isLive, false, "isLive must be false for failed status")
  })

  void it("reconcileSubagentStatuses recomputes isLive when incoming omits it", async () => {
    const mod = await import("./subagentReconciler")
    const prev = [
      { id: "s1", name: "Agent 1", status: "running" as const, isLive: true, unreadActivityCount: 0 },
    ]
    // Incoming carries status=completed but NO isLive field — the spread merge
    // alone would preserve the stale isLive=true from prev.
    const incoming = [
      { id: "s1", name: "Agent 1", status: "completed" as const, isLive: true, unreadActivityCount: 0 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, incoming)
    assert.equal(result[0]!.status, "completed")
    assert.equal(result[0]!.isLive, false, "isLive must be recomputed to false despite stale prev value")
  })

  void it("reconcileSubagentStatuses recomputes isLive for already-terminal dropped subagents", async () => {
    const mod = await import("./subagentReconciler")
    // A completed subagent with a stale isLive=true that disappears from the
    // snapshot must have isLive recomputed to false (not preserved as true).
    const prev = [
      { id: "s1", name: "Agent 1", status: "completed" as const, isLive: true, unreadActivityCount: 0, completedAt: 100 },
    ]
    const result = mod.reconcileSubagentStatuses(prev, [])
    assert.equal(result[0]!.status, "completed", "already-terminal dropped subagent keeps its status")
    assert.equal(result[0]!.isLive, false, "isLive must be recomputed to false even for previously-terminal entries")
  })
})
