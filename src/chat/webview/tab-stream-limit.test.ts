import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

// Regression test for the "1/undefined streaming" tab label. The stream-limit
// pill interpolates `${activeStreams}/${maxStreams} streaming`; before the fix
// the capacity object from sendLogic omitted `maxStreams`, so the label read
// "1/undefined streaming". See StreamCapacityState in sendLogic.ts.

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  return dom
}

describe("tab bar stream-limit label", () => {
  beforeEach(() => setupDom())

  it("renders activeStreams/maxStreams and never the literal 'undefined'", async () => {
    const { createTabBar } = await import("./tabs")
    const tabBar = document.createElement("div")
    const tabPanels = document.createElement("div")
    const newTabBtn = document.createElement("button")
    const els = { tabBar, tabPanels, newTabBtn } as unknown as import("./dom").ElementRefs

    const bar = createTabBar(els, {
      onSwitch: () => {},
      onClose: () => {},
      onNew: () => {},
    })

    bar.renderTabs(
      [{ id: "a", name: "Tab A", isStreaming: true }],
      "a",
      { activeStreams: 1, maxStreams: 5, isFull: false },
    )

    const limit = tabBar.querySelector(".tab-stream-limit")
    assert.ok(limit, "stream-limit pill should render when activeStreams > 0")
    assert.equal(limit?.textContent, "1/5 streaming")
    assert.ok(!limit?.textContent?.includes("undefined"), "label must not contain 'undefined'")
  })

  it("omits the pill when no streams are active", async () => {
    const { createTabBar } = await import("./tabs")
    const tabBar = document.createElement("div")
    const tabPanels = document.createElement("div")
    const newTabBtn = document.createElement("button")
    const els = { tabBar, tabPanels, newTabBtn } as unknown as import("./dom").ElementRefs

    const bar = createTabBar(els, { onSwitch: () => {}, onClose: () => {}, onNew: () => {} })
    bar.renderTabs(
      [{ id: "a", name: "Tab A", isStreaming: false }],
      "a",
      { activeStreams: 0, maxStreams: 5, isFull: false },
    )

    assert.equal(tabBar.querySelector(".tab-stream-limit"), null)
  })
})
