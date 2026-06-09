import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { McpToolsChangedHandler } from "./McpToolsChangedHandler"
import type { NormalizerContext } from "./types"

const ctx: NormalizerContext = {
  partTextLengths: new Map(),
  partMessageIds: new Map(),
  partSessionIds: new Map(),
  partTypes: new Map(),
  partStatusKeys: new Map(),
  messageRoles: new Map(),
  toolStatuses: new Map(),
  toolInputs: new Map(),
  toolOutputs: new Map(),
  toolStartedIds: new Set(),
  seenUnknownTypes: new Set(),
  isAssistantMessage: () => false,
  clearMessageTracking: () => {},
  rememberPart: () => {},
}

describe("McpToolsChangedHandler", () => {
  const handler = new McpToolsChangedHandler()

  it("claims mcp.tools.changed", () => {
    assert.equal(handler.canHandle("mcp.tools.changed"), true)
  })

  it("does not claim unrelated events", () => {
    assert.equal(handler.canHandle("session.status"), false)
    assert.equal(handler.canHandle("server.connected"), false)
    assert.equal(handler.canHandle("mcp.browser.open.failed"), false)
  })

  it("emits mcp_tools_changed with the server name from properties", () => {
    const out = handler.handle(
      { type: "mcp.tools.changed", properties: { server: "github-mcp" } },
      ctx,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "mcp_tools_changed")
    assert.deepEqual(out[0]!.data, { server: "github-mcp" })
  })

  it("tolerates missing properties.server", () => {
    const out = handler.handle({ type: "mcp.tools.changed" }, ctx)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "mcp_tools_changed")
    assert.deepEqual(out[0]!.data, { server: undefined })
  })
})
