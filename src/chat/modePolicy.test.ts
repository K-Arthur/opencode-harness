import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const policyPath = resolve(__dirname, "modePolicy.ts")

void describe("modePolicy", () => {
  void it("allows plan document writes but rejects shell commands that only look like plan document writes", async () => {
    assert.equal(existsSync(policyPath), true, "mode policy must be centralized in src/chat/modePolicy.ts")

    const { resolvePlanPermission } = await import("./modePolicy")

    assert.equal(
      resolvePlanPermission({ type: "write", pattern: ".opencode/plans/feature.md" }),
      "once",
      "plan mode should allow edits to its own plan markdown files",
    )
    assert.equal(
      resolvePlanPermission({ type: "bash", pattern: ".opencode/plans/feature.md" }),
      "reject",
      "plan-looking paths must not make shell permissions safe",
    )
    assert.equal(
      resolvePlanPermission({ type: "external_directory", pattern: ".opencode/plans/feature.md" }),
      "reject",
      "plan-looking paths must not make external-directory permissions safe",
    )
  })

  void it("normalizes legacy normal mode and rejects unknown modes", async () => {
    assert.equal(existsSync(policyPath), true, "mode policy must be centralized in src/chat/modePolicy.ts")

    const { normalizeSessionMode } = await import("./modePolicy")

    assert.equal(normalizeSessionMode("normal"), "build")
    assert.equal(normalizeSessionMode("build"), "build")
    assert.equal(normalizeSessionMode("plan"), "plan")
    assert.equal(normalizeSessionMode("auto"), "auto")
    assert.equal(normalizeSessionMode("oops"), null)
    assert.equal(normalizeSessionMode(undefined), null)
  })
})
