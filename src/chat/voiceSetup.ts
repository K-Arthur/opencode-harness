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

/** Prefer `pip3`, then `pip`. Returns null when neither is on PATH. */
export function pickPipCommand(exists: (bin: string) => boolean): string | null {
  if (exists("pip3")) return "pip3"
  if (exists("pip")) return "pip"
  return null
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
    if (exists("pacman")) return { manager: "pacman", command: "sudo pacman -S --noconfirm sox" }
    if (exists("zypper")) return { manager: "zypper", command: "sudo zypper install -y sox" }
    return null
  }
  if (platform === "win32") {
    if (exists("choco")) return { manager: "Chocolatey", command: "choco install sox -y" }
    if (exists("scoop")) return { manager: "Scoop", command: "scoop install sox" }
    return null
  }
  return null
}

function manualRecorderHint(platform: NodeJS.Platform | string): string {
  if (platform === "darwin") return "Install sox: `brew install sox` (install Homebrew from https://brew.sh first)."
  if (platform === "win32") return "Install sox via Chocolatey (`choco install sox`) or download it from https://sourceforge.net/projects/sox/ and add it to PATH."
  return "Install sox with your package manager (e.g. `sudo apt-get install sox`)."
}

/**
 * Build the ordered list of install steps from a probe. `ready` is true when
 * both a recorder and an engine are already present.
 */
export function buildVoiceSetupPlan(probe: VoiceToolProbe, platform: NodeJS.Platform | string): VoiceSetupPlan {
  const steps: VoiceSetupStep[] = []

  if (!probe.hasEngine) {
    if (probe.pip) {
      steps.push({
        kind: "engine",
        label: "Install the local speech-to-text engine (openai-whisper)",
        command: `${probe.pip} install -U openai-whisper`,
      })
    } else {
      steps.push({
        kind: "engine",
        label: "Install a local speech-to-text engine",
        manual: "Install Python 3, then run `pip install -U openai-whisper` — or set opencode.voice.localCommand to your own engine.",
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
