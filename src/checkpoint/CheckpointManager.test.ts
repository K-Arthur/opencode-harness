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
    assert.ok(source.includes("createdAt: number"))
    assert.ok(source.includes("action?: string"))
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

  it("uses VS Code workspace storage snapshots instead of git branch checkout", () => {
    assert.ok(!source.includes("simple-git"), "CheckpointManager must not depend on git for extension-local snapshots")
    assert.ok(!source.includes(".checkout("), "restore must not switch the user's git branch")
    assert.ok(!source.includes(".stash("), "snapshot must not mutate the user's git stash")
    assert.ok(source.includes("workspace.fs"), "snapshots must use VS Code workspace.fs")
    assert.ok(source.includes("WorkspaceEdit"), "restore must use VS Code WorkspaceEdit for undoable writes")
  })

  it("creates checkpoint id with oc-ckp- prefix", () => {
    assert.ok(source.includes("oc-ckp-"))
  })

  it("snapshots explicit file paths", () => {
    assert.ok(
      source.includes("files: string[]") || source.includes("filePaths: string[]"),
      "snapshot APIs must accept explicit file paths"
    )
    assert.ok(source.includes("snapshotBeforeAction("), "must keep pre-action snapshot API")
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
