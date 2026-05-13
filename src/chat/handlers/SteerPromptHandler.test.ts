import { describe, it, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "SteerPromptHandler.ts"), "utf8")

describe("SteerPromptHandler.ts", () => {
  it("exports SteerPromptHandler class", () => {
    assert.ok(source.includes("export class SteerPromptHandler"), "SteerPromptHandler class must be exported")
  })

  it("has constructor accepting StreamCoordinator, SessionStore, and SessionManager", () => {
    assert.ok(source.includes("constructor("), "must have constructor")
    assert.ok(source.includes("streamCoordinator: StreamCoordinator"), "constructor must accept StreamCoordinator")
    assert.ok(source.includes("sessionStore: SessionStore"), "constructor must accept SessionStore")
    assert.ok(source.includes("sessionManager: SessionManager"), "constructor must accept SessionManager")
  })

  it("has sendSteerPrompt method", () => {
    assert.ok(source.includes("async sendSteerPrompt("), "must have sendSteerPrompt method")
    assert.ok(source.includes("sessionId: string"), "sendSteerPrompt must accept sessionId")
    assert.ok(source.includes("steerPrompt:"), "sendSteerPrompt must accept steerPrompt")
    assert.ok(source.includes("callbacks: StreamCallbacks"), "sendSteerPrompt must accept callbacks")
  })

  it("has handleInterrupt method", () => {
    assert.ok(source.includes("private async handleInterrupt("), "must have handleInterrupt method")
    assert.ok(source.includes("await this.streamCoordinator.abort("), "handleInterrupt must call abort")
  })

  it("has handleAppend method", () => {
    assert.ok(source.includes("private async handleAppend("), "must have handleAppend method")
    assert.ok(source.includes("registerAppendCallback"), "handleAppend must use registerAppendCallback")
  })

  it("has handleQueue method", () => {
    assert.ok(source.includes("private async handleQueue("), "must have handleQueue method")
  })

  it("has trackSteerPrompt method", () => {
    assert.ok(source.includes("private trackSteerPrompt("), "must have trackSteerPrompt method")
  })

  it("handles interrupt mode by calling streamCoordinator.abort", () => {
    assert.ok(source.includes('case "interrupt":'), "must handle interrupt mode")
    assert.ok(source.includes("await this.handleInterrupt"), "must call handleInterrupt for interrupt mode")
  })

  it("handles append mode by calling registerAppendCallback", () => {
    assert.ok(source.includes('case "append":'), "must handle append mode")
    assert.ok(source.includes("await this.handleAppend"), "must call handleAppend for append mode")
  })

  it("handles queue mode by calling handleQueue", () => {
    assert.ok(source.includes('case "queue":'), "must handle queue mode")
    assert.ok(source.includes("await this.handleQueue"), "must call handleQueue for queue mode")
  })

  it("has unknown mode handling with warning", () => {
    assert.ok(source.includes("default:"), "must have default case for unknown modes")
    assert.ok(source.includes("log.warn"), "must warn on unknown mode")
  })

  it("queue mode posts message to webview instead of sending immediately", () => {
    assert.ok(source.includes('case "queue":'), "must handle queue mode")
    assert.ok(source.includes("postMessage"), "queue mode should post message to webview")
    assert.ok(!source.includes("sending immediately as fallback"), "queue mode should not use fallback")
  })
})
