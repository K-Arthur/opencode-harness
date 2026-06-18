import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createStreamingLog,
  emit,
  isStreamingLogEntry,
  LONG_RUNNING_THRESHOLD_MS,
  TTFB_WARNING_FRACTIONS,
  type StreamingLogEntry,
} from "./StreamingLog"

function fakeNow(): number {
  return 1_700_000_000_000
}

function capturingSink(): {
  posts: Record<string, unknown>[]
  streams: string[]
  postMessage: (m: Record<string, unknown>) => void
  channel: { stream: (msg: string, ctx?: Record<string, unknown>) => void }
} {
  const posts: Record<string, unknown>[] = []
  const streams: string[] = []
  return {
    posts,
    streams,
    postMessage: (m) => posts.push(m),
    channel: { stream: (msg) => { streams.push(msg) } },
  }
}

function makeSink(cap: ReturnType<typeof capturingSink>) {
  return createStreamingLog({ postMessage: cap.postMessage, channel: cap.channel })
}

describe("StreamingLog", () => {
  it("exports LONG_RUNNING_THRESHOLD_MS of 30_000ms (non-blocking notice threshold)", () => {
    assert.equal(LONG_RUNNING_THRESHOLD_MS, 30_000)
  })

  it("exports TTFB_WARNING_FRACTIONS including 50% and 75%", () => {
    assert.ok(TTFB_WARNING_FRACTIONS.includes(0.5))
    assert.ok(TTFB_WARNING_FRACTIONS.includes(0.75))
  })

  it("createStreamingLog returns a sink with a log() method", () => {
    const cap = capturingSink()
    const sink = makeSink(cap)
    assert.equal(typeof sink.log, "function")
  })

  it("posts a streaming_log message to the webview with the entry shape", () => {
    const cap = capturingSink()
    const sink = makeSink(cap)
    sink.log({
      ts: fakeNow(),
      kind: "ttfb_timeout",
      sessionId: "ses_abc123",
      cliSessionId: "cli_xyz",
      message: "TTFB fired after 180s with no chunks",
      context: { eventStream: "connected" },
    })
    assert.equal(cap.posts.length, 1)
    const posted = cap.posts[0]!
    assert.equal(posted.type, "streaming_log")
    const entry = (posted as { entry: StreamingLogEntry }).entry
    assert.equal(entry.kind, "ttfb_timeout")
    assert.equal(entry.sessionId, "ses_abc123")
    assert.equal(entry.cliSessionId, "cli_xyz")
    assert.equal(entry.message, "TTFB fired after 180s with no chunks")
    assert.deepEqual(entry.context, { eventStream: "connected" })
  })

  it("mirrors a one-line summary to the injected channel (OutputChannel)", () => {
    const cap = capturingSink()
    const sink = makeSink(cap)
    sink.log({
      ts: 1,
      kind: "first_chunk",
      sessionId: "ses_abc",
      cliSessionId: "cli_xyz",
      message: "first byte",
    })
    assert.equal(cap.streams.length, 1)
    const line = cap.streams[0]!
    assert.match(line, /\[first_chunk\]/)
    assert.match(line, /session=ses_abc/)
    assert.match(line, /cli=cli_xyz/)
    assert.match(line, /first byte/)
  })

  it("never throws if postMessage throws (best-effort webview mirror)", () => {
    const sink = createStreamingLog({
      postMessage: () => {
        throw new Error("webview gone")
      },
      channel: { stream: () => {} },
    })
    // Must not throw.
    sink.log({ ts: fakeNow(), kind: "stream_end", sessionId: "s", message: "done" })
  })

  it("never throws if channel.stream throws (best-effort OutputChannel mirror)", () => {
    const sink = createStreamingLog({
      postMessage: () => {},
      channel: {
        stream: () => {
          throw new Error("channel gone")
        },
      },
    })
    sink.log({ ts: fakeNow(), kind: "stream_end", sessionId: "s", message: "done" })
  })

  it("emit() returns the timestamp it logged at", () => {
    const cap = capturingSink()
    const sink = makeSink(cap)
    const ts = emit(sink, "first_chunk", "s1", "first byte received")
    assert.equal(typeof ts, "number")
    assert.equal(cap.posts.length, 1)
  })

  it("isStreamingLogEntry validates a well-formed entry", () => {
    assert.equal(
      isStreamingLogEntry({
        ts: 1,
        kind: "stream_end",
        sessionId: "s",
        message: "done",
      }),
      true,
    )
  })

  it("isStreamingLogEntry rejects malformed payloads (null / wrong types)", () => {
    assert.equal(isStreamingLogEntry(null), false)
    assert.equal(isStreamingLogEntry("[object Object]"), false)
    assert.equal(
      isStreamingLogEntry({ ts: "x", kind: 1, sessionId: true, message: {} }),
      false,
    )
    assert.equal(
      isStreamingLogEntry({ ts: 1, kind: "stream_end" /* missing sessionId/message */ }),
      false,
    )
  })

  it("handles entries with optional fields omitted", () => {
    const cap = capturingSink()
    const sink = makeSink(cap)
    sink.log({
      ts: fakeNow(),
      kind: "send_dispatched",
      sessionId: "s",
      message: "send",
    })
    const posted = cap.posts[0]! as { entry: StreamingLogEntry }
    assert.equal(posted.entry.cliSessionId, undefined)
    assert.equal(posted.entry.runId, undefined)
    assert.equal(posted.entry.context, undefined)
  })
})
