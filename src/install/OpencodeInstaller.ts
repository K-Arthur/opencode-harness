import * as vscode from "vscode"
import { spawn } from "node:child_process"
import * as os from "node:os"
import { existsSync } from "node:fs"
import { writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { log } from "../utils/outputChannel"
import { buildInstallPlan, executableNamesForRuntime, knownOpencodeBinaryPaths, preferExeOnWindows, type InstallPlan } from "./installPlan"
import type { RuntimePreference } from "../session/serverIdentity"

export type AutoInstallMode = "prompt" | "auto" | "off"

/** globalState key recording that the user declined a prompt-once install. */
const DECLINED_KEY = "opencode-install-declined"

/**
 * Env allowlist for spawned install processes — mirrors ServerLifecycle so no
 * unexpected secrets leak into the install script or npm.
 */
const INSTALL_ENV_ALLOWLIST = [
  "PATH", "HOME", "USERPROFILE", "APPDATA",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_DATA_DIRS",
  "LANG", "TERM", "SHELL", "TMPDIR", "TEMP", "TMP",
] as const

/**
 * Detects and installs the opencode CLI, which is a hard requirement for the
 * extension. VS Code has no install-time hook, so this runs on activation: if
 * the binary is missing it prompts once (per the autoInstall setting) and, on
 * consent, installs via the official mechanism behind a progress notification.
 */
export class OpencodeInstaller {
  constructor(private readonly globalState: vscode.Memento) {}

  /** True when an opencode binary is reachable (known install dirs or PATH). */
  async isInstalled(): Promise<boolean> {
    return (await this.locateBinary()) !== null
  }

  /**
   * Resolve a usable opencode binary path, or null.
   *
   * Probes the known install directories first — a freshly-installed binary in
   * `~/.opencode/bin` won't be on the extension host's PATH until VS Code is
   * restarted — then falls back to a PATH lookup.
   */
  async locateBinary(preference: RuntimePreference = this.runtimePreference()): Promise<string | null> {
    for (const executable of executableNamesForRuntime(preference)) {
      const candidates = executable === "opencode"
        ? knownOpencodeBinaryPaths(process.platform, os.homedir(), process.env)
        : knownOpencodeBinaryPaths(process.platform, os.homedir(), process.env, executable)
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
      }
    }
    for (const executable of executableNamesForRuntime(preference)) {
      const found = await this.whichOpencode(executable)
      if (found) return found
    }
    return null
  }

  /**
   * Activation entry point. Returns true if opencode is (now) available.
   * Honors the autoInstall mode and a one-time decline so the user is never
   * nagged on every window reload.
   */
  async ensureInstalled(mode: AutoInstallMode): Promise<boolean> {
    if (await this.isInstalled()) return true

    if (mode === "off") {
      log.info(`${this.runtimeDisplayName()} not found; autoInstall is off. Run 'OpenCode: Install CLI' to install.`)
      return false
    }

    if (mode === "auto") {
      return await this.install()
    }

    // prompt mode — ask once, then remember a decline.
    if (this.globalState.get<boolean>(DECLINED_KEY)) {
      log.info(`${this.runtimeDisplayName()} not found; install previously declined. Run 'OpenCode: Install CLI' to install.`)
      return false
    }

    const choice = await vscode.window.showInformationMessage(
      `OpenCode needs ${this.runtimeDisplayName()}, which isn't installed yet. Install it now?`,
      "Install",
      "Manual Instructions",
      "Not Now",
    )

    if (choice === "Install") {
      return await this.install()
    }
    if (choice === "Manual Instructions") {
      await this.showManualInstructions()
      return false
    }
    // "Not Now" or dismissed.
    await this.globalState.update(DECLINED_KEY, true)
    return false
  }

  /**
   * Perform the install end-to-end behind a progress notification.
   * Returns true on success (binary located afterwards).
   */
  async install(): Promise<boolean> {
    const plan = buildInstallPlan(process.platform, await this.hasNpm(), this.runtimePreference())

    if (plan.strategy === "manual") {
      await this.showManualInstructions(plan)
      return false
    }

    const ok = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Installing OpenCode runtime",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: plan.description })
        try {
          if (plan.strategy === "script") {
            await this.runScript(plan.scriptUrl!)
          } else {
            await this.runNpm(plan.npmCommand!.cmd, [...plan.npmCommand!.args])
          }
        } catch (err) {
          log.error("OpenCode runtime install failed", err)
          return false
        }
        const bin = await this.locateBinary()
        if (!bin) {
          log.error("Install finished but the selected OpenCode runtime could not be located")
          return false
        }
        log.info(`OpenCode runtime installed at ${bin}`)
        return true
      },
    )

    if (ok) {
      await this.globalState.update(DECLINED_KEY, false)
    } else {
      this.showInstallError(plan)
    }
    return ok
  }

  // --- internals -------------------------------------------------------------

  /**
   * Download the bash install script and run it via `bash <file>` with
   * shell:false. We deliberately avoid piping the script straight into a shell:
   * no shell pipe is spawned, curl need not be present, and the child env is
   * restricted to an allowlist.
   */
  private async runScript(url: string): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    let script: string
    try {
      const resp = await fetch(url, { signal: controller.signal, redirect: "follow" })
      if (!resp.ok) throw new Error(`Failed to download install script (HTTP ${resp.status})`)
      script = await resp.text()
    } finally {
      clearTimeout(timer)
    }
    // Sanity-check the payload before executing arbitrary downloaded code.
    if (!script.includes("#!") || !script.toLowerCase().includes("opencode")) {
      throw new Error("Downloaded install script failed validation")
    }

    const scriptPath = join(os.tmpdir(), `opencode-install-${randomBytes(8).toString("hex")}.sh`)
    await writeFile(scriptPath, script, { mode: 0o700 })
    try {
      await this.spawnToCompletion("bash", [scriptPath], false)
    } finally {
      await unlink(scriptPath).catch(() => {})
    }
  }

  private async runNpm(cmd: string, args: string[]): Promise<void> {
    // On Windows `npm` resolves to npm.cmd, which requires shell:true to spawn.
    // The args are fully static (no user input), so there is no injection surface.
    const useShell = process.platform === "win32"
    await this.spawnToCompletion(cmd, args, useShell)
  }

  private spawnToCompletion(cmd: string, args: string[], useShell: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const childEnv: Record<string, string> = {}
      for (const key of INSTALL_ENV_ALLOWLIST) {
        const val = process.env[key]
        if (val) childEnv[key] = val
      }
      const proc = spawn(cmd, args, { shell: useShell, env: childEnv, stdio: ["ignore", "pipe", "pipe"] })
      proc.stdout?.on("data", (d: Buffer) => log.info(`[install] ${d.toString().trimEnd()}`))
      proc.stderr?.on("data", (d: Buffer) => log.warn(`[install] ${d.toString().trimEnd()}`))
      proc.on("error", (err) => reject(err))
      proc.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`))
      })
    })
  }

  private hasNpm(): Promise<boolean> {
    return new Promise((resolve) => {
      const finder = process.platform === "win32" ? "where" : "which"
      const proc = spawn(finder, ["npm"], { shell: false })
      let found = ""
      proc.stdout?.on("data", (d: Buffer) => { found += d.toString() })
      proc.on("error", () => resolve(false))
      proc.on("close", () => resolve(found.trim().length > 0))
    })
  }

  private whichOpencode(executable = "opencode"): Promise<string | null> {
    return new Promise((resolve) => {
      const finder = process.platform === "win32" ? "where" : "which"
      const proc = spawn(finder, [executable], { shell: false })
      let out = ""
      proc.stdout?.on("data", (d: Buffer) => { out += d.toString() })
      proc.on("error", () => resolve(null))
      proc.on("close", () => {
        resolve(preferExeOnWindows(out, process.platform))
      })
    })
  }

  private runtimePreference(): RuntimePreference {
    const value = vscode.workspace.getConfiguration("opencode").get<string>("runtime", "auto")
    return value === "opencode" || value === "opencode2" ? value : "auto"
  }

  private runtimeDisplayName(): string {
    const preference = this.runtimePreference()
    return preference === "opencode2" ? "the OpenCode 2 preview runtime (opencode2)"
      : preference === "opencode" ? "the stable OpenCode runtime (opencode)"
        : "an OpenCode runtime"
  }

  private async showManualInstructions(plan?: InstallPlan): Promise<void> {
    const resolved = plan ?? buildInstallPlan(process.platform, await this.hasNpm(), this.runtimePreference())
    const primary = resolved.manualCommands[0] ?? ""
    const choice = await vscode.window.showInformationMessage(
      `Install the selected OpenCode runtime by running: ${primary}`,
      "Copy Command",
      "Open Docs",
    )
    if (choice === "Copy Command" && primary) {
      await vscode.env.clipboard.writeText(primary)
      void vscode.window.showInformationMessage("Install command copied to clipboard.")
    } else if (choice === "Open Docs") {
      await vscode.env.openExternal(vscode.Uri.parse(resolved.docsUrl))
    }
  }

  private showInstallError(plan: InstallPlan): void {
    void vscode.window
      .showErrorMessage(
        "OpenCode runtime installation failed. Check the OpenCode Harness output channel, or install it manually.",
        "Show Logs",
        "Manual Instructions",
      )
      .then((choice) => {
        if (choice === "Show Logs") log.outputChannel.show()
        else if (choice === "Manual Instructions") void this.showManualInstructions(plan)
      })
  }
}
