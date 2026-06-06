import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const providerManagementSource = readFileSync(
  path.join(__dirname, "../chat/ProviderManagementService.ts"),
  "utf8",
)

describe("provider config commands", () => {
  it("does not call a nonexistent SessionManager.updateConfig API", () => {
    assert.ok(
      !providerManagementSource.includes(".updateConfig("),
      "provider management must not call SessionManager.updateConfig",
    )
  })

  it("persists provider changes through ProviderConfigManager", () => {
    assert.ok(
      providerManagementSource.includes("providerConfigManager.upsertConfig"),
      "provider management should write provider changes through ProviderConfigManager",
    )
  })
})
