/**
 * Unit tests for the pure Command/Task model (commandModel.ts).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ChatMessage, Block } from "./types"
import { buildCommandTasks, filterCommandTasks, formatDuration, isExecBlock } from "./commandModel"

function msg(blocks: Block[], id = "a1"): ChatMessage {
  return { role: "assistant", blocks, id, timestamp: 1000 }
}
function exec(over: Partial<Block> = {}): Block {
  return { type: "tool-call", id: "t1", name: "bash", class: "exec", state: "result", args: { command: "npm test" }, ...over } as Block
}

describe("isExecBlock", () => {
  it("recognizes explicit exec class", () => {
    assert.equal(isExecBlock(exec()), true)
  })
  it("infers exec from tool name when class is absent", () => {
    assert.equal(isExecBlock({ type: "tool-call", name: "bash", state: "result", args: {} } as Block), true)
  })
  it("rejects a non-exec explicit class", () => {
    assert.equal(isExecBlock({ type: "tool-call", name: "read", class: "read", state: "result" } as Block), false)
  })
  it("rejects non-tool blocks", () => {
    assert.equal(isExecBlock({ type: "text", text: "bash" } as Block), false)
  })
})

describe("buildCommandTasks", () => {
  it("extracts command text, cwd, status, and anchor", () => {
    const tasks = buildCommandTasks([msg([exec({ args: { command: "ls -la", cwd: "/repo" }, durationMs: 1500 })], "m9")])
    assert.equal(tasks.length, 1)
    const t = tasks[0]!
    assert.equal(t.command, "ls -la")
    assert.equal(t.cwd, "/repo")
    assert.equal(t.status, "succeeded")
    assert.equal(t.durationMs, 1500)
    assert.equal(t.anchorMessageId, "m9")
  })

  it("marks a non-zero exit code as failed even when state is result", () => {
    const tasks = buildCommandTasks([msg([exec({ args: { command: "false" }, exitCode: 1 })])])
    assert.equal(tasks[0]!.status, "failed")
    assert.equal(tasks[0]!.exitCode, 1)
  })

  it("parses an exit code from result text when no exitCode field", () => {
    const tasks = buildCommandTasks([msg([exec({ args: { command: "x" }, result: "boom\nexit code: 2" })])])
    assert.equal(tasks[0]!.exitCode, 2)
    assert.equal(tasks[0]!.status, "failed")
  })

  it("maps running and pending states", () => {
    assert.equal(buildCommandTasks([msg([exec({ state: "running" })])])[0]!.status, "running")
    assert.equal(buildCommandTasks([msg([exec({ state: "pending" })])])[0]!.status, "pending")
  })

  it("ignores non-exec tools and text blocks", () => {
    const tasks = buildCommandTasks([msg([{ type: "tool-call", name: "read", class: "read", state: "result" } as Block, { type: "text", text: "hi" } as Block])])
    assert.equal(tasks.length, 0)
  })
})

describe("filterCommandTasks", () => {
  const tasks = buildCommandTasks([
    msg([
      exec({ id: "1", args: { command: "a" }, state: "running" }),
      exec({ id: "2", args: { command: "b" }, exitCode: 1 }),
      exec({ id: "3", args: { command: "c" }, exitCode: 0 }),
    ]),
  ])
  it("all returns a copy", () => {
    const all = filterCommandTasks(tasks, "all")
    assert.equal(all.length, 3)
    assert.notEqual(all, tasks)
  })
  it("filters by status", () => {
    assert.equal(filterCommandTasks(tasks, "running").length, 1)
    assert.equal(filterCommandTasks(tasks, "failed").length, 1)
    assert.equal(filterCommandTasks(tasks, "succeeded").length, 1)
  })
})

describe("formatDuration", () => {
  it("formats ms, seconds, and minutes", () => {
    assert.equal(formatDuration(340), "340ms")
    assert.equal(formatDuration(1500), "1.5s")
    assert.equal(formatDuration(83000), "1m 23s")
    assert.equal(formatDuration(undefined), "")
    assert.equal(formatDuration(-5), "")
  })
})
