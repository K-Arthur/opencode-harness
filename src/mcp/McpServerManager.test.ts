import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "McpServerManager.ts"), "utf8")

describe("McpServerManager.ts", () => {
  it("loads MCP servers from OpenCode config paths", () => {
    assert.ok(source.includes("OPENCODE_CONFIG"), "must respect OPENCODE_CONFIG")
    assert.ok(source.includes(".config"), "must read the default XDG config location")
    assert.ok(source.includes("opencode.json"), "must use OpenCode config files")
    assert.ok(source.includes("config.mcp"), "must read the OpenCode mcp object")
  })

  it("falls back to the legacy VS Code mcpServers setting", () => {
    assert.ok(source.includes("getLegacyVsCodeServers"), "must keep legacy setting fallback")
    assert.ok(source.includes("opencode.mcpServers"), "must know the legacy setting key")
  })

  it("opens and writes the primary OpenCode config file", () => {
    assert.ok(source.includes("openPrimaryConfigFile"), "must expose an action to open the config file")
    assert.ok(source.includes("writeFile"), "must write server edits to disk")
    assert.ok(source.includes("config.mcp = servers") && source.includes("\\\"mcp\\\""), "new config files must contain an mcp object")
  })

  it("validates MCP server config before persisting or loading it", () => {
    assert.ok(source.includes("sanitizeMcpServerConfig"), "must sanitize server config")
    assert.ok(source.includes("assertValidServerName"), "must validate server names")
    assert.ok(source.includes("MCP_COMMAND_PATTERN"), "must reject unsafe command strings")
    assert.ok(source.includes("MCP remote server URL must use HTTPS"), "must reject insecure remote MCP URLs")
  })

  it("requires a url for http/sse/remote server types", () => {
    assert.ok(
      source.includes("MCP") && source.includes("server must include a url"),
      "must reject http/sse/remote servers without a url",
    )
    assert.ok(source.includes("isRemoteType"), "must distinguish remote types from stdio")
  })

  it("sanitizes tool names reported by MCP servers", () => {
    assert.ok(source.includes("sanitizeToolNames"), "must sanitize tool names")
    assert.ok(source.includes("MCP_TOOL_NAME_PATTERN"), "must define a safe tool-name pattern")
    assert.ok(source.includes("Rejected unsafe MCP tool name"), "must log rejected unsafe tool names")
  })

  it("accepts command as string | string[] (opencode array form)", () => {
    assert.ok(source.includes("typeof rawCommand === \"string\""), "must accept string command")
    assert.ok(source.includes("Array.isArray(rawCommand)"), "must accept array command")
    assert.ok(source.includes("binary = rawCommand[0]"), "must treat first array element as binary")
    assert.ok(source.includes("argsFromCommand = rawCommand.slice(1)"), "must merge rest into args")
  })

  it("validates every element in command array with MCP_COMMAND_PATTERN", () => {
    assert.ok(source.includes("for (let i = 0; i < rawCommand.length; i++)"), "must iterate array elements")
    assert.ok(source.includes("MCP_COMMAND_PATTERN.test(elem)"), "must validate each element")
    assert.ok(source.includes("contains unsafe characters"), "must reject unsafe array elements")
  })

  it("accepts opencode aliases: environment → env, enabled → !disabled", () => {
    assert.ok(source.includes("environment → env"), "must accept environment alias")
    assert.ok(source.includes("enabled → !disabled"), "must accept enabled alias")
  })

  it("validates cwd field for local MCP servers (v1.17.4)", () => {
    assert.ok(source.includes("assertCwd"), "must validate cwd field")
    assert.ok(source.includes("cwd must be a string"), "must check cwd type")
    assert.ok(source.includes("cwd exceeds maximum length"), "must enforce cwd length limit")
  })

  it("validates timeout field for MCP servers (v1.17.4+)", () => {
    assert.ok(source.includes("assertTimeout"), "must validate timeout field")
    assert.ok(source.includes("timeout must be a positive number"), "must check timeout type and positivity")
    assert.ok(source.includes("timeout exceeds maximum"), "must enforce timeout cap")
  })

  it("validates oauth field for remote MCP servers (v1.15.9/v1.17.4)", () => {
    assert.ok(source.includes("assertOAuthConfig"), "must validate oauth field")
    assert.ok(source.includes("oauth must be an object or false"), "must check oauth type")
    assert.ok(source.includes("oauth.clientId must be a safe string"), "must validate clientId")
    assert.ok(source.includes("oauth.clientSecret must be a safe string"), "must validate clientSecret")
    assert.ok(source.includes("oauth.scope must be a safe string"), "must validate scope")
    assert.ok(source.includes("oauth.callbackPort must be a valid port number"), "must validate callbackPort")
    assert.ok(source.includes("oauth.redirectUri must be a valid URL"), "must validate redirectUri")
  })
})
