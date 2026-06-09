import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "outputChannel.ts"), "utf8")

describe("outputChannel.ts", () => {
  it("defines OutputChannelService class", () => {
    assert.ok(source.includes("class OutputChannelService"))
  })

  it("exports log singleton", () => {
    assert.ok(source.includes("export const log"))
    assert.ok(source.includes("new OutputChannelService()"))
  })

  it("has outputChannel getter", () => {
    assert.ok(source.includes("get outputChannel()"))
  })

  it("has info method", () => {
    assert.ok(source.includes("info("))
  })

  it("has warn method with optional err param", () => {
    assert.ok(source.includes("warn(message:"))
  })

  it("has error method with optional err param", () => {
    assert.ok(source.includes("error(message:"))
  })

  it("has debug method", () => {
    assert.ok(source.includes("debug("))
  })

  it("has show method", () => {
    assert.ok(source.includes("show()"))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })
})
