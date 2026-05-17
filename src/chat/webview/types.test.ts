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

  it("FileChange uses path added removed contract", () => {
    const idx = source.indexOf("export interface FileChange")
    assert.ok(idx >= 0, "FileChange must be exported")
    const block = source.slice(idx, idx + 200)
    assert.ok(block.includes("path: string"), "FileChange.path must be string")
    assert.ok(block.includes("added: number"), "FileChange.added must be number")
    assert.ok(block.includes("removed: number"), "FileChange.removed must be number")
  })

  it("checkpoint and diff host messages match runtime payloads", () => {
    assert.ok(source.includes("filesChanged?: string[]"), "CheckpointInfo must include filesChanged")
    assert.ok(source.includes("checkpointId: string"), "checkpoint_restored host message must include checkpointId")
    assert.ok(source.includes("blockId: string"), "diff_result host message must include blockId")
    assert.ok(source.includes("checkpointCreated?: boolean"), "diff_result host message must include checkpointCreated")
    assert.ok(source.includes('{ type: "accept_diff"; diffId: string; path?: string; sessionId?: string }'), "accept_diff webview message must allow path from renderer")
    assert.ok(source.includes('{ type: "revert_diff"; diffId: string; path: string; sessionId?: string }'), "revert_diff webview message must include path")
    assert.ok(source.includes('{ type: "show_diff"; filePath: string; proposedContent: string; title?: string; sessionId?: string }'), "show_diff webview message must match host handler payload")
  })
})
