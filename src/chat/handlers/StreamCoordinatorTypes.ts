export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void | boolean | Thenable<boolean | void>
  postRequestError: (message: string, sessionId?: string) => void
  toolCallId?: string
  /**
   * Called when a `stream_start` is posted to the webview. Lets the caller
   * (e.g. WebviewEventRouter) clear in-flight guards so a follow-up prompt
   * isn't silently dropped by a stale promptsInFlight entry.
   */
  clearPromptsInFlight?: () => void
}

export type ToolEndResult = { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean }

export type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout" | "interrupted"
