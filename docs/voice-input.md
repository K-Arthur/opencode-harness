# Voice Input

OpenCode Harness supports speech-to-text in the chat composer. The microphone
button opens a small helper page in the user's default browser, then inserts the
resulting transcript into the existing prompt textarea for review. It never
posts `send_prompt` or sends a prompt automatically.

## Architecture

VS Code extension webviews are not used for microphone capture. As of June 2,
2026, current VS Code/Electron behavior still does not expose a public extension
API for granting `microphone` Permission Policy to an extension webview. Current
reports show `navigator.mediaDevices.getUserMedia({ audio: true })` failing with
`Permissions policy violation: microphone is not allowed in this document`:

- VS Code webview issue: https://github.com/microsoft/vscode/issues/250568
- VS Code integrated browser permission request: https://github.com/microsoft/vscode/issues/299521
- MDN `getUserMedia()` permission/security rules: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN `Permissions-Policy: microphone`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/microphone

The extension therefore uses this flow:

1. The webview sends `stt_open_helper` with a request id and provider.
2. The extension host starts an ephemeral `127.0.0.1` helper server and creates a
   one-time token.
3. The host opens the helper with `vscode.env.openExternal(await vscode.env.asExternalUri(...))`,
   which keeps remote SSH/WSL/container scenarios compatible.
4. The helper page records or recognizes speech in the user's real browser, where
   normal browser microphone permission prompts work.
5. The helper POSTs the result back to the token-gated localhost endpoint.
6. The host posts `stt_transcript` to the webview. The webview inserts it only if
   the request id still matches the active voice request.

Remote-safe localhost forwarding is based on VS Code's remote extension guidance:
https://code.visualstudio.com/api/advanced-topics/remote-extensions

## Providers

### Browser

`opencode.voiceInput.provider = "browser"` opens the helper in browser speech
recognition mode. The helper uses the browser's Web Speech API and sends only
the final text back to the extension host.

This mode avoids OpenAI/API-key setup, but browser support is uneven and Chrome
or Edge may use a server-backed recognition service. MDN marks
`SpeechRecognition` as limited availability:
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

### OpenAI

`opencode.voiceInput.provider = "openai"` opens the helper in recording mode.
The helper records audio with `getUserMedia` and `MediaRecorder`, then sends the
recording to the extension-host localhost endpoint only after the user chooses
**Transcribe recording**. The extension host validates the request and calls
OpenAI's `/v1/audio/transcriptions` endpoint with the API key stored in VS Code
SecretStorage. The key is never sent to the webview or helper page.

The default model is `gpt-4o-mini-transcribe`. OpenAI's speech-to-text docs list
the transcription endpoint, compatible models, supported audio formats, and the
25 MB upload cap:
https://developers.openai.com/api/docs/guides/speech-to-text

Set the key with:

```text
OpenCode: Set Voice Input OpenAI API Key
```

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
helper-to-host uploads.

## Privacy And Safety

- Recording starts only after an explicit microphone-button click and browser
  permission prompt.
- The VS Code webview never captures microphone audio.
- Helper callbacks are token-gated and request-scoped.
- Raw audio is not persisted or logged.
- Transcripts are inserted into the prompt; the user still chooses whether to send.
- OpenAI API keys stay in VS Code SecretStorage and are never sent to the helper.
- Cloud transcription is disabled unless `provider` is `"openai"` and a
  SecretStorage API key exists.
- Browser mode may rely on browser-vendor recognition services; the helper page
  discloses this before use.
