import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { VoiceInputHelperService } from "./VoiceInputHelperService"
import type { VoiceAudioPayload, VoiceInputSettings } from "./voiceInputCore"

class TestUri {
  constructor(private readonly value: string) {}
  toString(): string {
    return this.value
  }
}

function parseUri(value: string): TestUri {
  return new TestUri(value)
}

function settings(overrides: Partial<VoiceInputSettings> = {}): VoiceInputSettings {
  return {
    enabled: true,
    provider: "openai",
    maxDurationSeconds: 60,
    maxUploadBytes: 1024 * 1024,
    openaiModel: "gpt-4o-mini-transcribe",
    hasOpenAiApiKey: true,
    ...overrides,
  }
}

void describe("VoiceInputHelperService", () => {
  void it("opens a tokenized localhost helper through asExternalUri", async () => {
    const posted: Record<string, unknown>[] = []
    let openedUri = ""
    let externalizedUri = ""
    const service = new VoiceInputHelperService({
      extensionPath: process.cwd(),
      parseUri,
      asExternalUri: async (uri) => {
        externalizedUri = uri.toString()
        return uri
      },
      openExternal: async (uri) => {
        openedUri = uri.toString()
        return true
      },
      getSettings: async () => settings(),
      transcribeAudio: async () => {},
      postMessage: (msg) => posted.push(msg),
      randomUUID: () => "token-1",
    })

    try {
      const result = await service.openBrowserHelper("voice-1")

      assert.equal(result.ok, true)
      assert.equal(result.requestId, "voice-1")
      assert.match(openedUri, /^http:\/\/127\.0\.0\.1:\d+\/voice-helper\.html\?/)
      assert.equal(openedUri, externalizedUri)
      const url = new URL(openedUri)
      assert.equal(url.searchParams.get("requestId"), "voice-1")
      assert.equal(url.searchParams.get("provider"), "openai")
      assert.equal(url.searchParams.get("token"), "token-1")
      assert.equal(posted[0]?.type, "stt_helper_opened")
    } finally {
      service.dispose()
    }
  })

  void it("accepts a tokenized browser transcript and posts it to the webview", async () => {
    const posted: Record<string, unknown>[] = []
    let openedUri = ""
    const service = new VoiceInputHelperService({
      extensionPath: process.cwd(),
      parseUri,
      asExternalUri: async (uri) => uri,
      openExternal: async (uri) => {
        openedUri = uri.toString()
        return true
      },
      getSettings: async () => settings({ provider: "browser" }),
      transcribeAudio: async () => {},
      postMessage: (msg) => posted.push(msg),
      randomUUID: () => "token-2",
    })

    try {
      await service.openBrowserHelper("voice-2")
      const origin = new URL(openedUri).origin
      const response = await fetch(`${origin}/api/browser-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: "voice-2", token: "token-2", text: "  hello\nthere  " }),
      })

      assert.equal(response.status, 200)
      assert.deepEqual(posted.at(-1), { type: "stt_transcript", requestId: "voice-2", text: "hello there" })
    } finally {
      service.dispose()
    }
  })

  void it("routes tokenized audio uploads to the host transcription service", async () => {
    const calls: VoiceAudioPayload[] = []
    let openedUri = ""
    const service = new VoiceInputHelperService({
      extensionPath: process.cwd(),
      parseUri,
      asExternalUri: async (uri) => uri,
      openExternal: async (uri) => {
        openedUri = uri.toString()
        return true
      },
      getSettings: async () => settings(),
      transcribeAudio: async (payload) => { calls.push(payload) },
      postMessage: () => {},
      randomUUID: () => "token-3",
    })

    try {
      await service.openBrowserHelper("voice-3")
      const origin = new URL(openedUri).origin
      const response = await fetch(`${origin}/api/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: "voice-3",
          token: "token-3",
          mimeType: "audio/webm",
          data: Buffer.from("audio").toString("base64"),
          sizeBytes: 5,
          durationMs: 1234,
        }),
      })

      assert.equal(response.status, 200)
      assert.equal(calls.length, 1)
      assert.equal(calls[0]?.requestId, "voice-3")
      assert.equal(calls[0]?.mimeType, "audio/webm")
      assert.equal(calls[0]?.data, Buffer.from("audio").toString("base64"))
    } finally {
      service.dispose()
    }
  })

  void it("rejects helper posts without the one-time token", async () => {
    const posted: Record<string, unknown>[] = []
    let openedUri = ""
    const service = new VoiceInputHelperService({
      extensionPath: process.cwd(),
      parseUri,
      asExternalUri: async (uri) => uri,
      openExternal: async (uri) => {
        openedUri = uri.toString()
        return true
      },
      getSettings: async () => settings({ provider: "browser" }),
      transcribeAudio: async () => {},
      postMessage: (msg) => posted.push(msg),
      randomUUID: () => "token-4",
    })

    try {
      await service.openBrowserHelper("voice-4")
      const origin = new URL(openedUri).origin
      const response = await fetch(`${origin}/api/browser-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: "voice-4", token: "wrong", text: "hello" }),
      })

      assert.equal(response.status, 403)
      assert.equal(posted.some((msg) => msg.type === "stt_transcript"), false)
    } finally {
      service.dispose()
    }
  })
})
