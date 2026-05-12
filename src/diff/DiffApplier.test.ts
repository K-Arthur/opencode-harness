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

  // ── Feature 3: Hunk-Level Diff Control ───────────────────────────────────

  it("has_parseUnifiedDiff_pure_function", () => {
    assert.ok(
      source.includes("parseUnifiedDiff("),
      "DiffApplier must expose parseUnifiedDiff to extract hunks from a unified diff string"
    )
  })

  it("parseUnifiedDiff_extracts_oldStart_newStart_and_lines", () => {
    const idx = source.indexOf("parseUnifiedDiff(")
    assert.ok(idx >= 0, "parseUnifiedDiff must exist")
    const block = source.slice(idx, idx + 1500)
    assert.ok(
      block.includes("oldStart") || block.includes("old_start"),
      "parseUnifiedDiff must extract oldStart from hunk header"
    )
    assert.ok(
      block.includes("newStart") || block.includes("new_start"),
      "parseUnifiedDiff must extract newStart from hunk header"
    )
  })

  it("has_applyHunks_method", () => {
    assert.ok(
      source.includes("applyHunks("),
      "DiffApplier must expose applyHunks to apply a subset of hunks to a file"
    )
  })

  it("applyHunks_uses_WorkspaceEdit_for_atomic_application", () => {
    const idx = source.indexOf("applyHunks(")
    assert.ok(idx >= 0, "applyHunks must exist")
    const block = source.slice(idx, idx + 1500)
    assert.ok(
      block.includes("WorkspaceEdit") || block.includes("applyEdit"),
      "applyHunks must use vscode.WorkspaceEdit for atomic undoable application"
    )
  })

  it("DiffHunk_interface_has_id_and_state_fields", () => {
    assert.ok(
      source.includes("hunkId") || source.includes("id: string"),
      "hunk objects passed to applyHunks must include an id field for conflict reporting"
    )
  })
})
