import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { hasRecentErrorCard } from "./streamEndErrorPolicy"
import type { ChatMessage } from "../../types"

const errorCard = (id = "e1"): ChatMessage => ({
  role: "system",
  id,
  blocks: [{ type: "error", message: "boom" }],
  timestamp: 1,
})
const userMsg = (id = "u1"): ChatMessage => ({ role: "user", id, blocks: [{ type: "text", text: "hi" }], timestamp: 1 })
const assistantMsg = (id = "a1"): ChatMessage => ({ role: "assistant", id, blocks: [{ type: "text", text: "ok" }], timestamp: 1 })

describe("hasRecentErrorCard", () => {
  it("returns false for an empty transcript", () => {
    assert.equal(hasRecentErrorCard([]), false)
  })

  it("detects an error card as the last message (suppresses the duplicate generic card)", () => {
    assert.equal(hasRecentErrorCard([userMsg(), assistantMsg(), errorCard()]), true)
  })

  it("detects an error card within the recent window even if not last", () => {
    assert.equal(hasRecentErrorCard([userMsg(), errorCard(), assistantMsg()]), true)
  })

  it("ignores an error card older than the window (genuine new error still shows)", () => {
    const msgs = [errorCard("old"), userMsg("u2"), assistantMsg("a2"), assistantMsg("a3")]
    assert.equal(hasRecentErrorCard(msgs), false)
  })

  it("returns false when there is no error card (generic card is allowed)", () => {
    assert.equal(hasRecentErrorCard([userMsg(), assistantMsg()]), false)
  })

  it("does not treat a non-error system message as an error card", () => {
    const activity: ChatMessage = { role: "system", id: "s", blocks: [{ type: "activity", title: "Model switched" }], timestamp: 1 }
    assert.equal(hasRecentErrorCard([userMsg(), activity]), false)
  })

  it("honours a custom window size", () => {
    const msgs = [errorCard("e"), assistantMsg("a")]
    assert.equal(hasRecentErrorCard(msgs, 1), false)
    assert.equal(hasRecentErrorCard(msgs, 2), true)
  })
})
