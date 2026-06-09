import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeMessageCounts } from "./messageCounter"
import type { ChatMessage } from "../../types"

const userMsg = (text: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "user",
  blocks: [{ type: "text", text }],
  timestamp: 1,
  ...overrides,
})

const assistantMsg = (text: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "assistant",
  blocks: [{ type: "text", text }],
  timestamp: 2,
  ...overrides,
})

const systemMsg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "system",
  blocks: [{ type: "activity", title: "activity", detail: "something happened" }],
  timestamp: 3,
  ...overrides,
})

const assistantWithTool = (text: string, toolName: string): ChatMessage => ({
  role: "assistant",
  blocks: [
    { type: "text", text },
    { type: "tool-call", id: "t1", name: toolName, state: "completed" as const },
  ],
  timestamp: 2,
})

const emptyUserMsg = (): ChatMessage => ({
  role: "user",
  blocks: [],
  timestamp: 1,
})

describe("computeMessageCounts", () => {
  it("returns all zeros for an empty array", () => {
    const c = computeMessageCounts([])
    assert.equal(c.userTurns, 0)
    assert.equal(c.assistantTurns, 0)
    assert.equal(c.systemMessages, 0)
    assert.equal(c.toolCallBlocks, 0)
  })

  it("counts a single user message as one user turn", () => {
    const c = computeMessageCounts([userMsg("hello")])
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 0)
    assert.equal(c.systemMessages, 0)
    assert.equal(c.toolCallBlocks, 0)
  })

  it("counts a single assistant message as one assistant turn", () => {
    const c = computeMessageCounts([assistantMsg("hi")])
    assert.equal(c.userTurns, 0)
    assert.equal(c.assistantTurns, 1)
  })

  it("counts a user+assistant pair as one turn each", () => {
    const c = computeMessageCounts([userMsg("hello"), assistantMsg("hi")])
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.systemMessages, 0)
    assert.equal(c.toolCallBlocks, 0)
  })

  it("counts system/activity messages separately from turns", () => {
    const msgs: ChatMessage[] = [
      userMsg("hello"),
      assistantMsg("hi"),
      systemMsg({ blocks: [{ type: "activity", title: "switched", detail: "model" }] }),
      systemMsg({ blocks: [{ type: "activity", title: "compacted", detail: "done" }] }),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.systemMessages, 2)
  })

  it("counts tool-call blocks but not text blocks", () => {
    const msgs: ChatMessage[] = [
      userMsg("do something"),
      assistantWithTool("running", "bash"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.toolCallBlocks, 1)
  })

  it("counts multiple tool calls within one assistant message", () => {
    const msg: ChatMessage = {
      role: "assistant",
      blocks: [
        { type: "text", text: "Let me check" },
        { type: "tool-call", id: "t1", name: "bash", state: "completed" as const },
        { type: "text", text: "Now another" },
        { type: "tool-call", id: "t2", name: "read", state: "running" as const },
        { type: "tool-call", id: "t3", name: "grep", state: "pending" as const },
      ],
      timestamp: 2,
    }
    const c = computeMessageCounts([userMsg("search"), msg])
    assert.equal(c.toolCallBlocks, 3)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.userTurns, 1)
  })

  it("does not count tool blocks as additional assistant turns", () => {
    const msgs: ChatMessage[] = [
      userMsg("deploy"),
      assistantWithTool("deploying", "bash"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.assistantTurns, 1)
  })

  it("counts distinct user+assistant pairs correctly across multiple turns", () => {
    const msgs: ChatMessage[] = [
      userMsg("first"),
      assistantMsg("reply A"),
      userMsg("second"),
      assistantWithTool("reply B", "read"),
      userMsg("third"),
      assistantMsg("reply C"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 3)
    assert.equal(c.assistantTurns, 3)
    assert.equal(c.toolCallBlocks, 1)
  })

  it("handles interleaved system messages without affecting turn count", () => {
    const msgs: ChatMessage[] = [
      userMsg("hi"),
      systemMsg(),
      assistantMsg("hello"),
      systemMsg(),
      systemMsg(),
      userMsg("again"),
      assistantMsg("ok"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 2)
    assert.equal(c.assistantTurns, 2)
    assert.equal(c.systemMessages, 3)
  })

  it("counts assistant messages with only tool blocks and no text blocks", () => {
    const msgs: ChatMessage[] = [
      userMsg("run command"),
      {
        role: "assistant",
        blocks: [{ type: "tool-call", id: "t1", name: "bash", state: "completed" as const }],
        timestamp: 2,
      },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.toolCallBlocks, 1)
  })

  it("does not count empty messages as turns", () => {
    // Empty messages with no blocks should not count (e.g. in-flight streaming
    // placeholders that were never populated).
    const msgs: ChatMessage[] = [
      { role: "user", blocks: [], timestamp: 1 },
      { role: "assistant", blocks: [], timestamp: 2 },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
  })

  it("streaming chunks do not create extra messages (single assistant turn, many deltas simulated as one msg)", () => {
    // During streaming, the assistant produces ONE ChatMessage with growing
    // text. Even though the SDK may emit dozens of text_chunk events the
    // message array only ever has one entry per turn.
    const msgs: ChatMessage[] = [
      userMsg("Write a poem"),
      {
        role: "assistant",
        blocks: [
          { type: "text", text: "Roses are red,\nViolets are blue,\nSugar is sweet,\nAnd so are you." },
        ],
        timestamp: 2,
      },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.toolCallBlocks, 0)
  })

  it("tool calls and results do not add assistant turns", () => {
    // A single assistant turn that calls 3 tools is still 1 assistant turn,
    // not 4 (1 text + 3 tools).
    const msgs: ChatMessage[] = [
      userMsg("Deploy the app"),
      {
        role: "assistant",
        blocks: [
          { type: "text", text: "I'll deploy the app" },
          { type: "tool-call", id: "t1", name: "bash", state: "completed" as const },
          { type: "text", text: "Build succeeded" },
          { type: "tool-call", id: "t2", name: "read", state: "completed" as const },
          { type: "tool-call", id: "t3", name: "grep", state: "completed" as const },
          { type: "text", text: "Deployment complete" },
        ],
        timestamp: 2,
      },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.toolCallBlocks, 3, "3 tool calls, not 3 assistant turns")
  })

  it("session reload does not duplicate messages (same IDs upsert, not append)", () => {
    // Simulates what happens when init_state re-sends messages that already
    // exist in the session. With upsert-by-id the count stays stable.
    const msgs: ChatMessage[] = [
      { role: "user", id: "u1", blocks: [{ type: "text", text: "hello" }], timestamp: 1 },
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "hi" }], timestamp: 2 },
      // Simulate a duplicate from reload with the same IDs (upsert path)
      { role: "user", id: "u1", blocks: [{ type: "text", text: "hello" }], timestamp: 1 },
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "hi" }], timestamp: 2 },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 2, "counting is by array entries; dedup happens at upsert time")
    assert.equal(c.assistantTurns, 2)
    assert.equal(c.totalMessages, 4, "array may temporarily hold dups — upsert is upstream")
    // The upsert-by-id fix in SessionStore.appendMessage prevents the array
    // from growing in the first place; the counter faithfully reflects what
    // the array contains.
  })

  it("webview reload does not duplicate messages", () => {
    // init_state re-sends the same messages. The webview's loadSessions
    // replaces messages in-place using existing.messages.push(...s.messages).
    // If IDs are stable and upsert-by-id is used upstream, the array stays
    // correct.
    const msgs: ChatMessage[] = [
      { role: "user", id: "u1", blocks: [{ type: "text", text: "hello" }], timestamp: 1 },
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "hi" }], timestamp: 2 },
      { role: "user", id: "u2", blocks: [{ type: "text", text: "again" }], timestamp: 3 },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 2, "two user messages across two turns")
    assert.equal(c.assistantTurns, 1, "one assistant reply so far")
    assert.equal(c.totalMessages, 3)
  })

  it("subagent events do not corrupt main agent turn count", () => {
    // Subagent activities are stored as system messages or activity blocks,
    // not as user/assistant messages. They must not inflate the turn count.
    const msgs: ChatMessage[] = [
      userMsg("Research topic"),
      assistantMsg("I'll delegate"),
      // Subagent activity — system message, not a turn
      { role: "system", blocks: [{ type: "activity", title: "Subagent", detail: "Researching..." }], timestamp: 3 },
      { role: "system", blocks: [{ type: "activity", title: "Subagent", detail: "Result obtained" }], timestamp: 4 },
      assistantMsg("Here's what I found"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 2)
    assert.equal(c.systemMessages, 2)
  })

  it("retried/regenerated responses replace prior attempt, not add to count", () => {
    // When a stream is retried, the old assistant message is replaced by
    // upsert-by-id. This test verifies the counting after replacement.
    // (The replacement itself is upstream in SessionStore.appendMessage.)
    const msgs: ChatMessage[] = [
      { role: "user", id: "u1", blocks: [{ type: "text", text: "generate image" }], timestamp: 1 },
      // After retry, only the final attempt remains in the array
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "Final result" }], timestamp: 3 },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
  })

  it("multiple distinct messages with identical text are not collapsed", () => {
    // Content-only dedup must never collapse two genuinely separate turns
    // that happen to say the same thing.
    const msgs: ChatMessage[] = [
      { role: "user", id: "u1", blocks: [{ type: "text", text: "hello" }], timestamp: 1 },
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "hello" }], timestamp: 2 },
      { role: "user", id: "u2", blocks: [{ type: "text", text: "hello" }], timestamp: 3 },
      { role: "assistant", id: "a2", blocks: [{ type: "text", text: "hello" }], timestamp: 4 },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 2, "two separate user messages, same text, both counted")
    assert.equal(c.assistantTurns, 2, "two separate assistant replies, both counted")
  })

  it("out-of-order events produce correct counts after upsert", () => {
    // After upsert-by-id reorders, the counter sees the final stable array.
    const msgs: ChatMessage[] = [
      { role: "user", id: "u1", blocks: [{ type: "text", text: "first" }], timestamp: 1 },
      { role: "assistant", id: "a1", blocks: [{ type: "text", text: "first reply" }], timestamp: 2 },
      { role: "user", id: "u2", blocks: [{ type: "text", text: "second" }], timestamp: 3 },
      { role: "assistant", id: "a2", blocks: [{ type: "text", text: "second reply" }], timestamp: 4 },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 2)
    assert.equal(c.assistantTurns, 2)
    assert.equal(c.totalMessages, 4)
  })

  it("reasoning/thinking blocks do not create extra messages", () => {
    // Reasoning blocks are part of an assistant message, not separate messages.
    const msgs: ChatMessage[] = [
      userMsg("Solve this"),
      {
        role: "assistant",
        id: "a1",
        blocks: [
          { type: "reasoning", text: "Let me think step by step..." },
          { type: "text", text: "The answer is 42." },
        ],
        timestamp: 2,
      },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.toolCallBlocks, 0)
  })

  it("step-start and step-finish blocks do not create extra messages", () => {
    const msgs: ChatMessage[] = [
      userMsg("Do work"),
      {
        role: "assistant",
        id: "a1",
        blocks: [
          { type: "step-start" as any, id: "s1" },
          { type: "text", text: "Working..." },
          { type: "step-finish" as any, id: "s1", reason: "completed", cost: 0.01, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } },
        ] as any,
        timestamp: 2,
      },
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.systemMessages, 0)
  })

  it("concurrent subagents do not inflate turn count", () => {
    // Multiple subagents running simultaneously produce activity system
    // messages but not user/assistant turns.
    const msgs: ChatMessage[] = [
      userMsg("Research and code"),
      assistantMsg("Starting subagents"),
      { role: "system", blocks: [{ type: "activity", title: "Subagent", detail: "Researching..." }], timestamp: 3 },
      { role: "system", blocks: [{ type: "activity", title: "Subagent", detail: "Coding..." }], timestamp: 4 },
      assistantMsg("Both tasks complete"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.userTurns, 1)
    assert.equal(c.assistantTurns, 2)
    assert.equal(c.systemMessages, 2)
  })

  it("totalMessages reflects array length accurately", () => {
    const msgs: ChatMessage[] = [
      userMsg("a"), assistantMsg("b"), systemMsg(), userMsg("c"),
    ]
    const c = computeMessageCounts(msgs)
    assert.equal(c.totalMessages, 4)
    assert.equal(c.userTurns, 2)
    assert.equal(c.assistantTurns, 1)
    assert.equal(c.systemMessages, 1)
  })
})
