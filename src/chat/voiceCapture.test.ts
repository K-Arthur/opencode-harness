import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  describeRecorderPlan,
  describeTranscriberPlan,
  selectRecorderPlan,
  selectTranscriberPlan,
} from "./voiceCapture"

/** Build an `exists` predicate from a set of "installed" binaries. */
const has = (...bins: string[]) => (bin: string) => bins.includes(bin)
const none = () => false

void describe("voiceCapture recorder selection", () => {
  void it("prefers an explicit recordCommand override", () => {
    const plan = selectRecorderPlan({ recordCommand: "myrec {output}" }, "linux", none)
    assert.deepEqual(plan, { kind: "template", template: "myrec {output}" })
  })

  void it("auto-detects sox `rec` first on any platform", () => {
    assert.deepEqual(selectRecorderPlan({}, "win32", has("rec")), { kind: "sox", bin: "rec" })
    assert.deepEqual(selectRecorderPlan({}, "darwin", has("rec", "ffmpeg")), { kind: "sox", bin: "rec" })
  })

  void it("falls back to arecord on Linux and ffmpeg where supported", () => {
    assert.deepEqual(selectRecorderPlan({}, "linux", has("arecord")), { kind: "arecord", bin: "arecord" })
    assert.deepEqual(selectRecorderPlan({}, "darwin", has("ffmpeg")), { kind: "ffmpeg", bin: "ffmpeg" })
    // arecord only counts on Linux
    assert.equal(selectRecorderPlan({}, "darwin", has("arecord")), null)
  })

  void it("returns null when no recorder is available", () => {
    assert.equal(selectRecorderPlan({}, "linux", none), null)
    // ffmpeg present but unsupported platform (win32 dshow needs a device name)
    assert.equal(selectRecorderPlan({}, "win32", has("ffmpeg")), null)
  })
})

void describe("voiceCapture transcriber selection", () => {
  void it("prefers an explicit localCommand override", () => {
    const plan = selectTranscriberPlan({ localCommand: "stt {input}" }, none)
    assert.deepEqual(plan, { kind: "template", template: "stt {input}" })
  })

  void it("uses whisper.cpp when a model is configured and the binary exists", () => {
    const plan = selectTranscriberPlan({ model: "/m.bin" }, has("whisper-cli"))
    assert.deepEqual(plan, { kind: "whisper-cpp", bin: "whisper-cli", model: "/m.bin" })
  })

  void it("falls back to openai-whisper (base model) when present", () => {
    assert.deepEqual(selectTranscriberPlan({}, has("whisper")), {
      kind: "openai-whisper",
      bin: "whisper",
      model: "base",
    })
    assert.deepEqual(selectTranscriberPlan({ model: "small" }, has("whisper")), {
      kind: "openai-whisper",
      bin: "whisper",
      model: "small",
    })
  })

  void it("does not pick whisper.cpp without a model", () => {
    // whisper.cpp needs a model file; with no model and only whisper-cli, nothing matches
    assert.equal(selectTranscriberPlan({}, has("whisper-cli")), null)
  })

  void it("returns null when no engine is available", () => {
    assert.equal(selectTranscriberPlan({}, none), null)
  })
})

void describe("voiceCapture plan descriptions", () => {
  void it("describes plans for diagnostics", () => {
    assert.equal(describeRecorderPlan({ kind: "sox", bin: "rec" }), "rec")
    assert.equal(describeRecorderPlan({ kind: "template", template: "myrec {output}" }), "custom (myrec)")
    assert.equal(describeTranscriberPlan({ kind: "openai-whisper", bin: "whisper", model: "base" }), "whisper (base)")
  })
})

void describe("voiceCapture commandExists ~/.local/bin fallback", () => {
  // uv tool / pipx install the `whisper` binary into ~/.local/bin, which is
  // not always on VS Code's process PATH (no login shell). The exists probe
  // must find such binaries so voice input works right after setup without
  // PATH surgery.
  void it("finds an executable in ~/.local/bin even when `which` misses it", async (t) => {
    if (process.platform === "win32") { t.skip("POSIX-only fallback"); return }
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const os = await import("node:os")
    const { commandExists, invalidateExistsCache } = await import("./voiceCapture")

    const fakeHome = mkdtempSync(join(os.tmpdir(), "oc-voice-home-"))
    const binDir = join(fakeHome, ".local", "bin")
    mkdirSync(binDir, { recursive: true })
    const binName = `oc-fake-whisper-${process.pid}`
    writeFileSync(join(binDir, binName), "#!/bin/sh\nexit 0\n")
    chmodSync(join(binDir, binName), 0o755)

    const prevHome = process.env.HOME
    process.env.HOME = fakeHome
    invalidateExistsCache()
    try {
      assert.equal(commandExists(binName), true, "binary in ~/.local/bin must be discoverable")
      assert.equal(commandExists(`${binName}-missing`), false, "absent binaries still report false")
    } finally {
      process.env.HOME = prevHome
      invalidateExistsCache()
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })
})
