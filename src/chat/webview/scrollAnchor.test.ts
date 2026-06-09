import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "scrollAnchor.ts"), "utf8")

describe("scrollAnchor.ts", () => {
  it("exports createScrollAnchor", () => {
    assert.ok(source.includes("export function createScrollAnchor"))
  })

  it("exports ScrollAnchor interface", () => {
    assert.ok(source.includes("export interface ScrollAnchor"))
  })

  it("has ANCHOR_THRESHOLD of 80", () => {
    assert.ok(source.includes("ANCHOR_THRESHOLD = 80"))
  })

  it("has container property", () => {
    assert.ok(source.includes("readonly container: HTMLElement"))
  })

  it("has isAnchored property", () => {
    assert.ok(source.includes("readonly isAnchored: boolean"))
  })

  it("has anchor method", () => {
    assert.ok(source.includes("anchor(): void"))
  })

  it("has scrollIfAnchored method", () => {
    assert.ok(source.includes("scrollIfAnchored(): void"))
  })

  it("has pause method", () => {
    assert.ok(source.includes("pause(): void"))
  })

  it("has resume method", () => {
    assert.ok(source.includes("resume(): void"))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose(): void"))
  })
})
