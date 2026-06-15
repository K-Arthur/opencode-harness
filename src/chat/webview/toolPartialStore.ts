export interface ToolPartialPayload {
  token?: number
  partialStdout?: string
  partialStderr?: string
  stdoutDelta?: string
  stderrDelta?: string
  stdout?: string
  stderr?: string
  stdoutLength?: number
  stderrLength?: number
  stdoutLineCount?: number
  stderrLineCount?: number
  replace?: boolean
  durationMs?: number
  exitCode?: number
}

export interface LiveToolOutput {
  stdout: string
  stderr: string
  token: number
  stdoutLength: number
  stderrLength: number
  stdoutLineCount: number
  stderrLineCount: number
  durationMs?: number
  exitCode?: number
  terminal: boolean
}

function key(sessionId: string, toolId: string): string {
  return `${sessionId}\u0000${toolId}`
}

function countLines(text: string): number {
  if (!text) return 0
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text
  return normalized ? normalized.split(/\r?\n/).length : 0
}

export function createToolPartialStore() {
  const store = new Map<string, LiveToolOutput>()

  return {
    apply(sessionId: string, toolId: string, payload: ToolPartialPayload): LiveToolOutput | undefined {
      const k = key(sessionId, toolId)
      const existing = store.get(k)
      if (existing?.terminal) return undefined

      const token = typeof payload.token === "number" ? payload.token : (existing?.token ?? 0) + 1
      if (existing && token <= existing.token) return undefined

      const stdoutDelta = payload.partialStdout ?? payload.stdoutDelta ?? ""
      const stderrDelta = payload.partialStderr ?? payload.stderrDelta ?? ""
      const requestedStdoutLength = payload.stdoutLength
      const requestedStderrLength = payload.stderrLength
      let replace = payload.replace === true
      if (existing && typeof requestedStdoutLength === "number" && requestedStdoutLength < existing.stdoutLength) replace = true
      if (existing && typeof requestedStderrLength === "number" && requestedStderrLength < existing.stderrLength) replace = true

      let stdout = replace && payload.stdout !== undefined ? payload.stdout : `${existing?.stdout ?? ""}${stdoutDelta}`
      let stderr = replace && payload.stderr !== undefined ? payload.stderr : `${existing?.stderr ?? ""}${stderrDelta}`

      const expectedStdoutLength = typeof requestedStdoutLength === "number" ? requestedStdoutLength : stdout.length
      const expectedStderrLength = typeof requestedStderrLength === "number" ? requestedStderrLength : stderr.length
      if (stdout.length !== expectedStdoutLength && payload.stdout !== undefined) stdout = payload.stdout
      if (stderr.length !== expectedStderrLength && payload.stderr !== undefined) stderr = payload.stderr

      const next: LiveToolOutput = {
        stdout,
        stderr,
        token,
        stdoutLength: expectedStdoutLength,
        stderrLength: expectedStderrLength,
        stdoutLineCount: payload.stdoutLineCount ?? countLines(stdout),
        stderrLineCount: payload.stderrLineCount ?? countLines(stderr),
        durationMs: payload.durationMs ?? existing?.durationMs,
        exitCode: payload.exitCode ?? existing?.exitCode,
        terminal: false,
      }
      store.set(k, next)
      return next
    },
    get(sessionId: string, toolId: string): LiveToolOutput | undefined {
      return store.get(key(sessionId, toolId))
    },
    markTerminal(sessionId: string, toolId: string): void {
      const existing = store.get(key(sessionId, toolId))
      if (existing) existing.terminal = true
    },
    clearSession(sessionId: string): void {
      const prefix = `${sessionId}\u0000`
      for (const k of Array.from(store.keys())) {
        if (k.startsWith(prefix)) store.delete(k)
      }
    },
  }
}

export const toolPartialStore = createToolPartialStore()
