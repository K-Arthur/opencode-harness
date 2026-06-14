import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveMcpNamespace, type RemoteCommandInfo } from "./slash-commands"

const CMD_LIST: RemoteCommandInfo[] = [
  { name: "triage", source: "mcp", origin: "jcodemunch" },
  { name: "index_folder", source: "mcp", origin: "jcodemunch" },
  { name: "review-pr", source: "mcp", origin: "github-mcp" },
  { name: "cost-report", source: "server" },
  { name: "deploy", source: "skill" },
]

describe("resolveMcpNamespace", () => {
  it("rewrites /server tool -> /tool when server+tool match", () => {
    const result = resolveMcpNamespace("/jcodemunch", "triage", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })

  it("preserves remaining arguments after the tool name", () => {
    const result = resolveMcpNamespace("/jcodemunch", "triage my-issue details", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "my-issue details" })
  })

  it("handles server names case-insensitively", () => {
    const result = resolveMcpNamespace("/JCoDeMunch", "Triage", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })

  it("matches when multiple MCP servers exist with different tools", () => {
    const result = resolveMcpNamespace("/github-mcp", "review-pr", CMD_LIST)
    assert.deepEqual(result, { command: "/review-pr", arguments: "" })
  })

  it("returns null when the prefix is not an MCP server origin", () => {
    const result = resolveMcpNamespace("/unknown-server", "triage", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null when the tool name is not from that MCP server", () => {
    // jcodemunch is a real origin, but review-pr belongs to github-mcp
    const result = resolveMcpNamespace("/jcodemunch", "review-pr", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null for non-MCP sources (server/skill commands)", () => {
    // cost-report is source "server" — namespace prefixing doesn't apply
    const result = resolveMcpNamespace("/server", "cost-report", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null when no arguments are provided", () => {
    const result = resolveMcpNamespace("/jcodemunch", "", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null when only whitespace arguments are provided", () => {
    const result = resolveMcpNamespace("/jcodemunch", "   ", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null for an empty command list", () => {
    const result = resolveMcpNamespace("/jcodemunch", "triage", [])
    assert.equal(result, null)
  })

  it("handles commands without a leading slash", () => {
    const result = resolveMcpNamespace("jcodemunch", "triage", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })

  it("deduplicates ambiguous matches by picking the first", () => {
    const dupes: RemoteCommandInfo[] = [
      { name: "triage", source: "mcp", origin: "jcodemunch" },
      { name: "triage", source: "mcp", origin: "jcodemunch" },
    ]
    const result = resolveMcpNamespace("/jcodemunch", "triage", dupes)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })
})

describe("resolveMcpNamespace — colon syntax (/prefix:command)", () => {
  it("rewrites /jcodemunch:triage -> /triage (exact MCP match)", () => {
    const result = resolveMcpNamespace("/jcodemunch:triage", "", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })

  it("rewrites /jcodemunch:triage with args -> /triage with args", () => {
    const result = resolveMcpNamespace("/jcodemunch:triage", "my-issue", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "my-issue" })
  })

  it("broad-matches /wrongprefix:triage -> /triage (skill/server match)", () => {
    // The prefix doesn't match any MCP origin, but 'triage' exists as an MCP
    // command under a different origin. The broad match rewrites anyway.
    const result = resolveMcpNamespace("/wrongprefix:triage", "", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })

  it("broad-matches /namespace:deploy -> /deploy (skill command)", () => {
    const result = resolveMcpNamespace("/myagent:deploy", "", CMD_LIST)
    assert.deepEqual(result, { command: "/deploy", arguments: "" })
  })

  it("handles colon syntax case-insensitively", () => {
    const result = resolveMcpNamespace("/JCODEMUNCH:Triage", "", CMD_LIST)
    assert.deepEqual(result, { command: "/triage", arguments: "" })
  })

  it("returns null when the suffix matches no known command", () => {
    const result = resolveMcpNamespace("/jcodemunch:nonexistent", "", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null for a trailing colon with no suffix", () => {
    const result = resolveMcpNamespace("/jcodemunch:", "", CMD_LIST)
    assert.equal(result, null)
  })

  it("returns null for a leading colon (no prefix)", () => {
    const result = resolveMcpNamespace("/:triage", "", CMD_LIST)
    assert.equal(result, null)
  })

  it("does NOT rewrite a command whose only colon is in a local command name", () => {
    // /diagnose:generation is a local command — it would be resolved before
    // resolveMcpNamespace is called. But if it somehow reaches here, we should
    // not rewrite it to /generation unless that's a real remote command.
    const localOnly: RemoteCommandInfo[] = []
    const result = resolveMcpNamespace("/diagnose:generation", "", localOnly)
    assert.equal(result, null)
  })
})
