import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "package.json"), "utf8"))
const properties = pkg.contributes.configuration.properties

describe("package configuration schema", () => {
  it("documents legacy MCP servers with stdio and remote HTTP fields", () => {
    const schema = properties["opencode.mcpServers"]
    assert.ok(schema, "opencode.mcpServers must be contributed for discoverability")
    const serverProps = schema.additionalProperties.properties
    for (const key of ["type", "command", "args", "env", "url", "headers", "disabled", "enabled"]) {
      assert.ok(serverProps[key], `mcp server schema must document ${key}`)
    }
  })

  it("exposes empty-session cleanup and open-tab restore settings", () => {
    assert.ok(properties["opencode.sessions.emptySessionTtlMinutes"])
    assert.ok(properties["opencode.sessions.cleanupIntervalMinutes"])
    assert.ok(properties["opencode.sessions.restoreOpenTabs"])
  })
})
