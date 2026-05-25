import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8")

describe("T1.5 — Retry-from-here after TTFB timeout", () => {
  it("detects TTFB timeout via streamStates", () => {
    assert.ok(source.includes('prevState === "timeout"'), "must check stream state for timeout")
    assert.ok(source.includes("wasTimeout"), "must have wasTimeout flag")
  })

  it("checks for assistant text output before falling back", () => {
    assert.ok(source.includes("hasAssistantOutput"), "must check for assistant output")
    assert.ok(source.includes('typeof b.text === "string"') || source.includes("b.text?.trim()") || source.includes(".trim().length > 0"), "must check for non-empty text blocks")
  })

  it("re-sends original user prompt when timeout and no assistant output", () => {
    assert.ok(source.includes("lastUser.blocks.map(b => b.type === \"text\" ? b.text : \"\").join(\" \").trim()"), "must reconstruct user prompt from blocks")
  })

  it("logs TTFB timeout retry detection", () => {
    assert.ok(source.includes("TTFB timeout detected"), "must log TTFB timeout detection")
    assert.ok(source.includes("re-sending original user prompt"), "must log re-sending original prompt")
  })

  it("keeps existing retry template for partial assistant output", () => {
    assert.ok(source.includes("Continue from where you left off"), "must keep existing retry template")
  })
})
