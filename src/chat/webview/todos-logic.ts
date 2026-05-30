import type { Todo } from "./types"

export interface TodoSessionState {
  todoOverrides?: Record<string, 'pending' | 'in-progress' | 'completed'>
  userTodos?: Todo[]
  deletedTodoIds?: string[]
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

  const overrides = session.todoOverrides || {}
  const userTodos = session.userTodos || []
  const deletedIds = new Set(session.deletedTodoIds || [])

  const mergedServerTodos = serverTodos
    .filter(todo => !deletedIds.has(todo.id))
    .map(todo => {
      const overrideStatus = overrides[todo.id]
      return overrideStatus ? { ...todo, status: overrideStatus } : todo
    })

  return [...mergedServerTodos, ...userTodos]
}

export function generateTodoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `todo-${crypto.randomUUID()}`
  }
  return `todo-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}
