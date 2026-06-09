import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "virtualList.ts"), "utf8")

void describe("virtualList.ts", () => {
  void it("uses dynamic prune and keep-alive thresholds", () => {
    assert.ok(source.includes("getPruneThreshold"), "must compute prune threshold dynamically")
    assert.ok(source.includes("getKeepAliveCounts"), "must compute keep-alive counts dynamically")
    assert.ok(source.includes("LONG_SESSION_PRUNE_BONUS"), "long sessions must get a larger pruning threshold")
  })

  void it("keeps active, focused, and recently added messages attached", () => {
    assert.ok(source.includes("mustKeepAttached"), "must have a keep-attached guard")
    assert.ok(source.includes(":focus-within"), "focused messages must not be detached")
    assert.ok(source.includes("recentlyAdded"), "recent messages must not be detached")
    assert.ok(source.includes(".streaming-text"), "active streaming text must not be detached")
  })

  void it("uses message complexity when deciding how much context to retain", () => {
    assert.ok(source.includes("messageComplexity"), "must score message complexity")
    assert.ok(source.includes('block.type === "code"'), "code blocks should increase complexity")
    assert.ok(source.includes('block.type === "diff"'), "diff blocks should increase complexity")
    assert.ok(source.includes('block.type === "tool-call"'), "tool blocks should increase complexity")
  })

  void it("handles detach and restore failures without leaving stale entries", () => {
    assert.ok(source.includes("try {"), "detach/restore must guard DOM replacement")
    assert.ok(source.includes("this.entries.delete(msgId)"), "failed restore must clear stale entries")
  })
})
