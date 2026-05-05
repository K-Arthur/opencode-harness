import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "DiffApplier.ts"), "utf8")

describe("DiffApplier.ts", () => {
  it("exports ProposedEdit interface", () => {
    assert.ok(source.includes("export interface ProposedEdit"))
  })

  it("exports DiffApplier class", () => {
    assert.ok(source.includes("export class DiffApplier"))
  })

  it("ProposedEdit has expected fields", () => {
    assert.ok(source.includes("filePath: string"))
    assert.ok(source.includes("originalContent: string"))
    assert.ok(source.includes("proposedContent: string"))
    assert.ok(source.includes("messageId: string"))
    assert.ok(source.includes("blockId: string"))
    assert.ok(source.includes("backupPath?"))
  })

  it("has parseCodeBlocks method", () => {
    assert.ok(source.includes("parseCodeBlocks("))
  })

  it("has extractCodeBlocks private method", () => {
    assert.ok(source.includes("private extractCodeBlocks("))
  })

  it("has parseFenceInfo private method", () => {
    assert.ok(source.includes("private parseFenceInfo("))
  })

  it("has generateDiff method", () => {
    assert.ok(source.includes("async generateDiff("))
  })

  it("has acceptEdit method", () => {
    assert.ok(source.includes("async acceptEdit("))
  })

  it("has rollbackEdit method", () => {
    assert.ok(source.includes("async rollbackEdit("))
  })
})
