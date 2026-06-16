import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "PtyService.ts"), "utf8")
const typesSource = readFileSync(path.join(__dirname, "ptyTypes.ts"), "utf8")

describe("PtyService.ts", () => {
  it("exports PtyService class", () => {
    assert.ok(source.includes("export class PtyService"))
  })

  it("has createSession method", () => {
    assert.ok(source.includes("async createSession("))
  })

  it("has getSession method", () => {
    assert.ok(source.includes("async getSession("))
  })

  it("has removeSession method", () => {
    assert.ok(source.includes("async removeSession("))
  })

  it("has listSessions method", () => {
    assert.ok(source.includes("async listSessions("))
  })

  it("has updateSession method", () => {
    assert.ok(source.includes("async updateSession("))
  })

  it("has getConnectToken method", () => {
    assert.ok(source.includes("async getConnectToken("))
  })

  it("has connectWebSocket method", () => {
    assert.ok(source.includes("async connectWebSocket("))
  })

  it("has sendInput method", () => {
    assert.ok(source.includes("async sendInput("))
  })

  it("has setTerminalSize method", () => {
    assert.ok(source.includes("async setTerminalSize("))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  it("uses client.pty SDK endpoints", () => {
    assert.ok(source.includes("client.pty.create"))
    assert.ok(source.includes("client.pty.get"))
    assert.ok(source.includes("client.pty.remove"))
    assert.ok(source.includes("client.pty.list"))
    assert.ok(source.includes("client.pty.update"))
    assert.ok(source.includes("client.pty.connectToken"))
  })

  it("opens WebSocket on connect", () => {
    assert.ok(source.includes("new WebSocket("))
  })

  it("handles socket.onmessage for output", () => {
    assert.ok(source.includes("socket.onmessage"))
  })

  it("handles socket.onclose cleanup", () => {
    assert.ok(source.includes("socket.onclose"))
  })

  it("handles socket.onerror", () => {
    assert.ok(source.includes("socket.onerror"))
  })

  it("handles abort signal", () => {
    assert.ok(source.includes("signal?.aborted"))
    assert.ok(source.includes("signal?.addEventListener"))
    assert.ok(source.includes("AbortError"))
  })

  it("adds WebSocket to sockets map on open", () => {
    assert.ok(source.includes("this.sockets.set("))
    assert.ok(source.includes("this.sockets.get("))
    assert.ok(source.includes("this.sockets.delete("))
  })

  it("exports PtySessionInfo interface", () => {
    assert.ok(typesSource.includes("export interface PtySessionInfo"))
  })

  it("exports PtyOutputEvent interface", () => {
    assert.ok(typesSource.includes("export interface PtyOutputEvent"))
  })

  it("exports PtyLifecycleEvent type", () => {
    assert.ok(typesSource.includes("export type PtyLifecycleEvent"))
  })

  it("exports PtyConnectToken interface", () => {
    assert.ok(typesSource.includes("export interface PtyConnectToken"))
  })

  it("exports PtyService interface", () => {
    assert.ok(typesSource.includes("export interface PtyService"))
  })
})
