import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "renderer.ts"), "utf8")

describe("renderer.ts", () => {
  it("exports renderMessage", () => {
    assert.ok(source.includes("export function renderMessage"))
  })

  it("exports renderBlock", () => {
    assert.ok(source.includes("export function renderBlock"))
  })

  it("has strict dispatch table RENDERER_MAP", () => {
    assert.ok(source.includes("const RENDERER_MAP"), "must have RENDERER_MAP dispatch table")
    assert.ok(source.includes("'tool-call': renderToolCallBlock"), "must map tool-call type")
    assert.ok(source.includes("'diff': renderNewDiffBlock"), "must map diff type")
    assert.ok(source.includes("'error': renderErrorBlock"), "must map error type")
  })

  it("has type guards for discriminated blocks", () => {
    assert.ok(source.includes("function isToolCallBlock"), "must have isToolCallBlock type guard")
    assert.ok(source.includes("function isDiffBlock"), "must have isDiffBlock type guard")
    assert.ok(source.includes("function isThinkingBlock"), "must have isThinkingBlock type guard")
    assert.ok(source.includes("function isErrorBlock"), "must have isErrorBlock type guard")
  })

  it("renders_user_message_with_mention_chips", () => {
    assert.ok(source.includes("mention-chip"), "must render mention chips")
    assert.ok(source.includes("chip.dataset.kind = mentionType"), "must set data-kind on mention chips")
    assert.ok(source.includes("mentionPattern"), "must have mention pattern detection")
  })

  it("instantiates_markdown_it", () => {
    assert.ok(source.includes("const md = new MarkdownIt({"), "must create MarkdownIt instance")
  })

  it("sanitizes_xss_with_dompurify", () => {
    assert.ok(source.includes("function sanitizeHtml"), "must call sanitizeHtml")
    assert.ok(source.includes("DOMPurify.sanitize"), "must use DOMPurify")
    assert.ok(source.includes("FORBID_TAGS"), "must forbid dangerous tags")
    assert.ok(source.includes("FORBID_CONTENTS"), "must forbid dangerous content")
  })

  it("renders_tool_call_with_dynamic_states", () => {
    assert.ok(source.includes("tool-call--${toolState}"), "must use dynamic tool state class")
    assert.ok(source.includes("tool-call--error"), "must support error state")
    assert.ok(source.includes("aria-label"), "must have aria-label")
    assert.ok(source.includes("tool-status--${toolState}"), "must have dynamic status badge")
  })

  it("renders_diff_block_with_table", () => {
    assert.ok(source.includes("diff-block"), "must render diff block")
    assert.ok(source.includes("diff-table"), "must render diff table")
    assert.ok(source.includes("diff-line--${line.type}"), "must use dynamic diff line class")
    assert.ok(source.includes("diff-line-num"), "must have line number cells")
  })

  it("diff_action_bar_has_accept_discard_open_buttons", () => {
    assert.ok(source.includes("diff-action-bar"), "must have diff action bar")
    assert.ok(source.includes("diff-btn--accept"), "must have accept button")
    assert.ok(source.includes("diff-btn--discard"), "must have discard button")
    assert.ok(source.includes("diff-btn--open"), "must have open file button")
  })

  it("thinking_block_uses_details_element", () => {
    assert.ok(source.includes("document.createElement(\"details\")"), "thinking block must use details element")
    assert.ok(source.includes("BRAIN_SVG"), "must have brain icon for thinking")
    assert.ok(source.includes("Thinking"), "must show thinking label")
  })

  it("imports highlight.js", () => {
    assert.ok(source.includes('import hljs from "highlight.js/lib/core"'))
  })

  it("imports markdown-it", () => {
    assert.ok(source.includes('import MarkdownIt from "markdown-it"'))
  })

  it("imports DOMPurify", () => {
    assert.ok(source.includes('import DOMPurify from "dompurify"'))
  })

  it("configures PURIFY_CONFIG with allowed tags", () => {
    assert.ok(source.includes("ALLOWED_TAGS"))
    assert.ok(source.includes("FORBID_TAGS"))
  })

  it("defines sanitizeHtml function", () => {
    assert.ok(source.includes("function sanitizeHtml"))
  })

  it("registers 15 highlight.js languages", () => {
    const languages = ["javascript", "typescript", "python", "rust", "go", "bash", "json", "css", "markdown", "sql", "diff", "java", "cpp", "yaml", "xml"]
    languages.forEach(lang => {
      assert.ok(source.includes(`"${lang}", ${lang}`), `Missing ${lang} language registration`)
    })
  })

  it("has SVG constants for icons", () => {
    assert.ok(source.includes('from "./icons"') || source.includes('from "./icons"'), "must import icons from icons.ts")
    assert.ok(source.includes("OC_LOGO_SVG"), "must have logo icon")
    assert.ok(source.includes("USER_AVATAR_SVG"), "must have avatar icon")
    assert.ok(source.includes("BRAIN_SVG"), "must have brain icon for thinking")
    assert.ok(source.includes("TOOL_READ_SVG"), "must have tool read icon")
    assert.ok(source.includes("TOOL_WRITE_SVG"), "must have tool write icon")
    assert.ok(source.includes("TOOL_EXEC_SVG"), "must have tool exec icon")
  })

  it("tool_call_renderer_uses_class_specific_icons", () => {
    assert.ok(source.includes("switch (toolClass)"), "must switch on tool class")
    assert.ok(source.includes("TOOL_WRITE_SVG"), "must handle write class")
    assert.ok(source.includes("TOOL_EXEC_SVG"), "must handle exec class")
    assert.ok(source.includes("TOOL_META_SVG"), "must handle meta class")
    assert.ok(source.includes("TOOL_READ_SVG"), "default must use read icon")
  })

  it("code_block_has_copy_button_and_line_numbers", () => {
    assert.ok(source.includes("code-block-copy"), "must have copy button")
    assert.ok(source.includes("code-block-lines"), "must have line number grid")
    assert.ok(source.includes("code-line-num"), "must have line number elements")
  })

  it("user_message_has_edit_button", () => {
    assert.ok(source.includes("message-edit-btn"), "must have edit button on user messages")
    assert.ok(source.includes('vscode.postMessage({ type: "edit_message"' ), "must post edit_message")
  })

  it("code_block_has_insert_and_new_file_buttons", () => {
    assert.ok(source.includes("code-block-insert"), "must have insert-at-cursor button")
    assert.ok(source.includes("code-block-new-file"), "must have create-new-file button")
    assert.ok(source.includes("insert_at_cursor"), "must post insert_at_cursor message")
    assert.ok(source.includes("create_file_from_code"), "must post create_file_from_code message")
  })

  it("error_block_has_role_alert", () => {
    assert.ok(source.includes('role", "alert"'), "error block must have alert role")
    assert.ok(source.includes("WARNING_SVG"), "must show warning icon")
  })

  it("task_banner_has_role_status_or_alert", () => {
    assert.ok(source.includes('renderTaskBanner'), "must have task banner renderer")
    assert.ok(source.includes('task-banner--${status}'), "must use dynamic status class")
  })

  it("plan_mode_shows_review_and_approve_apply", () => {
    assert.ok(source.includes('"Approve & Apply"'), "must show Approve & Apply text in plan mode")
    assert.ok(source.includes('"Review"'), "must show Review label in plan mode")
    assert.ok(source.includes('diff-btn--approve'), "must use approve button class in plan mode")
  })
})
