# ADR-013: Native, Fully Local Voice Input

## Status

Accepted

## Date

2026-06-05

## Context

OpenCode Harness needs speech-to-text in its custom chat webview. The previous
design ([ADR-012](ADR-012-voice-input-browser-helper.md)) opened an external
browser helper page for microphone capture and offered an OpenAI (cloud, API-key)
transcription path. That UX was confusing (a browser tab appeared instead of
recording in the panel) and the high-quality path required a paid key.

The hard requirement is: click mic → speak → stop → transcript appears in the
prompt, with **no browser redirect, no cloud service, and no API key**.

The binding platform constraint is real and unchanged:

- A VS Code extension webview is a sandboxed iframe without the `microphone`
  Permissions-Policy, so `getUserMedia()` is rejected
  (https://github.com/microsoft/vscode/issues/250568,
  https://github.com/microsoft/vscode/issues/113916).
- The Electron renderer cannot use the Web Speech API: `SpeechRecognition` throws
  a `network` error (no Google Speech key in Electron) and is cloud-backed anyway
  (https://github.com/electron/electron/issues/7749).

Therefore the microphone can only be captured **outside** the webview. With the
browser path forbidden, the remaining native option is the extension host
(Node.js), which can spawn local OS audio tools and a local STT engine.

## Decision

Voice input is native to the panel and fully local. The webview is only the UI; it
generates a `requestId` per take and drives state via `voice_*` messages. The
extension host:

1. Records the default microphone to a temporary 16 kHz mono WAV using an
   auto-detected local recorder: `rec` (sox) → `arecord` (Linux) → `ffmpeg`.
2. Transcribes that file with an auto-detected local engine: openai-whisper
   (`whisper`) or whisper.cpp (`whisper-cli`/`main`, when a model is configured).
3. Returns the transcript for insertion into the prompt, then deletes the temp WAV.

Both steps are overridable with machine-scoped command templates
(`opencode.voice.recordCommand`, `opencode.voice.localCommand`) for a
bring-your-own engine. When no recorder/engine is available the button degrades to
a clear "not available" state and the docs point to OS dictation.

The capture pipeline lives behind injected `Recorder` / `Transcriber` interfaces
(`voiceCapture.ts`), so `VoiceInputService` orchestration is fully unit-tested with
mocks. Pure logic (state machine, settings, sanitization, command builders) lives
in `voiceInputCore.ts`.

The OpenAI cloud path, the SecretStorage API key, the "Set Voice Input OpenAI API
Key" command, the localhost helper server, and `media/voice-helper.html` are
removed.

## Alternatives Considered

- **External browser helper (ADR-012)**: rejected — violates the no-browser-tab
  requirement and shipped a cloud path.
- **In-webview capture**: impossible — sandboxed iframe lacks mic permission.
- **Bundled Whisper model/binaries (zero-config)**: deferred as too heavy (native
  binaries, ~75 MB+ model downloads, platform packaging). The bring-your-own /
  auto-detect approach keeps the extension lightweight.
- **Cloud STT (OpenAI/Deepgram/Azure/etc.)**: rejected by requirement (no keys, no
  cloud).

## Consequences

- The mic button truly records and transcribes in the panel — no browser tab.
- Voice input requires a local recorder + engine on PATH (or override commands);
  otherwise it is cleanly unavailable. This is documented.
- Audio stays on the machine; the temp file is deleted after each take. Nothing is
  uploaded, persisted, or logged.
- Override commands are machine-scoped so an untrusted workspace cannot inject a
  command for the host to run.
- The webview no longer needs (or accepts) any audio-upload or browser-helper
  messages; the protocol is `voice_start/stop/cancel` ⇄ `voice_settings/
  voice_recording_started/voice_transcribing/voice_transcript/voice_error`.

## Addendum (2026-06-10) — PEP 668 / isolated engine installs

Auto-setup failed on externally-managed Python distros (Arch/CachyOS,
Debian 12+, Fedora 38+): `pip install` aborts with
`externally-managed-environment`, and the previous last-resort
`uv pip install --system` targets the same managed interpreter.

Engine install priority is now (`pickEngineInstallCommand` in
`voiceSetup.ts`):

1. `uv tool install openai-whisper` (isolated, puts `whisper` in `~/.local/bin`)
2. `pipx install openai-whisper` (same idea)
3. `<pip> install -U openai-whisper` — only when Python is NOT externally
   managed (probed via the stdlib `EXTERNALLY-MANAGED` marker,
   `ChatProvider.detectExternallyManagedPython()`)
4. **uv bootstrap** — when externally managed AND no uv/pipx yet, a runnable
   compound command that installs uv via the system package manager
   (`sudo pacman -S --needed --noconfirm uv` on Arch/CachyOS, `brew install uv`,
   `winget install astral-sh.uv`) or the official standalone installer
   (`curl -LsSf https://astral.sh/uv/install.sh | sh` on Debian/Fedora), then
   `uv tool install openai-whisper` (`uvBootstrapCommand` in `voiceSetup.ts`).
   This keeps "Run Setup" usable on PEP 668 distros instead of degrading to a
   dead-end "Copy Instructions".
5. Manual guidance (only when no bootstrap is possible) naming the exact Arch
   commands (`sudo pacman -S uv` → `uv tool install openai-whisper`).

`commandExists()` and both spawn sites additionally fall back to
`~/.local/bin/<bin>` (where uv tool/pipx install binaries), because VS Code's
process PATH is not a login-shell PATH and frequently misses it
(`resolveBinPath` in `voiceCapture.ts`).
