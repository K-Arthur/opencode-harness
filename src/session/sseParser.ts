import type { SdkEventLike } from "./EventNormalizer"

export interface SseParseResult {
  events: SdkEventLike[]
  errors: Error[]
  /**
   * Count of frames that contained SSE fields (e.g. `event:`, `id:`) but no
   * `data:` line, so they could not be turned into events. Pure comment / pure
   * heartbeat frames (`:keep-alive`, `retry: N` only) are NOT counted — those
   * are normal server traffic. A non-zero value here indicates the server is
   * emitting non-data-bearing frames (often a sign of keep-alive misconfig
   * or an event-name-only push); useful as a health metric.
   */
  droppedNonDataFrames: number
}

/**
 * Minimal Server-Sent Events parser for OpenCode's /event and /global/event streams.
 *
 * OpenCode sends JSON payloads in data frames. We intentionally ignore event
 * names, comments, retry hints, and empty heartbeat frames because the payload's
 * `type` field is the source of truth used by EventNormalizer.
 */
export class SseEventParser {
  private buffer = ""
  private readonly MAX_BUFFER_SIZE = 1024 * 1024

  push(chunk: string): SseParseResult {
    const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

    // Buffer overflow guard: discard oldest data when buffer exceeds 1 MB
    if (this.buffer.length + normalized.length > this.MAX_BUFFER_SIZE) {
      const excess = this.buffer.length + normalized.length - this.MAX_BUFFER_SIZE
      const split = this.buffer.indexOf("\n", excess)
      this.buffer = split >= 0 ? this.buffer.slice(split + 1) : ""
    }

    this.buffer += normalized

    const events: SdkEventLike[] = []
    const errors: Error[] = []
    let droppedNonDataFrames = 0

    while (true) {
      const frameEnd = this.buffer.indexOf("\n\n")
      if (frameEnd < 0) break

      const frame = this.buffer.slice(0, frameEnd)
      this.buffer = this.buffer.slice(frameEnd + 2)

      try {
        const result = parseFrameDetailed(frame)
        if (result.event) events.push(result.event)
        else if (result.hadNonHeartbeatFields) droppedNonDataFrames++
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
    }

    return { events, errors, droppedNonDataFrames }
  }

  flush(): SseParseResult {
    if (!this.buffer.trim()) {
      this.buffer = ""
      return { events: [], errors: [], droppedNonDataFrames: 0 }
    }

    const frame = this.buffer
    this.buffer = ""
    try {
      const result = parseFrameDetailed(frame)
      return {
        events: result.event ? [result.event] : [],
        errors: [],
        droppedNonDataFrames: !result.event && result.hadNonHeartbeatFields ? 1 : 0,
      }
    } catch (err) {
      return {
        events: [],
        errors: [err instanceof Error ? err : new Error(String(err))],
        droppedNonDataFrames: 0,
      }
    }
  }
}

interface ParsedFrame {
  event: SdkEventLike | undefined
  /** True when the frame had at least one non-comment, non-heartbeat field but no `data:` line. */
  hadNonHeartbeatFields: boolean
}

function parseFrameDetailed(frame: string): ParsedFrame {
  const dataLines: string[] = []
  let sawNonDataField = false

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue

    const colon = line.indexOf(":")
    const field = colon >= 0 ? line.slice(0, colon) : line
    let value = colon >= 0 ? line.slice(colon + 1) : ""
    if (value.startsWith(" ")) value = value.slice(1)

    if (field === "data") {
      dataLines.push(value)
    } else if (field !== "retry" && field !== "id") {
      // `event:` (and any unknown field) qualifies as non-heartbeat. `retry:`
      // and `id:` alone are routine SSE bookkeeping and not interesting.
      sawNonDataField = true
    }
  }

  if (dataLines.length === 0) {
    return { event: undefined, hadNonHeartbeatFields: sawNonDataField }
  }

  const parsed = JSON.parse(dataLines.join("\n")) as unknown
  const event = unwrapOpenCodeEvent(parsed)
  if (!event) {
    throw new Error("SSE data frame did not contain an OpenCode event")
  }

  return { event, hadNonHeartbeatFields: false }
}

export function parseSseFrame(frame: string): SdkEventLike | undefined {
  return parseFrameDetailed(frame).event
}

function isSdkEventLike(value: unknown): value is SdkEventLike {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
}

function unwrapOpenCodeEvent(value: unknown): SdkEventLike | null {
  if (isSdkEventLike(value)) return value

  if (typeof value !== "object" || value === null) return null

  const payload = (value as { payload?: unknown }).payload
  return isSdkEventLike(payload) ? payload : null
}
