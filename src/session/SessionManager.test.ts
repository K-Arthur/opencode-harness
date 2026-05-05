import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "SessionManager.ts"), "utf8")

describe("SessionManager.ts", () => {
  it("exports OpencodeEventType union type", () => {
    assert.ok(source.includes("export type OpencodeEventType"))
  })

  it("exports OpencodeEvent interface", () => {
    assert.ok(source.includes("export interface OpencodeEvent"))
  })

  it("exports ContextPackage interface", () => {
    assert.ok(source.includes("export interface ContextPackage"))
  })

  it("exports SessionManager class", () => {
    assert.ok(source.includes("export class SessionManager"))
  })

  it("has start method", () => {
    assert.ok(source.includes("async start()"))
  })

  it("has stop method", () => {
    assert.ok(source.includes("async stop()"))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  it("has sendPrompt method", () => {
    assert.ok(source.includes("async sendPrompt("))
  })

  it("has sendPromptAsync with retry logic", () => {
    assert.ok(source.includes("async sendPromptAsync("))
    assert.ok(source.includes("MAX_RETRIES"))
  })

  it("has ensureSession method", () => {
    assert.ok(source.includes("async ensureSession("))
  })
})
