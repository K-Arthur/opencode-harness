import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "model-dropdown.ts"), "utf8")

describe("model-dropdown.ts", () => {
  it("exports setupModelDropdown", () => {
    assert.ok(source.includes("export function setupModelDropdown"))
  })

  it("exports ModelDropdownCallbacks interface", () => {
    assert.ok(source.includes("export interface ModelDropdownCallbacks"))
  })

  it("defines open function", () => {
    assert.ok(source.includes("function open()"))
  })

  it("defines close function", () => {
    assert.ok(source.includes("function close()"))
  })

  it("defines render function", () => {
    assert.ok(source.includes("function render"))
  })

  it("defines setCurrentModel function", () => {
    assert.ok(source.includes("function setCurrentModel"))
  })

  it("groups models by provider", () => {
    assert.ok(source.includes("byProvider"))
  })

  it("uses aria-expanded for accessibility", () => {
    assert.ok(source.includes('"aria-expanded"'))
  })

  it("has keyboard navigation for ArrowDown/ArrowUp/Escape", () => {
    assert.ok(source.includes("ArrowDown"))
    assert.ok(source.includes("ArrowUp"))
    assert.ok(source.includes("Escape"))
  })

  it("returns { open, close, render, setCurrentModel }", () => {
    assert.ok(source.includes("open, close, render, setCurrentModel"))
  })
})
