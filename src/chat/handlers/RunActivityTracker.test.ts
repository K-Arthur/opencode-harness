import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { RunActivityTracker } from "./RunActivityTracker"

describe("RunActivityTracker", () => {
  it("treats tool activity as first OpenCode activity", () => {
    let now = 1_000
    const tracker = new RunActivityTracker(() => now)
    tracker.startRun({ tabId: "tab-1", cliSessionId: "ses-1", messageId: "msg-1" })

    now += 46_000
    assert.equal(tracker.shouldTriggerStartupTimeout("tab-1", 45_000), true)

    tracker.recordTool("tab-1", { id: "tool-1", name: "bash", status: "running" })

    assert.equal(tracker.shouldTriggerStartupTimeout("tab-1", 45_000), false)
    const snapshot = tracker.getSnapshot("tab-1")
    assert.equal(snapshot?.phase, "waiting_on_tool")
    assert.equal(snapshot?.firstActivityAt, now)
    assert.equal(snapshot?.activeToolCount, 1)
    assert.equal(snapshot?.statusLabel, "Running tool: bash")
  })

  it("treats subagent activity as liveness during quiet parent output", () => {
    let now = 2_000
    const tracker = new RunActivityTracker(() => now)
    tracker.startRun({ tabId: "tab-2", cliSessionId: "ses-2", messageId: "msg-2" })

    tracker.recordSubagent("tab-2", {
      id: "sub-1",
      agentName: "UI Audit",
      status: "running",
      currentActivity: "running file analysis",
    })
    now += 10 * 60_000

    assert.equal(tracker.shouldTriggerStartupTimeout("tab-2", 45_000), false)
    assert.equal(tracker.getFinalizeDeferReason("tab-2"), "1 subagent running")
    assert.equal(tracker.getSnapshot("tab-2")?.statusLabel, "Subagent: UI Audit - running file analysis")
  })

  it("marks run completion only after tools and subagents resolve", () => {
    const tracker = new RunActivityTracker(() => 5_000)
    tracker.startRun({ tabId: "tab-3", cliSessionId: "ses-3", messageId: "msg-3" })
    tracker.recordTool("tab-3", { id: "tool-1", name: "read", status: "running" })
    tracker.recordSubagent("tab-3", { id: "sub-1", agentName: "Reviewer", status: "running" })

    assert.equal(tracker.getFinalizeDeferReason("tab-3"), "1 tool running")

    tracker.recordTool("tab-3", { id: "tool-1", name: "read", status: "completed" })
    assert.equal(tracker.getFinalizeDeferReason("tab-3"), "1 subagent running")

    tracker.recordSubagent("tab-3", { id: "sub-1", agentName: "Reviewer", status: "completed" })
    assert.equal(tracker.getFinalizeDeferReason("tab-3"), null)

    tracker.markRunComplete("tab-3")
    assert.equal(tracker.getSnapshot("tab-3")?.phase, "completed")
  })

  it("markRunComplete transitions queued, running, waiting and unknown subagents to completed with completedAt", () => {
    let now = 7_000
    const tracker = new RunActivityTracker(() => now)
    tracker.startRun({ tabId: "tab-5", cliSessionId: "ses-5", messageId: "msg-5" })
    tracker.recordSubagent("tab-5", { id: "sub-q", agentName: "Queued", status: "queued" })
    tracker.recordSubagent("tab-5", { id: "sub-r", agentName: "Runner", status: "running" })
    tracker.recordSubagent("tab-5", { id: "sub-w", agentName: "Waiter", status: "waiting" })
    tracker.recordSubagent("tab-5", { id: "sub-u", agentName: "Mystery", status: "unknown" })

    now += 1_000
    const snapshot = tracker.markRunComplete("tab-5")

    const subagents = snapshot?.subagents ?? []
    for (const id of ["sub-q", "sub-r", "sub-w", "sub-u"]) {
      const found = subagents.find((s) => s.id === id)
      assert.equal(found?.status, "completed", `${id} should be completed`)
      assert.equal(found?.completedAt, now, `${id} should have completedAt`)
    }
    assert.equal(snapshot?.activeSubagentCount, 0)
  })

  it("markRunComplete leaves already-failed subagents untouched", () => {
    let now = 8_000
    const tracker = new RunActivityTracker(() => now)
    tracker.startRun({ tabId: "tab-6", cliSessionId: "ses-6", messageId: "msg-6" })
    tracker.recordSubagent("tab-6", { id: "sub-f", agentName: "Failer", status: "failed", error: "boom" })
    const failedAt = now

    now += 1_000
    const snapshot = tracker.markRunComplete("tab-6")

    const failed = snapshot?.subagents.find((s) => s.id === "sub-f")
    assert.equal(failed?.status, "failed")
    assert.equal(failed?.completedAt, failedAt)
    assert.equal(failed?.error, "boom")
  })

  it("markRunCancelled transitions active subagents to cancelled", () => {
    let now = 9_000
    const tracker = new RunActivityTracker(() => now)
    tracker.startRun({ tabId: "tab-7", cliSessionId: "ses-7", messageId: "msg-7" })
    tracker.recordSubagent("tab-7", { id: "sub-r", agentName: "Runner", status: "running" })
    tracker.recordSubagent("tab-7", { id: "sub-done", agentName: "Done", status: "completed" })
    const doneAt = now

    now += 500
    const snapshot = tracker.markRunCancelled("tab-7")

    const cancelled = snapshot?.subagents.find((s) => s.id === "sub-r")
    assert.equal(cancelled?.status, "cancelled")
    assert.equal(cancelled?.completedAt, now)
    const done = snapshot?.subagents.find((s) => s.id === "sub-done")
    assert.equal(done?.status, "completed")
    assert.equal(done?.completedAt, doneAt)
    assert.equal(snapshot?.activeSubagentCount, 0)
  })

  it("distinguishes user cancellation from unknown interruption", () => {
    const tracker = new RunActivityTracker(() => 6_000)
    tracker.startRun({ tabId: "tab-4", cliSessionId: "ses-4", messageId: "msg-4" })

    tracker.markRunCancelled("tab-4", "User cancelled the run")

    const snapshot = tracker.getSnapshot("tab-4")
    assert.equal(snapshot?.phase, "cancelled")
    assert.equal(snapshot?.statusLabel, "Cancelled")
    assert.equal(snapshot?.lastError?.kind, "user_cancelled")
  })

  // RED: these tests require { includeChildLinked } support on markActiveSubagentsUnresolved
  it("force_marks_child_linked_subagents_unresolved_when_forced", () => {
    const tracker = new RunActivityTracker(() => 10_000)
    tracker.startRun({ tabId: "tab-force", cliSessionId: "ses-f", messageId: "msg-f" })
    tracker.recordSubagent("tab-force", {
      id: "sub-linked",
      agentName: "ChildAgent",
      status: "running",
      childSessionId: "ses-child-1",
    })

    // Without force: child-linked subagent is skipped
    tracker.markActiveSubagentsUnresolved("tab-force", "grace expired")
    const afterNormal = tracker.getSnapshot("tab-force")
    const linkedAfterNormal = afterNormal?.subagents.find(s => s.id === "sub-linked")
    assert.equal(linkedAfterNormal?.status, "running", "child-linked subagent must not be marked by normal call")

    // With force: child-linked subagent must be terminated
    tracker.markActiveSubagentsUnresolved("tab-force", "grace escalated", { includeChildLinked: true })
    const afterForced = tracker.getSnapshot("tab-force")
    const linkedAfterForced = afterForced?.subagents.find(s => s.id === "sub-linked")
    assert.equal(linkedAfterForced?.status, "failed", "child-linked subagent must be marked failed when forced")
  })

  it("markActiveSubagentsUnresolved_returns_changed_flag", () => {
    const tracker = new RunActivityTracker(() => 10_000)
    tracker.startRun({ tabId: "tab-changed", cliSessionId: "ses-c", messageId: "msg-c" })
    tracker.recordSubagent("tab-changed", { id: "sub-1", agentName: "A", status: "running" })

    const snap = tracker.markActiveSubagentsUnresolved("tab-changed", "msg")
    // After marking, activeSubagentCount should be 0 (sub-1 has no childSessionId → marked immediately)
    assert.equal(snap?.activeSubagentCount, 0)
  })
})
