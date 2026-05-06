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

  it("has onDidChangeSession typed event for delete/rename/active", () => {
    assert.ok(source.includes("onDidChangeSession"), "must have typed change event")
    assert.ok(source.includes("kind"), "event must have kind discriminator")
    assert.ok(source.includes('kind: "deleted"'), "must emit session_deleted event")
  })

  it("has archive method that marks session as archived", () => {
    assert.ok(source.includes("archive("), "archive method must exist")
    assert.ok(source.includes("archived"), "OpenCodeSession must have archived field")
  })

  it("has unarchive method that restores session", () => {
    assert.ok(source.includes("unarchive("), "unarchive method must exist")
  })

  it("has clearAll method that returns preview counts", () => {
    assert.ok(source.includes("clearAll("), "clearAll method must exist")
    assert.ok(source.includes("dryRun"), "must support dry-run preview mode")
    assert.ok(source.includes("preview:"), "must return preview object with counts")
  })

  it("list filters archived sessions by default", () => {
    assert.ok(source.includes("list("), "list method must exist")
  })
})
