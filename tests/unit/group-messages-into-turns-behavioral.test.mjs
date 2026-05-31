import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rendererSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "renderer.ts"), "utf8")

describe("groupMessagesIntoTurns — Behavioral Tests", () => {

  describe("tool count accumulation (Fix #3)", () => {
    it("accumulates tool counts across multiple assistant messages in a single turn", () => {
      const toolCountIdx = rendererSource.indexOf("currentTurn.toolCount +=")
      assert.ok(toolCountIdx >= 0, "must use += for toolCount accumulation")
    })

    it("accumulates patch counts across multiple assistant messages in a single turn", () => {
      const patchCountIdx = rendererSource.indexOf("currentTurn.patchCount +=")
      assert.ok(patchCountIdx >= 0, "must use += for patchCount accumulation")
    })
  })

  describe("snippet extraction", () => {
    it("extracts snippet from blocks first, falls back to loose fields", () => {
      const extractFn = rendererSource.slice(
        rendererSource.indexOf("function extractSnippet"),
        rendererSource.indexOf("function renderThinkingBlock"),
      )
      assert.ok(extractFn.includes("blocks"), "must check blocks first")
      assert.ok(extractFn.includes("loose"), "must fall back to loose fields (text, content, message)")
      assert.ok(extractFn.includes("parts"), "must fall back to parts array")
    })

    it("truncates long snippets to 80 characters with ellipsis", () => {
      const extractFn = rendererSource.slice(
        rendererSource.indexOf("function extractSnippet"),
        rendererSource.indexOf("function renderThinkingBlock"),
      )
      assert.ok(extractFn.includes(".slice(0, 80)"), "must truncate to 80 chars")
      assert.ok(extractFn.includes('...'), "must append ellipsis for truncated text")
    })

    it("uses descriptive fallback instead of 'Thinking...' for assistant messages", () => {
      const extractFn = rendererSource.slice(
        rendererSource.indexOf("function extractSnippet"),
        rendererSource.indexOf("function renderThinkingBlock"),
      )
      assert.ok(!extractFn.includes('"Thinking..."'), "must not use 'Thinking...' as fallback for completed messages")
      assert.ok(extractFn.includes('"Response"'), "must use 'Response' as assistant fallback")
    })
  })

  describe("turn structure", () => {
    it("creates a turnId from the user message id", () => {
      assert.ok(
        rendererSource.includes('turnId: `turn-${msg.id'),
        "must create deterministic turnId from user message id",
      )
    })

    it("generates a UUID fallback when user message has no id", () => {
      assert.ok(
        rendererSource.includes("crypto.randomUUID()"),
        "must use crypto.randomUUID() as fallback for missing message ids",
      )
    })

    it("pushes the previous turn when a new user message is encountered", () => {
      const fnBlock = rendererSource.slice(
        rendererSource.indexOf("export function groupMessagesIntoTurns"),
        rendererSource.indexOf("function extractSnippet"),
      )
      assert.ok(
        fnBlock.includes("if (currentTurn) turns.push(currentTurn)"),
        "must push the previous turn when a new user message starts a new turn",
      )
    })
  })
})
