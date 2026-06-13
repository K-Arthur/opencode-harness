/**
 * Pure decision logic for the opt-in "Set Up Voice Input" flow.
 *
 * VS Code's own speech extension can't be reused here: its provider API is
 * proposed-only, it dictates only into Monaco editors / the built-in Chat (not
 * a third-party webview), and the embedded model + key are Microsoft-only. So
 * our local pipeline needs a recorder (sox/ffmpeg/arecord) and an STT engine
 * (openai-whisper / whisper.cpp). This module decides, from a probe of what's
 * on the machine, which install steps to offer. No Node/VS Code imports — fully
 * unit-testable.
 */

export interface VoiceToolProbe {
  hasRecorder: boolean
  hasEngine: boolean
  /** Resolved pip command if Python's pip is on PATH, else null. */
  pip: string | null
  /** Resolved recorder installer for this platform, else null. */
  recorderInstall: { manager: string; command: string } | null
  /** uv on PATH → isolated `uv tool install` is the preferred engine install. */
  hasUv?: boolean
  /** pipx on PATH → isolated `pipx install` fallback. */
  hasPipx?: boolean
  /** PEP 668 externally-managed Python (Arch/CachyOS, Debian 12+, Fedora 38+):
   *  bare pip installs fail with externally-managed-environment. */
  externallyManaged?: boolean
  /** Runnable command that installs uv (system package manager or the official
   *  standalone installer) AND then `uv tool install openai-whisper`, so the
   *  setup flow can offer a real "Run Setup" action on PEP 668 distros instead
   *  of a dead-end "Copy Instructions". Null when no bootstrap is possible
   *  (the user gets the manual hint instead). Computed by `uvBootstrapCommand`. */
  uvBootstrap?: { manager: string; command: string } | null
}

export interface VoiceSetupStep {
  kind: "engine" | "recorder"
  label: string
  /** A command that can be run in a terminal (with consent), if available. */
  command?: string
  /** Human guidance when no automatable command exists. */
  manual?: string
}

export interface VoiceSetupPlan {
  ready: boolean
  steps: VoiceSetupStep[]
}

/**
 * Resolve the best available pip command for installing Python packages.
 * Priority: pip3 > pip > python3 -m pip.
 * Returns null when none is available. uv is intentionally NOT a pip
 * substitute — `uv pip install --system` targets the externally-managed
 * interpreter on PEP 668 systems and fails exactly like bare pip; uv gets the
 * isolated `uv tool install` path in pickEngineInstallCommand instead.
 */
export function pickPipCommand(
  exists: (bin: string) => boolean,
  pipViaPython?: boolean,
): string | null {
  if (exists("pip3")) return "pip3"
  if (exists("pip")) return "pip"
  if (pipViaPython) return "python3 -m pip"
  return null
}

/**
 * Choose how to install the openai-whisper engine.
 * Priority: uv tool install (isolated, puts `whisper` in ~/.local/bin) >
 * pipx install (same idea) > pip (only when the environment is NOT
 * externally managed) > manual guidance.
 */
export function pickEngineInstallCommand(probe: VoiceToolProbe): { command?: string; manual?: string } {
  if (probe.hasUv) return { command: "uv tool install openai-whisper" }
  if (probe.hasPipx) return { command: "pipx install openai-whisper" }
  if (probe.pip && !probe.externallyManaged) {
    return { command: `${probe.pip} install -U openai-whisper` }
  }
  // PEP 668 + no isolated installer yet: bootstrap uv via the system package
  // manager (pacman/brew/winget/…) or the official standalone installer so the
  // setup flow can offer a runnable "Run Setup" instead of a dead-end copy.
  if (probe.externallyManaged && probe.uvBootstrap) {
    return { command: probe.uvBootstrap.command }
  }
  if (probe.externallyManaged) {
    return {
      manual: "Your Python is externally managed (PEP 668), so pip cannot install packages directly. "
        + "Install uv (`sudo pacman -S uv` on Arch/CachyOS, or see https://docs.astral.sh/uv/) and run `uv tool install openai-whisper`, "
        + "or use `pipx install openai-whisper`. Both put the `whisper` command in ~/.local/bin.",
    }
  }
  return {
    manual: "Install Python 3, then run `pip install -U openai-whisper` — or set opencode.voice.localCommand to your own engine.",
  }
}

/**
 * Choose a recorder (sox) install command for the platform using whatever
 * package manager is available. Returns null when none is detected (the user
 * gets manual guidance instead).
 */
export function recorderInstallCommand(
  platform: NodeJS.Platform | string,
  exists: (bin: string) => boolean,
): { manager: string; command: string } | null {
  if (platform === "darwin") {
    if (exists("brew")) return { manager: "Homebrew", command: "brew install sox" }
    return null
  }
  if (platform === "linux") {
    if (exists("apt-get")) return { manager: "apt", command: "sudo apt-get install -y sox" }
    if (exists("dnf")) return { manager: "dnf", command: "sudo dnf install -y sox" }
    if (exists("dnf5")) return { manager: "dnf5", command: "sudo dnf5 install -y sox" }
    if (exists("pacman")) return { manager: "pacman", command: "sudo pacman -S --noconfirm sox" }
    if (exists("zypper")) return { manager: "zypper", command: "sudo zypper install -y sox" }
    if (exists("apk")) return { manager: "apk", command: "sudo apk add sox" }
    if (exists("nix-env")) return { manager: "Nix", command: "nix-env -iA nixpkgs.sox" }
    return null
  }
  if (platform === "win32") {
    if (exists("winget")) return { manager: "winget", command: "winget install sox --accept-source-agreements" }
    if (exists("choco")) return { manager: "Chocolatey", command: "choco install sox -y" }
    if (exists("scoop")) return { manager: "Scoop", command: "scoop install sox" }
    return null
  }
  return null
}

/**
 * Resolve a runnable command that installs uv AND uses it to install
 * openai-whisper into an isolated environment. This is the escape hatch for
 * PEP 668 distros (Arch/CachyOS, Debian 12+, Fedora 38+) where bare `pip
 * install` is blocked and uv/pipx aren't on PATH yet — without it the setup
 * flow degrades to a dead-end "Copy Instructions".
 *
 * Strategy: prefer a native package manager that ships uv (faster, upgraded
 * with the system, immediately on PATH). Fall back to uv's official
 * standalone installer on POSIX (works on Debian/Fedora/etc. whose repos
 * don't carry uv). Returns null only when no bootstrap is possible.
 *
 * The returned command is a compound (`A && B`) so a single "Run Setup"
 * click finishes the whole engine install. The standalone installer drops
 * uv into ~/.local/bin, which the current shell hasn't hashed yet — so we
 * re-export PATH before invoking uv.
 */
export function uvBootstrapCommand(
  platform: NodeJS.Platform | string,
  exists: (bin: string) => boolean,
): { manager: string; command: string } | null {
  const whisperViaUv = "uv tool install openai-whisper"
  if (platform === "darwin") {
    if (exists("brew")) return { manager: "Homebrew", command: `brew install uv && ${whisperViaUv}` }
    if (exists("curl")) {
      return { manager: "uv installer", command: `curl -LsSf https://astral.sh/uv/install.sh | sh && export PATH="$HOME/.local/bin:$PATH" && ${whisperViaUv}` }
    }
    return null
  }
  if (platform === "linux") {
    // Arch/CachyOS ship uv in the `extra` repo; Alpine ships it in community.
    if (exists("pacman")) return { manager: "pacman", command: `sudo pacman -S --needed --noconfirm uv && ${whisperViaUv}` }
    if (exists("apk")) return { manager: "apk", command: `sudo apk add uv && ${whisperViaUv}` }
    // Debian/Ubuntu/Fedora don't ship uv in their base repos — use the
    // official standalone installer (astral.sh's recommended path).
    if (exists("curl")) {
      return { manager: "uv installer", command: `curl -LsSf https://astral.sh/uv/install.sh | sh && export PATH="$HOME/.local/bin:$PATH" && ${whisperViaUv}` }
    }
    if (exists("wget")) {
      return { manager: "uv installer", command: `wget -qO- https://astral.sh/uv/install.sh | sh && export PATH="$HOME/.local/bin:$PATH" && ${whisperViaUv}` }
    }
    return null
  }
  if (platform === "win32") {
    if (exists("winget")) return { manager: "winget", command: `winget install astral-sh.uv --accept-source-agreements && ${whisperViaUv}` }
    if (exists("scoop")) return { manager: "Scoop", command: `scoop install uv && ${whisperViaUv}` }
    if (exists("choco")) return { manager: "Chocolatey", command: `choco install uv -y && ${whisperViaUv}` }
    // PowerShell is always present on Windows; the official uv installer.
    return { manager: "uv installer", command: `powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex; uv tool install openai-whisper"` }
  }
  return null
}

function manualRecorderHint(platform: NodeJS.Platform | string): string {
  if (platform === "darwin") return "Install sox: `brew install sox` (install Homebrew from https://brew.sh first)."
  if (platform === "win32") return "Install sox via winget (`winget install sox`), Chocolatey (`choco install sox`), or download from https://sourceforge.net/projects/sox/."
  if (platform === "linux") return "Install sox with your package manager (e.g. `sudo apt-get install sox`, `sudo pacman -S sox`, or `sudo dnf install sox`)."
  return "Install sox with your system's package manager, or download it from https://sourceforge.net/projects/sox/."
}

/**
 * Build the ordered list of install steps from a probe. `ready` is true when
 * both a recorder and an engine are already present.
 */
export function buildVoiceSetupPlan(probe: VoiceToolProbe, platform: NodeJS.Platform | string): VoiceSetupPlan {
  const steps: VoiceSetupStep[] = []

  if (!probe.hasEngine) {
    const engineInstall = pickEngineInstallCommand(probe)
    if (engineInstall.command) {
      steps.push({
        kind: "engine",
        label: "Install the local speech-to-text engine (openai-whisper)",
        command: engineInstall.command,
      })
    } else {
      steps.push({
        kind: "engine",
        label: "Install a local speech-to-text engine",
        manual: engineInstall.manual,
      })
    }
  }

  if (!probe.hasRecorder) {
    if (probe.recorderInstall) {
      steps.push({
        kind: "recorder",
        label: `Install a microphone recorder (sox) via ${probe.recorderInstall.manager}`,
        command: probe.recorderInstall.command,
      })
    } else {
      steps.push({
        kind: "recorder",
        label: "Install a microphone recorder (sox)",
        manual: manualRecorderHint(platform),
      })
    }
  }

  return { ready: steps.length === 0, steps }
}
