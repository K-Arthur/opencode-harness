import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildDefaultCapabilities, classifyProtocolGeneration } from "../../src/session/serverIdentity.js"

describe("serverIdentity", () => {
  describe("buildDefaultCapabilities", () => {
    it("returns v2 capabilities for 1.18.7", () => {
      const caps = buildDefaultCapabilities("1.18.7")
      assert.equal(caps.supportsReview, true)
      assert.equal(caps.supportsTerminals, true)
      assert.equal(caps.supportsAsyncPrompts, true)
      assert.equal(caps.supportsSessionActions, true)
      assert.equal(caps.supportsV2Permissions, true)
      assert.equal(caps.supportsV2Questions, true)
    })

    it("returns v2 capabilities for 1.17.0", () => {
      const caps = buildDefaultCapabilities("1.17.0")
      assert.equal(caps.supportsTerminals, true)
      assert.equal(caps.supportsAsyncPrompts, true)
      assert.equal(caps.supportsV2Permissions, true)
    })

    it("returns v1 capabilities for pre-1.17", () => {
      const caps = buildDefaultCapabilities("1.16.0")
      assert.equal(caps.supportsTerminals, false)
      assert.equal(caps.supportsAsyncPrompts, false)
      assert.equal(caps.supportsV2Permissions, false)
      assert.equal(caps.supportsV2Questions, false)
    })

    it("returns v1 capabilities for unknown version", () => {
      const caps = buildDefaultCapabilities("0.0.0")
      assert.equal(caps.supportsTerminals, false)
      assert.equal(caps.supportsAsyncPrompts, false)
      assert.equal(caps.evidence?.supportsTerminals?.state, "unsupported")
    })

    it("returns OpenCode 2 defaults independently of its version string", () => {
      const caps = buildDefaultCapabilities("1.18.4", "opencode2")
      assert.equal(caps.supportsSessions, true)
      assert.equal(caps.evidence?.supportsSessions?.state, "supported")
      assert.match(caps.evidence?.supportsSessions?.reason ?? "", /OpenCode 2/)
    })
  })

  it("does not classify future major versions as a known protocol", () => {
    assert.equal(classifyProtocolGeneration("2.0.0"), "unknown")
    assert.equal(classifyProtocolGeneration("v1.18.0"), "v2")
  })
})
