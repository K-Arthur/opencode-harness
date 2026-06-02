# ADR-012: Voice Input Uses External Browser Helper

## Status

Accepted

## Date

2026-06-02

## Context

OpenCode Harness needs speech-to-text for its custom VS Code chat webview. The
previous implementation attempted two in-webview microphone paths:

- `SpeechRecognition` for the `"browser"` provider.
- `navigator.mediaDevices.getUserMedia()` + `MediaRecorder` for the `"openai"`
  provider.

That architecture is not reliable in VS Code extension webviews. Current VS Code
reports still show `Permissions policy violation: microphone is not allowed in
this document` for extension webviews:
https://github.com/microsoft/vscode/issues/250568

The integrated/simple browser has the same class of problem, with a 2026 feature
request for user-grantable camera/microphone permissions:
https://github.com/microsoft/vscode/issues/299521

MDN documents that `getUserMedia()` requires secure context, user permission, and
Permission Policy allowance; blocked microphone policy rejects with
`NotAllowedError`:

- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/microphone

Extensions do not control VS Code's Electron main process or the iframe
permission policy for extension webviews. Direct webview mic capture therefore
remains unsupported for this extension.

## Decision

Voice input uses the webview only as the composer UI. On mic click, the webview
sends `stt_open_helper` to the extension host. The host starts an ephemeral
`127.0.0.1` helper server, creates a one-time token, resolves the helper URL with
`vscode.env.asExternalUri`, and opens it with `vscode.env.openExternal`.

The helper page runs in the user's default browser, where normal browser
microphone permission prompts work. It supports:

- `"browser"`: Web Speech recognition in the helper; final text is POSTed back to
  the host.
- `"openai"`: `getUserMedia` + `MediaRecorder` in the helper; audio is POSTed to
  the host, and the host calls OpenAI transcription with the SecretStorage key.

The OpenAI key never leaves the extension host. The helper callback is
request-scoped and token-gated. The transcript is posted back to the webview and
inserted into the prompt for user review; the prompt is never auto-sent.

Remote compatibility follows VS Code's `asExternalUri` guidance:
https://code.visualstudio.com/api/advanced-topics/remote-extensions

OpenAI transcription model and upload behavior follow current OpenAI speech-to-text docs:
https://developers.openai.com/api/docs/guides/speech-to-text

## Alternatives Considered

- **Direct VS Code webview mic capture**: rejected because VS Code does not expose
  microphone Permission Policy delegation for extension webviews.
- **VS Code Simple Browser / integrated browser**: rejected because it also lacks
  grantable media permission support as of the current upstream issue.
- **Node/native host mic capture**: rejected as a default because VS Code has no
  native mic API; native addons or external binaries would add platform packaging,
  OS permission, and bundle maintenance risk.
- **Bundled local Whisper / whisper.cpp**: deferred. It is attractive for privacy
  but requires model management, native binaries, audio conversion, and hardware
  variability. It may be added later as a bring-your-own local STT endpoint.
- **Third-party cloud STT providers**: deferred. Deepgram, AssemblyAI, and Azure
  are viable future providers, but OpenAI is already wired, key storage exists,
  and `gpt-4o-mini-transcribe` is a good lightweight default.

## Consequences

- Users see a browser window/tab for voice input instead of recording directly in
  the VS Code panel.
- Browser mode depends on browser Web Speech support and may use browser-vendor
  recognition services.
- OpenAI mode requires an API key, but provides the most reliable current path for
  high-quality transcription without native dependencies.
- The webview no longer accepts direct base64 audio upload messages; audio enters
  only through the tokenized helper server.
- Remote SSH/WSL/container users get the forwarded helper URL through
  `asExternalUri`.
