import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationSource = readFileSync(path.join(__dirname, "..", "..", "src", "migrations", "authTokenMigration.ts"), "utf8")
const extensionSource = readFileSync(path.join(__dirname, "..", "..", "src", "extension.ts"), "utf8")

describe("T1.7 — Auth token migration module", () => {
  it("creates authTokenMigration.ts with resolveAuthToken export", () => {
    assert.ok(migrationSource.includes("export async function resolveAuthToken("), "must export resolveAuthToken")
  })

  it("checks SecretStorage first for existing token", () => {
    assert.ok(migrationSource.includes("const SECRET_KEY = \"opencode-harness.serverAuthToken\""), "must define the secret key")
    assert.ok(migrationSource.includes("context.secrets.get(SECRET_KEY)"), "must check secrets first")
  })

  it("returns secrets token directly without reading settings", () => {
    assert.ok(migrationSource.includes("if (secretsToken) return secretsToken"), "must return early if secrets has token")
  })

  it("migrates legacy settings token to SecretStorage", () => {
    assert.ok(migrationSource.includes("context.secrets.store(SECRET_KEY"), "must store in secrets")
    assert.ok(migrationSource.includes("config.update(\"serverAuthToken\", undefined, vscode.ConfigurationTarget.Global"), "must clear global legacy setting")
    assert.ok(migrationSource.includes("config.update(\"serverAuthToken\", undefined, vscode.ConfigurationTarget.Workspace"), "must clear workspace legacy setting")
  })

  it("returns empty string when neither secrets nor settings has token", () => {
    assert.ok(migrationSource.includes("return legacyToken"), "must return legacy token (empty string when absent)")
  })

  it("extension.ts imports from migration module", () => {
    assert.ok(extensionSource.includes("import { resolveAuthToken } from \"./migrations/authTokenMigration\""), "must import from migration module")
  })

  it("extension.ts no longer has inline resolveAuthToken function", () => {
    const inlineFn = extensionSource.match(/async function resolveAuthToken\(/)
    assert.ok(!inlineFn, "must not have inline resolveAuthToken in extension.ts")
  })
})
