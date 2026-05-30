import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "security.ts"), "utf8")

describe("security.ts hardening", () => {
  it("scans the full content for prompt injection markers", () => {
    assert.ok(source.includes("normalizeSecurityScanText"), "must normalize text before scanning")
    assert.ok(!source.includes("slice(0, 10240)"), "must not limit prompt-injection scanning to the first 10KB")
  })

  it("normalizes common homoglyphs before injection matching", () => {
    assert.ok(source.includes("SECURITY_SCAN_CHAR_MAP"), "must include a homoglyph map")
    assert.ok(source.includes("\\u043E"), "must normalize Cyrillic o")
  })

  it("covers common credential file names", () => {
    for (const pattern of [".npmrc", ".netrc", ".pgpass", ".git-credentials", "id_ed25519", ".tfvars"]) {
      assert.ok(source.includes(pattern), `missing sensitive pattern for ${pattern}`)
    }
  })

  it("requires HTTPS for non-loopback remote server URLs", () => {
    assert.ok(source.includes("Remote server URLs must use HTTPS"), "non-loopback HTTP must be rejected")
    assert.ok(source.includes('parsed.hostname === "localhost"'), "localhost HTTP must remain allowed for dev")
  })
})
