import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "renderer.ts"), "utf8")
const toolCallRendererSource = readFileSync(path.join(__dirname, "toolCallRenderer.ts"), "utf8")
const messageRendererSource = readFileSync(path.join(__dirname, "messageRenderer.ts"), "utf8")

describe("renderer.ts", () => {
  it("exports renderMessage", () => {
    assert.ok(messageRendererSource.includes("export function renderMessage"))
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
    assert.ok(source.includes("function isToolCallBlock") || source.includes('export { isToolCallBlock }'), "must have isToolCallBlock type guard")
    assert.ok(source.includes("function isDiffBlock"), "must have isDiffBlock type guard")
    assert.ok(source.includes("function isThinkingBlock"), "must have isThinkingBlock type guard")
    assert.ok(source.includes("function isErrorBlock"), "must have isErrorBlock type guard")
  })

  it("renders_user_message_with_mention_chips", () => {
    assert.ok(source.includes("context-chip"), "must render mention chips")
    assert.ok(source.includes("chip.dataset.kind = type"), "must set data-kind on mention chips")
    assert.ok(source.includes("mentionPattern"), "must have mention pattern detection")
  })

	  it("instantiates_markdown_it", () => {
	    assert.ok(source.includes("const md = new MarkdownIt({"), "must create MarkdownIt instance")
	  })

	  it("normalizes chunk-sensitive markdown without forcing hard line breaks", () => {
	    assert.ok(source.includes("export function normalizeMarkdownText"), "must normalize markdown before rendering")
	    assert.ok(source.includes("breaks: false"), "soft line breaks should use standard Markdown semantics")
	    assert.ok(source.includes("highlight:"), "markdown fenced code should use syntax highlighting")
	  })

  it("sanitizes_xss_with_dompurify", () => {
    assert.ok(source.includes("function sanitizeHtml"), "must call sanitizeHtml")
    assert.ok(source.includes("DOMPurify.sanitize"), "must use DOMPurify")
    assert.ok(source.includes("FORBID_TAGS"), "must forbid dangerous tags")
    assert.ok(source.includes("FORBID_CONTENTS"), "must forbid dangerous content")
  })

  it("hardens_external_markdown_links", () => {
    assert.ok(source.includes("md.renderer.rules.link_open"), "must override markdown link rendering")
    assert.ok(source.includes('"target"'), "sanitizer must allow target attr")
    assert.ok(source.includes('"rel"'), "sanitizer must allow rel attr")
    assert.ok(source.includes('token.attrSet("target", "_blank")'), "external links must open outside the webview")
    assert.ok(source.includes('token.attrSet("rel", "noopener noreferrer")'), "external links must be isolated from opener access")
  })

it("renders_tool_call_with_dynamic_states", () => {
    assert.ok(source.includes("tool-call--${toolState}") || toolCallRendererSource.includes("tool-call--${toolState}"), "must use dynamic tool state class")
    assert.ok(source.includes("tool-call--error") || toolCallRendererSource.includes("tool-call--error"), "must support error state")
    assert.ok(source.includes("aria-label") || toolCallRendererSource.includes("aria-label"), "must have aria-label")
    assert.ok(source.includes("tool-status--${toolState}") || toolCallRendererSource.includes("tool-status--${toolState}"), "must have dynamic status badge")
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

  it("open_file_button_posts_routable_open_file_message", () => {
    // The 'diff:openFile' message type has no handler in WebviewEventRouter,
    // so clicking the button silently did nothing. The button must post
    // 'open_file' (which IS routed and handles paths/line numbers correctly).
    assert.ok(
      source.includes("type: 'open_file'") || source.includes('type: "open_file"'),
      "Open File button must post 'open_file' message that WebviewEventRouter routes",
    )
    assert.ok(
      !source.includes("'diff:openFile'") && !source.includes('"diff:openFile"'),
      "must not post the unrouted 'diff:openFile' message",
    )
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
    assert.ok(source.includes('from "./icons"') || toolCallRendererSource.includes('from "./icons"'), "must import icons from icons.ts")
    assert.ok(source.includes("BRAIN_SVG") || toolCallRendererSource.includes("BRAIN_SVG"), "must have brain icon for thinking")
    assert.ok(source.includes("TOOL_READ_SVG") || toolCallRendererSource.includes("TOOL_READ_SVG"), "must have tool read icon")
    assert.ok(source.includes("TOOL_WRITE_SVG") || toolCallRendererSource.includes("TOOL_WRITE_SVG"), "must have tool write icon")
    assert.ok(source.includes("TOOL_EXEC_SVG") || toolCallRendererSource.includes("TOOL_EXEC_SVG"), "must have tool exec icon")
    assert.ok(source.includes("TOOL_META_SVG") || toolCallRendererSource.includes("TOOL_META_SVG"), "must have tool meta icon")
    assert.ok(source.includes("COPY_SVG") || toolCallRendererSource.includes("COPY_SVG"), "must have copy icon")
    assert.ok(source.includes("CHECK_SVG") || toolCallRendererSource.includes("CHECK_SVG"), "must have check icon")
    assert.ok(source.includes("ERROR_SVG") || toolCallRendererSource.includes("ERROR_SVG"), "must have error icon")
    assert.ok(source.includes("WARNING_SVG") || toolCallRendererSource.includes("WARNING_SVG"), "must have warning icon")
    assert.ok(source.includes("SPINNER_SVG") || toolCallRendererSource.includes("SPINNER_SVG") || toolCallRendererSource.includes("SPINNER_SVG"), "must have spinner icon")
    assert.ok(source.includes("EDIT_SVG") || toolCallRendererSource.includes("EDIT_SVG"), "must have edit icon")
    assert.ok(source.includes("INSERT_SVG") || toolCallRendererSource.includes("INSERT_SVG"), "must have insert icon")
    assert.ok(source.includes("NEW_FILE_SVG") || toolCallRendererSource.includes("NEW_FILE_SVG"), "must have new file icon")
    assert.ok(source.includes("CHEVRON_RIGHT_SVG") || toolCallRendererSource.includes("CHEVRON_RIGHT_SVG"), "must have chevron icon")
  })

it("tool_call_renderer_uses_class_specific_icons", () => {
    assert.ok(source.includes("switch (toolClass)") || toolCallRendererSource.includes("switch (toolClass)"), "must switch on tool class")
    assert.ok(source.includes("TOOL_WRITE_SVG") || toolCallRendererSource.includes("TOOL_WRITE_SVG"), "must handle write class")
    assert.ok(source.includes("TOOL_EXEC_SVG") || toolCallRendererSource.includes("TOOL_EXEC_SVG"), "must handle exec class")
    assert.ok(source.includes("TOOL_META_SVG") || toolCallRendererSource.includes("TOOL_META_SVG"), "must handle meta class")
    assert.ok(source.includes("TOOL_READ_SVG") || toolCallRendererSource.includes("TOOL_READ_SVG"), "default must use read icon")
  })

  it("code_block_has_copy_button_and_line_numbers", () => {
    assert.ok(source.includes("code-block-copy"), "must have copy button")
    assert.ok(source.includes("code-block-lines"), "must have line number grid")
    assert.ok(source.includes("code-line-num"), "must have line number elements")
  })

  it("user_message_has_edit_button", () => {
    assert.ok(source.includes("message-edit-btn") || messageRendererSource.includes("message-edit-btn"), "must have edit button on user messages")
    assert.ok(source.includes('type: "edit_message"') || messageRendererSource.includes('type: "edit_message"'), "must post edit_message via postMessage callback")
  })

  it("edit_button_uses_cached_vscode_api", () => {
    assert.ok(source.includes("opts?.postMessage") || source.includes("RenderOptions"),
      "edit button must pass postMessage through RenderOptions or use a cached reference")
  })

  it("assistant_message_has_revert_button", () => {
    assert.ok(source.includes("message-revert-btn") || messageRendererSource.includes("message-revert-btn"), "must have revert button on assistant messages")
    assert.ok(source.includes('type: "revert_message"') || messageRendererSource.includes('type: "revert_message"'), "must post revert_message")
    assert.ok(source.includes('"Revert code changes from this message"') || messageRendererSource.includes('"Revert code changes from this message"'), "must have descriptive title")
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
