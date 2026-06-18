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
  /**
   * B10-recovery: Set by WebviewEventRouter when this startPrompt is the
   * expired-question fallback (sending the user's answer as a fresh text
   * prompt after the v2 reply failed with QuestionNotFoundError). Arms a
   * HARD 20s watchdog that fires unconditionally — not gated by
   * activity-tracker state (which can false-positive on stray events and
   * leave the user stuck "generating" forever). On fire, the watchdog
   * clears promptsInFlight, awaits the server abort, then emits
   * `expired_question_recovery_failed` with the answer text so the webview
   * can auto-send seamlessly (no manual Enter required).
   */
  recoveryFromExpiredQuestion?: boolean
  /** The user's original answer text, echoed back in the recovery-failed
   *  message so the webview can pre-fill the prompt input. */
  expiredRecoveryAnswerText?: string
}

export type ToolEndResult = {
  id: string
  ok: boolean
  result?: string
  durationMs?: number
  stale?: boolean
  /** Sprint 2 / M1: bash exit code (defensively extracted from
   *  state.metadata on the host). Optional because not every tool emits
   *  one; the webview's commandModel.readExitCode regex parses it from
   *  the result text as a fallback. */
  exitCode?: number
  /** Sprint 2 / M1: separated stderr stream when the server ships one.
   *  Optional; the bash-card renderer's stdout/stderr split panels light
   *  up only when this is present. */
  stderr?: string
  /** Sprint 2 / M1: true when the host truncated `result` before posting
   *  to keep the webview message under the IPC size cap. The renderer
   *  shows a truncation marker and the user can use "Copy output" to get
   *  the full content via the host. (Reserved — currently set on the
   *  block but not the wire; future work.) */
  resultTruncated?: boolean
  state?: "cancelled" | "error" | "result" | "stale"
}

export type ToolPartialInput = {
  id: string
  tool?: string
  token: number
  stdoutDelta?: string
  stderrDelta?: string
  stdout?: string
  stderr?: string
  stdoutLength: number
  stderrLength: number
  stdoutLineCount?: number
  stderrLineCount?: number
  replace?: boolean
  durationMs?: number
  exitCode?: number
  terminal?: boolean
  ok?: boolean
  result?: string
}

export type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout" | "interrupted"

/** Per-tab stream latency metrics for performance instrumentation. */
export interface ActiveRunMetrics {
  sendTime: number
  firstResponseTime?: number
  completeTime?: number
  finalizeTime?: number
  messageCount: number
}
