import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "authTokenMigration.ts"), "utf8")

describe("authTokenMigration.ts", () => {
  it("reads SecretStorage before legacy settings", () => {
    assert.ok(source.indexOf("context.secrets.get") < source.indexOf("config.inspect"), "SecretStorage must be checked first")
  })

  it("migrates legacy plaintext settings into SecretStorage", () => {
    assert.ok(source.includes("context.secrets.store"), "legacy tokens must be stored in SecretStorage")
    assert.ok(source.includes("ConfigurationTarget.Global"), "global plaintext fallback must be cleared")
    assert.ok(source.includes("ConfigurationTarget.Workspace"), "workspace plaintext fallback must be cleared")
  })

  it("logs plaintext fallback migration instead of using it silently", () => {
    assert.ok(source.includes("Migrated legacy opencode.serverAuthToken"), "migration must be visible in logs")
  })
})
