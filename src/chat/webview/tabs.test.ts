import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "tabs.ts"), "utf8")

describe("tabs.ts", () => {
  it("exports createTabBar", () => {
    assert.ok(source.includes("export function createTabBar"))
  })

  it("exports createTabContent", () => {
    assert.ok(source.includes("export function createTabContent"))
  })

  it("exports switchToTab", () => {
    assert.ok(source.includes("export function switchToTab"))
  })

  it("exports removeTabContent", () => {
    assert.ok(source.includes("export function removeTabContent"))
  })

  it("exports TabCallbacks interface", () => {
    assert.ok(source.includes("export interface TabCallbacks"))
  })

  it("has renderTabs function", () => {
    assert.ok(source.includes("function renderTabs"))
  })

  it("creates tab-panel and tab-btn elements", () => {
    assert.ok(source.includes("tab-panel"))
    assert.ok(source.includes("tab-btn"))
  })

  it("returns { renderTabs }", () => {
    assert.ok(source.includes("renderTabs"))
  })

  it("createTabContent creates tab-panel elements with data attributes", () => {
    assert.ok(source.includes('view.className = "tab-panel"'), "must set tab-panel class")
    assert.ok(source.includes("tab-btn"), "must create tab-btn elements")
  })

  it("createTabBar wires newTabBtn click listener", () => {
    assert.ok(source.includes("els.newTabBtn.addEventListener"))
  })

  it("tab close uses closest() so SVG/path clicks inside .tab-close still fire", () => {
    // Regression: clicks on the inner SVG <path> of the close button used to
    // miss the classList.contains("tab-close") check and fall through to the
    // switch handler (or no-op). The fix uses closest(".tab-close") so any
    // descendant of .tab-close triggers the close callback.
    assert.ok(
      source.includes('target.closest(".tab-close")'),
      "tab close handler must use closest(\".tab-close\") so SVG children trigger close",
    )
    assert.ok(
      !source.includes('target.classList.contains("tab-close")'),
      "tab close handler must NOT use classList.contains on the direct target (misses SVG clicks)",
    )
  })
})
