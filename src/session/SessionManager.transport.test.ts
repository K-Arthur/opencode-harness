import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const sseSource = readFileSync(resolve(__dirname, "SseSubscriber.ts"), "utf8")
const managerSource = readFileSync(resolve(__dirname, "SessionManager.ts"), "utf8")

describe("SessionManager event transport", () => {
  it("owns the global SSE transport instead of SDK event.subscribe", () => {
    const subscribeIdx = sseSource.indexOf("subscribe():")
    assert.ok(subscribeIdx >= 0, "subscribe must exist in SseSubscriber")
    const runIdx = sseSource.indexOf("private async runEventStream", subscribeIdx)
    const block = sseSource.slice(subscribeIdx, runIdx > subscribeIdx ? runIdx : subscribeIdx + 1200)

    assert.ok(block.includes("getBaseUrl()"), "transport must derive the active server base URL")
    assert.ok(block.includes("new AbortController()"), "transport must own an AbortController")
    assert.ok(!block.includes(".event.subscribe("), "transport must not use the SDK event.subscribe helper")
  })

  it("opens GET /global/event with text/event-stream accept and auth header", () => {
    assert.ok(sseSource.includes("fetch(this.eventStreamUrl(baseUrl)"), "must fetch the owned event stream directly")
    assert.ok(sseSource.includes('return `${baseUrl}/global/event`'), "must subscribe to the long-lived global event stream")
    assert.ok(sseSource.includes('Accept: "text/event-stream"'), "must request SSE")
    assert.ok(sseSource.includes("getAuthHeader()"), "must forward current auth header")
  })

  it("parses SSE frames through SseEventParser and EventNormalizer", () => {
    assert.ok(sseSource.includes("new SseEventParser()"), "must instantiate the parser")
    assert.ok(sseSource.includes("parser.push(decoder.decode(value, { stream: true }))"), "must feed split chunks to parser")
    assert.ok(sseSource.includes("this.eventNormalizer.normalize("), "must normalize parsed SDK events")
  })

  it("tracks event stream lifecycle and waits for readiness", () => {
    assert.ok(managerSource.includes("EventStreamLifecycleState"), "must expose lifecycle state")
    assert.ok(sseSource.includes("waitForReady"), "must expose readiness wait")
    assert.ok(sseSource.includes("eventStreamReadyWaiters"), "must wake prompt waiters once connected")
    assert.ok(sseSource.includes('this.setEventStreamState("connected")'), "must mark connected after stream opens")
  })

  it("fires event_stream_reconnected only after a stable reconnect window", () => {
    const markIdx = sseSource.indexOf("private markEventStreamConnected")
    assert.ok(markIdx >= 0, "markEventStreamConnected must exist in SseSubscriber")
    const scheduleIdx = sseSource.indexOf("private scheduleEventStreamReconnect", markIdx)
    const block = sseSource.slice(markIdx, scheduleIdx > markIdx ? scheduleIdx : markIdx + 1800)

    assert.ok(block.includes("wasReconnect"), "must distinguish first connect from reconnect")
    assert.ok(block.includes("eventStreamStableTimer"), "must delay reconnect notification")
    assert.ok(block.includes('type: "event_stream_reconnected"'), "must keep existing reconnect event")
  })

  it("bridges process disconnects into normalized server_disconnected events", () => {
    assert.ok(managerSource.includes("lifecycleDisposables"), "must retain lifecycle event subscriptions for disposal")
    assert.ok(managerSource.includes("this.serverLifecycle.onDisconnected((data) =>"), "must subscribe to ServerLifecycle disconnects")
    assert.ok(managerSource.includes("this.sseSubscriber.disconnect()"), "must stop stale SSE transport on process disconnect")
    assert.ok(managerSource.includes("this.v2Client = null"), "must clear the stale v2 client so reconnect can create a fresh one")
    assert.ok(managerSource.includes('type: "server_disconnected", data'), "must publish normalized server_disconnected events")
  })
})
