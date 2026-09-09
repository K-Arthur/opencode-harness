import { join } from "node:path"
import type { RuntimePreference } from "../session/serverIdentity"

/**
 * Pure, vscode-free planning logic for installing the opencode CLI.
 *
 * Kept free of any `vscode` import so it can be exercised by real behavioral
 * tests under tsx/node (see installPlan.test.ts). The orchestration that needs
 * the VS Code API (notifications, progress, spawning) lives in OpencodeInstaller.
 */

/** Official opencode install script (bash). Redirects to the GitHub-hosted script. */
export const INSTALL_SCRIPT_URL = "https://opencode.ai/install"

/** npm package name for the opencode CLI. */
export const NPM_PACKAGE = "opencode-ai"

/** npm distribution for the OpenCode 2 preview executable. */
export const NPM_OPENCODE2_PACKAGE = "@opencode-ai/cli@next"

/** Docs landing page used for the "Manual Instructions" path. */
export const DOCS_URL = "https://opencode.ai/docs/"

/** Ordered executable names used by runtime discovery. */
export function executableNamesForRuntime(preference: RuntimePreference): readonly string[] {
  if (preference === "opencode2") return ["opencode2"]
  if (preference === "opencode") return ["opencode"]
  return ["opencode2", "opencode"]
}

export type InstallStrategy = "script" | "npm" | "manual"

export interface InstallPlan {
  /** How the install will be performed for the current platform. */
  readonly strategy: InstallStrategy
  /** Human-readable message for the progress notification. */
  readonly description: string
  /** Commands to show the user for manual install (always populated). */
  readonly manualCommands: readonly string[]
  /** Docs URL for the "Manual Instructions" path. */
  readonly docsUrl: string
  /** For strategy === "npm": executable + args to spawn (static, no user input). */
  readonly npmCommand?: { readonly cmd: string; readonly args: readonly string[] }
  /** For strategy === "script": URL of the bash install script to download and run. */
  readonly scriptUrl?: string
}

/**
 * Decide how to install opencode on the given platform.
 *
 * - macOS / Linux → the official bash install script, which lands the binary in
 *   `~/.opencode/bin` without sudo. We download the script and run it via `bash`
 *   directly rather than `curl | bash`, so no shell pipe is ever spawned.
 * - Windows → no official bash script exists, so prefer `npm i -g opencode-ai`
 *   when npm is present, otherwise fall back to manual instructions.
 */
export function buildInstallPlan(platform: NodeJS.Platform, hasNpm: boolean, runtime: RuntimePreference = "opencode"): InstallPlan {
  const executable = runtime === "opencode2" ? "opencode2" : "opencode"
  const runtimeManual = runtime === "opencode2"
    ? [`npm install -g ${NPM_OPENCODE2_PACKAGE}`]
    : [`npm install -g ${NPM_PACKAGE}`, `scoop install ${executable}`, `choco install ${executable}`]

  // The public shell installer is for the legacy `opencode` executable. The
  // OpenCode 2 binary is shipped by the npm package, so do not silently run a
  // legacy installer when the user explicitly selected OpenCode 2.
  if (runtime === "opencode2") {
    if (hasNpm) {
      return {
        strategy: "npm",
        description: `Installing the ${executable} preview CLI globally via npm (${NPM_OPENCODE2_PACKAGE})…`,
        npmCommand: { cmd: "npm", args: ["install", "-g", NPM_OPENCODE2_PACKAGE] },
        docsUrl: DOCS_URL,
        manualCommands: runtimeManual,
      }
    }
    return {
      strategy: "manual",
      description: "OpenCode 2 installation requires npm.",
      docsUrl: DOCS_URL,
      manualCommands: runtimeManual,
    }
  }

  if (platform !== "win32") {
    return {
      strategy: "script",
      description: "Downloading and running the official opencode install script…",
      scriptUrl: INSTALL_SCRIPT_URL,
      docsUrl: DOCS_URL,
      manualCommands: [`curl -fsSL ${INSTALL_SCRIPT_URL} | bash`],
    }
  }

  const windowsManual = runtimeManual

  if (hasNpm) {
    return {
      strategy: "npm",
      description: `Installing the ${executable} CLI globally via npm (${NPM_PACKAGE})…`,
      npmCommand: { cmd: "npm", args: ["install", "-g", NPM_PACKAGE] },
      docsUrl: DOCS_URL,
      manualCommands: windowsManual,
    }
  }

  return {
    strategy: "manual",
    description: "Manual installation required.",
    docsUrl: DOCS_URL,
    manualCommands: windowsManual,
  }
}

/**
 * Absolute paths where the opencode binary may live beyond the process PATH.
 *
 * The install script writes to `~/.opencode/bin` and updates shell rc files, but
 * the already-running extension host won't see that PATH change until VS Code is
 * restarted — so we must probe these locations directly both for detection and
 * for locating a freshly-installed binary.
 */
export function knownOpencodeBinaryPaths(
  platform: NodeJS.Platform,
  homedir: string,
  env: Record<string, string | undefined> = {},
  executable = "opencode",
): string[] {
  const isWindows = platform === "win32"
  const exe = isWindows ? `${executable}.exe` : executable
  const paths: string[] = []

  // Official install-script target.
  paths.push(join(homedir, ".opencode", "bin", exe))

  if (isWindows) {
    // npm global prefix on Windows lives under %APPDATA%\npm. npm creates
    // wrapper scripts (opencode.cmd, opencode.ps1) there, but the extension
    // spawns with shell:false — only the .exe is spawnable. Probe the .exe in
    // the npm bin dir and the real executable inside node_modules.
    const appData = env["APPDATA"]
    if (appData) {
      paths.push(join(appData, "npm", exe))
      const packageName = executable === "opencode2" ? ["@opencode-ai", "cli"] : ["opencode-ai"]
      paths.push(join(appData, "npm", "node_modules", ...packageName, "bin", exe))
    }
  } else {
    // Common npm global prefixes and package-manager locations on unix.
    paths.push(join(homedir, ".npm-global", "bin", exe))
    paths.push(join(homedir, ".local", "bin", exe))
    paths.push(join("/usr", "local", "bin", exe))
    // Homebrew (Apple Silicon and Intel).
    paths.push(join("/opt", "homebrew", "bin", exe))
    paths.push(join("/usr", "bin", exe))
  }

  return [...new Set(paths)]
}

/**
 * Select the best binary path from `where`/`which` output.
 *
 * On Windows, `where opencode` prints multiple lines — typically `opencode.cmd`,
 * `opencode.ps1`, and (if present) `opencode.exe`. The extension spawns with
 * `shell: false`, so only the `.exe` is spawnable; `.cmd`/`.ps1` wrappers cause
 * EFTYPE/EINVAL errors. This helper prefers `.exe`, rejects `.ps1`/`.cmd`, and
 * falls back to any remaining line.
 *
 * On non-Windows platforms, returns the first non-empty line (unchanged behavior).
 *
 * @param lines  Raw stdout from `where`/`which` (one path per line).
 * @param platform  `process.platform` — only `win32` gets the .exe filter.
 * @returns The chosen absolute path, or `null` when no usable line is found.
 */
export function preferExeOnWindows(
  lines: string,
  platform: NodeJS.Platform,
): string | null {
  const trimmed = lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (trimmed.length === 0) return null

  if (platform !== "win32") return trimmed[0] ?? null

  const exeMatch = trimmed.find((l) => l.toLowerCase().endsWith(".exe"))
  if (exeMatch) return exeMatch

  const nonWrapper = trimmed.find(
    (l) => !l.toLowerCase().endsWith(".cmd") && !l.toLowerCase().endsWith(".ps1"),
  )
  return nonWrapper ?? null
}
