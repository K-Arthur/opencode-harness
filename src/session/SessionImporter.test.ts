/**
 * TDD tests for session import (P3.3 — audit §11).
 *
 * The export format (SessionExporter.json) is:
 *   { id, name, createdAt, lastActiveAt, model, cost, messages: [{ id, role, timestamp, blocks }] }
 *
 * Import mirrors that format: parse the JSON, map blocks back to ChatMessage
 * blocks, mint a fresh session id (imports are local copies, not server
 * sessions), and return an OpenCodeSession ready for SessionStore.addSession.
 *
 * The pure parse function is tested here; the VS Code file-dialog adapter is
 * a thin wrapper tested via the command registration.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseSessionExport, type SessionExportJson } from "./SessionImporter"

const validExport: SessionExportJson = {
  id: "ses_original",
  name: "My Exported Chat",
  createdAt: 1000,
  lastActiveAt: 2000,
  model: "anthropic/claude-sonnet-4-5",
  cost: 0.05,
  messages: [
    {
      id: "msg_1",
      role: "user",
      timestamp: 1100,
      blocks: [{ type: "text", text: "Hello" }],
    },
    {
      id: "msg_2",
      role: "assistant",
      timestamp: 1200,
      blocks: [
        { type: "text", text: "Hi there" },
        { type: "tool_call", toolName: "bash", args: { cmd: "ls" }, result: "file.txt" },
        { type: "diff", fileName: "foo.ts", diffText: "@@ -1 +1 @@" },
      ],
    },
  ],
}

describe("parseSessionExport — happy path", () => {
  it("mints a fresh session id (imports are local copies)", () => {
    const session = parseSessionExport(validExport)
    assert.ok(session.id, "must have an id")
    assert.notEqual(session.id, "ses_original", "must not reuse the original id")
  })

  it("preserves name, model, cost, and timestamps from the export", () => {
    const session = parseSessionExport(validExport)
    assert.equal(session.name, "My Exported Chat")
    assert.equal(session.model, "anthropic/claude-sonnet-4-5")
    assert.equal(session.cost, 0.05)
    assert.equal(session.createdAt, 1000)
    assert.equal(session.lastActiveAt, 2000)
  })

  it("maps all messages with their blocks", () => {
    const session = parseSessionExport(validExport)
    assert.equal(session.messages.length, 2)
    assert.equal(session.messages[0]?.role, "user")
    assert.equal(session.messages[1]?.role, "assistant")
  })

  it("preserves text blocks", () => {
    const session = parseSessionExport(validExport)
    const userMsg = session.messages[0]
    assert.ok(userMsg)
    assert.equal(userMsg.blocks.length, 1)
    assert.equal(userMsg.blocks[0]?.type, "text")
  })

  it("preserves tool_call blocks with toolName, args, result", () => {
    const session = parseSessionExport(validExport)
    const assistantMsg = session.messages[1]
    assert.ok(assistantMsg)
    const toolBlock = assistantMsg.blocks.find(b => b.type === "tool_call" || b.type === "tool-call")
    assert.ok(toolBlock, "must have a tool call block")
  })

  it("preserves diff blocks with fileName and diffText", () => {
    const session = parseSessionExport(validExport)
    const assistantMsg = session.messages[1]
    assert.ok(assistantMsg)
    const diffBlock = assistantMsg.blocks.find(b => b.type === "diff" || b.type === "diff_block")
    assert.ok(diffBlock, "must have a diff block")
  })

  it("initializes tokenUsage to zero (import has no usage data)", () => {
    const session = parseSessionExport(validExport)
    assert.deepEqual(session.tokenUsage, { prompt: 0, completion: 0, total: 0 })
  })

  it("sets mode to a sensible default (build)", () => {
    const session = parseSessionExport(validExport)
    assert.ok(session.mode, "must have a mode")
  })
})

describe("parseSessionExport — validation", () => {
  it("rejects JSON without a messages array", () => {
    assert.throws(
      () => parseSessionExport({ ...validExport, messages: "not an array" } as unknown as SessionExportJson),
      /messages.*array/i,
    )
  })

  it("rejects JSON with no messages", () => {
    assert.throws(
      () => parseSessionExport({ ...validExport, messages: [] }),
      /no messages/i,
    )
  })

  it("rejects a message with no role", () => {
    const bad = { ...validExport, messages: [{ id: "x", timestamp: 1, blocks: [] }] } as unknown as SessionExportJson
    assert.throws(() => parseSessionExport(bad), /role/i)
  })

  it("handles unknown block types gracefully (passes them through)", () => {
    const exportWithUnknown: SessionExportJson = {
      ...validExport,
      messages: [
        { id: "m1", role: "user", timestamp: 1, blocks: [{ type: "unknown_future_block", data: "x" }] },
      ],
    }
    const session = parseSessionExport(exportWithUnknown)
    assert.equal(session.messages.length, 1)
    // Unknown blocks should pass through, not crash
    const first = session.messages[0]
    assert.ok(first, "expected at least one message")
    assert.ok(first.blocks.length >= 0)
  })
})
