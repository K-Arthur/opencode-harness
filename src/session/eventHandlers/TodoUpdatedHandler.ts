import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

type RawTodo = { id?: unknown; content?: unknown; status?: unknown }

export type CanonicalTodoStatus = "pending" | "in-progress" | "completed"

export function normalizeTodoStatus(status: unknown): CanonicalTodoStatus {
  if (status === "in_progress" || status === "in-progress") return "in-progress"
  if (status === "completed") return "completed"
  return "pending"
}

export function normalizeTodoList(todos: unknown): Array<{ id: string; content: string; status: CanonicalTodoStatus; createdAt: number }> {
  if (!Array.isArray(todos)) return []
  return todos
    .map((raw): { id: string; content: string; status: CanonicalTodoStatus; createdAt: number } | null => {
      if (!raw || typeof raw !== "object") return null
      const t = raw as RawTodo
      const id = typeof t.id === "string" ? t.id : ""
      const content = typeof t.content === "string" ? t.content : ""
      if (!id) return null
      return { id, content, status: normalizeTodoStatus(t.status), createdAt: 0 }
    })
    .filter((x): x is { id: string; content: string; status: CanonicalTodoStatus; createdAt: number } => x !== null)
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
