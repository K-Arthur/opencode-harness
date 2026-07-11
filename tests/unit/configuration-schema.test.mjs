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

  it("exposes the autoInstall setting with prompt/auto/off and a prompt default", () => {
    const schema = properties["opencode.autoInstall"]
    assert.ok(schema, "opencode.autoInstall must be contributed so users can control CLI install")
    assert.deepEqual(schema.enum, ["prompt", "auto", "off"], "autoInstall must offer prompt/auto/off")
    assert.equal(schema.default, "prompt", "autoInstall must default to prompt-once")
  })

  it("exposes ANSI rendering for tool output as an opt-in setting", () => {
    const schema = properties["opencode.toolOutput.renderAnsi"]
    assert.ok(schema, "opencode.toolOutput.renderAnsi must be contributed")
    assert.equal(schema.type, "boolean")
    assert.equal(schema.scope, "window")
    assert.equal(schema.default, false)
  })

  it("exposes role-based model routing and masking controls", () => {
    const roleSchema = properties["opencode.roleModels"]
    assert.ok(roleSchema, "opencode.roleModels must be contributed for orchestration routing")
    assert.deepEqual(Object.keys(roleSchema.properties), ["planning", "implementation", "review", "debugging"])
    assert.equal(roleSchema.additionalProperties, false)

    assert.equal(properties["opencode.masking.enabled"].default, true)
    assert.equal(properties["opencode.masking.maxPromptTokens"].type, "number")
    assert.equal(properties["opencode.masking.reserveTokens"].type, "number")
    assert.equal(properties["opencode.masking.exclude"].type, "array")
  })

  it("contributes the Install CLI command", () => {
    const commands = pkg.contributes.commands
    assert.ok(
      commands.some((c) => c.command === "opencode-harness.installCli"),
      "must contribute opencode-harness.installCli for manual installs",
    )
  })
})
