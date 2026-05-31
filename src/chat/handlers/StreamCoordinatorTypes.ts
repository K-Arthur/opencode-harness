export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
  toolCallId?: string
}

export type ToolEndResult = { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean }

export type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout" | "interrupted"
