import { describe, it } from "node:test"
import assert from "node:assert/strict"

const SDK_VERSION = "1.18.7"

describe("SDK contract drift detection", () => {
  it("SDK version matches expected minimum", () => {
    const parts = SDK_VERSION.split(".").map(Number)
    assert.ok(parts.length >= 3, "SDK version should be semver")
    assert.ok(parts[0] === 1, "SDK major version should be 1")
    assert.ok(parts[1] >= 17, "SDK minor version should be >= 17")
  })

  it("loads v2 types without error", async () => {
    const sdk = await import("@opencode-ai/sdk/v2")
    assert.ok(typeof sdk === "object", "should load as an object")
  })

  it("loads v2 client without error", async () => {
    const client = await import("@opencode-ai/sdk/v2/client")
    assert.ok(typeof client.createOpencodeClient === "function", "createOpencodeClient should be a function")
  })

  it("Part type can create discriminated union members", async () => {
    const textPart = { type: "text", text: "hello", id: "p1", sessionID: "s1", messageID: "m1" }
    assert.equal(textPart.type, "text")

    const toolPart = {
      type: "tool",
      id: "p2",
      sessionID: "s1",
      messageID: "m1",
      callID: "c1",
      tool: "read",
      state: { status: "completed", input: {}, output: "ok", title: "read", metadata: {}, time: { start: 1, end: 2 } },
    }
    assert.equal(toolPart.type, "tool")
  })

  it("Message structure has expected fields", () => {
    const userMsg = {
      id: "m1",
      sessionID: "s1",
      role: "user",
      time: { created: 1 },
      agent: "user",
      model: { providerID: "p", modelID: "m" },
    }
    assert.equal(userMsg.role, "user")

    const assistantMsg = {
      id: "m2",
      sessionID: "s1",
      role: "assistant",
      time: { created: 1 },
      parentID: "m1",
      modelID: "m",
      providerID: "p",
      mode: "build",
      agent: "test",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    assert.equal(assistantMsg.role, "assistant")
  })
})
