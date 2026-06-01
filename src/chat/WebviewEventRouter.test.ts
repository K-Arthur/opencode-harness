import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { validateWebviewMessage } from "./WebviewMessageValidator"

const source = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")

function blockBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist`)
  const end = source.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return source.slice(start, end)
}

describe("WebviewEventRouter prompt validation", () => {
  it("allows attachment-only send_prompt payloads", () => {
    const handler = blockBetween('[\"send_prompt\"', '[\"change_mode\"')

    assert.ok(handler.includes("hasPromptContent"), "send_prompt handler must accept text or attachments")
    assert.equal(validate({ attachments: [{ data: "abc", mimeType: "image/png" }] }, "send_prompt"), true)
    assert.equal(validate({ text: "   " }, "send_prompt"), false)
  })

  it("allows attachment-only steer prompts", () => {
    assert.equal(validate({ attachments: [{ data: "abc", mimeType: "image/png" }] }, "send_steer_prompt"), true)
    assert.equal(validate({ text: "   " }, "send_steer_prompt"), false)
  })

  it("allows fork_session at turnIndex 0", () => {
    assert.equal(validate({ turnIndex: 0 }, "fork_session"), true)
    assert.equal(validate({ turnIndex: -1 }, "fork_session"), false)
  })

  it("allows show_diff to resolve pending edits by diffId", () => {
    assert.equal(validate({ diffId: "diff-1" }, "show_diff"), true)
    assert.equal(validate({ filePath: "a.ts", proposedContent: "next" }, "show_diff"), true)
    assert.equal(validate({ filePath: "a.ts" }, "show_diff"), false)
  })
})

describe("WebviewEventRouter context usage routing", () => {
  it("registers a get_context_usage handler instead of only allowing the message type", () => {
    assert.match(
      source,
      /\["get_context_usage",\s*\(/,
      "get_context_usage must have a webview handler that posts the latest usage back to the frontend",
    )
  })
})

describe("WebviewEventRouter host state sync", () => {
  it("webview_ready asks ChatProvider to push full init state directly", () => {
    const handler = blockBetween('["webview_ready"', '["init_ack"')

    assert.ok(
      handler.includes("this.opts.pushAllStateToWebview()"),
      "webview_ready must call the host pushAllStateToWebview callback so init_state is sent immediately",
    )
    assert.ok(
      !handler.includes("statePush.pushAllStateToWebview()"),
      "webview_ready must not send a push_all_state message back to the webview",
    )
  })

  it("request_state_sync asks ChatProvider to push visible host state directly", () => {
    const handler = blockBetween('["request_state_sync"', '["stream_ack"')

    assert.ok(
      handler.includes("this.opts.pushVisibleStateToWebview()"),
      "request_state_sync must call the host pushVisibleStateToWebview callback",
    )
    assert.ok(
      !handler.includes("this.pushVisibleStateToWebview()"),
      "request_state_sync must not send another push_visible_state roundtrip",
    )
  })
})

describe("WebviewMessageValidator MCP config", () => {
  it("rejects unsafe MCP server names and command strings", () => {
    assert.equal(validate({ name: "safe-server", config: { command: "node", args: ["server.js"] } }, "add_mcp_server"), true)
    assert.equal(validate({ name: "../bad", config: { command: "node" } }, "add_mcp_server"), false)
    assert.equal(validate({ name: "safe", config: { command: "node; rm -rf ." } }, "add_mcp_server"), false)
  })

  it("rejects non-loopback HTTP MCP URLs", () => {
    assert.equal(validate({ name: "remote", config: { url: "https://mcp.example.com" } }, "add_mcp_server"), true)
    assert.equal(validate({ name: "local", config: { url: "http://localhost:8080" } }, "add_mcp_server"), true)
    assert.equal(validate({ name: "remote", config: { url: "http://mcp.example.com" } }, "add_mcp_server"), false)
  })
})

function validate(msg: Record<string, unknown>, msgType: string): boolean {
  return validateWebviewMessage(msg, msgType, {
    hasPromptContent: (payload) => {
      const text = typeof payload.text === "string" ? payload.text : ""
      return text.trim().length > 0 || (Array.isArray(payload.attachments) && payload.attachments.length > 0)
    },
    isValidThemeConfigPayload: (theme) => theme !== null,
    warn: () => {},
  })
}
