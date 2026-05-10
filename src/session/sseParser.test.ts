import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { SseEventParser, parseSseFrame } from "./sseParser"

describe("SseEventParser", () => {
  it("parses a single OpenCode data frame", () => {
    const event = parseSseFrame('data: {"type":"server.connected"}')
    assert.deepEqual(event, { type: "server.connected" })
  })

  it("unwraps global event envelopes", () => {
    const event = parseSseFrame(
      'data: {"directory":"/tmp/project","project":"global","payload":{"id":"evt_1","type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"text":"hello"}}}}',
    )

    assert.deepEqual(event, {
      id: "evt_1",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { text: "hello" },
      },
    })
  })

  it("parses multiple frames from one chunk", () => {
    const parser = new SseEventParser()
    const result = parser.push([
      'data: {"type":"server.connected"}',
      "",
      'data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}',
      "",
      "",
    ].join("\n"))

    assert.equal(result.errors.length, 0)
    assert.deepEqual(result.events.map(event => event.type), ["server.connected", "session.idle"])
  })

  it("ignores comments and heartbeat frames", () => {
    const parser = new SseEventParser()
    const result = parser.push(": keep-alive\n\nretry: 1000\n\n")
    assert.deepEqual(result.events, [])
    assert.deepEqual(result.errors, [])
    assert.equal(result.droppedNonDataFrames, 0, "comments and retry-only frames must NOT count as dropped")
  })

  it("counts non-data-bearing frames with real fields as dropped (observability metric)", () => {
    const parser = new SseEventParser()
    // event-only frames (no data:) — these are unusual and should be counted.
    // Comments, retry:, and id:-only frames should NOT be counted (covered above).
    const result = parser.push(
      "event: ping\n\n" +
      "event: notice\nid: 42\n\n" +
      ": keep-alive\n\n" +
      'data: {"type":"server.connected"}\n\n'
    )
    assert.equal(result.errors.length, 0, "non-data frames must not produce parse errors")
    assert.equal(result.events.length, 1, "the one data frame must still parse")
    assert.equal(
      result.droppedNonDataFrames, 2,
      "must count both event-bearing frames as dropped, but not the comment frame"
    )
  })

  it("handles frames split across chunks", () => {
    const parser = new SseEventParser()
    assert.deepEqual(parser.push('data: {"type":"message.part').events, [])

    const result = parser.push('.updated","properties":{"part":{"sessionID":"ses_2"}}}\n\n')
    assert.equal(result.errors.length, 0)
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0]!.type, "message.part.updated")
  })

  it("returns malformed JSON as an error without killing later frames", () => {
    const parser = new SseEventParser()
    const result = parser.push([
      "data: {not-json}",
      "",
      'data: {"type":"server.connected"}',
      "",
      "",
    ].join("\n"))

    assert.equal(result.errors.length, 1)
    assert.deepEqual(result.events, [{ type: "server.connected" }])
  })

  it("joins multi-line data frames before parsing", () => {
    const parser = new SseEventParser()
    const result = parser.push('data: {"type":\ndata: "server.connected"}\n\n')
    assert.equal(result.errors.length, 0)
    assert.deepEqual(result.events, [{ type: "server.connected" }])
  })

  it("normalises CRLF and bare CR line endings end-to-end", () => {
    const parser = new SseEventParser()
    // Mix of \r\n (HTTP-default), bare \r (legacy), and \n (Unix) in a single chunk
    const result = parser.push(
      'data: {"type":"server.connected"}\r\n\r\n' +
      'data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}\r\r' +
      'data: {"type":"server.disconnected"}\n\n'
    )
    assert.equal(result.errors.length, 0, "CRLF/CR must not produce parse errors")
    assert.deepEqual(
      result.events.map(e => e.type),
      ["server.connected", "session.idle", "server.disconnected"],
      "all three frames must parse regardless of line-ending variant"
    )
  })

  it("discards oldest data when buffer exceeds MAX_BUFFER_SIZE", () => {
    const parser = new SseEventParser()
    // Push a chunk just large enough to keep the buffer alive
    const smallFrame = 'data: {"type":"server.connected"}\n\n'
    // Feed enough data to overflow (1 MB of garbage + a valid frame at the end)
    const garbage = "x".repeat(512 * 1024)
    parser.push(garbage + "\n\n")

    // After overflow, valid frames should still parse
    const result = parser.push(smallFrame)
    assert.equal(result.errors.length, 0, "overflow must not introduce parse errors")
    assert.equal(result.events.length, 1, "must still parse frames after overflow")
    assert.equal(result.events[0]!.type, "server.connected")
  })
})
