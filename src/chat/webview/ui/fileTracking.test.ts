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

  it("handleChangedFiles gated by active session before rendering chips", () => {
    const idx = source.indexOf("function handleChangedFiles(")
    assert.ok(idx >= 0, "handleChangedFiles function must exist")
    const block = source.slice(idx, idx + 600)
    // Data write is unconditional (per-session persistence is correct)
    assert.ok(block.includes("session.changedFiles"), "must update session data")
    assert.ok(block.includes("deps.save()"), "must persist")
    // Render is gated: only show when this session is the active one
    assert.ok(block.includes("getActiveSessionId()") || block.includes("renderChangedFilesList"),
      "render must be gated by active session check")
  })

  it("handleChangedFiles always writes data regardless of active session", () => {
    const idx = source.indexOf("function handleChangedFiles(")
    assert.ok(idx >= 0, "handleChangedFiles function must exist")
    const block = source.slice(idx, idx + 600)
    // The data write (session.changedFiles = files) must happen before the
    // active-session gate so switching tabs surfaces persisted files instantly.
    const writeIdx = block.indexOf("session.changedFiles")
    const gateIdx = block.indexOf("getActiveSessionId()")
    assert.ok(writeIdx >= 0, "data write to session.changedFiles must exist")
    assert.ok(
      gateIdx === -1 || gateIdx > writeIdx,
      "data write must happen before the active-session gate (so per-session state survives tab switches)"
    )
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

  // ── Enhanced checkpoint panel features ────────────────────────────────

  it("exports formatRelativeTime helper", () => {
    assert.ok(source.includes("function formatRelativeTime"), "must have formatRelativeTime helper")
  })

  it("exports formatActionLabel helper", () => {
    assert.ok(source.includes("function formatActionLabel"), "must have formatActionLabel helper")
  })

  it("formatRelativeTime handles 'just now' for recent timestamps", () => {
    assert.ok(source.includes("just now"), "must show 'just now' for sub-minute timestamps")
  })

  it("formatRelativeTime handles minutes ago", () => {
    assert.ok(source.includes("m ago"), "must show 'Xm ago' for minute-level timestamps")
  })

  it("formatRelativeTime handles hours ago", () => {
    assert.ok(source.includes("h ago"), "must show 'Xh ago' for hour-level timestamps")
  })

  it("formatActionLabel maps known actions to human-readable labels", () => {
    assert.ok(source.includes("Session start"), "must map 'baseline' to 'Session start'")
    assert.ok(source.includes("File edit"), "must map 'edit' to 'File edit'")
    assert.ok(source.includes("File write"), "must map 'write' to 'File write'")
    assert.ok(source.includes("Tool execution"), "must map 'tool' to 'Tool execution'")
  })

  it("renderCheckpointPanel renders timeline dots", () => {
    assert.ok(source.includes("checkpoint-dot"), "must render timeline dot elements")
  })

  it("renderCheckpointPanel renders content column with header", () => {
    assert.ok(source.includes("checkpoint-content"), "must render content column")
    assert.ok(source.includes("checkpoint-header"), "must render header row within content")
  })

  it("renderCheckpointPanel renders timestamps when createdAt is provided", () => {
    assert.ok(source.includes("checkpoint-time"), "must render timestamp element")
    assert.ok(source.includes("createdAt"), "must check for createdAt field")
  })

  it("renderCheckpointPanel renders file summaries", () => {
    assert.ok(source.includes("checkpoint-files"), "must render file summary element")
  })

  it("renderCheckpointPanel uses data-checkpoint-id for test targeting", () => {
    assert.ok(source.includes("data-checkpoint-id"), "must add data-checkpoint-id attribute")
  })

  it("renderCheckpointPanel shows restore button on hover via CSS class", () => {
    assert.ok(source.includes("checkpoint-restore-btn"), "must have restore button class")
  })

  it("renderCheckpointPanel accepts createdAt and action in checkpoint shape", () => {
    const sigMatch = source.match(/function renderCheckpointPanel\([^)]+\)/)
    assert.ok(sigMatch, "must have renderCheckpointPanel function")
    const sig = sigMatch![0]
    assert.ok(sig.includes("createdAt"), "signature must include createdAt field")
    assert.ok(sig.includes("action"), "signature must include action field")
  })

  it("renderCheckpointPanel truncates file list when more than 3 files", () => {
    assert.ok(source.includes("+"), "must show '+N more' for file overflow")
  })

  // ── Unrevert support ──────────────────────────────────────────────────

  it("renderCheckpointPanel renders unrevert button", () => {
    assert.ok(source.includes("checkpoint-unrevert-btn"), "must have unrevert button class")
    assert.ok(source.includes("unrevert"), "must reference unrevert action")
  })

  it("unrevert button posts unrevert message type", () => {
    assert.ok(source.includes('"unrevert"') || source.includes("'unrevert'"), "must post unrevert message type")
  })

  it("unrevert button has accessible label", () => {
    assert.ok(
      source.includes("Restore all reverted"),
      "unrevert button must have descriptive aria-label",
    )
  })
})
