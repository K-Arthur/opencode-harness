import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildVoiceSetupPlan, pickPipCommand, pickEngineInstallCommand, recorderInstallCommand, uvBootstrapCommand, type VoiceToolProbe } from "./voiceSetup"

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
  void it("never returns uv as a pip substitute — uv gets the isolated tool-install path instead", () => {
    // `uv pip install --system` targets the externally-managed interpreter on
    // Arch/CachyOS and fails the same way bare pip does.
    assert.equal(pickPipCommand(none, false), null)
  })
})

void describe("voiceSetup engine install (isolated-first)", () => {
  const probe = (over: Partial<VoiceToolProbe>): VoiceToolProbe => ({
    hasRecorder: true,
    hasEngine: false,
    pip: null,
    recorderInstall: null,
    ...over,
  })

  void it("prefers 'uv tool install openai-whisper' when uv exists, even alongside pip", () => {
    assert.equal(
      pickEngineInstallCommand(probe({ hasUv: true, pip: "pip3" })).command,
      "uv tool install openai-whisper",
    )
  })

  void it("falls back to 'pipx install openai-whisper' when only pipx exists", () => {
    assert.equal(
      pickEngineInstallCommand(probe({ hasPipx: true, pip: "pip3", externallyManaged: true })).command,
      "pipx install openai-whisper",
    )
  })

  void it("suppresses bare pip installs on externally-managed Python (PEP 668)", () => {
    const choice = pickEngineInstallCommand(probe({ pip: "pip3", externallyManaged: true }))
    assert.equal(choice.command, undefined, "pip install would fail with externally-managed-environment")
    assert.match(choice.manual ?? "", /uv|pipx/, "manual guidance must point at an isolated installer")
    assert.match(choice.manual ?? "", /pacman -S uv/, "Arch/CachyOS users get the exact uv install command")
  })

  void it("still uses pip when the environment is not externally managed", () => {
    assert.equal(pickEngineInstallCommand(probe({ pip: "pip3" })).command, "pip3 install -U openai-whisper")
  })

  void it("never offers 'uv pip install --system'", () => {
    for (const p of [probe({ hasUv: true }), probe({ hasUv: true, externallyManaged: true }), probe({ hasUv: true, pip: "pip3" })]) {
      const plan = buildVoiceSetupPlan(p, "linux")
      for (const step of plan.steps) {
        assert.ok(!(step.command ?? "").includes("uv pip install --system"), "uv pip --system targets the managed env and fails")
      }
    }
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
    assert.equal(recorderInstallCommand("linux", has("dnf5"))?.command, "sudo dnf5 install -y sox")
    assert.equal(recorderInstallCommand("linux", has("pacman"))?.command, "sudo pacman -S --noconfirm sox")
    assert.equal(recorderInstallCommand("linux", has("zypper"))?.command, "sudo zypper install -y sox")
    assert.equal(recorderInstallCommand("linux", has("apk"))?.command, "sudo apk add sox")
    assert.equal(recorderInstallCommand("linux", has("nix-env"))?.command, "nix-env -iA nixpkgs.sox")
    assert.equal(recorderInstallCommand("linux", none), null)
  })
  void it("prefers dnf over dnf5 when both exist", () => {
    const hasBoth = has("dnf", "dnf5")
    assert.equal(recorderInstallCommand("linux", hasBoth)?.manager, "dnf")
  })
  void it("uses winget on Windows", () => {
    assert.equal(recorderInstallCommand("win32", has("winget"))?.manager, "winget")
    assert.equal(recorderInstallCommand("win32", has("winget"))?.command, "winget install sox --accept-source-agreements")
  })
  void it("uses choco/scoop on Windows", () => {
    assert.equal(recorderInstallCommand("win32", has("choco"))?.manager, "Chocolatey")
    assert.equal(recorderInstallCommand("win32", has("scoop"))?.manager, "Scoop")
    assert.equal(recorderInstallCommand("win32", none), null)
  })
})

void describe("voiceSetup uv bootstrap (PEP 668 escape hatch)", () => {
  void it("uses pacman on Arch/CachyOS to install uv then whisper", () => {
    const cmd = uvBootstrapCommand("linux", has("pacman"))
    assert.equal(cmd?.manager, "pacman")
    assert.match(cmd?.command ?? "", /sudo pacman -S --needed --noconfirm uv/)
    assert.match(cmd?.command ?? "", /uv tool install openai-whisper/)
  })
  void it("uses Homebrew on macOS", () => {
    const cmd = uvBootstrapCommand("darwin", has("brew"))
    assert.equal(cmd?.manager, "Homebrew")
    assert.match(cmd?.command ?? "", /brew install uv/)
  })
  void it("falls back to the official curl installer on Debian/Fedora (no uv in repos)", () => {
    const cmd = uvBootstrapCommand("linux", has("apt-get", "curl"))
    assert.equal(cmd?.manager, "uv installer")
    assert.match(cmd?.command ?? "", /curl -LsSf https:\/\/astral\.sh\/uv\/install\.sh/)
    // Must re-export PATH so the same shell can find uv right after install.
    assert.match(cmd?.command ?? "", /export PATH/)
  })
  void it("uses wget when curl is absent", () => {
    const cmd = uvBootstrapCommand("linux", has("apt-get", "wget"))
    assert.match(cmd?.command ?? "", /wget -qO- https:\/\/astral\.sh\/uv\/install\.sh/)
  })
  void it("prefers pacman over the curl installer when both are available", () => {
    const cmd = uvBootstrapCommand("linux", has("pacman", "curl"))
    assert.equal(cmd?.manager, "pacman")
  })
  void it("uses winget on Windows", () => {
    const cmd = uvBootstrapCommand("win32", has("winget"))
    assert.match(cmd?.command ?? "", /winget install astral-sh\.uv/)
  })
  void it("returns null on linux with no package manager and no curl/wget", () => {
    assert.equal(uvBootstrapCommand("linux", none), null)
  })
})

void describe("voiceSetup engine install on PEP 668 distros", () => {
  const probe = (over: Partial<VoiceToolProbe>): VoiceToolProbe => ({
    hasRecorder: true,
    hasEngine: false,
    pip: null,
    recorderInstall: null,
    externallyManaged: true,
    uvBootstrap: null,
    ...over,
  })

  void it("offers a runnable uv-bootstrap command on Arch/CachyOS (the user's dead-end bug)", () => {
    const choice = pickEngineInstallCommand(probe({
      externallyManaged: true,
      uvBootstrap: uvBootstrapCommand("linux", has("pacman")),
    }))
    assert.equal(choice.manual, undefined, "must not be a dead-end manual hint")
    assert.match(choice.command ?? "", /pacman -S --needed --noconfirm uv/)
    assert.match(choice.command ?? "", /uv tool install openai-whisper/)
  })

  void it("still prefers an existing uv over bootstrapping it", () => {
    const choice = pickEngineInstallCommand(probe({
      hasUv: true,
      uvBootstrap: uvBootstrapCommand("linux", has("pacman")),
    }))
    assert.equal(choice.command, "uv tool install openai-whisper")
  })

  void it("falls back to the manual hint only when no bootstrap is possible", () => {
    const choice = pickEngineInstallCommand(probe({ externallyManaged: true, uvBootstrap: null }))
    assert.equal(choice.command, undefined)
    assert.match(choice.manual ?? "", /pacman -S uv/)
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

  void it("gives platform-specific linux hint for unknown package manager", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true }),
      "linux",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.match(recorder?.manual || "", /pacman|dnf|apt/)
  })
  void it("gives winget hint on windows without package manager", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true }),
      "win32",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.match(recorder?.manual || "", /winget/)
  })
  void it("gives generic hint for unknown platforms", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true }),
      "freebsd",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.match(recorder?.manual || "", /package manager/)
  })

  void it("offers a runnable engine install when only python3 -m pip is available", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasRecorder: true, pip: "python3 -m pip" }),
      "linux",
    )
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.command, "python3 -m pip install -U openai-whisper")
  })

  void it("offers an isolated uv tool install when only uv is available", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasRecorder: true, hasUv: true }),
      "linux",
    )
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.command, "uv tool install openai-whisper")
  })

  void it("offers a runnable engine install on Arch/CachyOS even without uv/pipx (no dead-end Copy Instructions)", () => {
    // The exact user-reported bug: recorder present (arecord/ffmpeg), engine
    // missing, externally-managed Python, no uv/pipx, but pacman available.
    const plan = buildVoiceSetupPlan(
      probe({
        hasRecorder: true,
        externallyManaged: true,
        uvBootstrap: uvBootstrapCommand("linux", has("pacman")),
      }),
      "linux",
    )
    assert.equal(plan.ready, false)
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.manual, undefined, "engine step must be runnable, not a manual hint")
    assert.match(engine?.command ?? "", /pacman -S --needed --noconfirm uv/)
    assert.match(engine?.command ?? "", /uv tool install openai-whisper/)
  })
})
