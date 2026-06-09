import type { Todo } from "./types"

export interface TodoSessionState {
  userTodos?: Todo[]
}

/**
 * Returns true if the todo was created locally by the user (vs. delivered by
 * the OpenCode server). User todos have IDs prefixed with `todo-`; server
 * todos use the server's id (v1) or a synthesized `srv-` id (v2 compat).
 *
 * Centralized here so main.ts and todos-panel.ts share a single source of
 * truth — duplicate predicates had drifted in the past.
 */
export function isUserTodo(todo: Todo): boolean {
  return todo.id.startsWith("todo-")
}

export function calculateProgress(todos: Todo[]) {
  const total = todos.length
  const completed = todos.filter(t => t.status === "completed").length
  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0
  }
}

export function applyTodoFilter(
  todos: Todo[],
  filter: 'all' | 'active' | 'completed' | 'in-progress'
): Todo[] {
  if (filter === "active") return todos.filter(t => t.status === "pending" || t.status === "in-progress")
  if (filter === "completed") return todos.filter(t => t.status === "completed")
  if (filter === "in-progress") return todos.filter(t => t.status === "in-progress")
  return todos
}

export function mergeTodos(session: TodoSessionState | null | undefined, serverTodos: Todo[]): Todo[] {
  if (!session) return serverTodos
  const userTodos = session.userTodos || []
  return [...serverTodos, ...userTodos]
}

export function generateTodoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `todo-${crypto.randomUUID()}`
  }
  return `todo-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}
