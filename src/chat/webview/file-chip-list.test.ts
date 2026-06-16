/**
 * Unit tests for the shared file-chip-list helper.
 * Verifies both the persistent strip and the inline task banner produce
 * identical chip markup, eliminating the two divergent codepaths that
 * previously made the "edited N files" card balloon while the bottom
 * strip stayed compact.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  renderFileChipListHtml,
  splitFileList,
  escapeHtml,
  parseEditBannerFiles,
  mergeEditBannerFiles,
  getExtBadgeLabel,
} from "./file-chip-list"

describe("file-chip-list — escapeHtml", () => {
  it("escapes all dangerous characters", () => {
    assert.equal(
      escapeHtml(`<img src="x" onerror="alert(1)">`),
      "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;",
    )
  })

  it("preserves benign content", () => {
    assert.equal(escapeHtml("src/foo/bar.ts"), "src/foo/bar.ts")
  })
})

describe("file-chip-list — getExtBadgeLabel", () => {
  it("maps .ts to TS", () => {
    assert.equal(getExtBadgeLabel("foo.ts"), "TS")
  })

  it("maps .tsx to TSX", () => {
    assert.equal(getExtBadgeLabel("foo.tsx"), "TSX")
  })

  it("maps .py to PY", () => {
    assert.equal(getExtBadgeLabel("foo.py"), "PY")
  })

  it("maps .js to JS", () => {
    assert.equal(getExtBadgeLabel("foo.js"), "JS")
  })

  it("maps .go to GO", () => {
    assert.equal(getExtBadgeLabel("main.go"), "GO")
  })

  it("maps .rs to RS", () => {
    assert.equal(getExtBadgeLabel("lib.rs"), "RS")
  })

  it("returns uppercased ext for unknown extensions", () => {
    assert.equal(getExtBadgeLabel("foo.xyz"), "XYZ")
  })

  it("handles files with no extension", () => {
    assert.equal(getExtBadgeLabel("Makefile"), "MK")
  })

  it("handles paths with directories", () => {
    assert.equal(getExtBadgeLabel("src/components/App.tsx"), "TSX")
  })
})

describe("file-chip-list — splitFileList", () => {
  it("returns all files when count <= maxVisible", () => {
    const { visible, overflow } = splitFileList(["a", "b", "c"], 5)
    assert.deepEqual(visible, ["a", "b", "c"])
    assert.equal(overflow, 0)
  })

  it("splits at maxVisible with overflow count", () => {
    const { visible, overflow } = splitFileList(["a", "b", "c", "d", "e", "f", "g"], 3)
    assert.deepEqual(visible, ["a", "b", "c"])
    assert.equal(overflow, 4)
  })

  it("handles empty list", () => {
    const { visible, overflow } = splitFileList([], 5)
    assert.deepEqual(visible, [])
    assert.equal(overflow, 0)
  })
})

describe("file-chip-list — renderFileChipListHtml (chip DOM)", () => {
  it("renders .file-chip button with data-path and basename", () => {
    const html = renderFileChipListHtml(["src/foo/bar.ts"])
    assert.ok(html.includes(`class="file-chip"`), "must use .file-chip class")
    assert.ok(html.includes(`data-path="src/foo/bar.ts"`), "must have data-path")
    assert.ok(html.includes(">bar.ts<"), "must show basename")
  })

  it("renders extension badge with data-lang attribute", () => {
    const html = renderFileChipListHtml(["src/foo/bar.ts"])
    assert.ok(html.includes(`class="file-chip__ext"`), "must have ext badge")
    assert.ok(html.includes(`data-lang="typescript"`), "must set data-lang")
    assert.ok(html.includes(">TS<"), "must show TS badge label")
  })

  it("renders remove button with .file-chip__remove", () => {
    const html = renderFileChipListHtml(["src/foo/bar.ts"])
    assert.ok(html.includes(`class="file-chip__remove"`), "must have remove button")
    assert.ok(html.includes(`aria-label="Remove bar.ts"`), "must have accessible label")
  })

  it("renders chips as <button> elements for native keyboard accessibility", () => {
    const html = renderFileChipListHtml(["src/foo/bar.ts"])
    assert.ok(html.includes(`<button class="file-chip"`), "must be a <button>")
  })

  it("sets tabindex=0 on chips for Tab navigation", () => {
    const html = renderFileChipListHtml(["a.ts", "b.ts"])
    const count = (html.match(/tabindex="0"/g) || []).length
    assert.ok(count >= 2, "each chip must have tabindex=0")
  })

  it("includes count label and divider by default", () => {
    const html = renderFileChipListHtml(["a.ts", "b.ts"])
    assert.ok(html.includes(`cf-strip-label`))
    assert.ok(html.includes(`2 files`))
    assert.ok(html.includes(`cf-strip-divider`))
  })

  it("uses singular 'file' for a single file", () => {
    const html = renderFileChipListHtml(["a.ts"])
    assert.ok(html.match(/1 file(?!s)/), "must say '1 file' not '1 files'")
  })

  it("includes leading icon by default", () => {
    const html = renderFileChipListHtml(["a.ts"])
    assert.ok(html.includes(`cf-strip-icon`))
    assert.ok(html.includes(`<svg`))
  })

  it("omits count label when showCountLabel=false", () => {
    const html = renderFileChipListHtml(["a.ts"], { showCountLabel: false })
    assert.ok(!html.includes(`cf-strip-label`))
    assert.ok(!html.includes(`cf-strip-divider`))
  })

  it("omits icon when showLeadingIcon=false", () => {
    const html = renderFileChipListHtml(["a.ts"], { showLeadingIcon: false })
    assert.ok(!html.includes(`cf-strip-icon`))
  })

  it("collapses overflow into +N more pill", () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"]
    const html = renderFileChipListHtml(files, { maxVisible: 3 })
    assert.ok(html.includes(`+4 more`))
    assert.ok(html.includes(`cf-strip-overflow`))
    // Only first 3 chips rendered
    assert.equal((html.match(/class="file-chip"/g) || []).length, 3)
  })

  it("escapes HTML in file paths to prevent injection", () => {
    const html = renderFileChipListHtml([`<script>alert(1)</script>.ts`])
    assert.ok(!html.includes("<script>"), "raw <script> must not appear")
    assert.ok(html.includes("&lt;script&gt;"), "escaped marker must appear")
  })

  it("escapes HTML in remove button aria-label", () => {
    const html = renderFileChipListHtml([`src/a<b>.ts`])
    assert.ok(!html.match(/aria-label="Remove a<b>/), "aria-label must be escaped")
    assert.ok(html.includes("&lt;b&gt;"), "must escape angle brackets in label")
  })

  it("produces identical output for identical input (deterministic)", () => {
    const files = ["src/StreamCoordinator.ts", "src/main.ts", "tests/foo.test.mjs"]
    const a = renderFileChipListHtml(files, { maxVisible: 5, showCountLabel: true, showLeadingIcon: true })
    const b = renderFileChipListHtml(files, { maxVisible: 5, showCountLabel: true, showLeadingIcon: true })
    assert.equal(a, b, "shared helper must produce byte-identical output for identical input")
  })

  it("renders empty string for empty file list without icon/label", () => {
    const html = renderFileChipListHtml([], { showCountLabel: false, showLeadingIcon: false })
    assert.equal(html, "")
  })

  it("maps .py extension to PY badge with python data-lang", () => {
    const html = renderFileChipListHtml(["src/main.py"])
    assert.ok(html.includes(`data-lang="python"`))
    assert.ok(html.includes(">PY<"))
  })

  it("maps .go extension to GO badge with go data-lang", () => {
    const html = renderFileChipListHtml(["cmd/server.go"])
    assert.ok(html.includes(`data-lang="go"`))
    assert.ok(html.includes(">GO<"))
  })

  it("maps .rs extension to RS badge with rust data-lang", () => {
    const html = renderFileChipListHtml(["src/lib.rs"])
    assert.ok(html.includes(`data-lang="rust"`))
    assert.ok(html.includes(">RS<"))
  })
})

describe("file-chip-list — parseEditBannerFiles", () => {
  it("parses multi-file banner text", () => {
    const files = parseEditBannerFiles("Edited 3 files: a.ts, b.ts, c.ts")
    assert.deepEqual(files, ["a.ts", "b.ts", "c.ts"])
  })

  it("parses single-file banner text (full path)", () => {
    const files = parseEditBannerFiles("Edited src/foo/bar.ts")
    assert.deepEqual(files, ["src/foo/bar.ts"])
  })

  it("returns empty for unrecognized text", () => {
    assert.deepEqual(parseEditBannerFiles("Some other text"), [])
    assert.deepEqual(parseEditBannerFiles(""), [])
  })

  it("trims whitespace and drops empty entries", () => {
    const files = parseEditBannerFiles("Edited 2 files:   a.ts ,  b.ts , ")
    assert.deepEqual(files, ["a.ts", "b.ts"])
  })
})

describe("file-chip-list — mergeEditBannerFiles", () => {
  it("merges two distinct file lists, dropping duplicates", () => {
    const merged = mergeEditBannerFiles(
      "Edited 2 files: a.ts, b.ts",
      "Edited 2 files: c.ts, d.ts",
    )
    assert.equal(merged, "Edited 4 files: a.ts, b.ts, c.ts, d.ts")
  })

  it("dedupes overlapping entries (b.ts appears once)", () => {
    const merged = mergeEditBannerFiles(
      "Edited 2 files: a.ts, b.ts",
      "Edited 2 files: b.ts, c.ts",
    )
    assert.equal(merged, "Edited 3 files: a.ts, b.ts, c.ts")
  })

  it("upgrades single-file banner to multi-file when merging", () => {
    const merged = mergeEditBannerFiles("Edited a.ts", "Edited b.ts")
    assert.equal(merged, "Edited 2 files: a.ts, b.ts")
  })

  it("preserves single-file form when merge yields one file (idempotent)", () => {
    const merged = mergeEditBannerFiles("Edited a.ts", "Edited a.ts")
    assert.equal(merged, "Edited a.ts")
  })

  it("returns the existing text when both inputs are unparseable", () => {
    const merged = mergeEditBannerFiles("Random text", "Other text")
    assert.equal(merged, "Random text")
  })

  it("strips path to basename in merged comma-separated list (matches batcher format)", () => {
    const merged = mergeEditBannerFiles(
      "Edited src/a.ts",
      "Edited src/sub/b.ts",
    )
    assert.equal(merged, "Edited 2 files: a.ts, b.ts")
  })
})

describe("file-chip-list — aggregate diff stats", () => {
  it("renders +added/−removed totals after the count label when stats are provided", () => {
    const html = renderFileChipListHtml(["src/a.ts", "src/b.ts"], {
      showCountLabel: true,
      countLabelSuffix: "changed",
      stats: { added: 12, removed: 4 },
    })
    assert.match(html, /class="cf-strip-stats"/)
    assert.match(html, /class="cf-strip-added"[^>]*>\+12</)
    assert.match(html, /class="cf-strip-removed"[^>]*>−4</)
  })

  it("omits the stats block when stats are absent or zero", () => {
    assert.doesNotMatch(renderFileChipListHtml(["a.ts"]), /cf-strip-stats/)
    assert.doesNotMatch(
      renderFileChipListHtml(["a.ts"], { stats: { added: 0, removed: 0 } }),
      /cf-strip-stats/,
    )
  })
})
