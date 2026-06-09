import * as vscode from "vscode"
import { spawn } from "child_process"
import { log } from "../utils/outputChannel"

export class CliDiagnostics {
  private lastCheckOk = false
  private lastPingTime = 0
  private cliPid = 0

  constructor() {
    this.render(false, 0)
  }

  async check(port?: number): Promise<boolean> {
    try {
      log.outputChannel.appendLine("\n" + "=".repeat(50))
      log.outputChannel.appendLine("OpenCode CLI Communication Check")
      log.outputChannel.appendLine("=".repeat(50))

      // Step 1: Check opencode binary exists
      log.outputChannel.appendLine("\n[1/3] Checking opencode binary...")
      const { stdout: version, stderr: versionErr } = await this.execCommand(["--version"])
      if (!version) {
        log.outputChannel.appendLine("  FAILED: opencode binary not found on PATH")
        if (versionErr) log.outputChannel.appendLine(`  Error: ${versionErr.trim()}`)
        log.outputChannel.appendLine("  Install from https://opencode.ai")
        this.render(false, 0)
        return false
      }
      log.outputChannel.appendLine(`  Found: opencode ${version.trim()}`)

      // Step 2: Check server health
      const activePort = port || 4096
      log.outputChannel.appendLine(`\n[2/3] Checking server health (port ${activePort})...`)
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2000)
        const resp = await fetch(`http://127.0.0.1:${activePort}/global/health`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (resp.ok) {
          const data = await resp.json() as { version?: string }
          log.outputChannel.appendLine(`  Server healthy (version: ${data.version || "unknown"})`)
          this.cliPid = 0 // managed by extension
        } else {
          log.outputChannel.appendLine(`  Server returned HTTP ${resp.status} — will start on first request`)
        }
      } catch (err) {
        log.outputChannel.appendLine(`  Server not responding on port ${activePort} (timeout or refused) — will start on first request`)
      }

      // Step 3: Test prompt
      log.outputChannel.appendLine("\n[3/3] Sending test prompt (timeout: 10s)...")
      const { stdout: pong, stderr: pongErr } = await this.execCommand(["run", "--timeout", "10", "Respond with exactly: pong"], 15000)
      if (pong && pong.toLowerCase().includes("pong")) {
        log.outputChannel.appendLine("  SUCCESS: opencode responded to test prompt")
        this.lastCheckOk = true
        this.lastPingTime = Date.now()
        this.render(true, this.lastPingTime)
        log.outputChannel.appendLine("\n" + "=".repeat(50))
        log.outputChannel.appendLine("All checks passed. CLI communication is working.")
        log.outputChannel.appendLine("=".repeat(50))
        log.show()
        return true
      } else {
        const errorMsg = pongErr ? pongErr.trim() : (pong ? pong.trim() : "no response")
        log.outputChannel.appendLine(`  FAILED: ${errorMsg.slice(0, 200)}`)
        this.lastCheckOk = false
        this.render(false, this.lastPingTime)
        log.show()
        return false
      }
    } catch (err) {
      log.error("CLI diagnostics check failed unexpectedly", err)
      this.render(false, 0)
      return false
    }
  }

  logSend(data: string): void {
    log.outputChannel.appendLine(`[${new Date().toISOString()}] >> SEND >> ${data.slice(0, 200)}`)
  }

  logRecv(data: string): void {
    log.outputChannel.appendLine(`[${new Date().toISOString()}] << RECV << ${data.slice(0, 200)}`)
  }

  logError(msg: string): void {
    log.outputChannel.appendLine(`[${new Date().toISOString()}] !! ERROR !! ${msg}`)
  }

  /**
   * Validate the configured binary path to prevent command injection.
   * Only allows absolute paths or the bare "opencode" command.
   */
  private resolveBinaryPath(): string {
    const config = vscode.workspace.getConfiguration("opencode")
    const raw = config.get<string>("binaryPath") || "opencode"

    if (raw === "opencode") {
      return raw
    }

    // Must be an absolute path (starts with / on Unix or drive letter on Windows)
    if (!/^[/\\]|[A-Za-z]:/.test(raw)) {
      log.warn(`Binary path "${raw}" is not absolute. Falling back to "opencode" in PATH.`)
      return "opencode"
    }

    // Reject paths containing shell metacharacters that could enable injection
    if (/[;&|`$(){}!#~<>]/.test(raw)) {
      log.warn(`Binary path "${raw}" contains unsafe characters. Falling back to "opencode" in PATH.`)
      return "opencode"
    }

    return raw
  }

  private async execCommand(args: string[], timeoutMs = 10000): Promise<{ stdout: string | null, stderr: string | null }> {
    const binaryPath = this.resolveBinaryPath()

    return new Promise((resolve) => {
      const allowedEnvVars = ["PATH", "HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME", "LANG", "TERM", "SHELL", "TMPDIR", "TEMP", "TMP"]
      const childEnv: Record<string, string> = {}
      for (const key of allowedEnvVars) {
        const val = process.env[key]
        if (val) childEnv[key] = val
      }
      const proc = spawn(binaryPath, args, {
        timeout: timeoutMs,
        // Don't spawn a shell — prevents shell injection
        shell: false,
        // Restrict environment to allowlist to prevent secret leakage
        env: childEnv,
      })
      let out = ""
      let err = ""
      proc.stdout?.on("data", (d: Buffer) => { out += d.toString() })
      proc.stderr?.on("data", (d: Buffer) => { err += d.toString() })
      proc.on("close", (code) => {
        if (code === 0) resolve({ stdout: out, stderr: err })
        else resolve({ stdout: null, stderr: err || `Exit code ${code}` })
      })
      proc.on("error", (e) => resolve({ stdout: null, stderr: e.message }))
    })
  }

  private render(ok: boolean, timestamp: number): void {
    // Status bar item removed — connection status is shown by the main connection status bar
    // This method is kept as a no-op for now to avoid breaking the constructor call
  }

  dispose(): void {
    // No statusBarItem to dispose
  }
}
