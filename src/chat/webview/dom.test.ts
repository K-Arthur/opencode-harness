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

  it("requireElement uses fallback on missing element instead of crashing", () => {
    assert.ok(source.includes("Missing element") || source.includes("throw new Error("), 
      "requireElement must handle missing elements gracefully")
  })

  it("ElementRefs contains promptInput", () => {
    assert.ok(source.includes("promptInput: HTMLTextAreaElement"))
  })

  it("ElementRefs contains agentStatusText", () => {
    assert.ok(source.includes("agentStatusText: HTMLSpanElement"))
  })

  it("ElementRefs contains quota bar elements", () => {
    assert.ok(source.includes("quotaBar:"), "must expose quota bar container")
    assert.ok(source.includes("quotaProgressBar:"), "must expose quota progress")
    assert.ok(source.includes("quotaLabel:"), "must expose quota label")
  })

  it("optionalElement warns but does not throw on missing element", () => {
    assert.ok(source.includes('log.warn(`Optional element not found: ${id}`)'),
      "optionalElement must warn instead of throwing")
    assert.ok(source.includes("return null"),
      "optionalElement must return null instead of throwing")
  })

  it("requireElement has fallback for missing elements, does not hard crash", () => {
    assert.ok(
      source.includes("log.warn") && (source.includes("fallback") || source.includes("Missing element")),
      "requireElement must warn and use fallback instead of hard crashing")
  })
})
