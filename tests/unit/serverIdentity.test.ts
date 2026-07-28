import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildDefaultCapabilities } from "../../src/session/serverIdentity.js"

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
    })
  })
})
