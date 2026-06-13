import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  decideActivityCoalesce,
  activitySignature,
  isSwitchEventType,
  switchInsertIndex,
  decideSwitchPlacement,
} from "./activityCoalesce"
import type { ChatMessage } from "../types"

function activityMsg(signature: string, repeatCount = 1, id = signature): ChatMessage {
  return {
    role: "system",
    id,
    blocks: [{ type: "activity", title: "Model switched", detail: signature, signature, repeatCount }],
    timestamp: 1000,
  }
}

function asst(id: string): ChatMessage {
  return { role: "assistant", id, blocks: [{ type: "text", text: "hi" }], timestamp: 1001 } as ChatMessage
}
function user(id: string): ChatMessage {
  return { role: "user", id, blocks: [{ type: "text", text: "q" }], timestamp: 1000 } as ChatMessage
}
function switchMsg(signature: string, repeatCount = 1, id = signature): ChatMessage {
  return {
    role: "system",
    id,
    blocks: [{ type: "activity", title: "Model switched", detail: signature, signature, repeatCount, eventType: "session.next.model.switched" }],
    timestamp: 1000,
  } as ChatMessage
}

describe("decideActivityCoalesce", () => {
  it("appends when the transcript is empty", () => {
    assert.deepEqual(decideActivityCoalesce([], "model|m"), { kind: "append" })
  })

  it("coalesces an immediately-repeated identical activity (bumps repeatCount)", () => {
    const messages = [activityMsg("model|deepseek")]
    const res = decideActivityCoalesce(messages, "model|deepseek")
    assert.equal(res.kind, "coalesce")
    if (res.kind === "coalesce") {
      assert.equal(res.index, 0)
      assert.equal(res.repeatCount, 2)
    }
  })

  it("keeps counting repeats beyond two", () => {
    const messages = [activityMsg("model|deepseek", 4)]
    const res = decideActivityCoalesce(messages, "model|deepseek")
    assert.equal(res.kind, "coalesce")
    if (res.kind === "coalesce") assert.equal(res.repeatCount, 5)
  })

  it("does NOT coalesce a different activity (distinct signatures stay separate)", () => {
    const messages = [activityMsg("model|deepseek")]
    assert.equal(decideActivityCoalesce(messages, "agent|build").kind, "append")
  })

  it("only matches the LAST message — an interleaved message breaks the run", () => {
    const messages = [
      activityMsg("model|deepseek"),
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "hi" }], timestamp: 1001 } as ChatMessage,
    ]
    assert.equal(decideActivityCoalesce(messages, "model|deepseek").kind, "append")
  })

  it("does not coalesce against a non-activity system message", () => {
    const messages = [
      { role: "system", id: "e1", blocks: [{ type: "error", message: "boom" }], timestamp: 1000 } as ChatMessage,
    ]
    assert.equal(decideActivityCoalesce(messages, "model|deepseek").kind, "append")
  })

  it("treats a missing/invalid repeatCount as 1", () => {
    const messages = [
      { role: "system", id: "x", blocks: [{ type: "activity", signature: "s" }], timestamp: 1 } as ChatMessage,
    ]
    const res = decideActivityCoalesce(messages, "s")
    assert.equal(res.kind, "coalesce")
    if (res.kind === "coalesce") assert.equal(res.repeatCount, 2)
  })
})

describe("isSwitchEventType", () => {
  it("matches prefixed and bare switch event types", () => {
    assert.equal(isSwitchEventType("session.next.agent.switched"), true)
    assert.equal(isSwitchEventType("session.next.model.switched"), true)
    assert.equal(isSwitchEventType("agent.switched"), true)
    assert.equal(isSwitchEventType("model.switched"), true)
  })
  it("rejects other and non-string event types", () => {
    assert.equal(isSwitchEventType("session.next.compaction.started"), false)
    assert.equal(isSwitchEventType(undefined), false)
    assert.equal(isSwitchEventType(7), false)
  })
})

describe("switchInsertIndex", () => {
  it("appends when the transcript is empty", () => {
    assert.equal(switchInsertIndex([]), 0)
  })
  it("inserts before a trailing assistant generation", () => {
    // [user, assistant] -> switch belongs before index 1 (the assistant)
    assert.equal(switchInsertIndex([user("u1"), asst("a1")]), 1)
  })
  it("inserts before the START of a consecutive trailing assistant run", () => {
    assert.equal(switchInsertIndex([user("u1"), asst("a1"), asst("a2")]), 1)
  })
  it("appends when the transcript ends in a user message (next gen not streamed)", () => {
    assert.equal(switchInsertIndex([user("u1"), asst("a1"), user("u2")]), 3)
  })
  it("appends when the transcript ends in a system message", () => {
    assert.equal(switchInsertIndex([asst("a1"), switchMsg("model|x")]), 2)
  })
})

describe("decideSwitchPlacement", () => {
  it("inserts before the trailing assistant when no prior switch is adjacent", () => {
    const res = decideSwitchPlacement([user("u1"), asst("a1")], "model|x")
    assert.deepEqual(res, { kind: "insert", index: 1 })
  })
  it("coalesces with an identical switch already sitting before the generation (×N preserved)", () => {
    // [user, switch(model|x), assistant] — a repeat of model|x should bump the
    // existing badge at index 1, NOT stack a second one.
    const messages = [user("u1"), switchMsg("model|x"), asst("a1")]
    const res = decideSwitchPlacement(messages, "model|x")
    assert.equal(res.kind, "coalesce")
    if (res.kind === "coalesce") {
      assert.equal(res.index, 1)
      assert.equal(res.repeatCount, 2)
    }
  })
  it("does not coalesce a different switch signature (inserts before the generation, after the existing badge)", () => {
    const messages = [user("u1"), switchMsg("model|x"), asst("a1")]
    const res = decideSwitchPlacement(messages, "agent|build")
    assert.deepEqual(res, { kind: "insert", index: 2 })
  })
  it("appends a switch at the end when the turn has only a user message", () => {
    const res = decideSwitchPlacement([user("u1")], "model|x")
    assert.deepEqual(res, { kind: "insert", index: 1 })
  })
})

describe("activitySignature", () => {
  it("combines eventType, title and detail", () => {
    assert.equal(activitySignature("session.next.model.switched", "Model switched", "opencode/x"),
      "session.next.model.switched|Model switched|opencode/x")
  })

  it("is stable for identical content (so repeats coalesce)", () => {
    const a = activitySignature("e", "Title", "detail")
    const b = activitySignature("e", "Title", "detail")
    assert.equal(a, b)
  })

  it("differs when content differs (so distinct events stay separate)", () => {
    assert.notEqual(activitySignature("e", "Title", "X"), activitySignature("e", "Title", "Y"))
  })

  it("normalises whitespace and bounds length", () => {
    assert.equal(activitySignature("e", "a\n  b", "c"), "e|a b|c")
    assert.ok(activitySignature("e", "t", "d".repeat(500)).length <= 200)
  })
})
