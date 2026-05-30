/**
 * Contract tests for TodoUpdatedHandler.
 *
 * These pin the streaming-path normalization so the SSE and REST paths
 * cannot diverge again (C2 regression: `in_progress` leaked to the webview
 * filter that expects `in-progress`).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { TodoUpdatedHandler, normalizeTodoStatus, normalizeTodoList } from "./TodoUpdatedHandler"

const VALID_STATUSES = new Set(["pending", "in-progress", "completed"])

describe("TodoUpdatedHandler", () => {
  const handler = new TodoUpdatedHandler()
  const ctx = {} as any

  it("canHandle accepts only todo.updated events", () => {
    assert.equal(handler.canHandle("todo.updated"), true)
    assert.equal(handler.canHandle("message.updated"), false)
    assert.equal(handler.canHandle(""), false)
  })

  it("emits a single normalized todo_updated event", () => {
    const out = handler.handle({
      properties: {
        sessionID: "ses_abc",
        todos: [
          { id: "1", content: "x", status: "in_progress" },
          { id: "2", content: "y", status: "completed" },
        ],
      },
    } as any, ctx)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "todo_updated")
    assert.equal(out[0]!.sessionId, "ses_abc")
  })

  it("maps in_progress → in-progress (C2 regression)", () => {
    const out = handler.handle({
      properties: { sessionID: "s", todos: [{ id: "1", content: "x", status: "in_progress" }] },
    } as any, ctx)
    const todos = (out[0]!.data as { todos: Array<{ status: string }> }).todos
    assert.equal(todos[0]!.status, "in-progress")
  })

  it("emits only canonical status strings, regardless of input shape", () => {
    const out = handler.handle({
      properties: {
        sessionID: "s",
        todos: [
          { id: "1", content: "a", status: "pending" },
          { id: "2", content: "b", status: "in_progress" },
          { id: "3", content: "c", status: "in-progress" },
          { id: "4", content: "d", status: "completed" },
          { id: "5", content: "e", status: "garbage" },
          { id: "6", content: "f" },          // missing status
        ],
      },
    } as any, ctx)
    const todos = (out[0]!.data as { todos: Array<{ status: string }> }).todos
    for (const t of todos) {
      assert.ok(VALID_STATUSES.has(t.status), `bad status: ${t.status}`)
    }
  })

  it("filters out malformed todos (missing or non-string id)", () => {
    const out = handler.handle({
      properties: {
        sessionID: "s",
        todos: [
          { id: "1", content: "ok" },
          { id: "", content: "blank id" },
          { content: "no id" },
          null,
          "not an object",
        ],
      },
    } as any, ctx)
    const todos = (out[0]!.data as { todos: Array<{ id: string }> }).todos
    assert.equal(todos.length, 1)
    assert.equal(todos[0]!.id, "1")
  })

  it("handles missing sessionID and todos array", () => {
    const out = handler.handle({ properties: {} } as any, ctx)
    assert.equal(out[0]!.sessionId, undefined)
    assert.deepEqual(out[0]!.data, { todos: [] })
  })

  it("handles event with no properties at all", () => {
    const out = handler.handle({} as any, ctx)
    assert.deepEqual(out[0]!.data, { todos: [] })
  })
})

describe("normalizeTodoStatus", () => {
  it("maps in_progress → in-progress", () => {
    assert.equal(normalizeTodoStatus("in_progress"), "in-progress")
  })
  it("passes through canonical values", () => {
    assert.equal(normalizeTodoStatus("pending"), "pending")
    assert.equal(normalizeTodoStatus("in-progress"), "in-progress")
    assert.equal(normalizeTodoStatus("completed"), "completed")
  })
  it("defaults to pending for unknown/missing", () => {
    assert.equal(normalizeTodoStatus("garbage"), "pending")
    assert.equal(normalizeTodoStatus(undefined), "pending")
    assert.equal(normalizeTodoStatus(null), "pending")
    assert.equal(normalizeTodoStatus(42), "pending")
  })
})

describe("normalizeTodoList", () => {
  it("returns [] for non-array input", () => {
    assert.deepEqual(normalizeTodoList(undefined), [])
    assert.deepEqual(normalizeTodoList(null), [])
    assert.deepEqual(normalizeTodoList("not an array"), [])
  })
  it("preserves order of valid todos", () => {
    const out = normalizeTodoList([
      { id: "a", content: "1", status: "pending" },
      { id: "b", content: "2", status: "completed" },
    ])
    assert.deepEqual(out.map(t => t.id), ["a", "b"])
  })
})
