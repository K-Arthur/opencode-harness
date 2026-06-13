import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isSwitchEventType } from "./switchEvent"

describe("isSwitchEventType", () => {
  it("matches the prefixed forms the normalizer actually emits", () => {
    assert.equal(isSwitchEventType("session.next.agent.switched"), true)
    assert.equal(isSwitchEventType("session.next.model.switched"), true)
  })

  it("still matches the bare forms (backward compatible)", () => {
    assert.equal(isSwitchEventType("agent.switched"), true)
    assert.equal(isSwitchEventType("model.switched"), true)
  })

  it("does not match other activity / unrelated event types", () => {
    assert.equal(isSwitchEventType("session.next.compaction.started"), false)
    assert.equal(isSwitchEventType("session.next.shell.started"), false)
    assert.equal(isSwitchEventType("moved"), false)
    assert.equal(isSwitchEventType("agent.switched.extra"), false)
  })

  it("is safe for non-string inputs", () => {
    assert.equal(isSwitchEventType(undefined), false)
    assert.equal(isSwitchEventType(null), false)
    assert.equal(isSwitchEventType(42), false)
    assert.equal(isSwitchEventType({}), false)
  })
})
