import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export interface McpServerConfig {
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  enabled?: boolean
  url?: string
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface McpServerInfo {
  name: string
  config: McpServerConfig
  status: "connected" | "disconnected" | "error"
  tools: string[]
  source?: "opencode" | "vscode"
  sourcePath?: string
}

const MCP_CONFIG_KEY = "opencode.mcpServers"

export class McpServerManager {
  private context: vscode.ExtensionContext
  private servers: Map<string, McpServerInfo> = new Map()

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.loadServers()
  }

  private loadServers(): void {
    this.servers.clear()

    for (const configPath of this.getReadableConfigPaths()) {
      const config = this.readConfigFile(configPath)
      const servers = this.normalizeServerMap(config.mcp)
      for (const [name, serverConfig] of Object.entries(servers)) {
        this.servers.set(name, {
          name,
          config: serverConfig,
          status: this.isDisabled(serverConfig) ? "disconnected" : "disconnected",
          tools: [],
          source: "opencode",
          sourcePath: configPath,
        })
      }
    }

    const legacyServers = this.getLegacyVsCodeServers()
    for (const [name, serverConfig] of Object.entries(legacyServers)) {
      if (this.servers.has(name)) continue
      this.servers.set(name, {
        name,
        config: serverConfig,
        status: this.isDisabled(serverConfig) ? "disconnected" : "disconnected",
        tools: [],
        source: "vscode",
      })
    }
  }

  getServers(): McpServerInfo[] {
    return Array.from(this.servers.values())
  }

  getServer(name: string): McpServerInfo | undefined {
    return this.servers.get(name)
  }

async addServer(name: string, config: McpServerConfig): Promise<void> {
    // Validate command field for safety: must be a non-empty string, reject shell metacharacters
    if (!config.command || typeof config.command !== "string" || config.command.trim().length === 0) {
      throw new Error("MCP server command must be a non-empty string")
    }
    const dangerous = /[;&|`$(){}!#~<>]/
    if (dangerous.test(config.command)) {
      throw new Error(`MCP server command "${config.command}" contains shell metacharacters and was rejected`)
    }
    const servers = this.getAllServerConfigs()
    servers[name] = config
    await this.saveServers(servers)
this.loadServers()
      log.info(`MCP server added: ${name}`)
  }

  async removeServer(name: string): Promise<void> {
    const servers = this.getAllServerConfigs()
    delete servers[name]
    await this.saveServers(servers)
    this.loadServers()
    log.info(`MCP server removed: ${name}`)
  }

  async updateServer(name: string, config: Partial<McpServerConfig>): Promise<void> {
    const servers = this.getAllServerConfigs()
    const existing = servers[name]
    if (!existing) throw new Error(`Server ${name} not found`)
    servers[name] = { ...existing, ...config }
    await this.saveServers(servers)
    this.loadServers()
    log.info(`MCP server updated: ${name}`)
  }

  async toggleServer(name: string, disabled: boolean): Promise<void> {
    await this.updateServer(name, { disabled, enabled: !disabled })
  }

  setServerStatus(name: string, status: McpServerInfo["status"], tools?: string[]): void {
    const info = this.servers.get(name)
    if (info) {
      info.status = status
      if (tools) info.tools = tools
    }
  }

  private getAllServerConfigs(): Record<string, McpServerConfig> {
    const config = this.readConfigFile(this.getWritableConfigPath())
    return this.normalizeServerMap(config.mcp)
  }

  private async saveServers(servers: Record<string, McpServerConfig>): Promise<void> {
    const configPath = this.getWritableConfigPath()
    const config = this.readConfigFile(configPath)
    config.mcp = servers
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
    await fs.promises.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  }

  getPrimaryConfigPath(): string {
    return this.getWritableConfigPath()
  }

  async openPrimaryConfigFile(): Promise<void> {
    const configPath = this.getWritableConfigPath()
    if (!fs.existsSync(configPath)) {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
      await fs.promises.writeFile(configPath, "{\n  \"mcp\": {}\n}\n", "utf8")
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath))
    await vscode.window.showTextDocument(doc)
  }

  private getReadableConfigPaths(): string[] {
    const paths: string[] = []
    const envConfig = process.env.OPENCODE_CONFIG
    if (envConfig) paths.push(path.resolve(envConfig))

    paths.push(this.getDefaultGlobalConfigPath())

    for (const folder of vscode.workspace.workspaceFolders || []) {
      paths.push(path.join(folder.uri.fsPath, "opencode.json"))
      paths.push(path.join(folder.uri.fsPath, ".opencode", "opencode.json"))
    }

    return Array.from(new Set(paths)).filter((configPath) => fs.existsSync(configPath))
  }

  private getWritableConfigPath(): string {
    if (process.env.OPENCODE_CONFIG) return path.resolve(process.env.OPENCODE_CONFIG)
    return this.getDefaultGlobalConfigPath()
  }

  private getDefaultGlobalConfigPath(): string {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
    return path.join(configHome, "opencode", "opencode.json")
  }

  private getLegacyVsCodeServers(): Record<string, McpServerConfig> {
    const config = vscode.workspace.getConfiguration("opencode")
    return this.normalizeServerMap(config.get<Record<string, McpServerConfig>>(MCP_CONFIG_KEY.slice("opencode.".length), {}))
  }

  private readConfigFile(configPath: string): Record<string, unknown> {
    if (!fs.existsSync(configPath)) return {}
    try {
      const content = fs.readFileSync(configPath, "utf8")
      if (!content.trim()) return {}
      return JSON.parse(this.stripJsonComments(content).replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>
    } catch (err) {
      log.warn(`Failed to read OpenCode config at ${configPath}`, err)
      return {}
    }
  }

  private normalizeServerMap(value: unknown): Record<string, McpServerConfig> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    const servers: Record<string, McpServerConfig> = {}
    for (const [name, serverConfig] of Object.entries(value as Record<string, unknown>)) {
      if (serverConfig && typeof serverConfig === "object" && !Array.isArray(serverConfig)) {
        servers[name] = serverConfig as McpServerConfig
      }
    }
    return servers
  }

  private isDisabled(config: McpServerConfig): boolean {
    return config.disabled === true || config.enabled === false
  }

  private stripJsonComments(content: string): string {
    let output = ""
    let inString = false
    let quote = ""
    for (let i = 0; i < content.length; i++) {
      const char = content[i]
      const next = content[i + 1]
      if (inString) {
        output += char
        if (char === "\\" && next) {
          output += next
          i++
        } else if (char === quote) {
          inString = false
          quote = ""
        }
        continue
      }
      if (char === "\"" || char === "'") {
        inString = true
        quote = char
        output += char
        continue
      }
      if (char === "/" && next === "/") {
        while (i < content.length && content[i] !== "\n") i++
        output += "\n"
        continue
      }
      if (char === "/" && next === "*") {
        i += 2
        while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++
        i++
        continue
      }
      output += char
    }
    return output
  }

  refresh(): void {
    this.loadServers()
  }

  dispose(): void {
    // No persistent connections to clean up - config is managed via VS Code settings
  }
}
