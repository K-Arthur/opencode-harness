import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "types.ts"), "utf8")

describe("types.ts", () => {
  it("exports MessageRole type", () => {
    assert.ok(source.includes("export type MessageRole"))
  })

  it("exports Block type", () => {
    assert.ok(source.includes("export type Block = LegacyBlock"))
  })

  it("exports ChatMessage interface", () => {
    assert.ok(source.includes("export interface ChatMessage"))
  })

  it("exports SessionState interface", () => {
    assert.ok(source.includes("export interface SessionState"))
  })

  it("exports WebviewState interface", () => {
    assert.ok(source.includes("export interface WebviewState"))
  })

  it("exports MentionItem interface", () => {
    assert.ok(source.includes("export interface MentionItem"))
  })

  it("exports SessionSummary interface", () => {
    assert.ok(source.includes("export interface SessionSummary"))
  })

  it("exports ContextChip interface", () => {
    assert.ok(source.includes("export interface ContextChip"))
  })

  it("exports ContextUsage interface", () => {
    assert.ok(source.includes("export interface ContextUsage"))
  })

  it("exports HostMessage discriminated union type", () => {
    assert.ok(source.includes("export type HostMessage"))
  })

  it("exports VsCodeApi interface", () => {
    assert.ok(source.includes("export interface VsCodeApi"))
  })

  it("exports ModelInfo interface", () => {
    assert.ok(source.includes("export interface ModelInfo"))
  })

  it("exports TabInfo interface", () => {
    assert.ok(source.includes("export interface TabInfo"))
  })
})
