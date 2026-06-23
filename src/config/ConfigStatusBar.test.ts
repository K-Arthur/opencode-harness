import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "ConfigStatusBar.ts"), "utf8")

describe("ConfigStatusBar.ts", () => {
  it("exports ConfigStatusBar class", () => {
    assert.ok(source.includes("export class ConfigStatusBar"), "must export ConfigStatusBar class")
  })

  it("has show method that creates the status bar item", () => {
    assert.ok(source.includes("show(): void"), "must have show method")
    assert.ok(source.includes("createStatusBarItem"), "must create status bar item")
  })

  it("has update method that reflects config status", () => {
    assert.ok(source.includes("update(status: ConfigLoadStatus"), "must have update method with ConfigLoadStatus")
    assert.ok(source.includes('"ok"'), "must handle ok status")
    assert.ok(source.includes('"parse_error"'), "must handle parse_error status")
    assert.ok(source.includes('"not_found"'), "must handle not_found status")
  })

  it("sets warning background on parse error", () => {
    assert.ok(source.includes("statusBarItem.warningBackground"), "must use warning background for parse errors")
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose(): void"), "must have dispose method")
    assert.ok(source.includes("statusItem?.dispose()"), "must dispose the status bar item")
  })

  it("registers openConfigFile command on click", () => {
    assert.ok(source.includes("opencode-harness.openConfigFile"), "must register openConfigFile command")
  })

  it("uses settings-gear icon for ok status", () => {
    assert.ok(source.includes("$(settings-gear)"), "must use settings-gear icon for ok status")
  })

  it("uses warning icon for parse error", () => {
    assert.ok(source.includes("$(warning)"), "must use warning icon for parse error")
  })
})
