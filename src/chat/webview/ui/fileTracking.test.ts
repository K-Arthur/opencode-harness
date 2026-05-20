import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "fileTracking.ts"), "utf8")

describe("fileTracking.ts", () => {
  it("exports renderChangedFilesList", () => {
    assert.ok(source.includes("export function renderChangedFilesList"), "must export renderChangedFilesList")
  })

  it("renders_file_chips_with_icons", () => {
    assert.ok(source.includes("changed-file-icon"), "must add icon element to chips")
    assert.ok(source.includes("getFileIcon"), "must have getFileIcon function")
    assert.ok(source.includes("iconMap"), "must have icon mapping for file types")
  })

  it("renders_file_chips_with_status_indicators", () => {
    assert.ok(source.includes("changed-file-status"), "must add status element to chips")
    assert.ok(source.includes("changed-file-status--modified"), "must support modified status")
  })

  it("renders_file_chips_with_test_ids", () => {
    assert.ok(source.includes('data-testid'), "must add test-id attribute to chips")
    assert.ok(source.includes("changed-file-"), "test-id must include file identifier")
  })

  it("renders_file_chips_with_overflow_handling", () => {
    assert.ok(source.includes("changed-file-name"), "must have name element for truncation")
  })

  it("supports_common_file_extensions", () => {
    assert.ok(source.includes('ts:'), "must support TypeScript")
    assert.ok(source.includes('js:'), "must support JavaScript")
    assert.ok(source.includes('py:'), "must support Python")
    assert.ok(source.includes('rs:'), "must support Rust")
    assert.ok(source.includes('go:'), "must support Go")
    assert.ok(source.includes('json:'), "must support JSON")
    assert.ok(source.includes('md:'), "must support Markdown")
    assert.ok(source.includes('css:'), "must support CSS")
    assert.ok(source.includes('html:'), "must support HTML")
    assert.ok(source.includes('yaml:'), "must support YAML")
  })

  it("exports trackFileChange", () => {
    assert.ok(source.includes("export function trackFileChange"), "must export trackFileChange")
  })

  it("exports handleChangedFiles", () => {
    assert.ok(source.includes("export function handleChangedFiles"), "must export handleChangedFiles")
  })

  it("exports handleClearMessages", () => {
    assert.ok(source.includes("export function handleClearMessages"), "must export handleClearMessages")
  })

  it("exports renderCheckpointPanel", () => {
    assert.ok(source.includes("export function renderCheckpointPanel"), "must export renderCheckpointPanel")
  })
})
