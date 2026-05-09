import hljs from "highlight.js/lib/core"
import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"
import DOMPurify from "dompurify"
import {
  BRAIN_SVG,
  TOOL_READ_SVG,
  TOOL_WRITE_SVG,
  TOOL_EXEC_SVG,
  TOOL_META_SVG,
  WARNING_SVG,
  CHEVRON_RIGHT_SVG,
  COPY_SVG,
  CHECK_SVG,
  SUCCESS_SVG,
  ERROR_SVG,
  SPINNER_SVG,
  EDIT_SVG,
  INSERT_SVG,
  NEW_FILE_SVG,
  GEAR_SVG,
} from "./icons"
import type {
  Block,
  ChatMessage,
  ToolCallBlock,
  DiffBlock,
  ThinkingBlock,
  ErrorBlock,
  ToolCallClass,
  ToolCallState,
  DiffHunk,
  DiffLine,
} from "./types"

// ---------------------------------------------------------------------------
// Markdown parser with security settings
// ---------------------------------------------------------------------------

export function normalizeMarkdownText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(\s*(?:\d+\.|[-*+]))\s*\n{2,}(?=\S)/gm, "$1 ")
    .replace(/^(#{1,6})([^\s#])/gm, "$1 $2")
    .replace(/\n{3,}/g, "\n\n")
}

export function renderMarkdown(text: string): string {
  return md.render(normalizeMarkdownText(text))
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight: (str, lang) => highlightSyntax(str, normalizeMarkdownLanguage(lang)),
}).use(taskLists, { label: false })

function normalizeMarkdownLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (normalized === "tsx" || normalized === "jsx") return "typescript"
  if (normalized === "shell" || normalized === "sh" || normalized === "zsh") return "bash"
  if (normalized === "yml") return "yaml"
  if (normalized === "html") return "xml"
  return normalized
}

const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (!token) {
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  const href = token.attrGet("href") ?? ""

  if (/^(https?|ftp):/i.test(href)) {
    token.attrSet("target", "_blank")
    token.attrSet("rel", "noopener noreferrer")
  }

  return defaultLinkOpen(tokens, idx, options, env, self)
}

// Enable plugins for rich markdown rendering
// NOTE: Optional plugins (abbr, deflist, footnote, task-lists) are available
// but not installed. Install them for enhanced markdown rendering.


// ---------------------------------------------------------------------------
// DOMPurify configuration — strict allowlist, no XSS surface
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface PurifyConfig {
  ALLOWED_TAGS: string[]
  ALLOWED_ATTR: string[]
  ALLOWED_URI_REGEXP: RegExp
  FORBID_CONTENTS: string[]
  FORBID_TAGS: string[]
  SAFE_FOR_TEMPLATES: boolean
  SAFE_FOR_XML: boolean
}

const PURIFY_CONFIG: PurifyConfig = {
  ALLOWED_TAGS: [
    "b", "i", "em", "strong", "a", "p", "br", "ul", "ol", "li",
    "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "img", "span", "div", "table", "thead", "tbody", "tr", "th", "td",
    "del", "sup", "sub", "input", "label"
  ],
  ALLOWED_ATTR: [
    "href", "src", "alt", "title", "target", "rel", "class", "language", "width", "height",
    "aria-label", "role", "tabindex", "data-kind", "data-tab-id", "data-message-id",
    "data-block-id", "data-code", "data-lang", "type", "checked", "disabled", "id", "for"
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp):|\/)/i,
  FORBID_CONTENTS: ["script", "style", "iframe", "frame", "object", "embed"],
  FORBID_TAGS: ["script", "style", "iframe", "frame", "object", "embed", "form"],
  SAFE_FOR_TEMPLATES: true,
  SAFE_FOR_XML: true,
}

export function sanitizeHtml(html: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return DOMPurify.sanitize(html, PURIFY_CONFIG as any) as unknown as string
}

// ---------------------------------------------------------------------------
// Language registration for highlight.js
// ---------------------------------------------------------------------------

import javascript from "highlight.js/lib/languages/javascript"
import typescript from "highlight.js/lib/languages/typescript"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import go from "highlight.js/lib/languages/go"
import bash from "highlight.js/lib/languages/bash"
import json from "highlight.js/lib/languages/json"
import cssLang from "highlight.js/lib/languages/css"
import markdown from "highlight.js/lib/languages/markdown"
import sql from "highlight.js/lib/languages/sql"
import diffLang from "highlight.js/lib/languages/diff"
import java from "highlight.js/lib/languages/java"
import cpp from "highlight.js/lib/languages/cpp"
import yaml from "highlight.js/lib/languages/yaml"
import xml from "highlight.js/lib/languages/xml"

hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("python", python)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("go", go)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("json", json)
hljs.registerLanguage("css", cssLang)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("diff", diffLang)
hljs.registerLanguage("java", java)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("xml", xml)

hljs.registerAliases(["js", "node"], { languageName: "javascript" })
hljs.registerAliases(["ts"], { languageName: "typescript" })
hljs.registerAliases(["sh", "zsh"], { languageName: "bash" })
hljs.registerAliases(["html", "htm"], { languageName: "xml" })
hljs.registerAliases(["py"], { languageName: "python" })


// ---------------------------------------------------------------------------
// Type guards for discriminated block types
// ---------------------------------------------------------------------------

function isToolCallBlock(block: Block): block is ToolCallBlock {
  return block.type === 'tool-call'
}

function isDiffBlock(block: Block): block is DiffBlock {
  return block.type === 'diff'
}

function isThinkingBlock(block: Block): block is ThinkingBlock {
  return block.type === 'thinking'
}

function isErrorBlock(block: Block): block is ErrorBlock {
  return block.type === 'error'
}

// ---------------------------------------------------------------------------
// RenderOptions — passed to each renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  messageId?: string
  postMessage?: (msg: Record<string, unknown>) => void
  mode?: string
}

// ---------------------------------------------------------------------------
// Strict dispatch table — every block type must have a renderer
// ---------------------------------------------------------------------------

type BlockRenderer = (block: Block, opts: RenderOptions) => HTMLElement | null

const RENDERER_MAP: Readonly<Record<string, BlockRenderer>> = {
  'text': renderTextBlock,
  'code': renderCodeBlock,
  'thinking': renderThinkingBlock,
  'skill_badge': renderSkillBadge,
  'tool_call': renderToolCallBlock,
  'tool-call': renderToolCallBlock,
  'diff_block': renderDiffBlock,
  'diff': renderNewDiffBlock,
  'permission': renderPermissionBlock,
  'task_banner': renderTaskBanner,
  'context': renderContextBlock,
  'error': renderErrorBlock,
  'image': renderImageBlock,
}


// ---------------------------------------------------------------------------
// Public: renderMessage — top-level message renderer
// ---------------------------------------------------------------------------

export function renderMessage(msg: ChatMessage, opts?: RenderOptions, isConsecutive?: boolean): HTMLDivElement {
  const div = document.createElement("div")
  const role: string = msg.role || "assistant"
  div.className = `message ${role}`
  if (msg.id) div.dataset.messageId = msg.id
  if (role) div.dataset.role = role

  const contentWrapper = document.createElement("div")
  contentWrapper.className = "message-content"

  if (role !== "system" && !isConsecutive) {
    const header = document.createElement("div")
    header.className = "message-header"
    const roleSpan = document.createElement("span")
    roleSpan.className = "message-role"
    roleSpan.textContent = role === "user" ? "You" : "OpenCode"
    header.appendChild(roleSpan)
    if (msg.timestamp) {
      const ts = document.createElement("span")
      ts.className = "message-timestamp"
      ts.textContent = formatRelativeTime(msg.timestamp)
      header.appendChild(ts)
    }
    if (role === "user" && msg.id) {
      const editBtn = document.createElement("button")
      editBtn.className = "message-edit-btn"
      editBtn.setAttribute("aria-label", "Edit message")
      editBtn.title = "Edit message"
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      editBtn.addEventListener("click", () => {
        const textBlocks = (msg.blocks || []).filter((b) => b.type === "text")
        const text = textBlocks.map((b) => b.text || "").join("\n")
        const pm = opts?.postMessage
        if (pm) {
          pm({ type: "edit_message", messageId: msg.id, text, sessionId: msg.sessionId })
        }
      })
      header.appendChild(editBtn)
    }
    if (role === "assistant" && msg.id) {
      const revertBtn = document.createElement("button")
      revertBtn.className = "message-revert-btn"
      revertBtn.setAttribute("aria-label", "Revert message changes")
      revertBtn.title = "Revert code changes from this message"
      revertBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
      revertBtn.addEventListener("click", () => {
        const pm = opts?.postMessage
        if (pm) {
          pm({ type: "revert_message", messageId: msg.id, sessionId: msg.sessionId })
        }
      })
      header.appendChild(revertBtn)
    }
    contentWrapper.appendChild(header)
  }

  const bubble = document.createElement("div")
  bubble.className = role === "system" ? "system-bubble" : "message-bubble"

  if (msg.blocks && Array.isArray(msg.blocks)) {
    const groups = groupConsecutiveToolCalls(msg.blocks)
    for (const group of groups) {
      const firstBlock = group[0]
      if (!firstBlock) continue
      if (group.length === 1 || !isToolCallBlock(firstBlock)) {
        const el = renderBlock(firstBlock, { messageId: msg.id, mode: opts?.mode, postMessage: opts?.postMessage })
        if (el) bubble.appendChild(el)
      } else {
        const groupEl = renderToolGroup(group, { messageId: msg.id, mode: opts?.mode, postMessage: opts?.postMessage })
        if (groupEl) bubble.appendChild(groupEl)
      }
    }
  }

  contentWrapper.appendChild(bubble)
  div.appendChild(contentWrapper)

  return div
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// ---------------------------------------------------------------------------
// Public: renderBlock — dispatch via strict table
// ---------------------------------------------------------------------------

export function renderBlock(block: Block, opts?: RenderOptions): HTMLElement | null {
  if (!block || !block.type) return null
  const renderer = RENDERER_MAP[block.type]
  if (!renderer) return null
  return renderer(block, opts || {})
}

// ---------------------------------------------------------------------------
// Text block — markdown with mention chip support
// ---------------------------------------------------------------------------

function renderTextBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const text = block.text || ""
  if (!text.trim()) return null

  const div = document.createElement("div")
  div.className = "msg-text markdown-content"

  // Render mentions as chips if present in text
  const mentionPattern = /(@(file|folder|url|problems|terminal):\S+)/g
  const hasMentions = mentionPattern.test(text)

  if (hasMentions && block.text) {
    const parts = block.text.split(mentionPattern)
    const fragment = document.createDocumentFragment()

    // With capturing groups, split() returns [text, fullMatch, type, text, fullMatch, type, ...]
    // But our regex has TWO capturing groups: 1 for full match, 1 for the type.
    // So split returns [text, @file:/foo, file, text, ...]
    // Parts array length will be 1 + (number of matches * 3)

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue

      if (i % 3 === 0) {
        // Plain text part
        const span = document.createElement("span")
        span.innerHTML = sanitizeHtml(md.renderInline(normalizeMarkdownText(part), { label: false }))
        fragment.appendChild(span)
      } else if (i % 3 === 1) {
        // Full mention match (@file:/foo)
        const type = parts[i+1] || "file"
        const chip = document.createElement("span")
        chip.className = "context-chip"
        chip.dataset.kind = type
        chip.textContent = part
        fragment.appendChild(chip)
        i++ // Skip the 'type' part since we consumed it
      }
    }
    div.appendChild(fragment)
  } else {
    // No mentions — standard markdown render
    div.innerHTML = sanitizeHtml(renderMarkdown(text))
  }

  return div
}

// ---------------------------------------------------------------------------
// Code block — with language badge, copy button, optional line numbers
// ---------------------------------------------------------------------------

function renderCodeBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const code = block.code || ""
  if (!code.trim()) return null

  const outerWrapper = document.createElement("div")
  outerWrapper.className = "code-block"

  // Header: language badge + copy button
  const header = document.createElement("div")
  header.className = "code-block-header"

  const lang = document.createElement("span")
  lang.className = "code-block-lang"
  lang.textContent = block.language || "code"
  header.appendChild(lang)

  const actions = document.createElement("div")
  actions.className = "code-block-actions"

  const copyBtn = document.createElement("button")
  copyBtn.className = "code-block-copy"
  copyBtn.setAttribute("aria-label", "Copy code to clipboard")
  copyBtn.title = "Copy code"
  copyBtn.innerHTML = COPY_SVG + '<span>Copy</span>'
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.classList.add("copied")
      copyBtn.innerHTML = CHECK_SVG + '<span>Copied!</span>'
      setTimeout(() => {
        copyBtn.classList.remove("copied")
        copyBtn.innerHTML = COPY_SVG + '<span>Copy</span>'
      }, 1500)
    })
  })
  actions.appendChild(copyBtn)

  const insertBtn = document.createElement("button")
  insertBtn.className = "code-block-insert"
  insertBtn.setAttribute("aria-label", "Insert code at cursor position")
  insertBtn.title = "Insert at Cursor"
  insertBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg><span>Insert</span>`
  insertBtn.addEventListener("click", () => {
    const vscode = (window as any).acquireVsCodeApi?.()
    if (vscode) {
      vscode.postMessage({ type: "insert_at_cursor", code, language: block.language })
    }
  })
  actions.appendChild(insertBtn)

  const newFileBtn = document.createElement("button")
  newFileBtn.className = "code-block-new-file"
  newFileBtn.setAttribute("aria-label", "Create new file from code block")
  newFileBtn.title = "Create New File"
  newFileBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg><span>New File</span>`
  newFileBtn.addEventListener("click", () => {
    const vscode = (window as any).acquireVsCodeApi?.()
    if (vscode) {
      vscode.postMessage({ type: "create_file_from_code", code, language: block.language })
    }
  })
  actions.appendChild(newFileBtn)

  header.appendChild(actions)
  outerWrapper.appendChild(header)

  // Content: syntax-highlighted code with optional line numbers
  const lines = code.split("\n")
  const showLineNums = lines.length > 5

  if (showLineNums) {
    const grid = document.createElement("div")
    grid.className = "code-block-lines"
    lines.forEach((line, i) => {
      // Line number
      const numEl = document.createElement("span")
      numEl.className = "code-line-num"
      numEl.textContent = String(i + 1)
      grid.appendChild(numEl)
      // Line content
      const codeEl = document.createElement("span")
      codeEl.className = "code-line-content"
      const highlighted = highlightSyntax(line, block.language || "")
      codeEl.innerHTML = sanitizeHtml(highlighted) || "&nbsp;"
      grid.appendChild(codeEl)
    })
    outerWrapper.appendChild(grid)
  } else {
    const pre = document.createElement("pre")
    pre.className = "code-block-content"
    pre.innerHTML = sanitizeHtml(highlightSyntax(code, block.language || ""))
    outerWrapper.appendChild(pre)
  }

  return outerWrapper
}

export function highlightSyntax(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try { return hljs.highlight(code, { language }).value } catch {}
  }
  try { return hljs.highlightAuto(code).value } catch (e) {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
}

// ---------------------------------------------------------------------------
// Turn grouping — Phase 4.1: Group user+assistant exchanges into collapsible turns
// ---------------------------------------------------------------------------

export interface TurnSummary {
  turnId: string
  userMessageId: string
  assistantMessageId: string
  snippet: string
  toolCount: number
  patchCount: number
  timestamp: number
}

export function groupMessagesIntoTurns(messages: import("./types").ChatMessage[]): TurnSummary[] {
  const turns: TurnSummary[] = []
  let currentTurn: TurnSummary | null = null

  for (const msg of messages) {
    if (msg.role === "user") {
      if (currentTurn) turns.push(currentTurn)
      currentTurn = {
        turnId: `turn-${msg.id || crypto.randomUUID()}`,
        userMessageId: msg.id || "",
        assistantMessageId: "",
        snippet: extractSnippet(msg),
        toolCount: 0,
        patchCount: 0,
        timestamp: msg.timestamp || Date.now(),
      }
    } else if (msg.role === "assistant") {
      if (currentTurn) {
        currentTurn.assistantMessageId = msg.id || ""
        // Count tool calls and diffs in this assistant message
        const blocks = msg.blocks || []
        currentTurn.toolCount = blocks.filter(b => b.type === "tool-call" || b.type === "tool_call").length
        currentTurn.patchCount = blocks.filter(b => b.type === "diff" || b.type === "diff_block").length
        if (!currentTurn.snippet || currentTurn.snippet === "...") {
          currentTurn.snippet = extractSnippet(msg)
        }
      }
    }
  }

  if (currentTurn) turns.push(currentTurn)
  return turns
}

function extractSnippet(msg: import("./types").ChatMessage): string {
  const blocks = msg.blocks || []
  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      const text = b.text.trim().replace(/\n/g, " ")
      if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
    }
    if (b.type === "tool-call" || b.type === "tool_call") {
      return `Used ${b.name || b.toolName || 'tool'}`
    }
  }
  return msg.role === "user" ? "Sent a message" : "Thinking..."
}

function renderThinkingBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const thinking = isThinkingBlock(block) ? block : (block as unknown as ThinkingBlock)
  const content = thinking.content || ""
  if (!content.trim() && !thinking.streaming) return null

  const details = document.createElement("details")
  details.className = "thinking-block"
  details.setAttribute("aria-label", thinking.streaming ? "Thinking in progress" : "Reasoning")

  const summary = document.createElement("summary")
  summary.className = "thinking-header"
  summary.innerHTML = BRAIN_SVG
  const label = document.createElement("span")
  label.className = "thinking-label"
  label.textContent = thinking.streaming ? "Thinking" : `Reasoning${thinking.tokenCount ? ` (${thinking.tokenCount} tokens)` : ""}`
  summary.appendChild(label)

  if (thinking.streaming) {
    const loader = document.createElement("span")
    loader.className = "thinking-pulse"
    summary.appendChild(loader)
  }

  const toggle = document.createElement("span")
  toggle.className = "thinking-toggle"
  toggle.innerHTML = CHEVRON_RIGHT_SVG
  summary.appendChild(toggle)

  details.appendChild(summary)

  const body = document.createElement("div")
  body.className = "thinking-body"
  if (content) {
    body.innerHTML = sanitizeHtml(md.render(content))
  }
  details.appendChild(body)

  return details
}

// ---------------------------------------------------------------------------
// Skill badge
// ---------------------------------------------------------------------------

function renderSkillBadge(block: Block, _opts: RenderOptions): HTMLElement | null {
  const badge = document.createElement("div")
  badge.className = "skill-badge"

  const icon = document.createElement("span")
  icon.className = "skill-icon"
  icon.innerHTML = GEAR_SVG
  badge.appendChild(icon)

  const name = document.createElement("span")
  const skillName = block.skillName
  if (!skillName || skillName === "unknown" || skillName === "") {
    return null // Don't render empty skill tags
  }
  name.textContent = skillName
  badge.appendChild(name)

  return badge
}

// ---------------------------------------------------------------------------
// Tool call block — full renderer with states and classes
// ---------------------------------------------------------------------------

function renderToolCallBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const toolBlock: ToolCallBlock = isToolCallBlock(block) ? block : ({
        type: 'tool-call',
        id: block.id || `tool-${Date.now()}`,
        name: block.toolName || block.name || "tool",
        class: (block.class as ToolCallClass) || (block.toolType as ToolCallClass) || 'read',
        state: (block.state as ToolCallState) || 'running',
        args: block.args ? (typeof block.args === 'string' ? JSON.parse(block.args) : block.args) : undefined,
        result: block.result,
        durationMs: (block.durationMs as number | undefined),
      } as ToolCallBlock)

  const toolClass = toolBlock.class || 'read'
  const toolState = toolBlock.state || 'running'

  const details = document.createElement("details")
  details.className = `tool-call tool-call--${toolClass} tool-call--${toolState}`
  details.dataset.blockId = toolBlock.id
  if (toolState === 'result' && toolBlock.error) {
    details.className += ' tool-call--error'
  }
  details.setAttribute("aria-label", `${toolBlock.name} tool call, ${toolState} state`)
  details.setAttribute("aria-expanded", "false")
  // Toggle aria-expanded on toggle
  details.addEventListener("toggle", () => {
    details.setAttribute("aria-expanded", details.open ? "true" : "false")
  })

  // Default open for errors
  if (toolState === 'result' && toolBlock.error) {
    details.open = true
  }

  const summary = document.createElement("summary")
  summary.className = "tool-header"
  summary.setAttribute("tabindex", "0")
  summary.setAttribute("role", "button")
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      details.open = !details.open
      details.setAttribute("aria-expanded", details.open ? "true" : "false")
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      focusAdjacentToolSummary(summary, event.key)
    }
  })

  // Tool icon based on class
  const icon = document.createElement("span")
  icon.className = "tool-icon"
  switch (toolClass) {
    case 'write': icon.innerHTML = TOOL_WRITE_SVG; break
    case 'exec': icon.innerHTML = TOOL_EXEC_SVG; break
    case 'meta': icon.innerHTML = TOOL_META_SVG; break
    default: icon.innerHTML = TOOL_READ_SVG; break
  }
  summary.appendChild(icon)

  // Tool name
  const name = document.createElement("span")
  name.className = "tool-name"
  name.textContent = toolBlock.name
  summary.appendChild(name)

  // Key argument (e.g. filename)
  const keyArg = extractKeyArg(toolBlock.args)
  if (keyArg) {
    const argEl = document.createElement("span")
    argEl.className = "tool-arg"
    argEl.textContent = truncateMiddle(keyArg, 30)
    argEl.title = keyArg
    summary.appendChild(argEl)
  }

  // Status badge (text + symbol for colour-blind accessible distinction)
  const badge = document.createElement("span")
  badge.className = `tool-status tool-status--${toolState}`
  if (toolState === 'pending') {
    badge.textContent = '○ Pending'
    badge.setAttribute("aria-label", "Tool pending")
  } else if (toolState === 'running') {
    badge.textContent = '◉ Running'
    badge.setAttribute("aria-label", "Tool running")
  } else if (toolState === 'stale') {
    badge.textContent = 'Stale'
    badge.setAttribute("aria-label", "Tool completion unconfirmed")
  } else if (toolBlock.error || toolState === 'error') {
    badge.textContent = '✗ Error'
    badge.setAttribute("aria-label", "Tool error")
  } else if (toolState === 'completed' || toolState === 'result') {
    badge.textContent = '✓ Done'
    badge.setAttribute("aria-label", "Tool complete")
  } else {
    badge.textContent = '✓ Done'
  }
  summary.appendChild(badge)

  // Duration
  if (toolBlock.durationMs && (toolState === 'result' || toolState === 'completed')) {
    const dur = document.createElement("span")
    dur.className = "tool-duration"
    dur.textContent = toolBlock.durationMs >= 1000
      ? `${(toolBlock.durationMs / 1000).toFixed(1)}s`
      : `${toolBlock.durationMs}ms`
    summary.appendChild(dur)
  } else if (toolState === 'running' || toolState === 'pending') {
    const elapsed = document.createElement("span")
    elapsed.className = "tool-elapsed"
    elapsed.dataset.startTime = String(Date.now())
    elapsed.textContent = "0s"
    summary.appendChild(elapsed)
  }

  // Output size on completion
  if (toolBlock.result && (toolState === 'result' || toolState === 'completed')) {
    const resultStr = typeof toolBlock.result === 'string' ? toolBlock.result : JSON.stringify(toolBlock.result)
    const size = document.createElement("span")
    size.className = "tool-output-size"
    const lines = resultStr.split('\n').length
    const chars = resultStr.length
    size.textContent = chars >= 1024 ? `${(chars / 1024).toFixed(1)}KB` : `${chars} chars`
    size.title = `${lines} lines, ${chars} characters`
    summary.appendChild(size)
  }

  details.appendChild(summary)

  // Args panel (collapsed by default, show first 500 chars)
  if (toolBlock.args !== undefined) {
    const argsDiv = document.createElement("div")
    argsDiv.className = "tool-args-panel"
    const argsStr = typeof toolBlock.args === 'string' ? toolBlock.args : JSON.stringify(toolBlock.args, null, 2)
    const truncated = argsStr.length > 500
    const displayStr = truncated ? argsStr.slice(0, 500) : argsStr
    argsDiv.innerHTML = sanitizeHtml(highlightSyntax(displayStr, 'json'))
    if (truncated) {
      const more = document.createElement("button")
      more.className = "tool-show-more"
      more.textContent = "Show more…"
      more.addEventListener("click", () => {
        argsDiv.innerHTML = sanitizeHtml(highlightSyntax(argsStr, 'json'))
        more.remove()
      })
      argsDiv.appendChild(more)
    }
    details.appendChild(argsDiv)
  }

  // Result panel
  if (toolBlock.result !== undefined && (toolState === 'result' || toolState === 'completed' || toolState === 'stale')) {
    const resultDiv = document.createElement("div")
    resultDiv.className = toolBlock.error ? "tool-result-panel tool-result-panel--error" : "tool-result-panel"
    const resultText = typeof toolBlock.result === 'string' ? toolBlock.result : JSON.stringify(toolBlock.result, null, 2)
    const lines = resultText.split("\n")
    const truncated = resultText.length > 2000 || lines.length > 40
    const displayResult = truncated ? lines.slice(0, 40).join("\n").slice(0, 2000) : resultText
    const meta = document.createElement("div")
    meta.className = "tool-result-meta"
    meta.textContent = `${formatOutputSize(resultText.length)}${lines.length > 1 ? `, ${lines.length} lines` : ""}`
    resultDiv.appendChild(meta)
    const body = document.createElement("pre")
    body.className = "tool-result-body"
    body.textContent = displayResult
    resultDiv.appendChild(body)
    if (truncated) {
      const more = document.createElement("button")
      more.className = "tool-show-more"
      more.textContent = "Show full"
      more.addEventListener("click", () => {
        body.textContent = resultText
        more.remove()
      })
      resultDiv.appendChild(more)
    }
    details.appendChild(resultDiv)
  }

  return details
}

function extractKeyArg(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  const candidates = [a.path, a.file, a.filename, a.url, a.command, a.query, a.name]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return null
}

function groupConsecutiveToolCalls(blocks: Block[]): Block[][] {
  const groups: Block[][] = []
  let currentGroup: Block[] = []
  let lastToolName: string | null = null

  for (const block of blocks) {
    const isTool = block.type === "tool-call" || block.type === "tool_call"
    const toolName = isTool ? (block as any).name || (block as any).toolName || "tool" : ""

    if (isTool && toolName === lastToolName && currentGroup.length > 0) {
      currentGroup.push(block)
    } else {
      if (currentGroup.length > 0) groups.push(currentGroup)
      currentGroup = isTool ? [block] : [block]
      lastToolName = isTool ? toolName : null
      if (!isTool) { groups.push([block]); currentGroup = [] }
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup)
  return groups
}

function renderToolGroup(blocks: Block[], opts: RenderOptions): HTMLElement | null {
  if (blocks.length === 0) return null

  const firstTool = blocks[0]!
  const tc = isToolCallBlock(firstTool) ? firstTool : null
  const toolClass = tc?.class || 'read'
  const toolName = tc?.name || 'tool'

  const group = document.createElement("details")
  group.className = `tool-call tool-group tool-call--${toolClass}`
  group.dataset.blockId = `group-${tc?.id || Date.now()}`

  const summary = document.createElement("summary")
  summary.className = "tool-header"
  summary.setAttribute("tabindex", "0")
  summary.setAttribute("role", "button")
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      group.open = !group.open
    }
  })

  const icon = document.createElement("span")
  icon.className = "tool-icon"
  switch (toolClass) {
    case 'write': icon.innerHTML = TOOL_WRITE_SVG; break
    case 'exec': icon.innerHTML = TOOL_EXEC_SVG; break
    case 'meta': icon.innerHTML = TOOL_META_SVG; break
    default: icon.innerHTML = TOOL_READ_SVG; break
  }
  summary.appendChild(icon)

  const name = document.createElement("span")
  name.className = "tool-name"
  name.textContent = toolName
  summary.appendChild(name)

  const count = document.createElement("span")
  count.className = "tool-group-count"
  count.textContent = `${blocks.length} calls`
  summary.appendChild(count)

  const completed = blocks.filter(b => {
    const s = (b as any).state
    return s === 'result' || s === 'completed'
  }).length
  const badge = document.createElement("span")
  badge.className = "tool-status"
  if (completed === blocks.length) {
    badge.textContent = '✓ Done'
  } else if (completed > 0) {
    badge.textContent = `◉ ${completed}/${blocks.length}`
  } else {
    badge.textContent = '◉ Running'
  }
  summary.appendChild(badge)

  group.appendChild(summary)

  const children = document.createElement("div")
  children.className = "tool-group-children"
  for (const block of blocks) {
    const el = renderToolCallBlock(block, opts)
    if (el) {
      el.classList.add("tool-group-child")
      children.appendChild(el)
    }
  }
  group.appendChild(children)

  return group
}

function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  const half = Math.floor((maxLen - 1) / 2)
  return str.slice(0, half) + '\u2026' + str.slice(str.length - half)
}

function formatOutputSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k chars`
}

function focusAdjacentToolSummary(current: HTMLElement, key: string): void {
  const summaries = Array.from(document.querySelectorAll<HTMLElement>(".tool-header"))
  if (summaries.length === 0) return
  const index = summaries.indexOf(current)
  if (index < 0) return
  const nextIndex =
    key === "Home" ? 0 :
    key === "End" ? summaries.length - 1 :
    key === "ArrowUp" ? Math.max(0, index - 1) :
    Math.min(summaries.length - 1, index + 1)
  summaries[nextIndex]?.focus()
}

// ---------------------------------------------------------------------------
// New diff block — table-based with line numbers, sticky action bar
// ---------------------------------------------------------------------------

function renderNewDiffBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const diffBlock: DiffBlock = isDiffBlock(block)
    ? block
    : {
        type: 'diff',
        diffId: block.diffId || block.id || `diff-${Date.now()}`,
        path: block.filePath || block.path || "File Change",
        hunks: block.hunks || [],
        state: (block.state as 'pending' | 'accepted' | 'discarded') || 'pending',
        linesAdded: block.linesAdded || 0,
        linesRemoved: block.linesRemoved || 0,
      }

  const wrapper = document.createElement("div")
  wrapper.className = `diff-block diff-block--${diffBlock.state}`
  wrapper.dataset.diffId = diffBlock.diffId

  // Header: filename + stats
  const header = document.createElement("div")
  header.className = "diff-header"

  const fileInfo = document.createElement("div")
  fileInfo.className = "diff-file-info"

  const filePath = document.createElement("span")
  filePath.className = "diff-file-path"
  filePath.textContent = diffBlock.path
  fileInfo.appendChild(filePath)

  const stats = document.createElement("span")
  stats.className = "diff-stats"
  if (diffBlock.linesAdded > 0) {
    const added = document.createElement("span")
    added.className = "diff-stat diff-stat--added"
    added.textContent = `+${diffBlock.linesAdded}`
    stats.appendChild(added)
  }
  if (diffBlock.linesRemoved > 0) {
    const removed = document.createElement("span")
    removed.className = "diff-stat diff-stat--removed"
    removed.textContent = `-${diffBlock.linesRemoved}`
    stats.appendChild(removed)
  }
  fileInfo.appendChild(stats)
  header.appendChild(fileInfo)
  wrapper.appendChild(header)

  // Diff table
  if (diffBlock.hunks.length > 0) {
    const tableWrapper = document.createElement("div")
    tableWrapper.className = "diff-table-wrapper"

    const table = document.createElement("table")
    table.className = "diff-table"

    diffBlock.hunks.forEach((hunk) => {
      // Hunk header
      const hunkRow = document.createElement("tr")
      hunkRow.className = "diff-hunk-header"
      const hunkCell = document.createElement("td")
      hunkCell.colSpan = 4
      hunkCell.textContent = `@@ -${hunk.oldStart},${hunk.lines.length} +${hunk.newStart},${hunk.lines.length} @@`
      hunkRow.appendChild(hunkCell)
      table.appendChild(hunkRow)

      hunk.lines.forEach((line) => {
        const row = document.createElement("tr")
        row.className = `diff-line diff-line--${line.type}`

        // Old line number
        const oldNum = document.createElement("td")
        oldNum.className = "diff-line-num diff-line-num--old"
        oldNum.textContent = line.oldLine != null ? String(line.oldLine) : ""
        row.appendChild(oldNum)

        // New line number
        const newNum = document.createElement("td")
        newNum.className = "diff-line-num diff-line-num--new"
        newNum.textContent = line.newLine != null ? String(line.newLine) : ""
        row.appendChild(newNum)

        // Change marker
        const marker = document.createElement("td")
        marker.className = "diff-line-marker"
        marker.textContent = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
        row.appendChild(marker)

        // Content
        const content = document.createElement("td")
        content.className = "diff-line-content"
        content.textContent = line.content
        row.appendChild(content)

        table.appendChild(row)
      })
    })

    tableWrapper.appendChild(table)
    wrapper.appendChild(tableWrapper)
  } else if (block.diffText) {
    // Fallback: render raw diff text
    const pre = document.createElement("pre")
    pre.className = "diff-content"
    pre.textContent = block.diffText
    wrapper.appendChild(pre)
  }

  // Action bar (sticky bottom)
  const actionBar = document.createElement("div")
  actionBar.className = "diff-action-bar"

  if (diffBlock.state === 'accepted') {
    actionBar.innerHTML = ''
    const chip = document.createElement("span")
    chip.className = "diff-state-chip diff-state--accepted"
    chip.innerHTML = SUCCESS_SVG + ' Applied'
    actionBar.appendChild(chip)
    wrapper.classList.add("diff-block--accepted")
  } else if (diffBlock.state === 'discarded') {
    actionBar.innerHTML = ''
    const chip = document.createElement("span")
    chip.className = "diff-state-chip diff-state--discarded"
    chip.innerHTML = ERROR_SVG + ' Discarded'
    actionBar.appendChild(chip)
    wrapper.classList.add("diff-block--discarded")
    // Auto-collapse diff on discard
    const tableWrapper = wrapper.querySelector(".diff-table-wrapper")
    if (tableWrapper) tableWrapper.classList.add("hidden")
    const diffContent = wrapper.querySelector(".diff-content")
    if (diffContent) diffContent.classList.add("hidden")
  } else {
    const isPlanMode = opts.mode === "plan"

      if (isPlanMode) {
        const reviewLabel = document.createElement("span")
        reviewLabel.className = "diff-review-label"
        reviewLabel.textContent = "Review"
        actionBar.appendChild(reviewLabel)
      }

    const acceptBtn = document.createElement("button")
    acceptBtn.className = isPlanMode ? "diff-btn diff-btn--approve" : "diff-btn diff-btn--accept"
    acceptBtn.textContent = isPlanMode ? "Approve & Apply" : "Accept"
    acceptBtn.setAttribute("aria-label", `Accept changes to ${diffBlock.path}`)
    acceptBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const postMessage = opts.postMessage
      if (postMessage) {
        postMessage({ type: 'diff:accept', diffId: diffBlock.diffId, path: diffBlock.path })
      }
      actionBar.innerHTML = ''
      const chip = document.createElement("span")
      chip.className = "diff-state-chip diff-state--accepted"
      chip.innerHTML = SUCCESS_SVG + ' Applied'
      actionBar.appendChild(chip)
      wrapper.classList.add("diff-block--accepted")
    })
    actionBar.appendChild(acceptBtn)

    const discardBtn = document.createElement("button")
    discardBtn.className = "diff-btn diff-btn--discard"
    discardBtn.textContent = "Discard"
    discardBtn.setAttribute("aria-label", `Discard changes to ${diffBlock.path}`)
    discardBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const postMessage = opts.postMessage
      if (postMessage) {
        postMessage({ type: 'diff:discard', diffId: diffBlock.diffId })
      }
      actionBar.innerHTML = ''
      const chip = document.createElement("span")
      chip.className = "diff-state-chip diff-state--discarded"
      chip.innerHTML = ERROR_SVG + ' Discarded'
      actionBar.appendChild(chip)
      wrapper.classList.add("diff-block--discarded")
      const tableWrapper = wrapper.querySelector(".diff-table-wrapper")
      if (tableWrapper) tableWrapper.classList.add("hidden")
      const diffContent = wrapper.querySelector(".diff-content")
      if (diffContent) diffContent.classList.add("hidden")
    })
    actionBar.appendChild(discardBtn)

    const openBtn = document.createElement("button")
    openBtn.className = "diff-btn diff-btn--open"
    openBtn.textContent = "Open File"
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const postMessage = opts.postMessage
      if (postMessage) {
        postMessage({ type: 'diff:openFile', path: diffBlock.path })
      }
    })
    actionBar.appendChild(openBtn)
  }

  wrapper.appendChild(actionBar)
  return wrapper
}

// ---------------------------------------------------------------------------
// Legacy diff block renderer (backward compatibility)
// ---------------------------------------------------------------------------

function renderDiffBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  return renderNewDiffBlock(block, opts)
}

// ---------------------------------------------------------------------------
// Permission block
// ---------------------------------------------------------------------------

function renderPermissionBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const wrapper = document.createElement("div")
  wrapper.className = "permission-block"

  const text = document.createElement("div")
  text.className = "permission-text"
  text.textContent = block.text || "Requesting permission..."
  wrapper.appendChild(text)

  const actions = document.createElement("div")
  actions.className = "permission-actions"

  if (block.permissionId) {
    const allowBtn = document.createElement("button")
    allowBtn.className = "permission-btn permission-btn--allow"
    allowBtn.textContent = "Allow"
    allowBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("oc-permission", { detail: { permissionId: block.permissionId, response: "once" } }))
      actions.replaceChildren(document.createTextNode("Allowed"))
    })
    actions.appendChild(allowBtn)

    const denyBtn = document.createElement("button")
    denyBtn.className = "permission-btn permission-btn--deny"
    denyBtn.textContent = "Deny"
    denyBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("oc-permission", { detail: { permissionId: block.permissionId, response: "reject" } }))
      actions.replaceChildren(document.createTextNode("Denied"))
    })
    actions.appendChild(denyBtn)
  }

  wrapper.appendChild(actions)
  return wrapper
}

// ---------------------------------------------------------------------------
// Task banner
// ---------------------------------------------------------------------------

function renderTaskBanner(block: Block, _opts: RenderOptions): HTMLElement | null {
  const status = (block.status as "success" | "error" | "warning") || "success"
  const wrapper = document.createElement("div")
  wrapper.className = `task-banner task-banner--${status}`
  wrapper.setAttribute("role", status === "error" ? "alert" : "status")

  const icon = document.createElement("span")
  icon.className = "task-banner-icon"
  icon.innerHTML = status === "success" ? SUCCESS_SVG : ERROR_SVG
  wrapper.appendChild(icon)

  const text = document.createElement("span")
  text.textContent = block.text || "Task Status Updated"
  wrapper.appendChild(text)

  return wrapper
}

// ---------------------------------------------------------------------------
// Context block
// ---------------------------------------------------------------------------

function renderContextBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const wrapper = document.createElement("div")
  wrapper.className = "context-block"

  const header = document.createElement("div")
  header.className = "context-header"

  const toggle = document.createElement("span")
  toggle.className = "context-toggle"
  toggle.innerHTML = CHEVRON_RIGHT_SVG
  header.appendChild(toggle)

  const label = document.createElement("span")
  label.textContent = "Context"
  header.appendChild(label)

  wrapper.appendChild(header)

  const content = document.createElement("div")
  content.className = "context-content"
  content.textContent = block.text || ""
  wrapper.appendChild(content)

  wrapper.addEventListener("click", () => {
    wrapper.classList.toggle("expanded")
  })

  return wrapper
}

// ---------------------------------------------------------------------------
// Error block
// ---------------------------------------------------------------------------

function renderErrorBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const errorBlock: ErrorBlock = isErrorBlock(block)
    ? block
    : ({
        type: 'error',
        code: (block.code as string) || 'unknown',
        message: String(block.text ?? block.message ?? "An error occurred"),
        detail: (block.detail as string | undefined),
        retryable: (block.retryable as boolean) || false,
      } as ErrorBlock)

  const wrapper = document.createElement("div")
  wrapper.className = "msg-error"
  wrapper.setAttribute("role", "alert")

  const content = document.createElement("div")
  content.className = "error-bubble"

  const header = document.createElement("div")
  header.className = "error-header"
  header.innerHTML = WARNING_SVG
  const title = document.createElement("span")
  title.textContent = `Error: ${errorBlock.code}`
  header.appendChild(title)
  content.appendChild(header)

  const msg = document.createElement("div")
  msg.className = "error-message"
  msg.textContent = errorBlock.message
  content.appendChild(msg)

  if (errorBlock.detail) {
    const detail = document.createElement("div")
    detail.className = "error-detail"
    detail.textContent = errorBlock.detail
    content.appendChild(detail)
  }

  wrapper.appendChild(content)
  return wrapper
}

function renderImageBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const data = block.data as string | undefined
  const mimeType = (block.mimeType as string) || "image/png"
  if (!data) return null

  const wrapper = document.createElement("div")
  wrapper.className = "msg-image"

    const img = document.createElement("img")
    img.src = `data:${mimeType};base64,${data}`
    img.alt = "Attached image"
    img.className = "attached-image-thumb msg-image img"
    img.style.cursor = "pointer"
    img.loading = "lazy"

  img.addEventListener("click", () => {
      const viewer = document.createElement("div")
        viewer.className = "image-viewer-overlay"
        const fullImg = document.createElement("img")
        fullImg.src = img.src
        fullImg.className = "image-viewer-full"
        fullImg.loading = "lazy"
        viewer.appendChild(fullImg)
    viewer.addEventListener("click", () => viewer.remove())
    document.body.appendChild(viewer)
  })

  wrapper.appendChild(img)
  return wrapper
}
