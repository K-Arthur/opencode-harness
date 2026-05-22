import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { HostMessage } from "../../src/chat/webview/types"

void describe("Message Contract Tests", () => {
  void it("validates stream_chunk message structure", () => {
    const message: HostMessage = {
      type: "stream_chunk",
      sessionId: "test-123",
      text: "test content",
      messageId: "msg-1"
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.strictEqual(typeof message.text, "string")
    assert.strictEqual(typeof message.messageId, "string")
    assert.ok(message.sessionId.length > 0)
    assert.ok(message.messageId && message.messageId.length > 0)
  })

  void it("validates model_update message structure", () => {
    const message: HostMessage = {
      type: "model_update",
      model: "claude-3-opus-20240229"
    }
    
    assert.strictEqual(typeof message.model, "string")
    assert.ok(message.model.length > 0)
  })

  void it("validates session_compacted message structure", () => {
    const message: HostMessage = {
      type: "session_compacted",
      sessionId: "test-123"
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.ok(message.sessionId.length > 0)
  })

  void it("validates resume_session_data message structure", () => {
    const message: HostMessage = {
      type: "resume_session_data",
      sessionId: "test-123",
      messages: [],
      model: "claude-3-opus-20240229",
      isStreaming: false
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.strictEqual(typeof message.messages, "object")
    assert.strictEqual(typeof message.model, "string")
    assert.strictEqual(typeof message.isStreaming, "boolean")
    assert.strictEqual(Array.isArray(message.messages), true)
  })

  void it("validates compaction_started message structure", () => {
    const message: HostMessage = {
      type: "compaction_started",
      sessionId: "test-123"
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.ok(message.sessionId.length > 0)
  })

  void it("validates compact_banner message structure", () => {
    const message: HostMessage = {
      type: "compact_banner",
      sessionId: "test-123",
      percent: 80,
      tokens: 150000,
      maxTokens: 180000,
      actions: ["compact_now", "remind_later"]
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.strictEqual(typeof message.percent, "number")
    assert.strictEqual(typeof message.tokens, "number")
    assert.strictEqual(typeof message.maxTokens, "number")
    assert.strictEqual(Array.isArray(message.actions), true)
    assert.ok(message.tokens > 0)
  })

  void it("validates host_message_batch structure", () => {
    const message: HostMessage = {
      type: "host_message_batch",
      messages: [
        { type: "context_usage", sessionId: "test-123", percent: 80, tokens: 100, maxTokens: 200 },
        { type: "server_status", sessionId: "test-123", status: "thinking" }
      ]
    }

    assert.strictEqual(Array.isArray(message.messages), true)
    assert.equal(message.messages.length, 2)
    assert.equal(message.messages[0]!.type, "context_usage")
  })

  void it("validates active_session_changed message structure", () => {
    const message: HostMessage = {
      type: "active_session_changed",
      sessionId: "test-123"
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.ok(message.sessionId.length > 0)
  })
})
