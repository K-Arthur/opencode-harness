import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decideActivityCoalesce, activitySignature } from "./activityCoalesce"
import type { ChatMessage } from "../types"

function activityMsg(signature: string, repeatCount = 1, id = signature): ChatMessage {
  return {
    role: "system",
    id,
    blocks: [{ type: "activity", title: "Model switched", detail: signature, signature, repeatCount }],
    timestamp: 1000,
  }
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
