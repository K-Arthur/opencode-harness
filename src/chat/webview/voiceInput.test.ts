import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupVoiceInput } from "./voiceInput"
import type { VoiceInputSettings } from "../voiceInputCore"

function settings(overrides: Partial<VoiceInputSettings> = {}): VoiceInputSettings {
  return {
    enabled: true,
    provider: "browser",
    maxDurationSeconds: 60,
    maxUploadBytes: 1024,
    openaiModel: "gpt-4o-mini-transcribe",
    hasOpenAiApiKey: false,
    ...overrides,
  }
}

void describe("voice input webview UI", () => {
  beforeEach(() => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <textarea id="prompt-input"></textarea>
      <button id="voice-input-btn"></button>
      <span id="voice-input-status"></span>
    </body></html>`)
    ;(globalThis as any).document = dom.window.document
    ;(globalThis as any).window = dom.window
    ;(globalThis as any).HTMLElement = dom.window.HTMLElement
    ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
  })

  it("requests settings and disables browser mode when SpeechRecognition is unavailable", () => {
    const posted: Record<string, unknown>[] = []
    const api = setupVoiceInput({
      els: {
        promptInput: document.getElementById("prompt-input") as HTMLTextAreaElement,
        voiceInputBtn: document.getElementById("voice-input-btn") as HTMLButtonElement,
        voiceInputStatus: document.getElementById("voice-input-status") as HTMLElement,
      },
      postMessage: (msg) => posted.push(msg),
      insertTextAtCursor: () => {},
      autoResizeTextarea: () => {},
      updateSendButton: () => {},
    })

    api.applySettings(settings())

    assert.deepEqual(posted[0], { type: "get_stt_settings" })
    assert.equal(api.getState(), "disabled")
    assert.equal((document.getElementById("voice-input-btn") as HTMLButtonElement).disabled, true)
    assert.match(document.getElementById("voice-input-status")!.textContent || "", /unavailable/i)
  })

  it("inserts only the current transcript request into the prompt", () => {
    const inserted: string[] = []
    const api = setupVoiceInput({
      els: {
        promptInput: document.getElementById("prompt-input") as HTMLTextAreaElement,
        voiceInputBtn: document.getElementById("voice-input-btn") as HTMLButtonElement,
        voiceInputStatus: document.getElementById("voice-input-status") as HTMLElement,
      },
      postMessage: () => {},
      insertTextAtCursor: (text) => inserted.push(text),
      autoResizeTextarea: () => {},
      updateSendButton: () => {},
    })

    api.setCurrentRequestId("voice-current")
    api.handleTranscript({ requestId: "voice-old", text: "old text" })
    api.handleTranscript({ requestId: "voice-current", text: "  new\ntext  " })

    assert.deepEqual(inserted, ["new text"])
    assert.equal(api.getState(), "inserted")
  })
})
