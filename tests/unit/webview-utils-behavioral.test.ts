import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("createWebviewId", () => {
  it("generates IDs with prefix", async () => {
    const { createWebviewId } = await import("../../src/chat/webview/utils")
    const id = createWebviewId("user")
    assert.ok(id.startsWith("user-"), `ID should start with "user-", got: ${id}`)
  })

  it("generates unique IDs", async () => {
    const { createWebviewId } = await import("../../src/chat/webview/utils")
    const ids = new Set(Array.from({ length: 100 }, () => createWebviewId("test")))
    assert.equal(ids.size, 100, "all 100 IDs should be unique")
  })

  it("works without crypto.randomUUID (fallback path)", async () => {
    const { createWebviewId } = await import("../../src/chat/webview/utils")
    const orig = (globalThis.crypto as any).randomUUID
    try {
      delete (globalThis.crypto as any).randomUUID
      const id = createWebviewId("fallback")
      assert.ok(id.startsWith("fallback-"))
      assert.ok(id.length > "fallback-".length)
    } finally {
      if (orig) (globalThis.crypto as any).randomUUID = orig
    }
  })
})
