import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { HostMessage, WebviewMessage } from "../../src/chat/webview/types"

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

  void it("validates stream_tool_partial message structure", () => {
    const message: HostMessage = {
      type: "stream_tool_partial",
      sessionId: "test-123",
      toolCall: {
        id: "tool-1",
        name: "bash",
        class: "exec",
        state: "running",
        partialStdout: "installing\n",
        partialStderr: "warn\n",
        stdoutLength: 11,
        stderrLength: 5,
        stdoutLineCount: 1,
        stderrLineCount: 1,
        token: 9,
        durationMs: 750,
      },
    }

    assert.strictEqual(message.type, "stream_tool_partial")
    assert.strictEqual(message.toolCall.id, "tool-1")
    assert.strictEqual(message.toolCall.token, 9)
    assert.strictEqual(message.toolCall.stdoutLength, 11)
    assert.strictEqual(message.toolCall.stderrLength, 5)
  })

  void it("validates cancel_tool webview message structure", () => {
    const message: WebviewMessage = {
      type: "cancel_tool",
      sessionId: "test-123",
      toolId: "tool-1",
      stdout: "partial stdout\n",
      stderr: "partial stderr\n",
    }

    assert.strictEqual(message.type, "cancel_tool")
    assert.strictEqual(message.toolId, "tool-1")
    assert.strictEqual(typeof message.stdout, "string")
    assert.strictEqual(typeof message.stderr, "string")
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

  void it("validates token_usage message structure", () => {
    const message: HostMessage = {
      type: "token_usage",
      sessionId: "test-123",
      usage: { prompt: 100, completion: 20, total: 120, reasoning: 5, cacheRead: 10, cacheWrite: 3 }
    }

    assert.strictEqual(typeof message.sessionId, "string")
    assert.strictEqual(typeof message.usage.prompt, "number")
    assert.strictEqual(typeof message.usage.completion, "number")
    assert.strictEqual(typeof message.usage.total, "number")
  })

  void it("validates stream_tool_partial message structure", () => {
    const message: HostMessage = {
      type: "stream_tool_partial",
      sessionId: "test-123",
      toolCall: {
        id: "tool-1",
        name: "bash",
        class: "exec",
        state: "running",
        partialStdout: "installing\n",
        partialStderr: "warn\n",
        stdoutLength: 11,
        stderrLength: 5,
        stdoutLineCount: 1,
        stderrLineCount: 1,
        token: 2,
        durationMs: 600,
      },
      seq: 9,
    }

    assert.strictEqual(message.type, "stream_tool_partial")
    assert.strictEqual(message.toolCall.id, "tool-1")
    assert.strictEqual(message.toolCall.partialStdout, "installing\n")
    assert.strictEqual(message.toolCall.partialStderr, "warn\n")
    assert.strictEqual(message.toolCall.token, 2)
  })

  void it("validates tool_output_config message structure", () => {
    const message: HostMessage = {
      type: "tool_output_config",
      renderAnsi: true,
    }

    assert.strictEqual(message.type, "tool_output_config")
    assert.strictEqual(message.renderAnsi, true)
  })

  void it("validates chat_font_config message structure", () => {
    const message: HostMessage = {
      type: "chat_font_config",
      fontSize: 14,
      fontFamily: "Fira Code",
    }

    assert.strictEqual(message.type, "chat_font_config")
    assert.strictEqual(message.fontSize, 14)
    assert.strictEqual(message.fontFamily, "Fira Code")
  })

  void it("validates chat_dir_config message structure", () => {
    const message: HostMessage = {
      type: "chat_dir_config",
      direction: "rtl",
    }

    assert.strictEqual(message.type, "chat_dir_config")
    assert.strictEqual(message.direction, "rtl")
  })

  void it("validates chat_dir_change webview message structure", () => {
    const message: WebviewMessage = {
      type: "chat_dir_change",
      direction: "ltr",
    }

    assert.strictEqual(message.type, "chat_dir_change")
    assert.strictEqual(message.direction, "ltr")
  })

  void it("validates cancel_tool webview message structure", () => {
    const message: WebviewMessage = {
      type: "cancel_tool",
      sessionId: "test-123",
      toolId: "tool-1",
      stdout: "partial out",
      stderr: "partial err",
      durationMs: 1200,
    }

    assert.strictEqual(message.type, "cancel_tool")
    assert.strictEqual(message.sessionId, "test-123")
    assert.strictEqual(message.toolId, "tool-1")
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

  void it("validates prompt acceptance and failed-send recovery messages", () => {
    const accepted: HostMessage = {
      type: "prompt_accepted",
      sessionId: "test-123",
      messageId: "user-1",
      clientRequestId: "req-1",
    }
    const failed: HostMessage = {
      type: "prompt_send_failed",
      sessionId: "test-123",
      messageId: "user-1",
      clientRequestId: "req-1",
      text: "Retry me",
      reason: "No model selected",
    }

    assert.strictEqual(accepted.type, "prompt_accepted")
    assert.strictEqual(typeof accepted.clientRequestId, "string")
    assert.strictEqual(failed.type, "prompt_send_failed")
    assert.strictEqual(typeof failed.text, "string")
    assert.strictEqual(typeof failed.reason, "string")
  })

  void it("validates unknown_server_event message structure", () => {
    const message: HostMessage = {
      type: "unknown_server_event",
      sessionId: "test-123",
      eventType: "vendor.future.event",
      classification: "unclassified",
      preview: "{\"sessionID\":\"test-123\"}",
    }

    assert.strictEqual(message.type, "unknown_server_event")
    assert.strictEqual(typeof message.eventType, "string")
    assert.strictEqual(message.classification, "unclassified")
  })

  void it("validates voice settings message structure", () => {
    const message: HostMessage = {
      type: "voice_settings",
      settings: {
        enabled: true,
        autoSend: false,
        language: "auto",
        insertMode: "append",
        maxRecordingSeconds: 60,
        available: true,
      },
    }

    assert.strictEqual(typeof message.settings.enabled, "boolean")
    assert.strictEqual(typeof message.settings.autoSend, "boolean")
    assert.strictEqual(typeof message.settings.language, "string")
    assert.strictEqual(message.settings.insertMode, "append")
    assert.strictEqual(typeof message.settings.maxRecordingSeconds, "number")
    assert.strictEqual(message.settings.available, true)
  })

  void it("validates voice transcript and error messages", () => {
    const transcript: HostMessage = {
      type: "voice_transcript",
      requestId: "voice-1",
      text: "Summarize this file",
    }
    const error: HostMessage = {
      type: "voice_error",
      requestId: "voice-2",
      reason: "no_speech",
      message: "No speech was detected.",
    }

    assert.strictEqual(typeof transcript.requestId, "string")
    assert.strictEqual(typeof transcript.text, "string")
    assert.strictEqual(error.reason, "no_speech")
    assert.strictEqual(typeof error.message, "string")
  })

  void it("validates voice lifecycle (recording-started / transcribing) messages", () => {
    const started: HostMessage = { type: "voice_recording_started", requestId: "voice-1" }
    const transcribing: HostMessage = { type: "voice_transcribing", requestId: "voice-1" }

    assert.strictEqual(started.requestId, "voice-1")
    assert.strictEqual(transcribing.type, "voice_transcribing")
  })

  void it("validates open_model_manager message structure", () => {
    const message: HostMessage = {
      type: "open_model_manager",
      forRegeneration: true,
      messageId: "msg-1",
    }

    assert.strictEqual(message.type, "open_model_manager")
    assert.strictEqual(message.forRegeneration, true)
    assert.strictEqual(typeof message.messageId, "string")
  })
})
