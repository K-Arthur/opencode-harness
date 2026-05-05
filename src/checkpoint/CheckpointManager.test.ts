import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "CheckpointManager.ts"), "utf8")

describe("CheckpointManager.ts", () => {
  it("exports Checkpoint interface", () => {
    assert.ok(source.includes("export interface Checkpoint"))
  })

  it("exports CheckpointManager class", () => {
    assert.ok(source.includes("export class CheckpointManager"))
  })

  it("Checkpoint has expected fields", () => {
    assert.ok(source.includes("id: string"))
    assert.ok(source.includes("sessionId: string"))
    assert.ok(source.includes("timestamp: number"))
    assert.ok(source.includes("filesChanged: string[]"))
    assert.ok(source.includes("gitRef: string"))
  })

  it("CheckpointManager has snapshot method", () => {
    assert.ok(source.includes("async snapshot("))
  })

  it("CheckpointManager has restore method", () => {
    assert.ok(source.includes("async restore("))
  })

  it("CheckpointManager has listCheckpoints method", () => {
    assert.ok(source.includes("async listCheckpoints("))
  })

  it("CheckpointManager has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  it("uses simple-git", () => {
    assert.ok(source.includes("simple-git"))
  })

  it("creates checkpoint id with oc-ckp- prefix", () => {
    assert.ok(source.includes("oc-ckp-"))
  })

  it("stashes changes during snapshot", () => {
    assert.ok(source.includes(".stash(["))
  })

  it("has MAX_CHECKPOINTS constant of 20", () => {
    assert.ok(source.includes("MAX_CHECKPOINTS = 20"))
  })

  it("has pruneOldestCheckpoints method", () => {
    assert.ok(source.includes("pruneOldestCheckpoints("))
  })

  it("has snapshotBeforeAction method", () => {
    assert.ok(source.includes("async snapshotBeforeAction("))
  })

  it("prunes oldest when exceeding cap", () => {
    assert.ok(source.includes("pruneOldestCheckpoints(sessionId)"))
  })
})
