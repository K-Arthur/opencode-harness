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

describe("WebviewEventRouter dead-wire guard", () => {
  // The inbound gate rejects any message whose type isn't in VALID_WEBVIEW_TYPES
  // *before* dispatch. A handler that isn't also allowlisted is therefore dead
  // (the bug that silently disabled the prompt-template feature). Enforce that
  // every handler-mapped type is allowlisted so that class of bug can't recur.
  const validSet = blockBetween("VALID_WEBVIEW_TYPES = new Set([", "])")
  const allowed = new Set(
    Array.from(validSet.matchAll(/"([a-z_]+)"/g), (m) => m[1]),
  )
  const handlerKeys = Array.from(
    source.matchAll(/\["([a-z_]+)",\s*(?:async\s*)?\(/g),
    (m) => m[1] as string,
  )

  it("registers at least the known template + context handlers", () => {
    for (const t of ["save_template", "list_templates", "delete_template", "get_context_usage"]) {
      assert.ok(handlerKeys.includes(t), `expected a handler for ${t}`)
    }
  })

  it("allowlists every type that has a webview handler", () => {
    const dead = [...new Set(handlerKeys)].filter((t) => !allowed.has(t))
    assert.deepEqual(dead, [], `handlers present but not in VALID_WEBVIEW_TYPES (dead wires): ${dead.join(", ")}`)
  })

  it("explicitly allowlists the prompt-template messages", () => {
    for (const t of ["save_template", "list_templates", "delete_template"]) {
      assert.ok(allowed.has(t), `${t} must be in VALID_WEBVIEW_TYPES or it is rejected before dispatch`)
    }
  })
})

describe("WebviewEventRouter subagent routing", () => {
  it("requires subagent identifiers on detail, cancel, and read messages", () => {
    assert.equal(validate({ sessionId: "tab-1", subagentId: "child-1" }, "get_subagent_detail"), true)
    assert.equal(validate({ sessionId: "tab-1" }, "get_subagent_detail"), false)
    assert.equal(validate({ subagentId: "child-1" }, "cancel_subagent"), true)
    assert.equal(validate({}, "cancel_subagent"), false)
    assert.equal(validate({ sessionId: "tab-1", subagentId: "child-1" }, "mark_subagent_read"), true)
    assert.equal(validate({ sessionId: "tab-1" }, "mark_subagent_read"), false)
  })

  it("authorizes subagent detail and cancel against the active tab child-session list", () => {
    const detailHandler = blockBetween('["get_subagent_detail"', '["cancel_subagent"')
    const cancelHandler = blockBetween('["cancel_subagent"', '["mark_subagent_read"')

    assert.ok(
      detailHandler.includes("findAuthorizedSubagentChild"),
      "detail requests must prove the requested subagent belongs to the active tab before loading messages",
    )
    assert.ok(
      detailHandler.indexOf("findAuthorizedSubagentChild") < detailHandler.indexOf("getSessionDetails"),
      "detail authorization must happen before getSessionDetails",
    )
    assert.ok(
      cancelHandler.includes("findAuthorizedSubagentChild"),
      "cancel requests must prove the requested subagent belongs to the active tab before aborting",
    )
    assert.ok(
      cancelHandler.indexOf("findAuthorizedSubagentChild") < cancelHandler.indexOf("abortSession"),
      "cancel authorization must happen before abortSession",
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

describe("WebviewEventRouter switch_tab routing", () => {
  // Regression: switch_tab used a non-silent setActive, which echoed
  // active_session_changed back to the same webview that had already
  // switched itself locally. Under rapid tab switching the echo for an
  // earlier switch could arrive after the user had moved to a third tab,
  // forcing a visible snap back to the stale, superseded tab.
  it("calls setActive with silent: true so the webview's own switch is not echoed back", () => {
    const handler = blockBetween('["switch_tab"', '["accept_diff"')

    assert.ok(
      /sessionStore\.setActive\(\s*sessionId\s*,\s*\{\s*silent:\s*true\s*\}\s*\)/.test(handler),
      "switch_tab must call sessionStore.setActive(sessionId, { silent: true })",
    )
  })
})

describe("WebviewEventRouter copy_text routing", () => {
  // Webviews frequently lack navigator.clipboard; copy actions must round-trip
  // through the host's vscode.env.clipboard instead.
  it("accepts copy_text with a non-empty string and rejects anything else", () => {
    assert.equal(validate({ text: "npm test" }, "copy_text"), true)
    assert.equal(validate({}, "copy_text"), false)
    assert.equal(validate({ text: "   " }, "copy_text"), false)
    assert.equal(validate({ text: 42 }, "copy_text"), false)
  })

  it("registers a copy_text handler that writes to the host clipboard", () => {
    assert.match(
      source,
      /\["copy_text",\s*(async\s*)?\(/,
      "copy_text must have a webview handler",
    )
    const handler = blockBetween('["copy_text"', "}],")
    assert.ok(handler.includes("clipboard.writeText"), "copy_text handler must write to vscode.env.clipboard")
  })
})

describe("WebviewEventRouter subagent session navigation", () => {
  it("requires childSessionId on open_subagent_session", () => {
    assert.equal(validate({ childSessionId: "child-1" }, "open_subagent_session"), true)
    assert.equal(validate({}, "open_subagent_session"), false)
    assert.equal(validate({ childSessionId: 7 }, "open_subagent_session"), false)
  })

  it("registers an open_subagent_session handler that resumes the child session as a tab", () => {
    assert.match(
      source,
      /\["open_subagent_session",\s*(async\s*)?\(/,
      "open_subagent_session must have a webview handler",
    )
    const handler = blockBetween('["open_subagent_session"', "}],")
    assert.ok(handler.includes("importOneServerSession"), "handler must import the server session locally")
    assert.ok(handler.includes("handleResumeSession"), "handler must resume the imported session as a tab")
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
