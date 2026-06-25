import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { parseJsonc } from "../utils/jsonc"

/**
 * Condition that determines when an MCP server's tools should be available.
 * All specified conditions must match for the server to be active.
 */
export interface McpServerWhenCondition {
  /**
   * Provider IDs to match against (e.g. ["anthropic", "google", "openai"])
   * Matches the providerID portion of modelRef (e.g. "anthropic" from "anthropic/claude-sonnet-4")
   */
  provider?: string[]
  /**
   * Model ID patterns to match against.
   * Supports glob patterns: "*" matches any characters, "?" matches a single character.
   * Examples: ["claude-*-vision", "gemini-*", "gpt-4*"]
   * Matches the modelID portion of modelRef (e.g. "claude-sonnet-4" from "anthropic/claude-sonnet-4")
   */
  model?: string[]
}

/**
 * Helper to convert an array of glob-style patterns to a RegExp.
 * Supports simple glob patterns: "*" becomes ".*", "?" becomes ".".
 * Other regex special characters are escaped.
 * If patterns is empty or undefined, always matches.
 *
 * @example
 * patternsToRegex(["claude-*-vision", "gemini-*"])
 * // → /^(?:claude-.*-vision|gemini-.*)$/i
 */
function patternsToRegex(patterns: string[] | undefined): RegExp | null {
  if (!patterns || patterns.length === 0) return null

  const escapeRegex = (s: string): string =>
    s
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape real regex chars first
      .replace(/\\\*/g, ".*") // unescaped * (now \\*) becomes .*
      .replace(/\\\?/g, ".") // unescaped ? (now \\?) becomes .

  const joined = patterns.map(escapeRegex).join("|")
  return new RegExp(`^(?:${joined})$`, "i")
}

/**
 * Check if a string matches any of the given glob-style patterns.
 * If patterns is empty/undefined, returns true (no filter = always match).
 */
function matchesPatterns(value: string, patterns: string[] | undefined): boolean {
  const regex = patternsToRegex(patterns)
  if (!regex) return true
  return regex.test(value)
}

/**
 * Check whether an MCP server should be enabled for a given model.
 * Evaluates the server's `when` condition against the current model's provider and ID.
 *
 * @param config - The MCP server configuration (may include a `when` condition)
 * @param modelProviderID - The current model's provider ID (e.g. "anthropic")
 * @param modelID - The current model's ID (e.g. "claude-sonnet-4")
 * @returns true if the server should be enabled for this model
 */
function isEnabledForModel(
  config: McpServerConfig,
  modelProviderID: string,
  modelID: string,
): boolean {
  const condition = config.when
  if (!condition) return true // no condition = always available

  // Check provider match (if specified)
  if (condition.provider && condition.provider.length > 0) {
    if (!condition.provider.includes(modelProviderID)) {
      return false
    }
  }

  // Check model pattern match (if specified)
  if (condition.model && condition.model.length > 0) {
    if (!matchesPatterns(modelID, condition.model)) {
      return false
    }
  }

  return true
}

export interface McpServerConfig {
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  enabled?: boolean
  url?: string
  headers?: Record<string, string>
  /**
   * Working directory for local MCP servers (v1.17.4).
   * When set, the server starts from this workspace-relative directory.
   */
  cwd?: string
  /**
   * Timeout in milliseconds for MCP server operations (v1.17.4+).
   */
  timeout?: number
  /**
   * OAuth configuration for remote MCP servers (v1.15.9/v1.17.4).
   * Set to false to disable OAuth auto-detection.
   */
  oauth?: {
    clientId?: string
    clientSecret?: string
    scope?: string
    callbackPort?: number
    redirectUri?: string
  } | false
  /**
   * Condition that determines when this server's tools should be available.
   * If undefined, the server is always available (subject to disabled/enabled).
   *
   * Example opencode.json:
   * {
   *   "mcp": {
   *     "vision-server": {
   *       "type": "remote",
   *       "url": "https://mcp.example.com",
   *       "when": {
   *         "provider": ["anthropic", "google"],
   *         "model": ["*vision*", "gemini-*"]
   *       }
   *     }
   *   }
   * }
   */
  when?: McpServerWhenCondition
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
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const MCP_COMMAND_PATTERN = /^[A-Za-z0-9@._/\\:-]+$/
const MCP_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

function assertValidServerName(name: string): void {
  if (!MCP_SERVER_NAME_PATTERN.test(name)) {
    throw new Error("MCP server name must be 1-64 characters and contain only letters, numbers, dot, underscore, or dash")
  }
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value)
}

function assertSafeStringArray(label: string, values: unknown): string[] | undefined {
  if (values === undefined) return undefined
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || hasControlChars(value) || value.length > 500)) {
    throw new Error(`MCP server ${label} must be an array of safe strings`)
  }
  return values
}

function assertSafeRecord(label: string, value: unknown, keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP server ${label} must be an object`)
  }
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!keyPattern.test(key) || typeof raw !== "string" || hasControlChars(raw) || raw.length > 4000) {
      throw new Error(`MCP server ${label} contains an unsafe entry`)
    }
    result[key] = raw
  }
  return result
}

function assertRemoteUrl(url: unknown): string | undefined {
  if (url === undefined) return undefined
  if (typeof url !== "string" || hasControlChars(url)) {
    throw new Error("MCP remote server URL must be a string")
  }
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MCP remote server URL must use http or https")
  }
  if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "::1") {
    throw new Error("MCP remote server URL must use HTTPS unless it targets localhost")
  }
  return parsed.toString().replace(/\/$/, "")
}

function assertWhenCondition(value: unknown): McpServerWhenCondition | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP server when condition must be an object")
  }
  const condition = value as Record<string, unknown>
  return {
    provider: assertSafeStringArray("when.provider", condition.provider),
    model: assertSafeStringArray("when.model", condition.model),
  }
}

function assertCwd(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error("MCP server cwd must be a string")
  if (hasControlChars(value)) throw new Error("MCP server cwd contains control characters")
  if (value.length > 4096) throw new Error("MCP server cwd exceeds maximum length (4096 characters)")
  return value.trim()
}

function assertTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("MCP server timeout must be a positive number (milliseconds)")
  }
  if (value > 300000) throw new Error("MCP server timeout exceeds maximum (300000ms / 5 minutes)")
  return value
}

function assertOAuthConfig(value: unknown): { clientId?: string; clientSecret?: string; scope?: string; callbackPort?: number; redirectUri?: string } | false | undefined {
  if (value === undefined || value === false) return value === false ? false : undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP server oauth must be an object or false")
  }
  const oauth = value as Record<string, unknown>
  const result: { clientId?: string; clientSecret?: string; scope?: string; callbackPort?: number; redirectUri?: string } = {}
  
  if (oauth.clientId !== undefined) {
    if (typeof oauth.clientId !== "string" || hasControlChars(oauth.clientId) || oauth.clientId.length > 500) {
      throw new Error("MCP server oauth.clientId must be a safe string (max 500 chars)")
    }
    result.clientId = oauth.clientId.trim()
  }
  
  if (oauth.clientSecret !== undefined) {
    if (typeof oauth.clientSecret !== "string" || hasControlChars(oauth.clientSecret) || oauth.clientSecret.length > 500) {
      throw new Error("MCP server oauth.clientSecret must be a safe string (max 500 chars)")
    }
    result.clientSecret = oauth.clientSecret.trim()
  }
  
  if (oauth.scope !== undefined) {
    if (typeof oauth.scope !== "string" || hasControlChars(oauth.scope) || oauth.scope.length > 1000) {
      throw new Error("MCP server oauth.scope must be a safe string (max 1000 chars)")
    }
    result.scope = oauth.scope.trim()
  }
  
  if (oauth.callbackPort !== undefined) {
    if (typeof oauth.callbackPort !== "number" || !Number.isInteger(oauth.callbackPort) || oauth.callbackPort < 1 || oauth.callbackPort > 65535) {
      throw new Error("MCP server oauth.callbackPort must be a valid port number (1-65535)")
    }
    result.callbackPort = oauth.callbackPort
  }
  
  if (oauth.redirectUri !== undefined) {
    if (typeof oauth.redirectUri !== "string" || hasControlChars(oauth.redirectUri) || oauth.redirectUri.length > 2000) {
      throw new Error("MCP server oauth.redirectUri must be a safe string (max 2000 chars)")
    }
    try {
      new URL(oauth.redirectUri)
    } catch {
      throw new Error("MCP server oauth.redirectUri must be a valid URL")
    }
    result.redirectUri = oauth.redirectUri.trim()
  }
  
  return result
}

function sanitizeMcpServerConfig(name: string, value: unknown, partial = false): McpServerConfig {
  assertValidServerName(name)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP server config must be an object")
  }

  const raw = value as Record<string, unknown>
  const config = { ...raw } as McpServerConfig

  // Accept opencode aliases: environment → env, enabled → !disabled
  if (raw.environment !== undefined && raw.env === undefined) {
    config.env = assertSafeRecord("env", raw.environment)
    delete (config as Record<string, unknown>).environment
  }
  if (raw.enabled !== undefined && raw.disabled === undefined) {
    config.disabled = !(raw.enabled as boolean)
    delete (config as Record<string, unknown>).enabled
  }

  const type = typeof config.type === "string" ? config.type.trim().toLowerCase() : undefined
  if (type !== undefined && !["stdio", "local", "http", "sse", "remote"].includes(type)) {
    throw new Error("MCP server type must be stdio, local, http, sse, or remote")
  }
  if (type !== undefined) config.type = type

  const url = assertRemoteUrl(config.url)

  // Non-stdio types (http/sse/remote) require a URL; without one the server
  // has no endpoint to connect to and will fail at runtime.
  const isRemoteType = type === "http" || type === "sse" || type === "remote"
  if (isRemoteType && !url) {
    throw new Error(`MCP ${type} server must include a url`)
  }

  // Accept command as string | string[] (opencode uses array form)
  const rawCommand = config.command as string | string[] | undefined
  let command: string | undefined
  let argsFromCommand: string[] | undefined

  if (typeof rawCommand === "string") {
    command = rawCommand.trim()
  } else if (Array.isArray(rawCommand)) {
    // Array form: [0] is binary, rest are merged into args
    if (rawCommand.length === 0) {
      throw new Error("MCP server command array must not be empty")
    }
    const binary = rawCommand[0]
    if (typeof binary !== "string") {
      throw new Error("MCP server command array first element must be a string")
    }
    command = binary.trim()
    // Validate every element with MCP_COMMAND_PATTERN
    for (let i = 0; i < rawCommand.length; i++) {
      const elem = rawCommand[i]
      if (typeof elem !== "string") {
        throw new Error(`MCP server command array element ${i} must be a string`)
      }
      if (!MCP_COMMAND_PATTERN.test(elem) || elem.includes("..") || hasControlChars(elem)) {
        throw new Error(`MCP server command array element ${i} "${elem}" contains unsafe characters and was rejected`)
      }
    }
    // Merge rest into args
    if (rawCommand.length > 1) {
      argsFromCommand = rawCommand.slice(1).map((arg: unknown) => typeof arg === "string" ? arg : String(arg))
    }
  }

  const requiresCommand = !partial && (!type || type === "stdio" || type === "local") && !url
  if (requiresCommand && !command) {
    throw new Error("MCP stdio/local server command must be a non-empty string or array")
  }
  if (command !== undefined) {
    config.command = command
  }

  // Merge args from command array with existing args
  if (argsFromCommand) {
    const existingArgs = assertSafeStringArray("args", config.args) ?? []
    config.args = [...argsFromCommand, ...existingArgs]
  } else {
    config.args = assertSafeStringArray("args", config.args)
  }

  config.env = assertSafeRecord("env", config.env)
  config.headers = assertSafeRecord("headers", config.headers, MCP_HEADER_NAME_PATTERN)
  config.when = assertWhenCondition(config.when)
  config.cwd = assertCwd(config.cwd)
  config.timeout = assertTimeout(config.timeout)
  config.oauth = assertOAuthConfig(config.oauth)
  if (url !== undefined) config.url = url
  if (config.disabled !== undefined && typeof config.disabled !== "boolean") throw new Error("MCP server disabled flag must be boolean")
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") throw new Error("MCP server enabled flag must be boolean")
  return config
}

function sanitizeToolNames(serverName: string, tools: string[]): string[] {
  const safe = new Set<string>()
  for (const tool of tools) {
    if (typeof tool !== "string" || !MCP_TOOL_NAME_PATTERN.test(tool) || tool.includes("..")) {
      log.warn(`Rejected unsafe MCP tool name from ${serverName}: ${String(tool)}`)
      continue
    }
    safe.add(tool)
  }
  return Array.from(safe)
}

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
    const sanitized = sanitizeMcpServerConfig(name, config)
    const servers = this.getAllServerConfigs()
    servers[name] = sanitized
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
    assertValidServerName(name)
    const servers = this.getAllServerConfigs()
    const existing = servers[name]
    if (!existing) throw new Error(`Server ${name} not found`)
    servers[name] = sanitizeMcpServerConfig(name, { ...existing, ...config }, true)
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
      if (tools) info.tools = sanitizeToolNames(name, tools)
    }
  }

  /**
   * Check if a specific MCP server should be enabled for the given model.
   */
  isServerEnabledForModel(
    serverName: string,
    modelProviderID: string,
    modelID: string,
  ): boolean {
    const info = this.servers.get(serverName)
    if (!info) return false
    return isEnabledForModel(info.config, modelProviderID, modelID)
  }

  /**
   * Get a filtered map of tools that should be available for the given model.
   * Takes the current tools map and disables any tools that come from MCP servers
   * whose `when` conditions don't match the current model.
   *
   * @param modelProviderID - The current model's provider ID (e.g. "anthropic")
   * @param modelID - The current model's ID (e.g. "claude-sonnet-4")
   * @param allTools - The current tools map (tool name → enabled/disabled)
   * @returns A new tools map with non-matching server tools disabled
   */
  getFilteredTools(
    modelProviderID: string,
    modelID: string,
    allTools: Record<string, boolean>,
  ): Record<string, boolean> {
    const result: Record<string, boolean> = {}

    // Determine which servers are enabled for this model
    const disabledServers = new Set<string>()
    for (const [name] of this.servers) {
      if (!this.isServerEnabledForModel(name, modelProviderID, modelID)) {
        disabledServers.add(name)
      }
    }

    // Copy all tool settings but disable tools from non-matching servers
    // MCP tools are typically prefixed with "serverName_" by the opencode server
    for (const [toolName, enabled] of Object.entries(allTools)) {
      let toolEnabled = enabled
      if (!MCP_TOOL_NAME_PATTERN.test(toolName) || toolName.includes("..")) {
        result[toolName] = false
        continue
      }
      if (toolEnabled) {
        // Only check prefix if the tool is currently enabled
        for (const serverName of disabledServers) {
          const prefix = serverName.replace(/[^a-zA-Z0-9_-]/g, "_") + "_"
          if (toolName === serverName || toolName.startsWith(prefix)) {
            toolEnabled = false
            break
          }
        }
      }
      result[toolName] = toolEnabled
    }

    return result
  }

  /**
   * Get a list of all MCP servers, annotated with whether they're enabled
   * for the current model (based on their `when` condition).
   * Useful for UI display.
   */
  getServersForModel(
    modelProviderID: string,
    modelID: string,
  ): Array<McpServerInfo & { enabledForModel: boolean }> {
    return Array.from(this.servers.values()).map((info) => ({
      ...info,
      enabledForModel: this.isServerEnabledForModel(
        info.name,
        modelProviderID,
        modelID,
      ),
    }))
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
      const result = parseJsonc(content)
      if (result.errors.length > 0) {
        log.warn(`Failed to parse OpenCode config at ${configPath}: ${result.errors.map((e) => e.message).join(", ")}`)
        return {}
      }
      const config = result.config
      if (config === null || config === undefined || typeof config !== "object" || Array.isArray(config)) {
        return {}
      }
      return config as Record<string, unknown>
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
        try {
          servers[name] = sanitizeMcpServerConfig(name, serverConfig)
        } catch (err) {
          log.warn(`Ignoring unsafe MCP server config "${name}"`, err)
        }
      }
    }
    return servers
  }

  private isDisabled(config: McpServerConfig): boolean {
    return config.disabled === true || config.enabled === false
  }

  refresh(): void {
    this.loadServers()
  }

  dispose(): void {
    // No persistent connections to clean up - config is managed via VS Code settings
  }
}
