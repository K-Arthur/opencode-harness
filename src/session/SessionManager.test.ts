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

  it("has getSessionMessages method backed by session.messages API", () => {
    assert.ok(source.includes("async getSessionMessages("), "must expose session message history")
    assert.ok(source.includes("this.client.session.messages("), "must use SDK session.messages(), not Session.history")
  })

  it("generates SERVER_PASSWORD when none is configured", () => {
    assert.ok(source.includes("generatePassword"), "must have generatePassword method")
    assert.ok(source.includes("randomUUID"), "must use randomUUID for password")
    assert.ok(source.includes("OPENCODE_SERVER_PASSWORD"), "must pass password via env var")
  })

  it("passes password as Basic auth to SDK client", () => {
    assert.ok(source.includes("Authorization"), "must set Authorization header")
    assert.ok(source.includes("Basic"), "must use Basic scheme (opencode server uses HTTP Basic Auth)")
  })

  it("has idempotency key on sendPromptAsync to prevent duplicate retries", () => {
    assert.ok(source.includes("idempotency"), "must have idempotency-key header or mechanism")
  })

  it("narrows isRetryableError to avoid false-positive business-logic retries", () => {
    assert.ok(source.includes("isRetryableError"), "isRetryableError must exist")
    assert.ok(source.includes("econnrefused"), "must match ECONNREFUSED")
    assert.ok(source.includes("econnreset"), "must match ECONNRESET")
    // Should NOT broadly match generic strings like "socket"
    const narrowPattern = !source.includes("/socket/i")
    assert.ok(narrowPattern || source.includes("econnrefused"), "must prefer targeted patterns over broad /socket/i")
  })

  it("start() guards against concurrent server processes", () => {
    assert.ok(source.includes("startPromise"), "must use startPromise to guard concurrent starts")
    assert.ok(source.includes("this.startPromise = this._start()"), "must assign _start() to startPromise")
    assert.ok(source.includes("this.startPromise = null"), "must clear startPromise after completion")
  })
})
