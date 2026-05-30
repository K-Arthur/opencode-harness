/**
 * Behavioral tests for the SDK FileContent → DiffLine[] normalizer. The
 * changed-files dropdown's per-file expansion depends on this turning the
 * server's diff (structured patch or unified string) into rows with correct
 * old/new line numbers and add/remove/context typing.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { sdkFileContentToDiffLines, parseUnifiedDiff } from "./sdkFileContentToDiffLines"

describe("sdkFileContentToDiffLines — structured patch", () => {
  it("maps hunk lines to typed DiffLines with correct line numbers", () => {
    const lines = sdkFileContentToDiffLines({
      type: "text",
      content: "",
      patch: {
        hunks: [
          {
            oldStart: 10,
            oldLines: 2,
            newStart: 10,
            newLines: 3,
            lines: [" ctx", "-removed", "+added one", "+added two"],
          },
        ],
      },
    })
    assert.deepEqual(lines, [
      { type: "context", oldLine: 10, newLine: 10, content: "ctx" },
      { type: "removed", oldLine: 11, content: "removed" },
      { type: "added", newLine: 11, content: "added one" },
      { type: "added", newLine: 12, content: "added two" },
    ])
  })

  it("ignores the '\\ No newline at end of file' marker", () => {
    const lines = sdkFileContentToDiffLines({
      patch: { hunks: [{ oldStart: 1, newStart: 1, lines: ["-a", "+b", "\\ No newline at end of file"] }] },
    })
    assert.equal(lines.length, 2)
    assert.deepEqual(lines.map((l) => l.type), ["removed", "added"])
  })

  it("flattens multiple hunks in order", () => {
    const lines = sdkFileContentToDiffLines({
      patch: {
        hunks: [
          { oldStart: 1, newStart: 1, lines: ["+first"] },
          { oldStart: 50, newStart: 51, lines: ["+second"] },
        ],
      },
    })
    assert.equal(lines.length, 2)
    assert.equal(lines[0]!.newLine, 1)
    assert.equal(lines[1]!.newLine, 51)
  })
})

describe("sdkFileContentToDiffLines — unified diff fallback", () => {
  it("parses a unified diff string when no structured patch is present", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n")
    const lines = sdkFileContentToDiffLines({ diff })
    assert.deepEqual(lines, [
      { type: "context", oldLine: 1, newLine: 1, content: "keep" },
      { type: "removed", oldLine: 2, content: "old" },
      { type: "added", newLine: 2, content: "new" },
    ])
  })

  it("prefers structured patch over the diff string when both exist", () => {
    const lines = sdkFileContentToDiffLines({
      diff: "@@ -1 +1 @@\n+from-diff",
      patch: { hunks: [{ oldStart: 1, newStart: 1, lines: ["+from-patch"] }] },
    })
    assert.equal(lines.length, 1)
    assert.equal(lines[0]!.content, "from-patch")
  })

  it("resets line counters at each @@ hunk header", () => {
    const diff = "@@ -1 +1 @@\n+a\n@@ -100,0 +200,1 @@\n+b"
    const lines = parseUnifiedDiff(diff)
    assert.equal(lines[0]!.newLine, 1)
    assert.equal(lines[1]!.newLine, 200)
  })
})

describe("sdkFileContentToDiffLines — empty / binary", () => {
  it("returns [] for null, binary, or no-diff content", () => {
    assert.deepEqual(sdkFileContentToDiffLines(null), [])
    assert.deepEqual(sdkFileContentToDiffLines(undefined), [])
    assert.deepEqual(sdkFileContentToDiffLines({ type: "binary", content: "..." }), [])
    assert.deepEqual(sdkFileContentToDiffLines({ type: "text", content: "x", diff: "   " }), [])
  })
})
