import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "dom.ts"), "utf8")

describe("dom.ts", () => {
  it("exports requireElement", () => {
    assert.ok(source.includes("export function requireElement"))
  })

  it("exports optionalElement", () => {
    assert.ok(source.includes("export function optionalElement"))
  })

  it("exports ElementRefs interface", () => {
    assert.ok(source.includes("export interface ElementRefs"))
  })

  it("exports getElementRefs", () => {
    assert.ok(source.includes("export function getElementRefs"))
  })

  it("exports scrollToBottom", () => {
    assert.ok(source.includes("export function scrollToBottom"))
  })

  it("exports getActiveMessageList", () => {
    assert.ok(source.includes("export function getActiveMessageList"))
  })

  it("exports getActiveTypingIndicator", () => {
    assert.ok(source.includes("export function getActiveTypingIndicator"))
  })

  it("requireElement throws on missing element", () => {
    assert.ok(source.includes('throw new Error(`Missing webview element: ${id}`)'))
  })

  it("ElementRefs contains promptInput", () => {
    assert.ok(source.includes("promptInput: HTMLTextAreaElement"))
  })

  it("ElementRefs contains agentStatusText", () => {
    assert.ok(source.includes("agentStatusText: HTMLSpanElement"))
  })
})
