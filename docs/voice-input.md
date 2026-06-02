# Voice Input

OpenCode Harness supports speech-to-text in the chat composer. The microphone
button inserts a transcript into the existing prompt textarea so you can review
or edit it before sending. It never sends a prompt automatically.

## Providers

### Browser

`opencode.voiceInput.provider = "browser"` uses the webview/browser speech
recognition API when it is available. This path does not send recorded audio
through the extension host. Some browser engines may use platform speech
services behind their Web Speech implementation; use the OpenAI provider only
when you want explicit extension-managed cloud transcription.

### OpenAI

`opencode.voiceInput.provider = "openai"` records audio with `MediaRecorder`
after you click the microphone button, stops on a second click, Escape, unload,
or the configured duration cap, then sends that one recording to OpenAI's
`/v1/audio/transcriptions` endpoint. The default model is
`gpt-4o-mini-transcribe`.

Set the key with the command:

```text
OpenCode: Set Voice Input OpenAI API Key
```

The key is stored in VS Code SecretStorage. It is never written to settings,
sent to the webview, logged, or included in webview messages.

OpenAI's speech-to-text docs list the transcription endpoint, current compatible
models, supported audio formats, and upload cap:
https://platform.openai.com/docs/guides/speech-to-text

## Settings

```json
{
  "opencode.voiceInput.enabled": true,
  "opencode.voiceInput.provider": "browser",
  "opencode.voiceInput.maxDurationSeconds": 60,
  "opencode.voiceInput.maxUploadBytes": 10485760,
  "opencode.voiceInput.openaiModel": "gpt-4o-mini-transcribe"
}
```

`maxUploadBytes` is capped at 25 MB. The default is lower (10 MB) to avoid large
webview-to-host payloads.

## Privacy And Safety

- Recording starts only from an explicit microphone-button click.
- Stopping/canceling a recording releases media tracks and clears in-memory blobs.
- Raw audio is not persisted.
- Transcripts are inserted into the prompt; the user still chooses whether to send.
- Audio, transcripts, API keys, and full provider responses are not logged.
- The webview validates request IDs and ignores stale transcription responses.
- The host validates MIME type, base64 shape, request ID, and size before decoding.
- Cloud transcription is disabled unless `provider` is `"openai"` and a SecretStorage
  API key exists.
