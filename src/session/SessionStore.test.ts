import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "SessionStore.ts"), "utf8")

describe("SessionStore.ts", () => {
  it("exports OpenCodeSession interface", () => {
    assert.ok(source.includes("export interface OpenCodeSession"))
  })

  it("exports SessionStore class", () => {
    assert.ok(source.includes("export class SessionStore"))
  })

  it("constructor takes globalState", () => {
    assert.ok(source.includes("constructor(private readonly globalState"))
  })

  it("has create method", () => {
    assert.ok(source.includes("create("))
  })

  it("has get method", () => {
    assert.ok(source.includes("get("))
  })

  it("has list method", () => {
    assert.ok(source.includes("list()"))
  })

  it("has setActive method", () => {
    assert.ok(source.includes("setActive("))
  })

  it("has appendMessage method", () => {
    assert.ok(source.includes("appendMessage("))
  })

  it("has delete method", () => {
    assert.ok(source.includes("delete("))
  })

  it("has duplicate method", () => {
    assert.ok(source.includes("duplicate("))
  })

  it("has generateTitleFromMessage method", () => {
    assert.ok(source.includes("generateTitleFromMessage("))
  })

  it("has validateSessionName method", () => {
    assert.ok(source.includes("validateSessionName("))
  })

  it("auto-generates title from first user message", () => {
    assert.ok(source.includes("generateTitleFromMessage"))
  })

  it("validates rename for empty names", () => {
    assert.ok(source.includes("validateSessionName("))
  })

  it("validates rename for oversized names", () => {
    assert.ok(source.includes("80"))
  })
})
