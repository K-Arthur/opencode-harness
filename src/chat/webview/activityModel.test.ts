/**
 * Unit tests for the pure Activity model (activityModel.ts).
 *
 * No DOM. Covers block→event mapping (legacy + canonical shapes), ordering,
 * filtering, summarization, streaming status, and randomized invariants
 * (hand-rolled, since fast-check is not a project dependency).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ChatMessage, Block } from "./types"
import {
  buildActivityEvents,
  filterActivityEvents,
  summarizeActivity,
  ACTIVITY_FILTERS,
  type ActivityEvent,
  type ActivityFilter,
  type ActivityKind,
} from "./activityModel"

function msg(role: ChatMessage["role"], blocks: Block[], over: Partial<ChatMessage> = {}): ChatMessage {
  return { role, blocks, id: over.id ?? `${role}-${Math.random().toString(36).slice(2, 7)}`, timestamp: over.timestamp ?? 1000, ...over }
}

function tool(over: Partial<Block> & { type?: string } = {}): Block {
  return { type: "tool-call", id: "t1", name: "bash", class: "exec", state: "result", ...over } as Block
}

function find(events: ActivityEvent[], kind: ActivityKind): ActivityEvent | undefined {
  return events.find((e) => e.kind === kind)
}

describe("buildActivityEvents — message-level events", () => {
  it("emits one message event for a user message", () => {
    const events = buildActivityEvents([msg("user", [{ type: "text", text: "fix the bug" }])])
    const m = find(events, "message")
    assert.ok(m, "expected a message event")
    assert.equal(m!.status, "info")
    assert.match(m!.label, /fix the bug/)
  })

  it("emits a message event for an assistant message with prose", () => {
    const events = buildActivityEvents([msg("assistant", [{ type: "text", text: "Here is the plan." }])])
    const m = find(events, "message")
    assert.ok(m)
    assert.equal(m!.status, "success")
  })

  it("does NOT emit a message event for an assistant message that is only tool calls", () => {
    const events = buildActivityEvents([msg("assistant", [tool()])])
    assert.equal(find(events, "message"), undefined)
    assert.ok(find(events, "command"), "the tool should still produce a command event")
  })

  it("marks the streaming assistant message event as running", () => {
    const events = buildActivityEvents([msg("assistant", [{ type: "text", text: "thinking out loud" }])], { isStreaming: true })
    assert.equal(find(events, "message")!.status, "running")
  })
})

describe("buildActivityEvents — tool/command classification", () => {
  it("classifies an exec tool as a command with the command text as label", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ args: { command: "npm test" } })])])
    const c = find(events, "command")!
    assert.ok(c)
    assert.match(c.label, /npm test/)
    assert.equal(c.status, "success")
  })

  it("surfaces a non-zero exit code as detail", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ args: { command: "npm test" }, exitCode: 1, state: "error" })])])
    const c = find(events, "command")!
    assert.equal(c.detail, "exit 1")
    assert.equal(c.status, "error")
  })

  it("classifies a read tool as file-read with the basename", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ name: "read", class: "read", args: { path: "src/deep/foo.ts" } })])])
    const r = find(events, "file-read")!
    assert.ok(r)
    assert.match(r.label, /foo\.ts/)
    assert.equal(r.detail, "src/deep/foo.ts")
  })

  it("classifies a write tool as file-edit", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ name: "write", class: "write", args: { path: "a/b.ts", content: "x" } })])])
    const e = find(events, "file-edit")!
    assert.match(e.label, /Wrote b\.ts/)
  })

  it("infers class from tool name when the class field is absent", () => {
    const events = buildActivityEvents([
      msg("assistant", [{ type: "tool-call", id: "x", name: "bash", state: "result", args: { command: "ls" } } as Block]),
    ])
    assert.ok(find(events, "command"), "bash with no class should infer exec → command")
  })

  it("maps unknown tools to the generic tool kind", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ name: "websearch", class: "meta", state: "result" })])])
    assert.ok(find(events, "tool"))
  })
})

describe("buildActivityEvents — plans, diffs, errors, questions, thinking", () => {
  const PLAN_CONTENT = ["---", "name: My Plan", "overview: do things", "todos:", "  - id: 1", "    content: step one", "    status: completed", "  - id: 2", "    content: step two", "    status: pending", "---", "body"].join("\n")

  it("detects a plan written to a markdown file", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ name: "write", class: "write", args: { path: "PLAN.md", content: PLAN_CONTENT } })])])
    const p = find(events, "plan")!
    assert.ok(p, "expected a plan event")
    assert.match(p.label, /My Plan/)
    assert.equal(p.detail, "1/2 steps")
  })

  it("maps a diff block to file-edit with +/- detail and accepted status", () => {
    const events = buildActivityEvents([
      msg("assistant", [{ type: "diff", diffId: "d1", path: "src/x.ts", linesAdded: 3, linesRemoved: 1, state: "accepted" } as Block]),
    ])
    const e = find(events, "file-edit")!
    assert.match(e.label, /Edited x\.ts/)
    assert.equal(e.detail, "+3 −1")
    assert.equal(e.status, "success")
    assert.equal(e.refId, "d1")
  })

  it("maps an error block to an error event", () => {
    const events = buildActivityEvents([msg("assistant", [{ type: "error", code: "ENET", message: "network down", retryable: true } as Block])])
    const e = find(events, "error")!
    assert.equal(e.status, "error")
    assert.equal(e.detail, "ENET")
  })

  it("maps a question block to an approval event", () => {
    const events = buildActivityEvents([msg("assistant", [{ type: "question", id: "q", text: "Proceed?", options: ["yes", "no"] } as Block])])
    assert.equal(find(events, "approval")!.status, "pending")
  })

  it("maps a thinking block to a thinking event", () => {
    const events = buildActivityEvents([msg("assistant", [{ type: "thinking", content: "hmm", streaming: false } as Block, { type: "text", text: "done" }])])
    assert.ok(find(events, "thinking"))
  })
})

describe("buildActivityEvents — legacy ⇄ canonical tolerance", () => {
  it("treats tool-call, tool_call, and tool identically", () => {
    for (const t of ["tool-call", "tool_call", "tool"]) {
      const events = buildActivityEvents([msg("assistant", [tool({ type: t, args: { command: "echo hi" } })])])
      assert.ok(find(events, "command"), `type ${t} should classify as command`)
    }
  })

  it("treats thinking and reasoning identically", () => {
    for (const t of ["thinking", "reasoning"]) {
      const events = buildActivityEvents([msg("assistant", [{ type: t, content: "x", streaming: false } as Block])])
      assert.ok(find(events, "thinking"), `type ${t} should classify as thinking`)
    }
  })
})

describe("ordering", () => {
  it("sorts events by timestamp and keeps the message event ahead of its blocks", () => {
    const events = buildActivityEvents([
      msg("user", [{ type: "text", text: "go" }], { id: "u1", timestamp: 100 }),
      msg("assistant", [{ type: "text", text: "ok" }, tool({ args: { command: "ls" } })], { id: "a1", timestamp: 200 }),
    ])
    const kinds = events.map((e) => e.kind)
    assert.deepEqual(kinds, ["message", "message", "command"])
    // timestamps must be non-decreasing
    for (let i = 1; i < events.length; i++) assert.ok(events[i]!.timestamp >= events[i - 1]!.timestamp)
  })
})

describe("filterActivityEvents", () => {
  const events = buildActivityEvents([
    msg("user", [{ type: "text", text: "hi" }]),
    msg("assistant", [
      { type: "thinking", content: "ponder", streaming: false } as Block,
      tool({ args: { command: "npm i" } }),
      { type: "diff", diffId: "d", path: "f.ts", linesAdded: 1, linesRemoved: 0, state: "pending" } as Block,
      { type: "error", code: "E", message: "boom", retryable: false } as Block,
      { type: "question", id: "q", text: "ok?", options: [] } as Block,
    ]),
  ])

  it("'all' returns every event as a fresh array", () => {
    const all = filterActivityEvents(events, "all")
    assert.equal(all.length, events.length)
    assert.notEqual(all, events, "must return a copy, not the same reference")
  })

  it("each filter admits only its kinds", () => {
    assert.ok(filterActivityEvents(events, "commands").every((e) => e.kind === "command" || e.kind === "tool"))
    assert.ok(filterActivityEvents(events, "files").every((e) => e.kind === "file-edit" || e.kind === "file-read" || e.kind === "checkpoint"))
    assert.ok(filterActivityEvents(events, "errors").every((e) => e.kind === "error"))
    assert.ok(filterActivityEvents(events, "approvals").every((e) => e.kind === "approval"))
    assert.equal(filterActivityEvents(events, "errors").length, 1)
    assert.equal(filterActivityEvents(events, "approvals").length, 1)
  })

  it("messages filter includes thinking and message kinds", () => {
    const kinds = new Set(filterActivityEvents(events, "messages").map((e) => e.kind))
    assert.ok(kinds.has("message"))
    assert.ok(kinds.has("thinking"))
  })
})

describe("summarizeActivity", () => {
  it("counts events per kind", () => {
    const events = buildActivityEvents([msg("assistant", [tool({ args: { command: "a" } }), tool({ id: "t2", args: { command: "b" } })])])
    assert.equal(summarizeActivity(events).command, 2)
  })
})

describe("randomized invariants", () => {
  const TYPES = ["text", "tool-call", "tool", "thinking", "reasoning", "diff", "diff_block", "error", "question", "snapshot", "step-finish", "weird-unknown"]
  const CLASSES = ["read", "write", "exec", "meta", "mixed", undefined]
  const STATES = ["pending", "running", "result", "completed", "error", "stale", "unresolved", undefined]

  function rand<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)] as T
  }

  it("never throws and produces well-formed events for arbitrary blocks", () => {
    for (let iter = 0; iter < 300; iter++) {
      const messages: ChatMessage[] = []
      const n = Math.floor(Math.random() * 6)
      for (let i = 0; i < n; i++) {
        const blockCount = Math.floor(Math.random() * 5)
        const blocks: Block[] = []
        for (let b = 0; b < blockCount; b++) {
          blocks.push({ type: rand(TYPES), name: rand(["bash", "read", "write", "grep", "x"]), class: rand(CLASSES), state: rand(STATES), text: Math.random() > 0.5 ? "some text" : undefined, args: { command: "cmd", path: "p/q.ts" } } as Block)
        }
        messages.push(msg(rand(["user", "assistant", "system"] as const), blocks))
      }

      const events = buildActivityEvents(messages, { isStreaming: Math.random() > 0.5 })

      // Every event is well-formed.
      for (const e of events) {
        assert.ok(typeof e.id === "string" && e.id.length > 0, "id must be non-empty")
        assert.ok(typeof e.label === "string" && e.label.length > 0, "label must be non-empty")
        assert.ok(["pending", "running", "success", "error", "info"].includes(e.status))
      }

      // "all" is the identity-length; every filter is a subset of "all".
      assert.equal(filterActivityEvents(events, "all").length, events.length)
      for (const f of ACTIVITY_FILTERS) {
        const sub = filterActivityEvents(events, f as ActivityFilter)
        assert.ok(sub.length <= events.length)
        for (const e of sub) assert.ok(events.includes(e))
      }

      // timestamps are non-decreasing.
      for (let i = 1; i < events.length; i++) assert.ok(events[i]!.timestamp >= events[i - 1]!.timestamp)
    }
  })
})
