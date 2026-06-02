import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  STREAM_LIMIT_TOOLTIP,
  TOOLTIPS,
  getDisabledReasonTooltip,
  getModeOptionTooltip,
  getModeSelectorTooltip,
  getSendTooltip,
  getVoiceTooltip,
} from "./tooltips"

void describe("TOOLTIPS map", () => {
  void it("exposes the chat action strings", () => {
    assert.equal(TOOLTIPS.chat.send, "Send message (Ctrl+Enter)")
    assert.equal(TOOLTIPS.chat.stop, "Stop the current model response")
    assert.ok(TOOLTIPS.chat.voiceStart)
    assert.ok(TOOLTIPS.chat.voiceStop)
  })

  void it("exposes the stream-limit constant for backward compat", () => {
    assert.equal(
      STREAM_LIMIT_TOOLTIP,
      "Concurrent stream limit reached — wait or stop another tab first",
    )
    assert.equal(STREAM_LIMIT_TOOLTIP, TOOLTIPS.limits.streamCapReached)
  })

  void it("builds a send-blocked-by-limit tooltip with streaming names", () => {
    const result = TOOLTIPS.chat.sendBlockedByLimit("Fix bug, Write tests")
    assert.ok(result.includes("Fix bug, Write tests"))
    assert.ok(result.includes("stream"))
  })

  void it("builds a streamCapWithNames tooltip that includes the streaming names", () => {
    const result = TOOLTIPS.limits.streamCapWithNames("Fix bug, Write tests")
    assert.ok(result.includes("Fix bug, Write tests"))
    assert.ok(result.includes("Currently streaming"))
  })
})

void describe("getSendTooltip", () => {
  void it("returns the stop tooltip while streaming", () => {
    const result = getSendTooltip({ isStreaming: true, streamCapacity: { isFull: false, streamingNames: "", activeStreams: 0 } })
    assert.equal(result.title, TOOLTIPS.chat.stop)
    assert.equal(result.ariaLabel, "Stop the current model response")
  })

  void it("returns the send tooltip when not streaming and not at the cap", () => {
    const result = getSendTooltip({ isStreaming: false, streamCapacity: { isFull: false, streamingNames: "", activeStreams: 0 } })
    assert.equal(result.title, TOOLTIPS.chat.send)
    assert.equal(result.ariaLabel, "Send message")
  })

  void it("returns the cap-reached tooltip when at the cap with no streaming names", () => {
    const result = getSendTooltip({ isStreaming: false, streamCapacity: { isFull: true, streamingNames: "", activeStreams: 3 } })
    assert.equal(result.title, STREAM_LIMIT_TOOLTIP)
    assert.equal(result.ariaLabel, STREAM_LIMIT_TOOLTIP)
  })

  void it("returns a per-tab tooltip when at the cap with streaming names", () => {
    const result = getSendTooltip({
      isStreaming: false,
      streamCapacity: { isFull: true, streamingNames: "Fix bug", activeStreams: 3 },
    })
    assert.ok(result.title.includes("Fix bug"))
    assert.ok(result.ariaLabel.includes("Fix bug"))
  })
})

void describe("getVoiceTooltip", () => {
  void it("covers all voice states with non-empty title and ariaLabel", () => {
    const states = [
      "disabled",
      "idle",
      "requesting-permission",
      "recording",
      "stopping",
      "transcribing",
      "inserted",
      "error",
    ] as const
    for (const state of states) {
      const result = getVoiceTooltip(state)
      assert.ok(result.title.length > 0, `title for ${state} should be non-empty`)
      assert.ok(result.ariaLabel.length > 0, `ariaLabel for ${state} should be non-empty`)
    }
  })

  void it("uses the stop copy when recording", () => {
    const result = getVoiceTooltip("recording")
    assert.equal(result.ariaLabel, TOOLTIPS.chat.voiceStop)
  })

  void it("uses the start copy when idle", () => {
    const result = getVoiceTooltip("idle")
    assert.equal(result.ariaLabel, "Start voice input")
  })
})

void describe("getModeSelectorTooltip", () => {
  void it("preserves test-expected substrings for build mode", () => {
    const result = getModeSelectorTooltip("build")
    assert.match(result.title, /Build mode/)
    assert.match(result.ariaLabel, /Ctrl/)
    assert.match(result.ariaLabel, /Alt\+Shift\+Tab/)
  })

  void it("includes the cycle shortcut for every mode", () => {
    for (const mode of ["plan", "build", "auto"] as const) {
      const result = getModeSelectorTooltip(mode)
      assert.match(result.ariaLabel, /Alt\+Shift\+Tab/)
    }
  })
})

void describe("getModeOptionTooltip", () => {
  void it("includes the mode label in the aria-label for plan/auto", () => {
    assert.match(getModeOptionTooltip("plan").title, /Plan mode/)
    assert.match(getModeOptionTooltip("auto").ariaLabel, /Auto mode/)
  })
})

void describe("getDisabledReasonTooltip", () => {
  void it("wraps the reason with the Unavailable prefix for both title and ariaLabel", () => {
    const result = getDisabledReasonTooltip("No active session")
    assert.equal(result.title, "Unavailable: No active session")
    assert.equal(result.ariaLabel, "Unavailable: No active session")
  })
})
