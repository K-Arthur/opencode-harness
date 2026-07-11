import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

// Behavioural tests for the slash command handler — exercises MCP namespace
// resolution (/jcodemunch triage → /triage) using the real handler with JSDOM.

let posted: Array<Record<string, unknown>>
let handler: any
let serverCommands: Array<{ name: string; source?: string; origin?: string }>
let systemMessages: Array<{ sessionId: string; message: string }>
let createNewTabCalls: Array<{ title?: string; options?: { ephemeral?: boolean } }>

beforeEach(async () => {
  const dom = new JSDOM(`<!doctype html><body></body>`)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement

  posted = []
  systemMessages = []
  createNewTabCalls = []
  serverCommands = [
    { name: "triage", source: "mcp", origin: "jcodemunch" },
    { name: "index_folder", source: "mcp", origin: "jcodemunch" },
    { name: "review-pr", source: "mcp", origin: "github-mcp" },
  ]

  const { createSlashCommandHandler } = await import("./slashCommands")
  handler = createSlashCommandHandler({
    stateManager: {
      getActiveSession: () => ({ id: "tab-1", isStreaming: false }),
      setSessionModel: () => {},
      setGlobalModel: () => {},
    },
    vscode: {
      postMessage: (msg: Record<string, unknown>) => { posted.push(msg) },
    },
    modelDropdown: { setCurrentModel: () => {}, open: () => {} },
    commandsModal: { open: () => {} },
    clearPromptInput: () => {},
    createNewTab: (title?: string, options?: { ephemeral?: boolean }) => {
      createNewTabCalls.push({ title, options })
    },
    showSystemMessage: (sessionId: string, message: string) => { systemMessages.push({ sessionId, message }) },
    syncModelViews: () => {},
    renderQueue: () => {},
    getServerCommands: () => serverCommands,
  })
})

describe("slash command handler — temporary sessions", () => {
  it("creates an ephemeral tab for /temp", () => {
    handler.runSlashCommandText("/temp", { id: "tab-1", isStreaming: false })

    assert.deepEqual(createNewTabCalls, [{ title: "Temporary chat", options: { ephemeral: true } }])
  })

  it("creates an ephemeral tab for /temporary", () => {
    handler.runSlashCommandText("/temporary", { id: "tab-1", isStreaming: false })

    assert.deepEqual(createNewTabCalls, [{ title: "Temporary chat", options: { ephemeral: true } }])
  })
})

function lastExec(): Record<string, unknown> {
  const msg = posted.find((m) => m.type === "execute_command")
  assert.ok(msg, "expected an execute_command message")
  return msg
}

describe("slash command handler — MCP namespace resolution", () => {
  it("rewrites /server tool to /tool when server+tool are known MCP commands", () => {
    handler.runSlashCommandText("/jcodemunch triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage", "must rewrite to the canonical tool command")
    assert.equal(msg.arguments, "", "no remaining args")
  })

  it("preserves extra arguments after the tool name", () => {
    handler.runSlashCommandText("/jcodemunch triage my-issue", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
    assert.equal(msg.arguments, "my-issue")
  })

  it("handles server names case-insensitively", () => {
    handler.runSlashCommandText("/JCODEMUNCH Triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
  })

  it("forwards the command as-is when the prefix is not a known MCP origin", () => {
    handler.runSlashCommandText("/unknown-server triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/unknown-server", "must not rewrite unknown prefixes")
    assert.equal(msg.arguments, "triage")
  })

  it("forwards as-is when the tool name doesn't belong to that MCP server", () => {
    handler.runSlashCommandText("/jcodemunch review-pr", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/jcodemunch")
    assert.equal(msg.arguments, "review-pr")
  })

  it("still forwards a plain server command without rewriting", () => {
    handler.runSlashCommandText("/triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
    assert.equal(msg.arguments, "")
  })

  it("does not crash when getServerCommands is not provided", async () => {
    const { createSlashCommandHandler } = await import("./slashCommands")
    const localPosted: Array<Record<string, unknown>> = []
    const h = createSlashCommandHandler({
      stateManager: {
        getActiveSession: () => ({ id: "tab-1", isStreaming: false }),
        setSessionModel: () => {},
        setGlobalModel: () => {},
      },
      vscode: { postMessage: (m: Record<string, unknown>) => { localPosted.push(m) } },
      modelDropdown: { setCurrentModel: () => {}, open: () => {} },
      commandsModal: { open: () => {} },
      clearPromptInput: () => {},
      createNewTab: () => {},
      showSystemMessage: () => {},
      syncModelViews: () => {},
      renderQueue: () => {},
      // getServerCommands intentionally omitted
    })
    h.runSlashCommandText("/jcodemunch triage", { id: "tab-1", isStreaming: false })
    const msg = localPosted.find((m) => m.type === "execute_command")
    assert.ok(msg, "must still forward the command")
    assert.equal(msg!.command, "/jcodemunch")
  })
})

describe("slash command handler — non-blocking guidance for unknown commands", () => {
  it("shows a tip when the command is not in the cached server list", () => {
    handler.runSlashCommandText("/totally-unknown", { id: "tab-1", isStreaming: false })
    const tip = systemMessages.find((m) => m.message.includes("/commands"))
    assert.ok(tip, "must show a guidance tip pointing to /commands")
    // Must still forward the command (non-blocking)
    const msg = lastExec()
    assert.ok(msg, "must still forward the unknown command to the host")
  })

  it("does NOT show a tip when the command IS a known remote command", () => {
    handler.runSlashCommandText("/triage", { id: "tab-1", isStreaming: false })
    const tip = systemMessages.find((m) => m.message.includes("/commands"))
    assert.equal(tip, undefined, "must not show a tip for known server commands")
  })

  it("does NOT show a tip when MCP namespace resolution succeeds", () => {
    handler.runSlashCommandText("/jcodemunch triage", { id: "tab-1", isStreaming: false })
    const tip = systemMessages.find((m) => m.message.includes("/commands"))
    assert.equal(tip, undefined, "must not show a tip after successful namespace rewrite")
  })
})

describe("slash command handler — colon namespace syntax (/prefix:command)", () => {
  it("rewrites /jcodemunch:triage -> /triage", () => {
    handler.runSlashCommandText("/jcodemunch:triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
    assert.equal(msg.arguments, "")
  })

  it("rewrites /jcodemunch:triage with trailing args -> /triage with args", () => {
    handler.runSlashCommandText("/jcodemunch:triage my-issue", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
    assert.equal(msg.arguments, "my-issue")
  })

  it("rewrites /wrongprefix:triage -> /triage via broad match", () => {
    handler.runSlashCommandText("/wrongprefix:triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
  })

  it("does NOT show a tip after successful colon namespace rewrite", () => {
    handler.runSlashCommandText("/jcodemunch:triage", { id: "tab-1", isStreaming: false })
    const tip = systemMessages.find((m) => m.message.includes("/commands"))
    assert.equal(tip, undefined, "must not tip after successful rewrite")
  })
})

describe("slash command handler — @namespace /command hierarchical syntax", () => {
  it("rewrites @jcodemunch /triage -> /triage", () => {
    handler.runSlashCommandText("@jcodemunch /triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
    assert.equal(msg.arguments, "")
  })

  it("preserves arguments after @namespace /command", () => {
    handler.runSlashCommandText("@jcodemunch /triage my-issue", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
    assert.equal(msg.arguments, "my-issue")
  })

  it("handles namespace case-insensitively", () => {
    handler.runSlashCommandText("@JCODEMUNCH /Triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage")
  })

  it("forwards as-is when the namespace does not match any origin", () => {
    handler.runSlashCommandText("@wrongns /triage", { id: "tab-1", isStreaming: false })
    const msg = lastExec()
    assert.equal(msg.command, "/triage", "must forward the command as-is")
  })

  it("shows a tip when @namespace /command does not match", () => {
    handler.runSlashCommandText("@wrongns /totally-unknown", { id: "tab-1", isStreaming: false })
    const tip = systemMessages.find((m) => m.message.includes("/commands"))
    assert.ok(tip, "must show a guidance tip for unknown @namespace /command")
  })

  it("does NOT show a tip when @namespace /command resolves successfully", () => {
    handler.runSlashCommandText("@jcodemunch /triage", { id: "tab-1", isStreaming: false })
    const tip = systemMessages.find((m) => m.message.includes("/commands"))
    assert.equal(tip, undefined, "must not tip after successful @namespace resolution")
  })
})
