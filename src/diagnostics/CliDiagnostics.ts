import * as vscode from "vscode"
import { spawn } from "child_process"

export class CliDiagnostics {
  private outputChannel: vscode.OutputChannel
  private statusBarItem: vscode.StatusBarItem
  private lastCheckOk = false
  private lastPingTime = 0
  private cliPid = 0

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("OpenCode CLI Communication")
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102)
    this.statusBarItem.name = "OpenCode Connection"
    this.statusBarItem.command = "opencode-harness.checkCli"
    this.render(false, 0)
  }

  async check(): Promise<boolean> {
    this.outputChannel.clear()
    this.outputChannel.appendLine("=".repeat(50))
    this.outputChannel.appendLine("OpenCode CLI Communication Check")
    this.outputChannel.appendLine("=".repeat(50))

    // Step 1: Check opencode binary exists
    this.outputChannel.appendLine("\n[1/3] Checking opencode binary...")
    const version = await this.execCommand(["--version"])
    if (!version) {
      this.outputChannel.appendLine("  FAILED: opencode binary not found on PATH")
      this.outputChannel.appendLine("  Install from https://opencode.ai")
      this.render(false, 0)
      return false
    }
    this.outputChannel.appendLine(`  Found: opencode ${version.trim()}`)

    // Step 2: Check server health
    this.outputChannel.appendLine("\n[2/3] Checking server health...")
    try {
      const resp = await fetch("http://127.0.0.1:4096/global/health")
      if (resp.ok) {
        const data = await resp.json() as { version?: string }
        this.outputChannel.appendLine(`  Server healthy (version: ${data.version || "unknown"})`)
        this.cliPid = 0 // managed by extension
      } else {
        this.outputChannel.appendLine("  Server not responding — will start on first request")
      }
    } catch {
      this.outputChannel.appendLine("  Server not running — will start on first request")
    }

    // Step 3: Test prompt
    this.outputChannel.appendLine("\n[3/3] Sending test prompt (timeout: 10s)...")
    const pong = await this.execCommand(["run", "--timeout", "10", "Respond with exactly: pong"], 15000)
    if (pong && pong.toLowerCase().includes("pong")) {
      this.outputChannel.appendLine("  SUCCESS: opencode responded to test prompt")
      this.lastCheckOk = true
      this.lastPingTime = Date.now()
      this.render(true, this.lastPingTime)
      this.outputChannel.appendLine("\n" + "=".repeat(50))
      this.outputChannel.appendLine("All checks passed. CLI communication is working.")
      this.outputChannel.appendLine("=".repeat(50))
      this.outputChannel.show()
      return true
    } else {
      this.outputChannel.appendLine(`  FAILED: unexpected response: "${(pong || "no response").slice(0, 100)}"`)
      this.lastCheckOk = false
      this.render(false, this.lastPingTime)
      this.outputChannel.show()
      return false
    }
  }

  logSend(data: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] >> SEND >> ${data.slice(0, 200)}`)
  }

  logRecv(data: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] << RECV << ${data.slice(0, 200)}`)
  }

  logError(msg: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] !! ERROR !! ${msg}`)
  }

  private async execCommand(args: string[], timeoutMs = 10000): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn("opencode", args, { timeout: timeoutMs })
      let out = ""
      proc.stdout?.on("data", (d: Buffer) => { out += d.toString() })
      proc.on("close", (code) => {
        if (code === 0) resolve(out)
        else resolve(null)
      })
      proc.on("error", () => resolve(null))
    })
  }

  private render(ok: boolean, timestamp: number): void {
    const elapsed = timestamp ? Math.round((Date.now() - timestamp) / 1000) : 0
    if (ok) {
      this.statusBarItem.text = `$(circle-filled) Connected`
      this.statusBarItem.tooltip = `CLI responding (${elapsed}s since last ping)`
      this.statusBarItem.color = new vscode.ThemeColor("terminalAnsiGreen")
    } else {
      this.statusBarItem.text = `$(circle-slash) Disconnected`
      this.statusBarItem.tooltip = "Click to check CLI communication"
      this.statusBarItem.color = new vscode.ThemeColor("terminalAnsiRed")
    }
    this.statusBarItem.show()
  }

  dispose(): void {
    this.outputChannel.dispose()
    this.statusBarItem.dispose()
  }
}
