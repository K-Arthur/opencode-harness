/**
 * At stream_end the host sends authoritative blocks ([...blocksBuffer]) and the
 * webview's mergeServerBlocks rebuilds the message from them. A question must
 * survive this merge: it must NOT be clobbered into a tool card, and a late /
 * empty server copy must NOT wipe the groups the user is looking at.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

function makeEls() {
  const messageList = dom.window.document.createElement("div")
  const typingIndicator = dom.window.document.createElement("div")
  const typingLabel = dom.window.document.createElement("span")
  return {
    messageList,
    typingIndicator,
    typingLabel,
    scrollAnchor: { scrollIfAnchored() {} },
  } as any
}

function makeState(messageId: string) {
  return {
    isStreaming: true,
    streamingMessageId: messageId,
    streamingBuffer: "",
    streamingBlockId: null,
    streamingToolCallId: null,
    seenEventIds: new Set<string>(),
    lastStreamTextEl: null,
    currentBlockEl: null,
    currentBlockBuffer: "",
    currentBlockIndex: -1,
    rafPending: false,
    renderQueue: null,
    chunkSeq: 0,
  } as any
}

describe("stream_end merge — question survival", () => {
  beforeEach(() => setupDom())

  it("keeps the live question's groups when the server copy is empty", async () => {
    const { handleStreamEnd } = await import("./streamEndHandler")

    const liveQuestion: any = {
      type: "question",
      id: "call-q",
      toolCallId: "call-q",
      sessionId: "s1",
      groups: [{ question: "Pick a DB", options: ["Postgres", "MySQL"], multiSelect: false }],
      text: "Pick a DB",
      options: ["Postgres", "MySQL"],
      allowFreeText: true,
    }
    const messages: any[] = [{ id: "m1", role: "assistant", blocks: [liveQuestion] }]

    const serverEmptyQuestion = {
      type: "question",
      id: "call-q",
      toolCallId: "call-q",
      groups: [],
      text: "",
      options: [],
      allowFreeText: true,
    }

    handleStreamEnd(makeState("m1"), makeEls(), messages, () => {}, "m1", [serverEmptyQuestion])

    const blocks = messages[0].blocks
    const questions = blocks.filter((b: any) => b.type === "question")
    assert.equal(questions.length, 1, "exactly one question block")
    assert.equal(questions[0].text, "Pick a DB", "live groups/text preserved")
    assert.deepEqual(questions[0].options, ["Postgres", "MySQL"])
    assert.equal(blocks.some((b: any) => b.type === "tool-call"), false, "not downgraded to a tool card")
  })

  it("adopts the server question when it carries fuller groups", async () => {
    const { handleStreamEnd } = await import("./streamEndHandler")

    const liveQuestion: any = {
      type: "question",
      id: "call-q",
      toolCallId: "call-q",
      groups: [],
      text: "",
      options: [],
      allowFreeText: true,
    }
    const messages: any[] = [{ id: "m1", role: "assistant", blocks: [liveQuestion] }]

    const serverQuestion = {
      type: "question",
      id: "call-q",
      toolCallId: "call-q",
      groups: [{ question: "Final?", options: ["A", "B"], multiSelect: false }],
      text: "Final?",
      options: ["A", "B"],
      allowFreeText: true,
    }

    handleStreamEnd(makeState("m1"), makeEls(), messages, () => {}, "m1", [serverQuestion])

    const questions = messages[0].blocks.filter((b: any) => b.type === "question")
    assert.equal(questions.length, 1)
    assert.equal(questions[0].text, "Final?")
    assert.deepEqual(questions[0].options, ["A", "B"])
  })
})
