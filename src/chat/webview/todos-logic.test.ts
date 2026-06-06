import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { calculateProgress, applyTodoFilter, mergeTodos, generateTodoId, type TodoSessionState } from "./todos-logic"
import type { Todo } from "./types"

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return { content: `Todo ${overrides.id}`, status: "pending", createdAt: 0, ...overrides }
}

describe("todos-logic", () => {
  describe("calculateProgress", () => {
    it("returns 0% for empty list", () => {
      const result = calculateProgress([])
      assert.deepStrictEqual(result, { total: 0, completed: 0, percent: 0 })
    })

    it("returns 100% when all completed", () => {
      const todos: Todo[] = [
        makeTodo({ id: "1", status: "completed" }),
        makeTodo({ id: "2", status: "completed" }),
      ]
      assert.deepStrictEqual(calculateProgress(todos), { total: 2, completed: 2, percent: 100 })
    })

    it("returns 50% for half completed", () => {
      const todos: Todo[] = [
        makeTodo({ id: "1", status: "completed" }),
        makeTodo({ id: "2", status: "pending" }),
      ]
      assert.deepStrictEqual(calculateProgress(todos), { total: 2, completed: 1, percent: 50 })
    })

    it("rounds percentages correctly", () => {
      const todos: Todo[] = [
        makeTodo({ id: "1", status: "completed" }),
        makeTodo({ id: "2", status: "pending" }),
        makeTodo({ id: "3", status: "pending" }),
      ]
      assert.strictEqual(calculateProgress(todos).percent, 33)
    })

    it("counts in-progress as non-completed", () => {
      const todos: Todo[] = [
        makeTodo({ id: "1", status: "in-progress" }),
        makeTodo({ id: "2", status: "completed" }),
      ]
      assert.deepStrictEqual(calculateProgress(todos), { total: 2, completed: 1, percent: 50 })
    })
  })

  describe("applyTodoFilter", () => {
    const todos: Todo[] = [
      makeTodo({ id: "1", status: "pending" }),
      makeTodo({ id: "2", status: "in-progress" }),
      makeTodo({ id: "3", status: "completed" }),
    ]

    it("'all' returns every todo", () => {
      const result = applyTodoFilter(todos, "all")
      assert.strictEqual(result.length, 3)
    })

    it("'active' returns pending and in-progress", () => {
      const result = applyTodoFilter(todos, "active")
      assert.strictEqual(result.length, 2)
      assert.ok(result.every(t => t.status !== "completed"))
    })

    it("'completed' returns only completed", () => {
      const result = applyTodoFilter(todos, "completed")
      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0]!.id, "3")
    })

    it("'in-progress' returns only in-progress", () => {
      const result = applyTodoFilter(todos, "in-progress")
      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0]!.id, "2")
    })

    it("preserves original order", () => {
      const result = applyTodoFilter(todos, "active")
      assert.deepStrictEqual(result.map(t => t.id), ["1", "2"])
    })

    it("returns empty for empty input", () => {
      assert.deepStrictEqual(applyTodoFilter([], "all"), [])
      assert.deepStrictEqual(applyTodoFilter([], "completed"), [])
    })
  })

  describe("mergeTodos", () => {
    it("returns serverTodos as-is when session is null", () => {
      const server = [makeTodo({ id: "s1" })]
      assert.deepStrictEqual(mergeTodos(null, server), server)
    })

    it("returns serverTodos as-is when session is undefined", () => {
      const server = [makeTodo({ id: "s1" })]
      assert.deepStrictEqual(mergeTodos(undefined, server), server)
    })

    it("returns serverTodos as-is for empty session state", () => {
      const session: TodoSessionState = {}
      const server = [makeTodo({ id: "s1" })]
      assert.deepStrictEqual(mergeTodos(session, server), server)
    })

    it("appends user todos after server todos", () => {
      const session: TodoSessionState = {
        userTodos: [makeTodo({ id: "u1", content: "User task" })]
      }
      const server = [makeTodo({ id: "s1" })]
      const result = mergeTodos(session, server)
      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0]!.id, "s1")
      assert.strictEqual(result[1]!.id, "u1")
    })

    it("does not mutate input serverTodos array", () => {
      const session: TodoSessionState = { userTodos: [makeTodo({ id: "u1" })] }
      const server = [makeTodo({ id: "s1", status: "pending" })]
      const original = JSON.parse(JSON.stringify(server))
      mergeTodos(session, server)
      assert.deepStrictEqual(server, original, "serverTodos should not be mutated")
    })

    it("handles empty server todos with user todos", () => {
      const session: TodoSessionState = {
        userTodos: [makeTodo({ id: "u1" }), makeTodo({ id: "u2" })]
      }
      const result = mergeTodos(session, [])
      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0]!.id, "u1")
      assert.strictEqual(result[1]!.id, "u2")
    })

    it("concatenates server and user todos unchanged", () => {
      const session: TodoSessionState = {
        userTodos: [makeTodo({ id: "u1", status: "pending" })]
      }
      const server = [
        makeTodo({ id: "s1", status: "pending" }),
        makeTodo({ id: "s2", status: "in-progress" }),
        makeTodo({ id: "s3", status: "completed" }),
      ]
      const result = mergeTodos(session, server)
      assert.strictEqual(result.length, 4)
      assert.strictEqual(result[0]!.id, "s1")
      assert.strictEqual(result[0]!.status, "pending")
      assert.strictEqual(result[1]!.id, "s2")
      assert.strictEqual(result[1]!.status, "in-progress")
      assert.strictEqual(result[2]!.id, "s3")
      assert.strictEqual(result[2]!.status, "completed")
      assert.strictEqual(result[3]!.id, "u1")
      assert.strictEqual(result[3]!.status, "pending")
    })
  })

  describe("generateTodoId", () => {
    it("produces a string starting with 'todo-'", () => {
      const id = generateTodoId()
      assert.ok(id.startsWith("todo-"), `Expected 'todo-' prefix, got: ${id}`)
    })

    it("produces unique IDs on successive calls", () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateTodoId())
      }
      assert.strictEqual(ids.size, 100, "All 100 IDs should be unique")
    })

    it("produces IDs longer than 10 characters", () => {
      const id = generateTodoId()
      assert.ok(id.length > 10, `ID too short: ${id}`)
    })
  })
})
