type MaybeThenable<T> = T | PromiseLike<T>

export interface HostMessageBatcherOptions {
  flushMs?: number
  maxBatchSize?: number
}

export type BatchableHostMessage = Record<string, unknown> & { type: string }

const IMMEDIATE_TYPES = new Set([
  "init_state",
  "session_deleted",
  "session_renamed",
  "active_session_changed",
  "stream_start",
  "stream_chunk",
  "stream_end",
  "stream_ping",
  "stream_ack",
  "stream_tool_start",
  "stream_tool_end",
  "stream_tool_unresolved",
  "streaming_state",
  "permission_request",
  "request_error",
  "webview_request_error",
  "prompt_rejected",
  "rate_limit_exhausted",
  "compaction_started",
  "session_compacted",
  "clear_messages",
  "resume_session_data",
  "more_messages",
  "force_rerender",
])

export class HostMessageBatcher {
  private queued: BatchableHostMessage[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly flushMs: number
  private readonly maxBatchSize: number

  constructor(
    private readonly delegate: (msg: Record<string, unknown>) => MaybeThenable<boolean | void>,
    private readonly log?: (msg: string) => void,
    options: HostMessageBatcherOptions = {},
  ) {
    this.flushMs = options.flushMs ?? 16
    this.maxBatchSize = options.maxBatchSize ?? 25
  }

  static isBatchable(msg: Record<string, unknown>): msg is BatchableHostMessage {
    const type = typeof msg.type === "string" ? msg.type : ""
    return Boolean(type && !IMMEDIATE_TYPES.has(type))
  }

  post(msg: Record<string, unknown>): boolean {
    if (!HostMessageBatcher.isBatchable(msg)) {
      return this.dispatch(msg)
    }

    this.queued.push(msg)
    if (this.queued.length >= this.maxBatchSize) {
      this.flush()
      return true
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushMs)
    }
    return true
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.queued.length === 0) return
    const messages = this.queued.splice(0)
    this.dispatch({ type: "host_message_batch", messages })
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.queued = []
  }

  dispose(): void {
    this.flush()
    this.clear()
  }

  private dispatch(msg: Record<string, unknown>): boolean {
    try {
      const result = this.delegate(msg)
      if (result === false) return false
      if (result && typeof (result as PromiseLike<boolean | void>).then === "function") {
        ;(result as PromiseLike<boolean | void>).then((ok) => {
          if (ok === false) this.log?.(`[HostMessageBatcher] delegate returned false for ${String(msg.type)}`)
        }, (err) => {
          this.log?.(`[HostMessageBatcher] delegate rejected for ${String(msg.type)}: ${String(err)}`)
        })
      }
      return true
    } catch (err) {
      this.log?.(`[HostMessageBatcher] delegate threw for ${String(msg.type)}: ${String(err)}`)
      return false
    }
  }
}
