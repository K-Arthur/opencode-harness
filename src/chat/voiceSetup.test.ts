import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildVoiceSetupPlan, pickPipCommand, recorderInstallCommand, type VoiceToolProbe } from "./voiceSetup"

const has = (...bins: string[]) => (bin: string) => bins.includes(bin)
const none = () => false

void describe("voiceSetup pip detection", () => {
  void it("prefers pip3, then pip, else null", () => {
    assert.equal(pickPipCommand(has("pip3", "pip")), "pip3")
    assert.equal(pickPipCommand(has("pip")), "pip")
    assert.equal(pickPipCommand(none), null)
  })
  void it("falls back to python3 -m pip when pip/pip3 are absent", () => {
    assert.equal(pickPipCommand(none, true), "python3 -m pip")
    assert.equal(pickPipCommand(none, false), null)
  })
  void it("prefers pip3 over python3 -m pip", () => {
    assert.equal(pickPipCommand(has("pip3"), true), "pip3")
  })
  void it("prefers pip over python3 -m pip", () => {
    assert.equal(pickPipCommand(has("pip"), true), "pip")
  })
  void it("supports uv as a fallback after python3 -m pip", () => {
    assert.equal(pickPipCommand(none, false, true), "uv pip install --system")
  })
  void it("prefers pip3 over uv", () => {
    assert.equal(pickPipCommand(has("pip3"), true, true), "pip3")
  })
  void it("prefers python3 -m pip over uv", () => {
    assert.equal(pickPipCommand(none, true, true), "python3 -m pip")
  })
})

void describe("voiceSetup recorder installer", () => {
  void it("uses Homebrew on macOS when present", () => {
    assert.deepEqual(recorderInstallCommand("darwin", has("brew")), { manager: "Homebrew", command: "brew install sox" })
    assert.equal(recorderInstallCommand("darwin", none), null)
  })
  void it("uses the available Linux package manager", () => {
    assert.equal(recorderInstallCommand("linux", has("apt-get"))?.command, "sudo apt-get install -y sox")
    assert.equal(recorderInstallCommand("linux", has("dnf"))?.command, "sudo dnf install -y sox")
    assert.equal(recorderInstallCommand("linux", none), null)
  })
  void it("uses choco/scoop on Windows", () => {
    assert.equal(recorderInstallCommand("win32", has("choco"))?.manager, "Chocolatey")
    assert.equal(recorderInstallCommand("win32", has("scoop"))?.manager, "Scoop")
    assert.equal(recorderInstallCommand("win32", none), null)
  })
})

void describe("voiceSetup plan", () => {
  const probe = (over: Partial<VoiceToolProbe>): VoiceToolProbe => ({
    hasRecorder: false,
    hasEngine: false,
    pip: null,
    recorderInstall: null,
    ...over,
  })

  void it("is ready when both tools are present", () => {
    const plan = buildVoiceSetupPlan(probe({ hasRecorder: true, hasEngine: true }), "linux")
    assert.equal(plan.ready, true)
    assert.equal(plan.steps.length, 0)
  })

  void it("offers a runnable engine install when pip exists", () => {
    const plan = buildVoiceSetupPlan(probe({ hasRecorder: true, pip: "pip3" }), "linux")
    assert.equal(plan.ready, false)
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.command, "pip3 install -U openai-whisper")
  })

  void it("falls back to manual engine guidance without pip", () => {
    const plan = buildVoiceSetupPlan(probe({ hasRecorder: true }), "linux")
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.command, undefined)
    assert.match(engine?.manual || "", /openai-whisper/)
  })

  void it("offers a runnable recorder install when a manager is available", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true, recorderInstall: { manager: "Homebrew", command: "brew install sox" } }),
      "darwin",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.equal(recorder?.command, "brew install sox")
  })

  void it("gives manual recorder guidance when no manager is found", () => {
    const plan = buildVoiceSetupPlan(probe({ hasEngine: true }), "win32")
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.equal(recorder?.command, undefined)
    assert.match(recorder?.manual || "", /sox/i)
  })
})
