import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "DiffHandler.ts"), "utf8")

describe("DiffHandler.ts", () => {
  it("exports DiffHandler class", () => {
    assert.ok(source.includes("export class DiffHandler"), "DiffHandler class must be exported")
  })

  it("accepts DiffApplier in constructor", () => {
    assert.ok(
      source.includes("private readonly diffApplier: DiffApplier"),
      "constructor must accept DiffApplier"
    )
  })

  it("has pendingDiffs map for tracking diffs", () => {
    assert.ok(
      source.includes("private pendingDiffs = new Map<string, ProposedEdit>()"),
      "pendingDiffs map must exist"
    )
  })

  it("has register method that returns diffId", () => {
    assert.ok(
      source.includes("register(edit: ProposedEdit): string"),
      "register method must accept edit and return string (diffId)"
    )
    assert.ok(source.includes("const diffId = randomUUID()"), "register must generate UUID v4")
    assert.ok(source.includes("this.pendingDiffs.set(diffId, edit)"), "register must store the edit")
    assert.ok(source.includes("return diffId"), "register must return the diffId")
  })

  it("has accept method that returns result", () => {
    assert.ok(
      source.includes("async accept(diffId: string): Promise<{ ok: boolean; message?: string }>"),
      "accept method must be async and return result object"
    )
    assert.ok(source.includes("this.diffApplier.acceptEdit(edit)"), "accept must call acceptEdit")
    assert.ok(source.includes('return { ok: false, message: "Diff is no longer available." }'),
      "accept must handle missing diff")
  })

  it("accept emits diff:accepted on success", () => {
    assert.ok(source.includes("this.diffApplier.acceptEdit(edit)"), "accept must call acceptEdit")
    assert.ok(
      source.includes("type: 'diff:accepted'"),
      "accept must emit diff:accepted message"
    )
    assert.ok(source.includes("this.emitToWebview?."), "accept must call emitToWebview")
  })

  it("accept handles failure gracefully with diff:error", () => {
    assert.ok(
      source.includes("diffApplier.acceptEdit(edit)"),
      "must attempt to apply edit"
    )
    assert.ok(
      source.includes("type: 'diff:error'"),
      "must emit diff:error on failure"
    )
    assert.ok(
      source.includes("Never leave the webview"),
      "must have comment about not leaving webview stuck"
    )
  })

  it("has reject method", () => {
    assert.ok(source.includes("reject(diffId: string): void"), "reject method must exist")
    assert.ok(source.includes("this.pendingDiffs.delete(diffId)"), "reject must delete from map")
    assert.ok(source.includes("this.acceptingDiffs.delete(diffId)"), "reject must clear accepting set")
  })

  it("reject emits diff:discarded and removes from registry", () => {
    assert.ok(source.includes("reject(diffId: string): void"), "reject method must exist")
    assert.ok(
      source.includes("type: 'diff:discarded'"),
      "reject must emit diff:discarded message"
    )
    assert.ok(source.includes("this.pendingDiffs.delete(diffId)"), "reject must remove from map")
    assert.ok(source.includes("this.emitToWebview?."), "reject must call emitToWebview")
  })

  it("has setMessageId method as no-op", () => {
    assert.ok(source.includes("setMessageId(_diffId: string, _messageId: string): void"),
      "setMessageId method must exist")
    assert.ok(source.includes("No longer needed"), "setMessageId is now a no-op")
  })

  it("uses UUID v4 for stable diffId", () => {
    assert.ok(source.includes("import { randomUUID } from \"crypto\""), "must import randomUUID")
    assert.ok(source.includes("const diffId = randomUUID()"), "must use crypto.randomUUID() for diffId")
  })

  it("has emitToWebview callback as optional property", () => {
    assert.ok(
      source.includes("emitToWebview?: (msg: Record<string, unknown>) => void"),
      "emitToWebview must be an optional property"
    )
  })

  it("has dispose method that clears all pending diffs", () => {
    assert.ok(source.includes("dispose(): void"), "dispose method must exist")
    assert.ok(source.includes("this.pendingDiffs.clear()"), "dispose must clear the map")
    assert.ok(source.includes("this.acceptingDiffs.clear()"), "dispose must clear accepting set")
  })

  it("never leaves webview stuck on error", () => {
    assert.ok(
      source.includes("try {"),
      "accept must have try-catch"
    )
    assert.ok(
      source.includes("catch (e)"),
      "must catch errors in accept"
    )
    assert.ok(
      source.includes("this.emitToWebview?.("),
      "must emit error to unstick webview"
    )
  })

  it("has acceptingDiffs set to prevent double-apply race", () => {
    assert.ok(source.includes("private acceptingDiffs = new Set<string>()"), "must track accepting diffs")
    assert.ok(source.includes("this.acceptingDiffs.has(diffId)"), "must check for concurrent accept")
    assert.ok(source.includes("this.acceptingDiffs.add(diffId)"), "must mark as accepting")
    assert.ok(source.includes("this.acceptingDiffs.delete(diffId)"), "must clear accepting flag")
  })
})
