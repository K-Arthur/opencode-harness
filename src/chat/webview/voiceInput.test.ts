import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupVoiceInput, type VoiceInputDeps } from "./voiceInput"
import type { VoiceInputSettings } from "../voiceInputCore"

function settings(overrides: Partial<VoiceInputSettings> = {}): VoiceInputSettings {
  return {
    enabled: true,
    autoSend: false,
    language: "auto",
    insertMode: "append",
    maxRecordingSeconds: 60,
    available: true,
    ...overrides,
  }
}

function els() {
  return {
    promptInput: document.getElementById("prompt-input") as HTMLTextAreaElement,
    voiceInputBtn: document.getElementById("voice-input-btn") as HTMLButtonElement,
    voiceInputStatus: document.getElementById("voice-input-status") as HTMLElement,
  }
}

function setup(overrides: Partial<VoiceInputDeps> = {}) {
  const posted: Record<string, unknown>[] = []
  const inserted: string[] = []
  let submitCount = 0
  const api = setupVoiceInput({
    els: els(),
    postMessage: (msg) => posted.push(msg),
    insertTextAtCursor: (text) => {
      const input = els().promptInput
      input.value += text
      inserted.push(text)
    },
    autoResizeTextarea: () => {},
    updateSendButton: () => {},
    submitPrompt: () => {
      submitCount++
    },
    ...overrides,
  })
  return { api, posted, inserted, getSubmitCount: () => submitCount }
}

const btn = () => document.getElementById("voice-input-btn") as HTMLButtonElement
const status = () => document.getElementById("voice-input-status")!.textContent || ""

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

  it("requests voice settings on init and becomes idle when available", () => {
    const { api, posted } = setup()
    api.applySettings(settings())
    assert.deepEqual(posted[0], { type: "get_voice_settings" })
    assert.equal(api.getState(), "idle")
    assert.equal(btn().disabled, false)
    assert.match(status(), /ready/i)
  })

  it("disables the button when the feature is off", () => {
    const { api } = setup()
    api.applySettings(settings({ enabled: false }))
    assert.equal(api.getState(), "disabled")
    assert.equal(btn().disabled, true)
    assert.match(status(), /disabled/i)
  })

  it("offers setup when no local engine is available", () => {
    const { api, posted } = setup()
    api.applySettings(settings({ available: false, unavailableReason: "No engine found." }))
    assert.equal(api.getState(), "disabled")
    assert.equal(btn().disabled, false)
    assert.equal(btn().getAttribute("aria-label"), "Set up voice input")
    assert.match(status(), /No engine found\./)
    btn().click()
    assert.equal(posted.some((m) => m.type === "setup_voice_input"), true)
  })

  it("starts recording via the host (no in-webview mic) on click", async () => {
    let getUserMediaCalled = false
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => { getUserMediaCalled = true; throw new Error("no") } } },
    })
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click()
    const startMsg = posted.find((m) => m.type === "voice_start")
    assert.equal(getUserMediaCalled, false) // webview never touches the mic
    assert.equal(typeof startMsg?.requestId, "string")
    assert.equal(api.getState(), "starting")
  })

  it("transitions to recording once the host confirms capture started", () => {
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    assert.equal(api.getState(), "recording")
    assert.match(status(), /recording/i)
  })

  it("stops and transcribes on a second click", () => {
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    btn().click()
    assert.equal(posted.some((m) => m.type === "voice_stop" && m.requestId === requestId), true)
    assert.equal(api.getState(), "transcribing")
    assert.equal(btn().disabled, true)
  })

  it("inserts the transcript (append) and lands in inserted state", () => {
    const { api, posted, inserted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    api.handleTranscribing({ requestId })
    api.handleTranscript({ requestId, text: "  hello\nthere  " })
    assert.deepEqual(inserted, ["hello there"])
    assert.equal(api.getState(), "inserted")
  })

  it("appends after existing text with a separating space", () => {
    els().promptInput.value = "draft"
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    api.handleTranscript({ requestId, text: "spoken" })
    assert.equal(els().promptInput.value, "draft spoken")
  })

  it("replaces existing text in replace mode", () => {
    els().promptInput.value = "old draft"
    const { api, posted } = setup()
    api.applySettings(settings({ insertMode: "replace" }))
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    api.handleTranscript({ requestId, text: "fresh" })
    assert.equal(els().promptInput.value, "fresh")
  })

  it("auto-sends only when autoSend is enabled", () => {
    const { api, posted, getSubmitCount } = setup()
    api.applySettings(settings({ autoSend: true }))
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    api.handleTranscript({ requestId, text: "go" })
    assert.equal(getSubmitCount(), 1)
  })

  it("does not auto-send by default", () => {
    const { api, posted, getSubmitCount } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    api.handleTranscript({ requestId, text: "go" })
    assert.equal(getSubmitCount(), 0)
  })

  it("ignores transcripts for a stale request id", () => {
    const { api, posted, inserted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    api.handleTranscript({ requestId: "voice-old", text: "stale" })
    assert.deepEqual(inserted, [])
    api.handleTranscript({ requestId, text: "fresh" })
    assert.deepEqual(inserted, ["fresh"])
  })

  it("cancels with Escape while recording and posts voice_cancel", () => {
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleRecordingStarted({ requestId })
    window.dispatchEvent(new (globalThis as any).KeyboardEvent("keydown", { key: "Escape" }))
    assert.equal(posted.some((m) => m.type === "voice_cancel" && m.requestId === requestId), true)
    assert.equal(api.getState(), "idle")
  })

  it("cancels a pending start on a second click before capture begins", () => {
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click() // starting
    btn().click() // cancel
    assert.equal(posted.some((m) => m.type === "voice_cancel"), true)
    assert.equal(api.getState(), "idle")
  })

  it("surfaces host errors and returns to an actionable state", () => {
    const { api, posted } = setup()
    api.applySettings(settings())
    btn().click()
    const requestId = posted.find((m) => m.type === "voice_start")?.requestId
    api.handleError({ requestId, message: "Mic not found" })
    assert.equal(api.getState(), "error")
    assert.match(status(), /Mic not found/)
    assert.equal(btn().disabled, false) // can retry
  })
})
