import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "renderer.ts"), "utf8")
const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const syntaxHighlighterSource = readFileSync(path.join(__dirname, "syntaxHighlighter.ts"), "utf8")
const toolCallRendererSource = readFileSync(path.join(__dirname, "toolCallRenderer.ts"), "utf8")
const messageRendererSource = readFileSync(path.join(__dirname, "messageRenderer.ts"), "utf8")
const workerSource = readFileSync(path.join(__dirname, "markdownWorker.ts"), "utf8")

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
    assert.ok(source.includes("function sanitizeHtml") || syntaxHighlighterSource.includes("function sanitizeHtml"), "must call sanitizeHtml")
    assert.ok(source.includes("const rendered = sanitizeHtml(md.render(normalized))") || source.includes("return sanitizeHtml(md.render(normalized))"), "renderMarkdown must sanitize output")
    assert.ok(source.includes("DOMPurify.sanitize") || syntaxHighlighterSource.includes("DOMPurify.sanitize"), "must use DOMPurify")
    assert.ok(source.includes("FORBID_TAGS") || syntaxHighlighterSource.includes("FORBID_TAGS"), "must forbid dangerous tags")
    assert.ok(source.includes("FORBID_CONTENTS") || syntaxHighlighterSource.includes("FORBID_CONTENTS"), "must forbid dangerous content")
  })

  it("caches sanitized markdown and highlighted code with bounded LRU caches", () => {
    assert.ok(source.includes("class LruStringCache"), "must define a bounded markdown cache")
    assert.ok(source.includes("markdownCache"), "must cache non-streaming markdown")
    assert.ok(source.includes("if (isStreaming) return sanitizeHtml"), "streaming markdown must skip the markdown cache")
  })

  it("handles_streaming_markdown_artifacts", () => {
    assert.ok(source.includes("export function normalizeStreamingMarkdown"), "must have streaming-aware normalization")
    // The corrected single-pass scanner tracks fences and inline code separately
    // (fixes the old double-counting where backticks inside a fence were
    // miscounted as inline code).
    assert.ok(source.includes("fenceCount % 2 !== 0"), "must detect unclosed code fences")
    assert.ok(source.includes("if (inInlineCode) result"), "must detect unclosed inline code")
  })

  it("renderMarkdown_accepts_isStreaming_flag", () => {
    assert.ok(source.includes("export function renderMarkdown(text: string, isStreaming"), "renderMarkdown must accept isStreaming parameter")
    assert.ok(source.includes("normalizeMarkdownForRender(text, isStreaming)"), "must use streaming-aware normalization helper")
  })

  it("supports a VS Code-safe markdown worker for large final renders", () => {
    assert.ok(source.includes("MARKDOWN_WORKER_MIN_CHARS"), "must define a worker size threshold")
    assert.ok(source.includes("window.__OC_MARKDOWN_WORKER_URI__"), "must read worker URI from webview bootstrap config")
    assert.ok(source.includes("new Worker(objectUrl"), "must launch worker from a blob URL")
    assert.ok(source.includes("renderMarkdownAsync"), "must expose async markdown rendering")
    assert.ok(source.includes("if (isStreaming) return false"), "worker path must skip active streaming text")
    assert.ok(source.includes("const rendered = sanitizeHtml(html)"), "worker output must be sanitized before caching")
  })

  it("RenderOptions_includes_isStreaming", () => {
    assert.ok(source.includes("isStreaming?: boolean"), "RenderOptions must include isStreaming flag")
  })

  it("renderTextBlock_uses_isStreaming_flag", () => {
    assert.ok(
      source.includes("opts?.isStreaming ? normalizeStreamingMarkdown(part) : normalizeMarkdownText(part)") ||
        source.includes("opts?.isStreaming ? normalizeStreamingMarkdown(text) : normalizeMarkdownText(text)"),
      "must use streaming flag for mentions"
    )
    assert.ok(source.includes("renderMarkdown(text, isStreaming)"), "must pass streaming flag to renderMarkdown")
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

  it("assistant tool rendering respects block order instead of grouping the whole message", () => {
    assert.ok(
      messageRendererSource.includes("groupConsecutiveToolCalls(msg.blocks"),
      "messageRenderer must group only consecutive tool runs from the original block order",
    )
    assert.ok(
      !messageRendererSource.includes("renderToolGroup(toolBlocks"),
      "messageRenderer must not render every assistant tool call as one message-wide group",
    )
  })

  it("tool groups collapse by default even for a single tool call", () => {
    assert.ok(
      toolCallRendererSource.includes("collapseThreshold: 1"),
      "default tool collapse threshold must be one so a single tool is still a compact expandable row",
    )
    assert.ok(
      toolCallRendererSource.includes("blocks.length >= config.collapseThreshold"),
      "tool group collapse decision must use the configured threshold",
    )
  })

  it("renders_diff_block_with_table", () => {
    assert.ok(source.includes("diff-block"), "must render diff block")
    assert.ok(source.includes("diff-table"), "must render diff table")
    assert.ok(source.includes("diff-line--${line.type}"), "must use dynamic diff line class")
    assert.ok(source.includes("diff-line-num"), "must have line number cells")
  })

  it("permission approval UI supports once, always, and reject responses", () => {
    assert.ok(mainSource.includes("sessionId"), "permission responses must target the session that received the request")
    assert.ok(mainSource.includes('response: "once"'), "Allow must send an SDK-compatible once response")
    assert.ok(mainSource.includes('response: "always"'), "Scoped approvals must support the SDK-compatible always response")
    assert.ok(mainSource.includes('response: "reject"'), "Deny must send an SDK-compatible reject response")
    assert.ok(mainSource.includes("permissionType"), "permission responses must preserve the permission type")
    assert.ok(mainSource.includes("pattern"), "permission responses must preserve the permission pattern")
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

  it("imports highlight.js only in the worker", () => {
    const highlightInRenderSyntax = source.includes('import hljs from "highlight.js/lib/core"') || syntaxHighlighterSource.includes('import hljs from "highlight.js/lib/core"')
    assert.ok(!highlightInRenderSyntax, "highlight.js must NOT be in main-thread renderer or syntaxHighlighter bundle")
    assert.ok(workerSource.includes('import hljs from "highlight.js/lib/core"'), "highlight.js must be in the markdown worker")
  })

  it("imports markdown-it", () => {
    assert.ok(source.includes('import MarkdownIt from "markdown-it"'))
  })

  it("imports DOMPurify", () => {
    assert.ok(source.includes('import DOMPurify from "dompurify"') || syntaxHighlighterSource.includes('import DOMPurify from "dompurify"'))
  })

  it("configures PURIFY_CONFIG with allowed tags", () => {
    assert.ok(source.includes("ALLOWED_TAGS") || syntaxHighlighterSource.includes("ALLOWED_TAGS"))
    assert.ok(source.includes("FORBID_TAGS") || syntaxHighlighterSource.includes("FORBID_TAGS"))
  })

  it("defines sanitizeHtml function", () => {
    assert.ok(source.includes("function sanitizeHtml") || syntaxHighlighterSource.includes("function sanitizeHtml"))
  })

  it("registers 15 highlight.js languages in the worker", () => {
    const languages = ["javascript", "typescript", "python", "rust", "go", "bash", "json", "css", "markdown", "sql", "diff", "java", "cpp", "yaml", "xml"]
    languages.forEach(lang => {
      assert.ok(workerSource.includes(`"${lang}", ${lang}`), `Missing ${lang} language registration in worker`)
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

  // ── Batch 3c: diff add/remove visual highlighting ─────────────────────────
  describe("diff line highlighting (Batch 3c)", () => {
    const cssSource = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")
    const tokensCss = readFileSync(path.join(__dirname, "css", "tokens.css"), "utf8")

    it("renderer emits diff-line--added and diff-line--removed classes", () => {
      assert.ok(
        source.includes("diff-line--${line.type}") || source.includes("diff-line diff-line--"),
        "rows must carry a diff-line--{added|removed|context} class"
      )
    })

    it("blocks.css paints added/removed line backgrounds via theme tokens", () => {
      assert.ok(
        cssSource.includes(".diff-line--added .diff-line-content"),
        "blocks.css must style .diff-line--added .diff-line-content"
      )
      assert.ok(
        cssSource.includes(".diff-line--removed .diff-line-content"),
        "blocks.css must style .diff-line--removed .diff-line-content"
      )
    })

    it("line-number gutter cells get distinct background tints for old/new", () => {
      // The diffAddedLineNumberBg / diffRemovedLineNumberBg theme tokens
      // existed in package.json but were orphaned — wire them up so the
      // line-number column itself is also colored, not just the content.
      assert.ok(
        cssSource.includes(".diff-line--added .diff-line-num--new") ||
          cssSource.includes(".diff-line--added .diff-line-num"),
        "added-row line-numbers must receive an added background"
      )
      assert.ok(
        cssSource.includes(".diff-line--removed .diff-line-num--old") ||
          cssSource.includes(".diff-line--removed .diff-line-num"),
        "removed-row line-numbers must receive a removed background"
      )
      assert.ok(
        tokensCss.includes("--oc-diff-added-line-number-bg") || cssSource.includes("--oc-diff-added-line-number-bg"),
        "must define/consume --oc-diff-added-line-number-bg token"
      )
      assert.ok(
        tokensCss.includes("--oc-diff-removed-line-number-bg") || cssSource.includes("--oc-diff-removed-line-number-bg"),
        "must define/consume --oc-diff-removed-line-number-bg token"
      )
    })

    it("backgrounds are stronger than the original 12% so add/remove is obvious", () => {
      // The original tokens used color-mix at 12% — too faint to read at a
      // glance. The new defaults sit in the 22%–25% range.
      const tokenLines = tokensCss
        .split("\n")
        .filter(l => l.includes("--diff-added-bg") || l.includes("--diff-removed-bg"))
        .join("\n")
      const pctMatches = tokenLines.match(/(\d+)%/g) || []
      const pcts = pctMatches.map(s => parseInt(s, 10))
      assert.ok(
        pcts.some(p => p >= 18),
        `diff background tint must be ≥ 18%, got ${pcts.join(", ")}`
      )
    })
  })

  // ── Batch 3e: detectPlanProse behavioral tests ────────────────────────────
  describe("detectPlanProse heuristic (Batch 3e)", () => {
    // We import dynamically so the import is co-located with the tests it
    // exercises and the source-only tests above stay fast / pure.
    const { detectPlanProse } = require("./renderer") as { detectPlanProse: (s: string) => boolean }

    it("detects markdown plans with a header and numbered steps", () => {
      const text = `## Plan\n1. Inspect the file\n2. Replace the old API call\n3. Run the tests`
      assert.equal(detectPlanProse(text), true)
    })

    it("detects checklist-shaped plans", () => {
      const text = `Here's my approach:\n- [ ] Investigate the bug\n- [ ] Fix the regression\n- [ ] Add tests`
      assert.equal(detectPlanProse(text), true)
    })

    it("does NOT flag short casual replies as plans", () => {
      assert.equal(detectPlanProse("Sure, I'll take a look."), false)
      assert.equal(detectPlanProse("Plan?"), false)
    })

    it("does NOT flag a single numbered line as a plan", () => {
      // Casual prose can have a single numbered fact like "There are 3 issues.
      // 1. Foo." — that shouldn't trigger the plan UI.
      assert.equal(
        detectPlanProse("I see three issues here. 1. The first is small."),
        false
      )
    })
  })

  describe("conversation timeline snippets", () => {
    const { groupMessagesIntoTurns } = require("./renderer") as {
      groupMessagesIntoTurns: (messages: Array<Record<string, unknown>>) => Array<{ snippet: string }>
    }

    it("extracts user snippets from runtime content strings when blocks are absent", () => {
      const turns = groupMessagesIntoTurns([
        {
          role: "user",
          id: "user-1",
          content: "Please audit the webview communication channel.",
          timestamp: 1,
        },
      ])

      assert.equal(turns[0]?.snippet, "Please audit the webview communication channel.")
    })

    it("extracts user snippets from runtime parts arrays", () => {
      const turns = groupMessagesIntoTurns([
        {
          role: "user",
          id: "user-1",
          parts: [{ type: "text", text: "Check the checkpoint button." }],
          timestamp: 1,
        },
      ])

      assert.equal(turns[0]?.snippet, "Check the checkpoint button.")
    })
  })

  // ── Batch 3e: plan-mode prose rendering ────────────────────────────────────
  describe("plan-mode prose rendering (Batch 3e)", () => {
    const cssSource = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")

    it("messageRenderer flags assistant turns as plan-mode via a CSS class", () => {
      // Every assistant turn rendered while the session is in plan mode gets
      // a message--plan-mode class so the user can see at a glance that
      // they're looking at planning output, not applied work.
      assert.ok(
        messageRendererSource.includes('"message--plan-mode"') ||
          messageRendererSource.includes("message--plan-mode"),
        "messageRenderer.ts must add a message--plan-mode class when opts.mode === 'plan'"
      )
      assert.ok(
        /opts\??\.mode\s*===\s*['"]plan['"]/.test(messageRendererSource),
        "messageRenderer must check opts.mode === 'plan'"
      )
    })

    it("css paints plan-mode assistant turns with an amber accent", () => {
      assert.ok(
        cssSource.includes(".message--plan-mode") ||
          cssSource.includes(".message.message--plan-mode"),
        "blocks.css must style .message--plan-mode"
      )
      assert.ok(
        cssSource.includes("notificationsWarningIcon-foreground") ||
          cssSource.includes("--vscode-charts-yellow"),
        "plan-mode accent should use the same amber as the mode dropdown for consistency"
      )
    })

    it("renderer exposes a heuristic to detect plan-shaped prose", () => {
      assert.ok(
        source.includes("detectPlanProse") || source.includes("isPlanProse"),
        "renderer.ts must export a detectPlanProse helper that recognizes plan-shaped text"
      )
    })
  })

  // ── Batch 3b: plan-mode diff blocks are visually distinct from applied diffs ─
  describe("plan-mode diff visual differentiation (Batch 3b)", () => {
    const cssSource = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")

    it("plan-mode diff wrapper gets a dedicated CSS class", () => {
      // The wrapper itself — not just the action bar — must signal plan mode
      // so the user can see at a glance that this diff is a PROPOSAL and not
      // yet applied. A dedicated class lets us paint a distinct accent border.
      assert.ok(
        source.includes("diff-block--plan"),
        "renderNewDiffBlock must add a diff-block--plan class in plan mode"
      )
    })

    it("plan-mode diff header shows a PLAN pill", () => {
      assert.ok(
        source.includes('"diff-pill diff-pill--plan"') || source.includes("diff-pill--plan"),
        "renderNewDiffBlock must render a .diff-pill--plan element in plan mode"
      )
      assert.ok(source.includes('"PLAN"'), "the pill text must be 'PLAN'")
    })

    it("blocks.css styles diff-block--plan with a distinct accent border", () => {
      assert.ok(
        cssSource.includes(".diff-block--plan"),
        "blocks.css must define .diff-block--plan"
      )
      assert.ok(
        cssSource.includes(".diff-pill--plan"),
        "blocks.css must define .diff-pill--plan"
      )
    })
  })

  // ── Batch 3a: thinking blocks respect the persisted preference ────────────
  describe("thinking block visibility pref (Batch 3a)", () => {
    it("renderThinkingBlock consults getThinkingVisible() so newly streamed blocks honor the user pref", () => {
      // Locks in the wiring: the renderer must import the displayPrefs module
      // (not depend on stateManager) and call getThinkingVisible() when
      // building a new <details>. Without this, a thinking block that streams
      // in AFTER the toggle was flipped would ignore the preference.
      assert.ok(
        source.includes('from "./displayPrefs"') || source.includes("from './displayPrefs'"),
        "renderer.ts must import displayPrefs"
      )
      assert.ok(
        source.includes("getThinkingVisible"),
        "renderThinkingBlock must call getThinkingVisible() to honor the pref"
      )
    })

    it("renderThinkingBlock sets details.open from the pref when not streaming", () => {
      const fnIdx = source.indexOf("function renderThinkingBlock(")
      assert.ok(fnIdx >= 0, "renderThinkingBlock must exist")
      const body = source.slice(fnIdx, fnIdx + 2000)
      // The body must touch details.open AND reference getThinkingVisible().
      assert.ok(body.includes("details.open"), "must set details.open")
      assert.ok(
        body.includes("getThinkingVisible"),
        "details.open must be derived from getThinkingVisible()"
      )
    })

    it("streaming thinking blocks remain open regardless of pref (in-progress UX)", () => {
      // We don't collapse a thinking block while it's still streaming — that
      // would hide live progress. The pref should only apply once streaming
      // ends. Lock in the guard so a future refactor doesn't break this.
      const fnIdx = source.indexOf("function renderThinkingBlock(")
      const body = source.slice(fnIdx, fnIdx + 2000)
      assert.ok(
        /thinking\.streaming|!thinking\.streaming/.test(body),
        "renderThinkingBlock must distinguish streaming vs final state when applying open/closed"
      )
    })
  })

  // ── Batch 3b: interactive tool arguments ──────────────────────────────────
  describe("interactive tool-arg click handling (Batch 3b)", () => {
    it("appendToolKeyArg styles the chip with a pointer cursor", () => {
      assert.ok(
        toolCallRendererSource.includes('argEl.style.cursor = "pointer"') ||
        toolCallRendererSource.includes("argEl.style.cursor = 'pointer'"),
        "tool-arg element must set pointer cursor"
      )
    })

    it("appendToolKeyArg handles click, stops propagation, and prevents default", () => {
      assert.ok(
        toolCallRendererSource.includes("e.stopPropagation()"),
        "click listener must stop event propagation"
      )
      assert.ok(
        toolCallRendererSource.includes("e.preventDefault()"),
        "click listener must prevent default detail toggle behavior"
      )
    })

    it("appendToolKeyArg dispatches open_file, open_folder, or open_url via postMessage", () => {
      assert.ok(
        toolCallRendererSource.includes('pm({ type: "open_url", url: keyArg })') ||
        toolCallRendererSource.includes("pm({ type: 'open_url', url: keyArg })"),
        "click listener must support dispatching open_url"
      )
      assert.ok(
        toolCallRendererSource.includes('pm({ type: "open_folder", dir: keyArg })') ||
        toolCallRendererSource.includes("pm({ type: 'open_folder', dir: keyArg })"),
        "click listener must support dispatching open_folder"
      )
      assert.ok(
        toolCallRendererSource.includes('pm({ type: "open_file", path: keyArg })') ||
        toolCallRendererSource.includes("pm({ type: 'open_file', path: keyArg })"),
        "click listener must support dispatching open_file"
      )
    })
  })

  // ── Batch 3c: interactive diff file paths ──────────────────────────────────
  describe("interactive diff-file-path click handling (Batch 3c)", () => {
    it("renderNewDiffBlock styles the file path with a pointer cursor", () => {
      assert.ok(
        source.includes('filePath.style.cursor = "pointer"') ||
        source.includes("filePath.style.cursor = 'pointer'"),
        "diff-file-path element must set pointer cursor"
      )
    })

    it("renderNewDiffBlock handles click, stops propagation, and prevents default", () => {
      // Find within renderNewDiffBlock area
      const fnIdx = source.indexOf("function renderNewDiffBlock(")
      assert.ok(fnIdx >= 0, "renderNewDiffBlock must exist")
      const body = source.slice(fnIdx, fnIdx + 3500)
      assert.ok(
        body.includes("e.stopPropagation()"),
        "click listener must stop event propagation"
      )
      assert.ok(
        body.includes("e.preventDefault()"),
        "click listener must prevent default actions"
      )
    })

    it("renderNewDiffBlock dispatches open_file via postMessage", () => {
      const fnIdx = source.indexOf("function renderNewDiffBlock(")
      const body = source.slice(fnIdx, fnIdx + 3500)
      assert.ok(
        body.includes('type: "open_file", path: diffBlock.path') ||
        body.includes("type: 'open_file', path: diffBlock.path") ||
        body.includes("type: \"open_file\", path: diffBlock.path"),
        "click listener must dispatch open_file with diffBlock.path"
      )
    })

    it("renderNewDiffBlock excludes command-like paths or File Change placeholder from interactivity", () => {
      const fnIdx = source.indexOf("function renderNewDiffBlock(")
      const body = source.slice(fnIdx, fnIdx + 2500)
      assert.ok(
        body.includes("isCommand") && body.includes("!isCommand"),
        "must check isCommand and apply click listener conditionally"
      )
    })

    it("appendToolKeyArg excludes command runner tools or command arguments from interactivity", () => {
      assert.ok(
        toolCallRendererSource.includes("isCommand") && toolCallRendererSource.includes("!isCommand"),
        "appendToolKeyArg must check for command/exec context and apply click listener conditionally"
      )
    })
  })
})
