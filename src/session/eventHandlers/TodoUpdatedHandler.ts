import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

type RawTodo = { id?: unknown; content?: unknown; status?: unknown }

export type CanonicalTodoStatus = "pending" | "in-progress" | "completed"

export function normalizeTodoStatus(status: unknown): CanonicalTodoStatus {
  if (status === "in_progress" || status === "in-progress") return "in-progress"
  if (status === "completed") return "completed"
  return "pending"
}

type NormalizedTodo = { id: string; content: string; status: CanonicalTodoStatus; createdAt: number; priority?: string }

export function normalizeTodoList(todos: unknown): NormalizedTodo[] {
  if (!Array.isArray(todos)) return []
  return todos
    .map((raw): NormalizedTodo | null => {
      if (!raw || typeof raw !== "object") return null
      const t = raw as RawTodo & { priority?: unknown }
      const id = typeof t.id === "string" ? t.id : ""
      const content = typeof t.content === "string" ? t.content : ""
      if (!id) return null
      const result: NormalizedTodo = { id, content, status: normalizeTodoStatus(t.status), createdAt: 0 }
      if (typeof t.priority === "string" && ["low", "medium", "high"].includes(t.priority)) {
        result.priority = t.priority as "low" | "medium" | "high"
      }
      return result
    })
    .filter((x): x is NormalizedTodo => x !== null)
}

export class TodoUpdatedHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "todo.updated"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const props = event.properties as { sessionID?: string; todos?: unknown } | undefined
    return [{
      type: "todo_updated",
      sessionId: props?.sessionID,
      data: { todos: normalizeTodoList(props?.todos) },
    }]
  }
}
