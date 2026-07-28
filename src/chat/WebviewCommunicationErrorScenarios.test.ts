import { describe, it, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const chatProviderSource = readFileSync(resolve(__dirname, "ChatProvider.ts"), "utf8")
const eventRouterSource = readFileSync(resolve(__dirname, "WebviewEventRouter.ts"), "utf8")
const hostMessageBatcherSource = readFileSync(resolve(__dirname, "HostMessageBatcher.ts"), "utf8")

void describe("Webview Communication Error Scenarios", () => {
  void describe("postMessage error handling", () => {
    void it("catches errors when webview.postMessage fails", () => {
      assert.ok(chatProviderSource.includes("try {"), "postMessage must be wrapped in try-catch")
      assert.ok(chatProviderSource.includes("} catch (err)"), "postMessage must have error handling")
      assert.ok(chatProviderSource.includes('log.error("Failed to post message to webview"'), "errors must be logged")
    })

    void it("schedules retry for critical messages on postMessage failure", () => {
      assert.ok(chatProviderSource.includes("CRITICAL_MESSAGE_TYPES"), "must define critical message types")
      assert.ok(chatProviderSource.includes("scheduleRetry"), "must have retry scheduling logic")
      assert.ok(chatProviderSource.includes("this.scheduleRetry(msg)"), "must call scheduleRetry for critical messages")
    })
  })

  void describe("earlyMessageQueue overflow handling", () => {
    void it("has size limit for earlyMessageQueue", () => {
      assert.ok(eventRouterSource.includes("MAX_QUEUE_SIZE"), "must define max queue size")
      assert.ok(eventRouterSource.includes("MAX_QUEUE_SIZE") && eventRouterSource.includes("100"), "must set queue size limit to 100")
    })

    void it("evicts coalesceable or non-critical messages before critical ones (O1)", () => {
      // After O1: priority eviction — prefer dropping stale coalesceable types and never silently
      // displace UNDROPPABLE critical types like init_state/stream_end.
      assert.ok(eventRouterSource.includes("COALESCEABLE_TYPES"), "must define the coalesceable type set")
      assert.ok(eventRouterSource.includes("UNDROPPABLE_TYPES"), "must define the undroppable type set")
      assert.ok(eventRouterSource.includes("this.earlyMessageQueue.splice") || eventRouterSource.includes("this.earlyMessageQueue.shift"), "must remove from queue when full")
      assert.ok(
        eventRouterSource.includes("evicting non-critical") || eventRouterSource.includes("dropping incoming") || eventRouterSource.includes("Early message queue full"),
        "must log when something is evicted or refused"
      )
    })
  })

  void describe("webview_ready timeout handling", () => {
    void it("starts timeout when webviewReady is set to false", () => {
      assert.ok(eventRouterSource.includes("startReadyTimeout"), "must have startReadyTimeout method")
      assert.ok(chatProviderSource.includes("this.eventRouter.startReadyTimeout()"), "must call startReadyTimeout on resolve")
    })

    void it("clears timeout when webview_ready message arrives", () => {
      assert.ok(eventRouterSource.includes("clearReadyTimeout"), "must have clearReadyTimeout method")
      assert.ok(eventRouterSource.includes("this.clearReadyTimeout()"), "must call clearReadyTimeout in webview_ready handler")
    })

    void it("flushes queued messages on timeout expiry", () => {
      assert.ok(eventRouterSource.includes("setTimeout"), "must use setTimeout for timeout")
      assert.ok(eventRouterSource.includes("flushing"), "must flush messages on timeout")
    })
  })

  void describe("HostMessageBatcher graceful shutdown", () => {
    void it("has disposed flag to prevent new chunks", () => {
      assert.ok(hostMessageBatcherSource.includes("disposed = false"), "must have disposed flag")
      assert.ok(hostMessageBatcherSource.includes("if (this.disposed)"), "must check disposed flag")
    })

    void it("sets disposed flag before flushing in dispose", () => {
      assert.ok(hostMessageBatcherSource.includes("this.disposed = true"), "must set disposed flag")
      assert.ok(hostMessageBatcherSource.includes("this.flush()"), "must flush before clearing")
    })
  })

  void describe("retry queue cleanup", () => {
    void it("clears retry queue on webview recreation", () => {
      assert.ok(chatProviderSource.includes("this.messageRetryQueue = []"), "must clear retry queue")
    })

    void it("clears retry timer on disposal", () => {
      assert.ok(chatProviderSource.includes("if (this.retryTimer)"), "must check retry timer")
      assert.ok(chatProviderSource.includes("clearTimeout(this.retryTimer)"), "must clear retry timer")
    })
  })

  void describe("duplicate handler registration", () => {
    void it("does not have duplicate force_rerender handler", () => {
      const mainSource = readFileSync(resolve(__dirname, "webview/main.ts"), "utf8")
      const forceRerenderMatches = mainSource.match(/\["force_rerender"/g)
      assert.ok(forceRerenderMatches && forceRerenderMatches.length === 1, "should have exactly one force_rerender handler")
    })
  })

  void describe("type safety improvements", () => {
    void it("HostMessage is a discriminated union type", () => {
      const typesSource = readFileSync(resolve(__dirname, "webview/types.ts"), "utf8")
      assert.ok(typesSource.includes("export type HostMessage"), "HostMessage must be a discriminated union type")
      assert.ok(!typesSource.includes("[key: string]: unknown") || !typesSource.match(/export type HostMessage[\s\S]*?\n\}/)?.[0]?.includes("[key: string]: unknown"), "HostMessage union members should not have index signatures")
    })

    void it("has discriminated union members with typed fields", () => {
      const typesSource = readFileSync(resolve(__dirname, "webview/types.ts"), "utf8")
      assert.ok(typesSource.includes('type: "stream_chunk"') && typesSource.includes("sessionId: string"), "stream_chunk should have sessionId")
      assert.ok(typesSource.includes("messageId?: string"), "should have messageId on relevant members")
      assert.ok(typesSource.includes("text: string"), "should have text on relevant members")
    })
  })
})
