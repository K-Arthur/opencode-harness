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
      pendingTokens: 150000,
      predictedTokens: 160000,
      predictedCost: 0.5,
      willOverflow: true
    }
    
    assert.strictEqual(typeof message.sessionId, "string")
    assert.strictEqual(typeof message.pendingTokens, "number")
    assert.strictEqual(typeof message.predictedTokens, "number")
    assert.strictEqual(typeof message.predictedCost, "number")
    assert.strictEqual(typeof message.willOverflow, "boolean")
    assert.ok(message.pendingTokens > 0)
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
