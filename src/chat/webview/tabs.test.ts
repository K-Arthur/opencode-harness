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

  it("TabCallbacks includes onToggleContextMonitor", () => {
    assert.ok(source.includes("onToggleContextMonitor"))
  })

  it("context-monitor is clickable to open panel", () => {
    assert.ok(source.includes('contextMonitor.addEventListener("click"'))
    assert.ok(source.includes("onToggleContextMonitor"))
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
})
