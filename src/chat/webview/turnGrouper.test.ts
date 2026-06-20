/**
 * TDD tests for the extracted turn-grouper module.
 *
 * groupMessagesIntoTurns + extractSnippet were extracted from renderer.ts
 * into turnGrouper.ts so the host (WebviewEventRouter) can import them
 * WITHOUT transitively pulling markdown-it / dompurify / entities into the
 * extension host bundle (audit: extension bundle was 860kb vs 660kb limit,
 * ~173kb of webview-only markdown deps leaked via renderer.ts).
 *
 * turnGrouper.ts must be a pure, dependency-free module — it imports only
 * the ChatMessage type. These tests enforce that contract.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { groupMessagesIntoTurns, extractSnippet, type TurnSummary } from "./turnGrouper"
import type { ChatMessage } from "./types"

const source = readFileSync(path.join(__dirname, "turnGrouper.ts"), "utf8")

const userMsg = (id: string, text: string): ChatMessage => ({
  role: "user", id, timestamp: Date.now(),
  blocks: [{ type: "text", text }],
})

const assistantMsg = (id: string, text: string, model?: string): ChatMessage => ({
  role: "assistant", id, timestamp: Date.now(),
  blocks: [{ type: "text", text }],
  model,
})

const assistantWithTools = (id: string, model: string): ChatMessage => ({
  role: "assistant", id, timestamp: Date.now(),
  blocks: [
    { type: "tool-call", tool: "bash", state: "running" } as never,
    { type: "diff", path: "foo.ts", hunks: [] } as never,
  ],
  model,
})

describe("turnGrouper — module contract (no heavy deps)", () => {
  it("imports nothing from markdown-it / dompurify / entities / linkify", () => {
    // Check import statements only (not doc comments that may mention dep names)
    const importLines = source.split("\n").filter(l => l.trim().startsWith("import "))
    const importBlock = importLines.join("\n")
    assert.ok(!importBlock.includes("markdown-it"), "must not import markdown-it")
    assert.ok(!importBlock.includes("dompurify"), "must not import dompurify")
    assert.ok(!importBlock.includes("entities"), "must not import entities")
    assert.ok(!importBlock.includes("linkify-it"), "must not import linkify-it")
    assert.ok(!importBlock.includes("wordDiff"), "must not import wordDiff (pulls diff-match-patch)")
    assert.ok(!importBlock.includes("syntaxHighlighter"), "must not import syntaxHighlighter")
    assert.ok(!importBlock.includes("toolCallRenderer"), "must not import toolCallRenderer")
    assert.ok(!importBlock.includes("vendorLoader"), "must not import vendorLoader")
    assert.ok(!importBlock.includes("markdownWorkerClient"), "must not import markdownWorkerClient")
    // Must import ONLY the type from ./types — nothing else
    assert.ok(importBlock.includes('from "./types"'), "must import ChatMessage type from ./types")
    assert.equal(importLines.length, 1, "must have exactly one import line (the type)")
  })

  it("exports groupMessagesIntoTurns, extractSnippet, and TurnSummary", () => {
    assert.ok(typeof groupMessagesIntoTurns === "function")
    assert.ok(typeof extractSnippet === "function")
    // TurnSummary is a type — just verify the import doesn't throw
    const t: TurnSummary = { turnId: "x", userMessageId: "u", assistantMessageId: "a", snippet: "s", toolCount: 0, patchCount: 0, timestamp: 0 }
    assert.ok(t.turnId === "x")
  })
})

describe("groupMessagesIntoTurns — behavior", () => {
  it("groups a user→assistant pair into one turn", () => {
    const turns = groupMessagesIntoTurns([userMsg("u1", "hello"), assistantMsg("a1", "hi there", "anthropic/claude-sonnet-4-5")])
    assert.equal(turns.length, 1)
    const t = turns[0]
    assert.ok(t, "expected at least one turn")
    assert.equal(t.userMessageId, "u1")
    assert.equal(t.assistantMessageId, "a1")
    assert.equal(t.model, "anthropic/claude-sonnet-4-5")
    assert.equal(t.snippet, "hello")
  })

  it("starts a new turn on the next user message", () => {
    const turns = groupMessagesIntoTurns([
      userMsg("u1", "first"), assistantMsg("a1", "reply1"),
      userMsg("u2", "second"), assistantMsg("a2", "reply2"),
    ])
    assert.equal(turns.length, 2)
    const t0 = turns[0]; const t1 = turns[1]
    assert.ok(t0 && t1, "expected two turns")
    assert.equal(t0.userMessageId, "u1")
    assert.equal(t1.userMessageId, "u2")
  })

  it("counts tool calls and diffs in assistant blocks", () => {
    const turns = groupMessagesIntoTurns([userMsg("u1", "do it"), assistantWithTools("a1", "claude")])
    const first = turns[0]
    assert.ok(first, "expected at least one turn")
    assert.equal(first.toolCount, 1)
    assert.equal(first.patchCount, 1)
  })

  it("handles a trailing user message with no assistant reply (open turn)", () => {
    const turns = groupMessagesIntoTurns([userMsg("u1", "hello")])
    assert.equal(turns.length, 1)
    const first = turns[0]
    assert.ok(first, "expected at least one turn")
    assert.equal(first.assistantMessageId, "")
  })

  it("handles empty message list", () => {
    assert.deepEqual(groupMessagesIntoTurns([]), [])
  })
})

describe("extractSnippet — behavior", () => {
  it("extracts text from the first text block", () => {
    assert.equal(extractSnippet(userMsg("u1", "hello world")), "hello world")
  })

  it("truncates long text to 80 chars with ellipsis", () => {
    const long = "x".repeat(120)
    const snippet = extractSnippet(userMsg("u1", long))
    assert.equal(snippet.length, 83) // 80 + "..."
    assert.ok(snippet.endsWith("..."))
  })

  it("returns a tool-call label for tool blocks", () => {
    const msg: ChatMessage = {
      role: "assistant", id: "a1", timestamp: 0,
      blocks: [{ type: "tool-call", tool: "bash", state: "running" } as never],
    }
    assert.equal(extractSnippet(msg), "Used bash")
  })

  it("falls back to role-based default when no blocks", () => {
    const msg: ChatMessage = { role: "user", id: "u1", timestamp: 0, blocks: [] }
    assert.equal(extractSnippet(msg), "Sent a message")
  })
})
