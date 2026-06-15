/**
 * PTY terminal state model (audit §14.1/§14.2).
 *
 * opencode SDK 1.17.7 exposes a PTY API that makes live terminal visibility and
 * true per-command cancellation possible without the §14.1 "Hybrid A" polling
 * hack: `pty.created/updated/exited/deleted` events (lifecycle), `pty.connect()`
 * (live output bytes), and `pty.remove()` (cancel a specific running command).
 *
 * The SDK `Pty` info object carries NO output, so output arrives as separate
 * chunks from the connect stream. This **pure, DOM-free, IO-free** reducer folds
 * lifecycle events + output chunks into a renderable model with a bounded
 * (ring-buffered) output buffer (perf: never unbounded growth on long logs).
 *
 * Rendering (ANSI handling via `webview/ansiUtils.ts`) and the live connect/remove
 * wiring live at the host/webview edges; this core is what they fold events into.
 */

/** Bounded output buffer per terminal — keep the most recent tail. */
export const PTY_OUTPUT_CAP = 200_000

/** SDK `Pty` info shape (subset we consume). */
export interface PtyInfo {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export interface PtyTerminalState {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  exitCode?: number
  /** Ring-buffered combined output (capped at PTY_OUTPUT_CAP). */
  output: string
  startedAt: number
  endedAt?: number
}

export type PtyAction =
  | { kind: "created"; info: PtyInfo; at: number }
  | { kind: "chunk"; id: string; data: string }
  | { kind: "updated"; info: PtyInfo }
  | { kind: "exited"; id: string; exitCode: number; at: number }
  | { kind: "removed"; id: string }

const TRUNCATION_MARKER = "…[earlier output truncated]\n"

/** Append `data` to `existing`, keeping at most PTY_OUTPUT_CAP chars (newest tail). */
function appendCapped(existing: string, data: string): string {
  const combined = existing + data
  if (combined.length <= PTY_OUTPUT_CAP) return combined
  const tail = combined.slice(combined.length - PTY_OUTPUT_CAP)
  return TRUNCATION_MARKER + tail
}

/**
 * Fold one action into the terminal map, returning a NEW map (immutable — callers
 * may diff or persist the previous state safely). Unknown ids are ignored rather
 * than throwing or fabricating entries (events can race the connect handshake).
 */
export function ptyReducer(
  state: ReadonlyMap<string, PtyTerminalState>,
  action: PtyAction,
): Map<string, PtyTerminalState> {
  const next = new Map(state)
  switch (action.kind) {
    case "created": {
      const i = action.info
      next.set(i.id, {
        id: i.id,
        title: i.title,
        command: i.command,
        args: i.args,
        cwd: i.cwd,
        status: i.status,
        output: "",
        startedAt: action.at,
      })
      return next
    }
    case "chunk": {
      const cur = next.get(action.id)
      if (!cur) return next
      next.set(action.id, { ...cur, output: appendCapped(cur.output, action.data) })
      return next
    }
    case "updated": {
      const cur = next.get(action.info.id)
      if (!cur) return next
      next.set(action.info.id, {
        ...cur,
        title: action.info.title,
        command: action.info.command,
        args: action.info.args,
        cwd: action.info.cwd,
        status: action.info.status,
      })
      return next
    }
    case "exited": {
      const cur = next.get(action.id)
      if (!cur) return next
      next.set(action.id, { ...cur, status: "exited", exitCode: action.exitCode, endedAt: action.at })
      return next
    }
    case "removed": {
      next.delete(action.id)
      return next
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = action
      return _never
    }
  }
}

/**
 * Interpret a `client.pty.list()` result to decide whether the connected server
 * supports the PTY API. When false, the caller keeps the §14.1 Hybrid-A polling
 * fallback (constitution rule #6: graceful degradation).
 */
export function isPtySupported(result: { data?: unknown; error?: unknown; response?: { status?: number } } | undefined | null): boolean {
  if (!result) return false
  if (result.error) return false
  if (result.response?.status === 404) return false
  return Array.isArray(result.data)
}
