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

  it("distinguishes user cancellation from unknown interruption", () => {
    const tracker = new RunActivityTracker(() => 6_000)
    tracker.startRun({ tabId: "tab-4", cliSessionId: "ses-4", messageId: "msg-4" })

    tracker.markRunCancelled("tab-4", "User cancelled the run")

    const snapshot = tracker.getSnapshot("tab-4")
    assert.equal(snapshot?.phase, "cancelled")
    assert.equal(snapshot?.statusLabel, "Cancelled")
    assert.equal(snapshot?.lastError?.kind, "user_cancelled")
  })
})
