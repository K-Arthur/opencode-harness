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

  // ── Per-extension icons must be visually distinct, not duplicate art.
  // Previously every extension mapped to the same generic SVG path which
  // made the changed-files component useless for at-a-glance recognition.
  it("file icons are visually distinct per language family", () => {
    const classNames = [
      "changed-file-icon--ts",
      "changed-file-icon--js",
      "changed-file-icon--py",
      "changed-file-icon--rs",
      "changed-file-icon--go",
      "changed-file-icon--json",
      "changed-file-icon--md",
      "changed-file-icon--css",
      "changed-file-icon--html",
      "changed-file-icon--yaml",
    ]
    for (const cls of classNames) {
      assert.ok(source.includes(cls), `iconMap must reference distinct className '${cls}'`)
    }
  })

  it("getFileIcon returns a FileTypeMeta with label + className, not raw SVG markup", () => {
    assert.ok(
      /interface\s+FileTypeMeta\s*\{[^}]*label:\s*string[^}]*className:\s*string/.test(source),
      "must declare FileTypeMeta interface with label and className fields"
    )
    assert.ok(
      !/getFileIcon[\s\S]{0,200}<svg/i.test(source),
      "getFileIcon must no longer return inline SVG markup (caused identical icons across extensions)"
    )
  })

  it("getFileIcon handles extensionless filenames with a default badge", () => {
    assert.ok(
      /FIL[\s\S]{0,50}changed-file-icon--default/.test(source) ||
        /changed-file-icon--default[\s\S]{0,50}FIL/.test(source),
      "must return a default badge for files without a recognized extension"
    )
  })

  it("renderChangedFilesList sets icon aria-hidden so screen readers skip the badge", () => {
    assert.ok(
      /aria-hidden["']?,\s*["']true["']/.test(source) || source.includes('setAttribute("aria-hidden", "true")'),
      "icon span must be aria-hidden since the filename next to it is the accessible label"
    )
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

  it("checkpoint panel shows an empty state instead of making the toolbar button appear inert", () => {
    assert.ok(
      source.includes("No checkpoints yet"),
      "empty checkpoint lists must render a visible empty state",
    )
    assert.ok(
      source.includes("checkpoint-empty"),
      "empty checkpoint state must have a stable class for styling and tests",
    )
    assert.ok(
      !source.includes("checkpoints.length === 0) {\n    panel.classList.add(\"hidden\")"),
      "checkpoint panel must not immediately hide when a list request returns no checkpoints",
    )
  })
})
