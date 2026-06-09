import * as vscode from "vscode"

/**
 * Centralised output channel for the OpenCode Harness extension.
 * Every module should log through this instead of console.log / console.error
 * so that all activity is visible in the "OpenCode Harness" output channel.
 */
class OutputChannelService {
  private channel: vscode.OutputChannel

  constructor() {
    this.channel = vscode.window.createOutputChannel("OpenCode Harness")
  }

  get outputChannel(): vscode.OutputChannel {
    return this.channel
  }

  private static readonly SENSITIVE_PATTERNS = [
    /Bearer\s+\S+/gi,
    /sk-[a-zA-Z0-9]{20,}/g,
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /github_pat_[a-zA-Z0-9]{22,}/g,
    /xox[bpsa]-[a-zA-Z0-9]{10,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /(?:api|api_key|apikey|password|secret|token)\s*[:=]\s*['"]?\S+['"]?/gi,
  ]

  private scrub(message: string): string {
    let scrubbed = message
    for (const pattern of OutputChannelService.SENSITIVE_PATTERNS) {
      scrubbed = scrubbed.replace(pattern, "[REDACTED]")
    }
    return scrubbed
  }

  private scrubObject(obj: unknown): unknown {
    if (typeof obj === "string") return this.scrub(obj)
    if (typeof obj !== "object" || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(item => this.scrubObject(item))
    
    const scrubbed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === "string") {
        scrubbed[key] = this.scrub(value)
      } else if (typeof value === "object" && value !== null) {
        scrubbed[key] = this.scrubObject(value)
      } else {
        scrubbed[key] = value
      }
    }
    return scrubbed
  }

  private formatContext(context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) return ""
    try {
      const scrubbed = this.scrubObject(context)
      return ` | ${JSON.stringify(scrubbed)}`
    } catch {
      return ""
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [INFO] ${this.scrub(message)}${this.formatContext(context)}`)
  }

  warn(message: string, err?: unknown, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [WARN] ${this.scrub(message)}${this.formatContext(context)}`)
    if (err instanceof Error) {
      this.channel.appendLine(`  ${this.scrub(err.stack || err.message)}`)
    } else if (err !== undefined) {
      this.channel.appendLine(`  ${this.scrub(String(err))}`)
    }
  }

  error(message: string, err?: unknown, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [ERROR] ${this.scrub(message)}${this.formatContext(context)}`)
    if (err instanceof Error) {
      this.channel.appendLine(`  ${this.scrub(err.stack || err.message)}`)
    } else if (err !== undefined) {
      this.channel.appendLine(`  ${this.scrub(String(err))}`)
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    const config = vscode.workspace.getConfiguration("opencode")
    if (!config.get<boolean>("debugLogging")) return
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [DEBUG] ${this.scrub(message)}${this.formatContext(context)}`)
  }

  /** Structured logging for specific domains */
  stream(message: string, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [STREAM] ${this.scrub(message)}${this.formatContext(context)}`)
  }

  stateSync(message: string, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [STATE] ${this.scrub(message)}${this.formatContext(context)}`)
  }

  sdk(message: string, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [SDK] ${this.scrub(message)}${this.formatContext(context)}`)
  }

  metrics(message: string, context?: Record<string, unknown>): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [METRICS] ${this.scrub(message)}${this.formatContext(context)}`)
  }

  show(): void {
    this.channel.show(true)
  }

  dispose(): void {
    this.channel.dispose()
  }
}

/** Singleton instance – created once during activation. */
export const log = new OutputChannelService()