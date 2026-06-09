import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

type RawTodo = { id?: unknown; content?: unknown; status?: unknown }

export type CanonicalTodoStatus = "pending" | "in-progress" | "completed" | "cancelled"

export function normalizeTodoStatus(status: unknown): CanonicalTodoStatus {
  if (status === "in_progress" || status === "in-progress") return "in-progress"
  if (status === "completed") return "completed"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  return "pending"
}

type NormalizedTodo = { id: string; content: string; status: CanonicalTodoStatus; createdAt: number; priority?: string }

/**
 * Generate a deterministic ID for a todo that arrives without one.
 *
 * OpenCode v2 server emits todos WITHOUT `id` (only content/status/priority),
 * while v1 included it. We synthesize a stable ID from the content + array index
 * so the same payload produces the same ID across reconnects/redeliveries —
 * which the diff-based renderer requires to preserve focus and avoid flicker.
 */
function generateStableTodoId(content: string, index: number): string {
  let h = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `srv-${(h >>> 0).toString(36)}-${index}`
}

export function normalizeTodoList(todos: unknown): NormalizedTodo[] {
  if (!Array.isArray(todos)) return []
  return todos
    .map((raw, index): NormalizedTodo | null => {
      if (!raw || typeof raw !== "object") return null
      const t = raw as RawTodo & { priority?: unknown }
      const rawContent = t.content
      const hasContentField = typeof rawContent === "string"
      const content = hasContentField ? rawContent : ""
      const rawId = typeof t.id === "string" ? t.id : ""
      const id = rawId || (hasContentField ? generateStableTodoId(content, index) : "")
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
