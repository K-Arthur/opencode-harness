import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "queue.ts"), "utf8")

describe("queue.ts enhancements", () => {
  it("has position field in QueueItem interface", () => {
    assert.ok(/position\??: number/.test(source), "QueueItem must have position field")
  })

  it("has isSteerPrompt field in QueueItem interface", () => {
    assert.ok(source.includes("isSteerPrompt?: boolean"), "QueueItem must have isSteerPrompt field")
  })

  it("has estimatedTokens field in QueueItem interface", () => {
    assert.ok(source.includes("estimatedTokens?: number"), "QueueItem must have estimatedTokens field")
  })

  it("has reorder method in PromptQueue interface", () => {
    assert.ok(source.includes("reorder:"), "PromptQueue must have reorder method")
  })

  it("has moveToFront method in PromptQueue interface", () => {
    assert.ok(source.includes("moveToFront:"), "PromptQueue must have moveToFront method")
  })

  it("has moveToBack method in PromptQueue interface", () => {
    assert.ok(source.includes("moveToBack:"), "PromptQueue must have moveToBack method")
  })

  it("has getEstimatedTokens method in PromptQueue interface", () => {
    assert.ok(source.includes("getEstimatedTokens:"), "PromptQueue must have getEstimatedTokens method")
  })

  it("has getTotalEstimatedTokens method in PromptQueue interface", () => {
    assert.ok(source.includes("getTotalEstimatedTokens:"), "PromptQueue must have getTotalEstimatedTokens method")
  })

  it("has markAsSteer method in PromptQueue interface", () => {
    assert.ok(source.includes("markAsSteer:"), "PromptQueue must have markAsSteer method")
  })

  it("has persist method in PromptQueue interface", () => {
    assert.ok(source.includes("persist:"), "PromptQueue must have persist method")
  })

  it("has restore method in PromptQueue interface", () => {
    assert.ok(source.includes("restore:"), "PromptQueue must have restore method")
  })

  it("implements reorder function", () => {
    assert.ok(source.includes("function reorder("), "must implement reorder function")
  })

  it("implements moveToFront function", () => {
    assert.ok(source.includes("function moveToFront("), "must implement moveToFront function")
  })

  it("implements moveToBack function", () => {
    assert.ok(source.includes("function moveToBack("), "must implement moveToBack function")
  })

  it("implements getEstimatedTokens function", () => {
    assert.ok(source.includes("function getEstimatedTokens("), "must implement getEstimatedTokens function")
  })

  it("implements getTotalEstimatedTokens function", () => {
    assert.ok(source.includes("function getTotalEstimatedTokens("), "must implement getTotalEstimatedTokens function")
  })

  it("implements markAsSteer function", () => {
    assert.ok(source.includes("function markAsSteer("), "must implement markAsSteer function")
  })

  it("implements persist function", () => {
    assert.ok(source.includes("function persist("), "must implement persist function")
  })

  it("implements restore function", () => {
    assert.ok(source.includes("function restore("), "must implement restore function")
  })

  it("assigns position in enqueue", () => {
    assert.ok(source.includes("position: items.length"), "enqueue must assign position")
  })

  it("estimates tokens in enqueue", () => {
    assert.ok(source.includes("estimatedTokens: estimateTextTokens("), "enqueue must estimate tokens")
  })

  it("has estimateTextTokens helper function", () => {
    assert.ok(source.includes("function estimateTextTokens("), "must have estimateTextTokens helper")
  })

  it("exports all new methods in createPromptQueue return object", () => {
    assert.ok(source.includes("reorder,"), "reorder must be exported")
    assert.ok(source.includes("moveToFront,"), "moveToFront must be exported")
    assert.ok(source.includes("moveToBack,"), "moveToBack must be exported")
    assert.ok(source.includes("getEstimatedTokens,"), "getEstimatedTokens must be exported")
    assert.ok(source.includes("getTotalEstimatedTokens,"), "getTotalEstimatedTokens must be exported")
    assert.ok(source.includes("markAsSteer,"), "markAsSteer must be exported")
    assert.ok(source.includes("persist,"), "persist must be exported")
    assert.ok(/\brestore\b/.test(source.slice(source.lastIndexOf("return {"))), "restore must be exported")
  })
})
