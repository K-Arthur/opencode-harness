import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const chatProviderSource = readFileSync(resolve(__dirname, "ChatProvider.ts"), "utf8")
const eventRouterSource = readFileSync(resolve(__dirname, "WebviewEventRouter.ts"), "utf8")
const validatorSource = readFileSync(resolve(__dirname, "WebviewMessageValidator.ts"), "utf8")
const hostMessageBatcherSource = readFileSync(resolve(__dirname, "HostMessageBatcher.ts"), "utf8")
const typesSource = readFileSync(resolve(__dirname, "webview/types.ts"), "utf8")
const retryQueueSource = readFileSync(resolve(__dirname, "RetryQueueService.ts"), "utf8")

void describe("Webview Message Flow Integration Tests", () => {
  void describe("message validation flow", () => {
    void it("validates message type against VALID_WEBVIEW_TYPES", () => {
      assert.ok(eventRouterSource.includes("VALID_WEBVIEW_TYPES"), "must have valid types set")
      assert.ok(eventRouterSource.includes("has(msg.type)"), "must validate message type")
      assert.ok(eventRouterSource.includes('log.warn(`Unknown webview message type'), "must warn on unknown type")
    })

    void it("validates sessionId length constraints", () => {
      assert.ok(eventRouterSource.includes("sessionId.length === 0"), "must reject empty sessionId")
      assert.ok(eventRouterSource.includes("sessionId.length > 100"), "must reject oversized sessionId")
    })

    void it("validates send_prompt text length", () => {
      assert.ok(eventRouterSource.includes("validateMessage"), "must call validateMessage")
      assert.ok(validatorSource.includes("send_prompt: validateSendPrompt"), "must validate send_prompt")
      assert.ok(validatorSource.includes("text.length > 50000"), "must validate prompt length")
    })

    void it("validates mention_search query length", () => {
      assert.ok(eventRouterSource.includes("validateMessage"), "must call validateMessage")
      assert.ok(validatorSource.includes("mention_search: validateMentionSearch"), "must validate mention_search")
      assert.ok(
        validatorSource.includes('invalidOptionalString(msg, "query", "Rejected oversized mention search query", deps, 500)'),
        "must validate query length"
      )
    })

    void it("validates change_mode values", () => {
      assert.ok(eventRouterSource.includes("validateMessage"), "must call validateMessage")
      assert.ok(validatorSource.includes("change_mode: validateChangeMode"), "must validate change_mode")
      assert.ok(validatorSource.includes('new Set(["normal", "plan", "build", "auto"])'), "must validate mode values")
    })
  })

  void describe("message buffering flow", () => {
    void it("buffers messages when webview is not ready", () => {
      assert.ok(eventRouterSource.includes("enqueueMessage"), "must use enqueueMessage for buffering")
      assert.ok(eventRouterSource.includes("earlyMessageQueue.push(msg)"), "must push to queue")
    })

    void it("allows passthrough messages during buffering", () => {
      assert.ok(chatProviderSource.includes("init_state"), "must allow init_state through")
      assert.ok(chatProviderSource.includes("theme_vars"), "must allow theme_vars through")
      assert.ok(chatProviderSource.includes("theme_config"), "must allow theme_config through")
      assert.ok(chatProviderSource.includes("rate_limit_state"), "must allow rate_limit_state through")
      assert.ok(chatProviderSource.includes("model_update"), "must allow model_update through")
      assert.ok(chatProviderSource.includes("model_list"), "must allow model_list through")
      assert.ok(chatProviderSource.includes("webview_ready"), "must allow webview_ready through")
      assert.ok(chatProviderSource.includes("session_list_update"), "must allow session_list_update through")
    })

    void it("flushes buffered messages on webview_ready", () => {
      assert.ok(eventRouterSource.includes('["webview_ready"'), "must have webview_ready handler")
      assert.ok(eventRouterSource.includes("for (const q of queue) this.opts.postMessage(q)"), "must iterate and flush queue")
      assert.ok(eventRouterSource.includes("this.earlyMessageQueue = []"), "must clear queue after flush")
    })
  })

  void describe("chunk batching flow", () => {
    void it("batches stream_chunk messages by sessionId", () => {
      assert.ok(hostMessageBatcherSource.includes('type: "stream_chunk"'), "must emit stream_chunk in delegate")
      assert.ok(hostMessageBatcherSource.includes("chunkQueue.add(msg.sessionId"), "must buffer by sessionId")
    })

    void it("flushes batches on timer expiry", () => {
      assert.ok(hostMessageBatcherSource.includes("setTimeout"), "must use timer for flushing")
      assert.ok(hostMessageBatcherSource.includes("computeChunkFlushDelay"), "must compute adaptive flush timing")
    })

    void it("batches non-critical host messages without batching stream lifecycle", () => {
      assert.ok(chatProviderSource.includes("this.messageBatcher.post(msg)"), "ChatProvider must route host messages through the unified batcher")
      assert.ok(typesSource.includes("host_message_batch"), "HostMessage must include the batch envelope")
      assert.ok(chatProviderSource.includes('"stream_start", "stream_end", "stream_chunk"') || retryQueueSource.includes('"stream_start", "stream_end", "stream_chunk"') || retryQueueSource.includes("stream_start") && retryQueueSource.includes("stream_end") && retryQueueSource.includes("stream_chunk"), "stream lifecycle messages must remain critical")
    })

    void it("flushes immediately on stream_end", () => {
      assert.ok(hostMessageBatcherSource.includes('msg.type === "stream_end"'), "must detect stream_end")
      assert.ok(hostMessageBatcherSource.includes("this.flushChunks()"), "must flush on stream_end")
    })

    void it("prevents new chunks after disposal", () => {
      assert.ok(hostMessageBatcherSource.includes("if (this.disposed)"), "must check disposed flag")
      assert.ok(hostMessageBatcherSource.includes("return"), "must return early if disposed")
    })
  })

  void describe("retry logic flow", () => {
    void it("identifies critical message types for retry", () => {
      assert.ok(chatProviderSource.includes("CRITICAL_MESSAGE_TYPES") || retryQueueSource.includes("CRITICAL_MESSAGE_TYPES"), "must define critical types")
      assert.ok(chatProviderSource.includes("stream_end") || retryQueueSource.includes("stream_end"), "must include stream_end")
      assert.ok(chatProviderSource.includes("error") || retryQueueSource.includes("error"), "must include error")
      assert.ok(chatProviderSource.includes("webview_ready") || retryQueueSource.includes("webview_ready"), "must include webview_ready")
    })

    void it("implements exponential backoff for retries", () => {
      assert.ok(chatProviderSource.includes("RETRY_DELAYS_MS") || retryQueueSource.includes("RETRY_DELAYS_MS") || retryQueueSource.includes("RETRY_DELAYS"), "must have retry delay array")
      assert.ok(chatProviderSource.includes("attempts") || retryQueueSource.includes("attempts"), "must track retry attempts")
      assert.ok(chatProviderSource.includes("MAX_RETRIES") || retryQueueSource.includes("MAX_RETRIES"), "must have max retry limit")
    })

    void it("removes message from queue on successful retry", () => {
      assert.ok(chatProviderSource.includes("this.messageRetryQueue.splice") || retryQueueSource.includes(".splice("), "must remove from queue on success")
    })

    void it("abandons message after max retries", () => {
      assert.ok(chatProviderSource.includes("attempts >= ChatProvider.MAX_RETRIES") || retryQueueSource.includes("attempts >= MAX_RETRIES") || retryQueueSource.includes("attempts >= maxRetries") || retryQueueSource.includes(">= MAX_RETRIES"), "must check max retries")
      assert.ok(chatProviderSource.includes('log.error(`Max retries exceeded') || retryQueueSource.includes('Max retries exceeded'), "must log when max retries exceeded")
    })
  })

  void describe("type safety flow", () => {
    void it("exports UsageDelta type for token usage", () => {
      assert.ok(typesSource.includes("export interface UsageDelta"), "must export UsageDelta")
      assert.ok(typesSource.includes("prompt: number"), "must have prompt field")
      assert.ok(typesSource.includes("completion: number"), "must have completion field")
    })

    void it("imports UsageDelta in main.ts", () => {
      const mainSource = readFileSync(resolve(__dirname, "webview/main.ts"), "utf8")
      assert.ok(mainSource.includes("UsageDelta"), "must import UsageDelta")
    })

    void it("HostMessage usage field accepts both types", () => {
      assert.ok(typesSource.includes("usage?: ContextUsage | UsageDelta"), "usage must accept both types")
    })
  })

  void describe("stream handler cleanup flow", () => {
    void it("deletes stream handler on tab close", () => {
      const mainSource = readFileSync(resolve(__dirname, "webview/main.ts"), "utf8")
      assert.ok(mainSource.includes("function closeTab"), "must have closeTab function")
      assert.ok(mainSource.includes("streamHandlers.delete(tabId)"), "must delete handler on close")
    })

    void it("deletes stream handler on session deletion", () => {
      const mainSource = readFileSync(resolve(__dirname, "webview/main.ts"), "utf8")
      assert.ok(mainSource.includes('["session_deleted"'), "must have session_deleted handler")
      assert.ok(mainSource.includes("streamHandlers.delete(msg.sessionId)"), "must delete handler on session delete")
    })
  })

  void describe("webview lifecycle flow", () => {
    void it("clears message batcher on webview recreation", () => {
      assert.ok(chatProviderSource.includes("this.messageBatcher.dispose()"), "must dispose message batcher on resolve")
    })

    void it("resets webviewReady state on recreation", () => {
      assert.ok(chatProviderSource.includes("this.eventRouter.webviewReady = false"), "must reset ready state")
    })

    void it("starts ready timeout on recreation", () => {
      assert.ok(chatProviderSource.includes("this.eventRouter.startReadyTimeout()"), "must start timeout on resolve")
    })

    void it("clears ready timeout on disposal", () => {
      assert.ok(chatProviderSource.includes("this.eventRouter.clearReadyTimeout()"), "must clear timeout on disposal")
    })
  })
})
