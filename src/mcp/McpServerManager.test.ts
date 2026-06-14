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
})
