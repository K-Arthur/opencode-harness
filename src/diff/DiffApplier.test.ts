/**
 * Sprint 3 / C1-a: structural tests for the trimmed DiffApplier.
 *
 * The original file (~355 lines) was stripped to only the VS Code diff
 * editor entry point (showSideBySideDiff) + the opencode-diff:// content
 * provider. All the accept/reject/backup/parseCodeBlocks/generateDiff/
 * parseUnifiedDiff/applyHunks paths were removed because the SDK applies
 * edits server-side and never emits a `diff` part type — the entire
 * client-side accept/reject path was unreachable in production.
 *
 * These tests assert the survival of the core diff-entry primitives that
 * are reused for the new open_changed_file_diff action (M7).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "DiffApplier.ts"), "utf8")

describe("DiffApplier.ts (trimmed C1-a)", () => {
  it("keeps ProposedEdit interface for backward compatibility", () => {
    assert.ok(source.includes("export interface ProposedEdit"), "ProposedEdit must survive")
    assert.ok(source.includes("filePath"), "ProposedEdit must have filePath")
    assert.ok(source.includes("proposedContent"), "ProposedEdit must have proposedContent")
  })

  it("has showSideBySideDiff method", () => {
    assert.ok(source.includes("showSideBySideDiff("), "showSideBySideDiff must survive")
    assert.ok(source.includes("vscode.diff"), "showSideBySideDiff must call vscode.diff")
  })

  it("has opencode-diff:// content provider", () => {
    assert.ok(source.includes("opencode-diff:"), "opencode-diff URI scheme must be registered")
    assert.ok(
      source.includes("TextDocumentContentProvider") || source.includes("registerTextDocumentContentProvider"),
      "a TextDocumentContentProvider must be registered for the opencode-diff scheme"
    )
  })

  it("has diffDocuments Map for content storage", () => {
    assert.ok(source.includes("diffDocuments"), "diffDocuments Map must survive")
  })

  it("removes parseCodeBlocks (C1-a dead code)", () => {
    assert.ok(!source.includes("parseCodeBlocks("), "C1-a: parseCodeBlocks must be removed")
  })

  it("removes extractCodeBlocks (C1-a)", () => {
    assert.ok(!source.includes("extractCodeBlocks("), "C1-a: extractCodeBlocks must be removed")
  })

  it("removes parseFenceInfo (C1-a)", () => {
    assert.ok(!source.includes("parseFenceInfo("), "C1-a: parseFenceInfo must be removed")
  })

  it("removes generateDiff (C1-a)", () => {
    assert.ok(!source.includes("generateDiff("), "C1-a: generateDiff must be removed")
  })

  it("removes acceptEdit (C1-a)", () => {
    assert.ok(!source.includes("acceptEdit("), "C1-a: acceptEdit must be removed")
  })

  it("removes rollbackEdit (C1-a)", () => {
    assert.ok(!source.includes("rollbackEdit("), "C1-a: rollbackEdit must be removed")
  })

  it("removes parseUnifiedDiff (C1-a)", () => {
    assert.ok(!source.includes("parseUnifiedDiff("), "C1-a: parseUnifiedDiff must be removed")
  })

  it("removes applyHunks (C1-a)", () => {
    assert.ok(!source.includes("applyHunks("), "C1-a: applyHunks must be removed")
  })

  it("removes acceptedEdits Map (C1-a)", () => {
    assert.ok(!source.includes("acceptedEdits"), "C1-a: acceptedEdits must be removed")
  })

  it("removes createBackup (C1-a)", () => {
    assert.ok(!source.includes("createBackup"), "C1-a: createBackup must be removed")
  })
})
