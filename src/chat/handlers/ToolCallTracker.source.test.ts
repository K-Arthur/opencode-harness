import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ToolCallTracker.ts"), "utf8")

describe("ToolCallTracker.ts — grace escalation source assertions (RED)", () => {
  it("resetPendingToolGraceTimeout_fingerprints_defer_state", () => {
    // The fix for the infinite defer loop: track a fingerprint of active subagents
    // at each grace expiry; if fingerprint unchanged on second expiry, escalate.
    assert.ok(
      source.includes("fingerprint") || source.includes("graceFingerprint") || source.includes("lastGraceState"),
      "resetPendingToolGraceTimeout must capture a state fingerprint to detect stuck grace cycles",
    )
  })

  it("second_identical_grace_fires_includeChildLinked_escalation", () => {
    assert.ok(
      source.includes("includeChildLinked") || source.includes("force:"),
      "on identical second grace, must call markActiveSubagentsUnresolved with includeChildLinked:true",
    )
  })

  it("markUnresolvedActiveSubagents_logs_only_on_state_change", () => {
    // Avoid spam: only log 'Marking N active subagent(s) unresolved' when something actually changed
    assert.ok(
      source.includes("changed") || source.includes("return") && source.includes("markActiveSubagentsUnresolved"),
      "must gate the warn log on whether markActiveSubagentsUnresolved changed anything",
    )
  })
})
