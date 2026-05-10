import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "SessionManager.ts"), "utf8")

describe("SessionManager event transport", () => {
  it("owns the global SSE transport instead of SDK event.subscribe", () => {
    const subscribeIdx = source.indexOf("private subscribeToEvents()")
    assert.ok(subscribeIdx >= 0, "subscribeToEvents must exist")
    const runIdx = source.indexOf("private async runEventStream", subscribeIdx)
    const block = source.slice(subscribeIdx, runIdx > subscribeIdx ? runIdx : subscribeIdx + 1200)

    assert.ok(block.includes("this.serverBaseUrl()"), "transport must derive the active server base URL")
    assert.ok(block.includes("new AbortController()"), "transport must own an AbortController")
    assert.ok(!block.includes(".event.subscribe("), "transport must not use the SDK event.subscribe helper")
  })

  it("opens GET /global/event with text/event-stream accept and auth header", () => {
    assert.ok(source.includes("fetch(this.eventStreamUrl(baseUrl)"), "must fetch the owned event stream directly")
    assert.ok(source.includes('return `${baseUrl}/global/event`'), "must subscribe to the long-lived global event stream")
    assert.ok(source.includes('Accept: "text/event-stream"'), "must request SSE")
    assert.ok(source.includes('headers["Authorization"] = this.authHeader'), "must forward current auth header")
  })

  it("parses SSE frames through SseEventParser and EventNormalizer", () => {
    assert.ok(source.includes("new SseEventParser()"), "must instantiate the parser")
    assert.ok(source.includes("parser.push(decoder.decode(value, { stream: true }))"), "must feed split chunks to parser")
    assert.ok(source.includes("this.eventNormalizer.normalize(sdkEvent)"), "must normalize parsed SDK events")
  })

  it("tracks event stream lifecycle and waits for readiness", () => {
    assert.ok(source.includes("EventStreamLifecycleState"), "must expose lifecycle state")
    assert.ok(source.includes("waitForEventStreamReady"), "must expose readiness wait")
    assert.ok(source.includes("eventStreamReadyWaiters"), "must wake prompt waiters once connected")
    assert.ok(source.includes('this.setEventStreamState("connected")'), "must mark connected after stream opens")
  })

  it("fires event_stream_reconnected only after a stable reconnect window", () => {
    const markIdx = source.indexOf("private markEventStreamConnected")
    assert.ok(markIdx >= 0, "markEventStreamConnected must exist")
    const scheduleIdx = source.indexOf("private scheduleEventStreamReconnect", markIdx)
    const block = source.slice(markIdx, scheduleIdx > markIdx ? scheduleIdx : markIdx + 1800)

    assert.ok(block.includes("wasReconnect"), "must distinguish first connect from reconnect")
    assert.ok(block.includes("eventStreamStableTimer"), "must delay reconnect notification")
    assert.ok(block.includes('type: "event_stream_reconnected"'), "must keep existing reconnect event")
  })
})
