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
})
