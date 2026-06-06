# Voice Input

OpenCode Harness supports **native, fully local** speech-to-text in the chat
composer. Click the microphone button, speak, click again to stop, and the
transcript appears in the prompt box for you to edit and send.

- No browser redirect — everything happens inside the VS Code panel.
- No cloud service and no API key — recording and transcription are local.
- Audio never leaves your machine; the temporary recording is deleted afterward.

## Why capture happens in the extension host

A VS Code extension webview is a sandboxed iframe that does **not** get the
`microphone` Permissions-Policy, so `navigator.mediaDevices.getUserMedia()` fails
with `Permissions policy violation: microphone is not allowed in this document`.
The Electron renderer also can't use the Web Speech API (`SpeechRecognition`
throws a `network` error because Electron ships no Google Speech key, and it is a
cloud service anyway). References:

- VS Code webview mic limitation: https://github.com/microsoft/vscode/issues/250568
- Extension webview media permission: https://github.com/microsoft/vscode/issues/113916
- MDN `getUserMedia()` security/permission rules: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Electron `webkitSpeechRecognition` network error: https://github.com/electron/electron/issues/7749

So the webview is only the UI. The extension host records the default microphone
with a local command-line tool and transcribes it with a local engine.

## Flow

1. The webview sends `voice_start` with a request id.
2. The host starts the recorder (auto-detected) writing a 16 kHz mono WAV to a
   temp file, and posts `voice_recording_started`.
3. On stop (button/Escape, or the max-duration limit) the webview sends
   `voice_stop`; the host stops the recorder, posts `voice_transcribing`, and runs
   the local engine.
4. The host posts `voice_transcript`; the webview inserts it if the request id
   still matches, then deletes the temp audio file.
5. `voice_cancel` kills the recorder and discards the take.

## Requirements

Voice input is available when the host can find **both** a recorder and an engine.

### Recorder (auto-detected, in order)

- **sox** (`rec`) — cross-platform, uses the default input device. Recommended.
  - macOS: `brew install sox` · Debian/Ubuntu: `sudo apt install sox` · Windows: install sox and add it to PATH.
- **arecord** — Linux/ALSA (`alsa-utils`).
- **ffmpeg** — macOS (`avfoundation`) and Linux (`alsa`). Not auto-used on Windows
  (dshow needs an explicit device name; use `opencode.voice.recordCommand`).

### Engine (auto-detected, in order)

- **openai-whisper** (`whisper` on PATH) — `pip install -U openai-whisper`. Uses
  the `base` model by default (set another with `opencode.voice.model`, e.g.
  `small`). The model downloads on first use.
- **whisper.cpp** (`whisper-cli`, legacy `main`) — requires a model file path in
  `opencode.voice.model`, e.g. `/path/to/ggml-base.en.bin`.

### Bring your own

Override either step with a command template:

- `opencode.voice.localCommand` — placeholders `{input}` (WAV path), `{output}`
  (a `.txt` path the command may write to), `{language}`. If `{output}` is present
  the file is read; otherwise stdout is used.
- `opencode.voice.recordCommand` — placeholders `{output}` (WAV path),
  `{duration}` (max seconds). The command should record the default device and
  stop on `SIGINT`.

If nothing is detected, the mic button is disabled with a clear message. You can
still type, or use your OS dictation (macOS Dictation, Windows `Win+H`), which
inserts directly into the focused prompt box.

## Settings

```jsonc
{
  // Behavior (window scope)
  "opencode.voice.enabled": true,
  "opencode.voice.autoSend": false,
  "opencode.voice.language": "auto",
  "opencode.voice.insertMode": "append", // or "replace"
  "opencode.voice.maxRecordingSeconds": 60,

  // Engine (machine scope — cannot be set by a workspace, for security)
  "opencode.voice.model": "",         // "base" / "small" (openai-whisper) or .bin path (whisper.cpp)
  "opencode.voice.localCommand": "",  // custom transcriber: {input} {output} {language}
  "opencode.voice.recordCommand": ""  // custom recorder: {output} {duration}
}
```

## Privacy and safety

- Recording starts only after an explicit microphone-button click.
- All capture and transcription happen on your machine. No network calls, no API
  keys, no cloud STT.
- Audio is written to a temp WAV, transcribed, and deleted after each take.
- Raw audio and transcripts are not persisted or logged.
- Transcripts are inserted into the prompt for review; nothing is sent unless you
  send it (or enable `opencode.voice.autoSend`).
- `model`, `localCommand`, and `recordCommand` are machine-scoped so an untrusted
  workspace cannot make the host run an arbitrary command.

## Troubleshooting

- **Button is disabled / "not available"**: install a recorder (`sox`) and an
  engine (`openai-whisper`), or set the override commands. Reload the window so the
  host re-detects them.
- **macOS asks for microphone permission**: grant Visual Studio Code microphone
  access in System Settings → Privacy & Security → Microphone.
- **"No speech was detected"**: speak closer to the mic, or raise
  `maxRecordingSeconds`.
- **First transcription is slow**: openai-whisper downloads the model on first run.
- Diagnostics are written to the OpenCode output channel (audio/transcripts are not
  logged).
