/**
 * Source-assertion tests (RED phase) verifying that visibility guards exist in
 * scrollAnchor.ts, virtualList.ts, and tabs.ts after the gating fix is applied.
 * These tests FAIL until the production code is updated.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const dir = __dirname

const scrollAnchorSrc = readFileSync(path.join(dir, "scrollAnchor.ts"), "utf8")
const virtualListSrc = readFileSync(path.join(dir, "virtualList.ts"), "utf8")
const tabsSrc = readFileSync(path.join(dir, "tabs.ts"), "utf8")

describe("scrollAnchor.ts visibility gating", () => {
  it("scrollToBottom early-returns when the panel is not active", () => {
    assert.ok(
      scrollAnchorSrc.includes("isPanelVisible") ||
        scrollAnchorSrc.includes("tab-panel") && scrollAnchorSrc.includes("active"),
      "scrollToBottom must check panel visibility before writing scrollTop",
    )
  })

  it("imports or uses visibilityGate isPanelVisible", () => {
    assert.ok(
      scrollAnchorSrc.includes("isPanelVisible") ||
        scrollAnchorSrc.includes("visibilityGate"),
      "scrollAnchor.ts must reference isPanelVisible from visibilityGate",
    )
  })
})

describe("virtualList.ts visibility gating", () => {
  it("pruneOffScreen early-returns when panel is hidden", () => {
    assert.ok(
      virtualListSrc.includes("isPanelVisible") ||
        (virtualListSrc.includes("tab-panel") && virtualListSrc.includes("active")),
      "pruneOffScreen must early-return when the container's tab panel is not active",
    )
  })
})

describe("tabs.ts notifyTabActivated call", () => {
  it("switchToTab calls notifyTabActivated after making the panel active", () => {
    assert.ok(
      tabsSrc.includes("notifyTabActivated"),
      "switchToTab must call notifyTabActivated(tabId) to trigger deferred flushes",
    )
  })
})
