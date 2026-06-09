import { describe, it } from "node:test"
import assert from "node:assert"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "SseSubscriber.ts"), "utf8")

void describe("SseSubscriber", () => {
  void it("reads from event stream endpoint via fetch", () => {
    assert.ok(source.includes("text/event-stream"), "should use SSE content type header")
    assert.ok(source.includes("await fetch("), "should fetch the event stream URL")
  })

  void it("parses data lines using SseEventParser", () => {
    assert.ok(source.includes("SseEventParser"), "should reference SseEventParser")
    assert.ok(source.includes("parser.push("), "should push chunks into the parser")
    assert.ok(source.includes("parser.flush()"), "should flush the parser on stream end")
  })

  void it("has scheduleEventStreamReconnect method with exponential backoff", () => {
    assert.ok(source.includes("scheduleEventStreamReconnect("), "should define scheduleEventStreamReconnect")
    assert.ok(source.includes("Math.pow(2, attempt)"), "should use exponential backoff delay")
  })

  void it("caps reconnect attempts at MAX_EVENT_STREAM_RECONNECT_ATTEMPTS", () => {
    assert.ok(source.includes("MAX_EVENT_STREAM_RECONNECT_ATTEMPTS"), "should define max reconnect constant")
    assert.ok(source.includes("eventReconnectAttempts >= this.MAX_EVENT_STREAM_RECONNECT_ATTEMPTS"), "should check against max")
  })

  void it("has idle watchdog with timeout detection", () => {
    assert.ok(source.includes("IdleWatchdog"), "should reference IdleWatchdog")
    assert.ok(source.includes("idleWatchdog.arm()"), "should arm the watchdog")
    assert.ok(source.includes("idleWatchdog.timedOut"), "should check watchdog timedOut")
  })

  void it("tracks generation to gate stale callbacks", () => {
    assert.ok(source.includes("eventStreamGeneration"), "should track generation counter")
    assert.ok(source.includes("++this.eventStreamGeneration"), "should increment generation")
    assert.ok(source.includes("generation === this.eventStreamGeneration"), "should gate on generation")
  })

  void it("calls eventNormalizer.normalize to process events", () => {
    assert.ok(source.includes("this.eventNormalizer.normalize(event)"), "should normalize events via eventNormalizer")
  })

  void it("has waitForReady mechanism with ready waiters", () => {
    assert.ok(source.includes("eventStreamReadyWaiters"), "should define ready waiters set")
    assert.ok(source.includes("waitForReady("), "should define waitForReady method")
  })

  void it("has markEventStreamConnected method", () => {
    assert.ok(source.includes("markEventStreamConnected("), "should define markEventStreamConnected")
  })

  void it("has handleEventStreamError method with error handling", () => {
    assert.ok(source.includes("handleEventStreamError("), "should define handleEventStreamError")
  })

  void it("handles connection timeout with 30s message", () => {
    assert.ok(source.includes("timed out after 30s"), "should log 30s timeout message")
  })

  void it("handles max reconnect attempts with error message", () => {
    assert.ok(source.includes("max reconnect attempts"), "should include max reconnect attempts message")
  })

  void it("sets state to failed on max reconnect", () => {
    assert.ok(source.includes('setEventStreamState("failed")'), "should set state to failed")
  })

  void it("resets event normalizer on reconnect", () => {
    assert.ok(source.includes("createSdkEventNormalizer()"), "should create a new normalizer")
    assert.ok(source.includes("this.eventNormalizer = createSdkEventNormalizer()"), "should reassign normalizer on reconnect")
  })

  void it("uses AbortController for fetch cancellation", () => {
    assert.ok(source.includes("AbortController"), "should use AbortController")
    assert.ok(source.includes("controller.abort()"), "should abort the controller")
    assert.ok(source.includes("signal: controller.signal"), "should pass signal to fetch")
  })

  void it("exposes subscribe method to start the stream", () => {
    assert.ok(source.includes("subscribe()"), "should define subscribe method")
    assert.ok(source.includes("runEventStream("), "should call runEventStream from subscribe")
  })

  void it("exposes disconnect method to stop the stream", () => {
    assert.ok(source.includes("disconnect()"), "should define disconnect method")
  })

  void it("exposes dispose method for cleanup", () => {
    assert.ok(source.includes("dispose()"), "should define dispose method")
    assert.ok(source.includes("this.disposed = true"), "should set disposed flag")
  })

  void it("has sessionIdFromEvent method", () => {
    assert.ok(source.includes("sessionIdFromEvent("), "should define sessionIdFromEvent")
    assert.ok(source.includes("props.sessionID"), "should extract sessionID from event properties")
  })

  void it("emits normalized events via onEvent callback", () => {
    assert.ok(source.includes("this.onEvent(normalized)"), "should call onEvent with normalized events")
  })
})
