export interface LiveToolOutputSnapshot {
  available: boolean
  callId: string
  stdout: string
  stderr: string
  token: number
  stdoutLength: number
  stderrLength: number
  stdoutLineCount: number
  stderrLineCount: number
  durationMs?: number
  exitCode?: number
}

export interface LiveToolOutputInput {
  callId: string
  state?: unknown
  part?: Record<string, unknown>
  fallbackToken?: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function countOutputLines(text: string): number {
  if (!text) return 0
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text
  return normalized ? normalized.split(/\r?\n/).length : 0
}

function firstNumber(records: Array<Record<string, unknown> | undefined>, keys: readonly string[]): number | undefined {
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const value = readNumber(record[key])
      if (value !== undefined) return value
    }
  }
  return undefined
}

function extractFromRecord(record: Record<string, unknown> | undefined): { stdout?: string; stderr?: string } {
  if (!record) return {}
  const stdout = readString(record.stdout) ?? readString(record.out) ?? readString(record.output)
  const stderr = readString(record.stderr) ?? readString(record.error_output) ?? readString(record.err)
  return { stdout, stderr }
}

export function extractLiveToolOutput(input: LiveToolOutputInput): LiveToolOutputSnapshot {
  const state = asRecord(input.state)
  const meta = asRecord(state?.metadata)
  const liveOutput = asRecord(meta?.liveOutput) ?? asRecord(meta?.live_output) ?? asRecord(state?.liveOutput) ?? asRecord(state?.live_output)

  const nested = extractFromRecord(liveOutput)
  const directMeta = extractFromRecord(meta)
  const directState = extractFromRecord(state)
  const directPart = extractFromRecord(input.part)

  const stdout = nested.stdout ?? directMeta.stdout ?? directState.stdout ?? directPart.stdout
  const stderr = nested.stderr ?? directMeta.stderr ?? directState.stderr ?? directPart.stderr ?? ""
  const normalizedStdout = stdout ?? ""
  const normalizedStderr = stderr ?? ""
  const available = stdout !== undefined || nested.stderr !== undefined || directMeta.stderr !== undefined || directState.stderr !== undefined || directPart.stderr !== undefined

  const token = firstNumber([liveOutput, meta, state, input.part], ["token", "seq", "sequence", "version", "offset"])
    ?? input.fallbackToken
    ?? (normalizedStdout.length + normalizedStderr.length)

  const time = asRecord(state?.time)
  const start = readNumber(time?.start)
  const end = readNumber(time?.end)
  const durationMs = start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined
  const exitCode = firstNumber([meta, state, input.part], ["exit_code", "exitCode", "exit", "status"])

  return {
    available,
    callId: input.callId,
    stdout: normalizedStdout,
    stderr: normalizedStderr,
    token,
    stdoutLength: normalizedStdout.length,
    stderrLength: normalizedStderr.length,
    stdoutLineCount: countOutputLines(normalizedStdout),
    stderrLineCount: countOutputLines(normalizedStderr),
    durationMs,
    exitCode,
  }
}
