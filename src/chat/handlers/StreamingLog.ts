/**
 * Streaming state transition logger.
 *
 * Research (opencode CLI / WHATWG SSE / VS Code webview guidance) shows the
 * most common reason "stuck streaming" / "Send reverted while still generating"
 * reports are untriagable is that the UI gives no signal beyond "it just
 * stopped". opencode CLI exposes `--log-level DEBUG`, `--print-logs`, and
 * timestamped log files; this module is the extension's equivalent funnel for
 * streaming lifecycle events.
 *
 * The logger is host-side (runs in the extension process). It writes to:
 *   1. The shared {@link OutputChannelService} (visible in VS Code's Output
 *      panel — mirrors `--print-logs`).
 *   2. The webview via `postMessage({type:'streaming_log', ...})` so the
 *      in-webview devtools console and any future "streaming log" panel see
 *      the same narrative.
 *
 * It is intentionally side-effect-free for production paths: logging never
 * throws and never blocks. Everything is best-effort.
 */

export interface StreamingLogChannel {
  /** Mirror the entry to the OutputChannel (or any other side-channel). */
  stream(message: string, context?: Record<string, unknown>): void
}

/** Discriminator for the kind of streaming lifecycle event being logged. */
export type StreamingLogKind =
  | "send_dispatched" // host received send_prompt, dispatching to opencode server
  | "prompt_accepted" // server accepted the prompt
  | "first_chunk" // first stream chunk arrived (TTFB resolved)
  | "ttfb_warning" // approaching TTFB threshold (50%, 75%)
  | "ttfb_timeout" // TTFB watchdog fired
  | "probe_dispatched" // host probing server for run liveness
  | "probe_result" // host received probe result
  | "probe_retry" // probe failed, scheduling retry
  | "probe_exhausted" // all probe retries failed
  | "stream_end" // terminal: run completed/aborted/errored
  | "reconnect" // SSE reconnected
  | "watchdog" // generic watchdog tick
  | "long_running" // long-running indicator (no chunks for >LONG_RUNNING_THRESHOLD_MS)
  | "abort" // user-initiated abort

export interface StreamingLogEntry {
  /** Millisecond timestamp (Date.now()). */
  ts: number
  kind: StreamingLogKind
  /** Stable session id (the webview tab id). */
  sessionId: string
  /** opencode server session id when known. */
  cliSessionId?: string
  /** Server-assigned run id when known. */
  runId?: string
  /** Human-readable detail. */
  message: string
  /** Optional structured context (scrubbed by OutputChannelService). */
  context?: Record<string, unknown>
}

export interface StreamingLogSink {
  log(entry: StreamingLogEntry): void
}

export interface StreamingLogDeps {
  /** Post a message to the webview. */
  postMessage: (msg: Record<string, unknown>) => void
  /** Mirror to the OutputChannel. Injected (not imported) so the module is
   *  pure logic and unit-testable without a vscode runtime. The host wires
   *  this to the shared `log` singleton; tests pass a capturing fake. */
  channel: StreamingLogChannel
}

/** Long-running threshold: post a "model is thinking..." notice after this
 *  many ms with no chunks. Per research, reasoning models (GLM-5.x, Kimi,
 *  DeepSeek-R1, Qwen-QwQ) routinely take 60–180s to first token; we surface
 *  a non-blocking notice at 30s so users don't assume the extension hung. */
export const LONG_RUNNING_THRESHOLD_MS = 30_000

/** TTFB warning thresholds (fraction of configured TTFB). At each threshold
 *  crossed, emit a ttfb_warning so the user sees the host is still waiting. */
export const TTFB_WARNING_FRACTIONS = [0.5, 0.75]

/**
 * Create a streaming log sink. The sink funnels every entry to:
 *   - The shared OutputChannel (with `stream` prefix for filtering)
 *   - The webview via `streaming_log` postMessage
 */
export function createStreamingLog(deps: StreamingLogDeps): StreamingLogSink {
  return {
    log(entry: StreamingLogEntry) {
      try {
        const detail = entry.message ? ` — ${entry.message}` : ""
        const cli = entry.cliSessionId ? ` cli=${entry.cliSessionId.slice(0, 12)}` : ""
        const run = entry.runId ? ` run=${entry.runId.slice(0, 12)}` : ""
        const line = `[${entry.kind}] session=${entry.sessionId.slice(0, 12)}${cli}${run}${detail}`
        try {
          deps.channel.stream(line, entry.context)
        } catch {
          /* channel gone — keep going so webview still gets it */
        }
        // Best-effort webview mirror. Never throw on postMessage failure.
        try {
          deps.postMessage({
            type: "streaming_log",
            entry: {
              ts: entry.ts,
              kind: entry.kind,
              sessionId: entry.sessionId,
              cliSessionId: entry.cliSessionId,
              runId: entry.runId,
              message: entry.message,
              context: entry.context,
            },
          })
        } catch {
          /* webview gone — channel log still useful */
        }
      } catch {
        /* never let logging break the streaming path */
      }
    },
  }
}

/** Convenience helper: emit a log entry from kind + session. The sink handles
 *  the actual dispatch. Returned `ts` lets callers track thresholds. */
export function emit(
  sink: StreamingLogSink,
  kind: StreamingLogKind,
  sessionId: string,
  message: string,
  extra?: Pick<StreamingLogEntry, "cliSessionId" | "runId" | "context">,
): number {
  const ts = Date.now()
  sink.log({ ts, kind, sessionId, message, ...extra })
  return ts
}

/** Type guard for inbound `streaming_log` postMessages so the webview can
 *  validate before rendering. */
export function isStreamingLogEntry(value: unknown): value is StreamingLogEntry {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.ts === "number" &&
    typeof v.kind === "string" &&
    typeof v.sessionId === "string" &&
    typeof v.message === "string"
  )
}
