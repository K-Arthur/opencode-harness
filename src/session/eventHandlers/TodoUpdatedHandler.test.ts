import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { TodoUpdatedHandler, normalizeTodoStatus, normalizeTodoList } from "./TodoUpdatedHandler"

const VALID_STATUSES = new Set(["pending", "in-progress", "completed", "cancelled"])

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
      properties: { sessionID: "ses_abc", todos: [{ id: "1", content: "x", status: "in_progress" }] },
    } as any, ctx)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "todo_updated")
    assert.equal(out[0]!.sessionId, "ses_abc")
  })

  it("maps in_progress → in-progress (C2 regression)", () => {
    const out = handler.handle({
      properties: { sessionID: "s", todos: [{ id: "1", content: "x", status: "in_progress" }] },
    } as any, ctx)
    assert.equal((out[0]!.data as any).todos[0]!.status, "in-progress")
  })

  it("preserves cancelled as distinct status", () => {
    const out = handler.handle({
      properties: { sessionID: "s", todos: [
        { id: "1", content: "a", status: "cancelled" },
        { id: "2", content: "b", status: "canceled" },
      ]},
    } as any, ctx)
    const todos = (out[0]!.data as any).todos
    assert.equal(todos[0]!.status, "cancelled")
    assert.equal(todos[1]!.status, "cancelled")
  })

  it("accepts v2-shape todos (no `id`) by synthesizing stable IDs", () => {
    const out = handler.handle({
      properties: { sessionID: "s", todos: [
        { content: "Task A", status: "pending" },
        { content: "Task B", status: "completed" },
      ]},
    } as any, ctx)
    const todos = (out[0]!.data as any).todos
    assert.equal(todos.length, 2, "v2-shape todos must NOT be filtered out")
    assert.ok(todos[0]!.id.startsWith("srv-"), "synthesized id prefix")
    assert.ok(todos[1]!.id.startsWith("srv-"))
    assert.notEqual(todos[0]!.id, todos[1]!.id, "different indices => different ids")
  })

  it("synthesizes stable IDs across calls with the same payload", () => {
    const payload = { properties: { sessionID: "s", todos: [
      { content: "same text", status: "pending" },
    ]}} as any
    const a = (handler.handle(payload, ctx)[0]!.data as any).todos
    const b = (handler.handle(payload, ctx)[0]!.data as any).todos
    assert.equal(a[0]!.id, b[0]!.id, "same content+index must produce same id")
  })

  it("still filters out truly malformed entries (null, primitives)", () => {
    const out = handler.handle({
      properties: { sessionID: "s", todos: [
        { id: "valid", content: "ok" },
        null,
        "not an object",
        { id: "x" },
        { content: "" },
      ]},
    } as any, ctx)
    const todos = (out[0]!.data as any).todos
    assert.equal(todos.length, 3, "keep valid + blank-id-with-content + empty-content-with-id; drop null/primitive")
    assert.ok(todos.some((t: any) => t.id === "valid"))
    assert.ok(todos.some((t: any) => t.id === "x"))
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
  it("maps in_progress → in-progress", () => assert.equal(normalizeTodoStatus("in_progress"), "in-progress"))
  it("maps cancelled → cancelled", () => assert.equal(normalizeTodoStatus("cancelled"), "cancelled"))
  it("maps canceled (US) → cancelled", () => assert.equal(normalizeTodoStatus("canceled"), "cancelled"))
  it("defaults to pending for unknown", () => assert.equal(normalizeTodoStatus("garbage"), "pending"))
  it("defaults to pending for undefined/null", () => assert.equal(normalizeTodoStatus(undefined), "pending"))
})

describe("normalizeTodoList", () => {
  it("returns [] for non-array input", () => {
    assert.deepEqual(normalizeTodoList(undefined), [])
    assert.deepEqual(normalizeTodoList(null), [])
  })
  it("preserves order and explicit ids (v1)", () => {
    const out = normalizeTodoList([{ id: "a", content: "1" }, { id: "b", content: "2" }])
    assert.deepEqual(out.map(t => t.id), ["a", "b"])
  })
  it("synthesizes ids only when missing (v2)", () => {
    const out = normalizeTodoList([{ content: "no id" }])
    assert.equal(out.length, 1)
    assert.ok(out[0]!.id.startsWith("srv-"))
  })
})
