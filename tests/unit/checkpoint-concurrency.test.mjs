import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "..", "..", "src", "checkpoint", "CheckpointManager.ts"), "utf8")

describe("T1.2 — CheckpointManager TOCTOU race", () => {
  it("replaces boolean snapshotLock with promise-chain serializer", () => {
    assert.ok(!source.includes("snapshotLock = false"), "must not have boolean snapshotLock")
    assert.ok(!source.includes("snapshotLock = true"), "must not set snapshotLock to true")
    assert.ok(!source.includes("if (this.snapshotLock)"), "must not guard with snapshotLock boolean")
  })

  it("uses snapshotQueue promise chain for serialization", () => {
    assert.ok(source.includes("private snapshotQueue: Promise<unknown> = Promise.resolve()"), "must declare snapshotQueue")
    assert.ok(source.includes("this.snapshotQueue.then(() => this.snapshotImpl("), "snapshot must chain on snapshotQueue")
    assert.ok(source.includes("this.snapshotQueue = next.catch(() => {})"), "must swallow rejection on chain")
  })

  it("extracts snapshot body into snapshotImpl method", () => {
    assert.ok(source.includes("private async snapshotImpl("), "must have snapshotImpl method")
  })

  it("guards empty uniqueFiles in snapshotImpl", () => {
    assert.ok(source.includes("uniqueFiles.length === 0"), "snapshotImpl must guard empty files")
  })

  it("snapshot returns Checkpoint | null", () => {
    const snapshotMatch = source.match(/async snapshot\([^)]+\): Promise<Checkpoint \| null>/)
    assert.ok(snapshotMatch, "snapshot must return Promise<Checkpoint | null>")
  })
})
