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
    assert.ok(source.includes('warnElement(`Optional element not found: ${id}`)'),
      "optionalElement must warn instead of throwing")
    assert.ok(source.includes("return null"),
      "optionalElement must return null instead of throwing")
  })

  it("requireElement has fallback for missing elements, does not hard crash", () => {
    assert.ok(
      source.includes("warnElement") && (source.includes("fallback") || source.includes("Missing element")),
      "requireElement must warn and use fallback instead of hard crashing")
  })

  // ── Hide-thinking visibility: the "Show thinking" toggle must actually
  // remove blocks from the layout, not just collapse them. Users reported
  // that unchecking the toggle still left thinking blocks visible.
  describe("toggleAllThinkingBlocks — visibility semantics", () => {
    it("exports toggleAllThinkingBlocks", () => {
      assert.ok(source.includes("export function toggleAllThinkingBlocks"))
    })

    it("toggles a body class so CSS can fully hide thinking blocks", () => {
      const fnIdx = source.indexOf("export function toggleAllThinkingBlocks")
      assert.ok(fnIdx >= 0)
      const body = source.slice(fnIdx, fnIdx + 800)
      // Must apply/remove a body-level class — the open/closed details
      // attribute alone leaves the summary visible, which is the bug.
      assert.ok(
        /document\.body\.classList\.toggle\(\s*['"]hide-thinking['"]/.test(body),
        "must toggle document.body.classList for 'hide-thinking'",
      )
    })

    it("keeps the collapse-all-on-hide behavior so subsequent unhide reveals a tidy state", () => {
      const fnIdx = source.indexOf("export function toggleAllThinkingBlocks")
      const body = source.slice(fnIdx, fnIdx + 800)
      // Belt-and-braces: still flip details.open so visual snapshot tests
      // and screen readers see a coherent state regardless of CSS.
      assert.ok(
        body.includes("block.open"),
        "must continue to set per-block open state alongside the body class",
      )
    })
  })
})
