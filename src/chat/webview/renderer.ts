import hljs from "highlight.js/lib/core"
import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"
import DOMPurify from "dompurify"
import {
  BRAIN_SVG,
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
import { renderToolCallBlock, isToolCallBlock, groupConsecutiveToolCalls } from "./toolCallRenderer"
import { getThinkingVisible } from "./displayPrefs"
import type {
  Block,
  ChatMessage,
  DiffBlock,
  ThinkingBlock,
  ErrorBlock,
  DiffHunk,
  DiffLine,
  ToolCollapseConfig,
} from "./types"

declare global {
  interface Window {
    __OC_MARKDOWN_WORKER_URI__?: string
  }
}

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

/**
 * Streaming-aware markdown normalization.
 * Handles partial markdown artifacts during streaming, such as unclosed code fences.
 */
export function normalizeStreamingMarkdown(text: string): string {
  let normalized = normalizeMarkdownText(text)
  
  // Close unclosed code fences to prevent markdown-it from treating the rest as code
  const codeFenceMatches = normalized.match(/^```[\s\S]*?```/gm) || []
  const openFences = (normalized.match(/```/g) || []).length
  if (openFences % 2 !== 0) {
    normalized += "\n```"
  }
  
  // Close unclosed inline code
  const inlineCodeMatches = normalized.match(/`[^`\n]*`/g) || []
  const openInline = (normalized.match(/`/g) || []).length
  if (openInline % 2 !== 0) {
    normalized += "`"
  }
  
  return normalized
}

class LruStringCache {
  private values = new Map<string, { value: string; bytes: number }>()
  private totalBytes = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get(key: string): string | undefined {
    const hit = this.values.get(key)
    if (!hit) return undefined
    this.values.delete(key)
    this.values.set(key, hit)
    return hit.value
  }

  set(key: string, value: string): void {
    const bytes = (key.length + value.length) * 2
    if (bytes > this.maxBytes) return
    const previous = this.values.get(key)
    if (previous) {
      this.totalBytes -= previous.bytes
      this.values.delete(key)
    }
    this.values.set(key, { value, bytes })
    this.totalBytes += bytes
    this.prune()
  }

  clear(): void {
    this.values.clear()
    this.totalBytes = 0
  }

  get size(): number {
    return this.values.size
  }

  private prune(): void {
    while (this.values.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.values.keys().next().value as string | undefined
      if (!oldest) break
      const entry = this.values.get(oldest)
      if (entry) this.totalBytes -= entry.bytes
      this.values.delete(oldest)
    }
  }
}

const markdownCache = new LruStringCache(250, 2 * 1024 * 1024)
const highlightCache = new LruStringCache(500, 1024 * 1024)

export const MARKDOWN_WORKER_MIN_CHARS = 8_000
export const MARKDOWN_WORKER_MIN_CODE_CHARS = 4_000
export const MARKDOWN_WORKER_TIMEOUT_MS = 8_000

type MarkdownWorkerResponse =
  | { id: number; html: string }
  | { id: number; error: string }

type PendingMarkdownRender = {
  resolve: (html: string | undefined) => void
  timer: ReturnType<typeof setTimeout>
}

function normalizeMarkdownForRender(text: string, isStreaming: boolean): string {
  return isStreaming ? normalizeStreamingMarkdown(text) : normalizeMarkdownText(text)
}

export function getCachedMarkdown(text: string, isStreaming: boolean = false): string | undefined {
  if (isStreaming) return undefined
  return markdownCache.get(normalizeMarkdownForRender(text, false))
}

export function shouldRenderMarkdownInWorker(text: string, isStreaming: boolean = false): boolean {
  if (isStreaming) return false
  if (typeof window === "undefined") return false
  if (typeof Worker === "undefined" || typeof URL === "undefined" || typeof fetch === "undefined") return false
  if (!window.__OC_MARKDOWN_WORKER_URI__) return false
  if (text.length >= MARKDOWN_WORKER_MIN_CHARS) return true
  const fenceCount = (text.match(/(^|\n)```/g) || []).length
  return text.length >= MARKDOWN_WORKER_MIN_CODE_CHARS && fenceCount >= 2
}

class MarkdownWorkerClient {
  private worker: Worker | undefined
  private workerPromise: Promise<Worker | null> | undefined
  private objectUrl: string | undefined
  private pending = new Map<number, PendingMarkdownRender>()
  private nextId = 1
  private disabled = false

  async render(normalized: string): Promise<string | undefined> {
    if (this.disabled) return undefined
    const worker = await this.getWorker()
    if (!worker) return undefined

    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(undefined)
      }, MARKDOWN_WORKER_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      try {
        worker.postMessage({ id, text: normalized })
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(undefined)
      }
    })
  }

  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve(undefined)
    }
    this.pending.clear()
    try {
      this.worker?.terminate()
    } catch {
      // Best-effort shutdown only.
    }
    if (this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl)
      } catch {
        // Best-effort cleanup only.
      }
    }
    this.worker = undefined
    this.workerPromise = undefined
    this.objectUrl = undefined
  }

  private async getWorker(): Promise<Worker | null> {
    if (this.worker) return this.worker
    if (this.workerPromise) return this.workerPromise
    this.workerPromise = this.createWorker().catch(() => {
      this.disabled = true
      this.dispose()
      return null
    })
    return this.workerPromise
  }

  private async createWorker(): Promise<Worker | null> {
    const sourceUri = window.__OC_MARKDOWN_WORKER_URI__
    if (!sourceUri) return null

    const response = await fetch(sourceUri)
    if (!response.ok) throw new Error(`Markdown worker fetch failed: ${response.status}`)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const worker = new Worker(objectUrl, { name: "opencode-markdown-renderer" })
    this.objectUrl = objectUrl
    this.worker = worker

    worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
      const message = event.data
      const entry = this.pending.get(message?.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(message.id)
      entry.resolve("html" in message && typeof message.html === "string" ? message.html : undefined)
    }
    worker.onerror = () => {
      this.disabled = true
      this.dispose()
    }

    return worker
  }
}

let markdownWorkerClient: MarkdownWorkerClient | undefined

function getMarkdownWorkerClient(): MarkdownWorkerClient {
  if (!markdownWorkerClient) markdownWorkerClient = new MarkdownWorkerClient()
  return markdownWorkerClient
}

export function renderMarkdown(text: string, isStreaming: boolean = false): string {
  const normalized = normalizeMarkdownForRender(text, isStreaming)
  if (isStreaming) return sanitizeHtml(md.render(normalized))
  const cached = markdownCache.get(normalized)
  if (cached !== undefined) return cached
  const rendered = sanitizeHtml(md.render(normalized))
  markdownCache.set(normalized, rendered)
  return rendered
}

export async function renderMarkdownAsync(text: string, isStreaming: boolean = false): Promise<string> {
  const normalized = normalizeMarkdownForRender(text, isStreaming)
  if (isStreaming) return sanitizeHtml(md.render(normalized))
  const cached = markdownCache.get(normalized)
  if (cached !== undefined) return cached

  if (shouldRenderMarkdownInWorker(text, false)) {
    const html = await getMarkdownWorkerClient().render(normalized)
    if (html !== undefined) {
      const rendered = sanitizeHtml(html)
      markdownCache.set(normalized, rendered)
      return rendered
    }
  }

  const rendered = sanitizeHtml(md.render(normalized))
  markdownCache.set(normalized, rendered)
  return rendered
}

export function clearRendererCaches(): void {
  markdownCache.clear()
  highlightCache.clear()
  markdownWorkerClient?.dispose()
  markdownWorkerClient = undefined
}

export function getRendererCacheStats(): { markdownEntries: number; highlightEntries: number } {
  return {
    markdownEntries: markdownCache.size,
    highlightEntries: highlightCache.size,
  }
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

export { isToolCallBlock } from "./toolCallRenderer"

export function isDiffBlock(block: Block): block is DiffBlock {
  return block.type === 'diff'
}

export function isThinkingBlock(block: Block): block is ThinkingBlock {
  return block.type === 'thinking'
}

export function isErrorBlock(block: Block): block is ErrorBlock {
  return block.type === 'error'
}

// ---------------------------------------------------------------------------
// Revert confirmation dialog
// ---------------------------------------------------------------------------

function showRevertConfirmation(diffId: string, path: string, postMessage?: (msg: Record<string, unknown>) => void): void {
  // Validate required parameters
  if (!diffId || !path) {
    console.warn("Cannot show revert confirmation: missing diffId or path")
    return
  }

  // Remove existing modal if present
  const existingModal = document.getElementById('revert-modal')
  if (existingModal) {
    existingModal.remove()
  }

  // Create modal
  const modal = document.createElement('div')
  modal.id = 'revert-modal'
  modal.className = 'revert-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'revert-modal-title')

  modal.innerHTML = `
    <div class="revert-modal-content">
      <h2 id="revert-modal-title" class="revert-modal-title">Revert Changes?</h2>
      <p class="revert-modal-text">
        This will revert all changes to <strong>${escapeHtml(path)}</strong>. 
        This action cannot be undone.
      </p>
      <div class="revert-modal-actions">
        <button class="revert-modal-btn revert-modal-btn--cancel" id="revert-cancel">Cancel</button>
        <button class="revert-modal-btn revert-modal-btn--confirm" id="revert-confirm">Revert Changes</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  // Focus management
  const cancelBtn = modal.querySelector('#revert-cancel') as HTMLButtonElement
  const confirmBtn = modal.querySelector('#revert-confirm') as HTMLButtonElement

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      modal.remove()
    })
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      modal.remove()
      if (postMessage) {
        postMessage({ type: 'revert_diff', diffId, path })
      }
    })
  }

  // Close on Escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      modal.remove()
      document.removeEventListener('keydown', handleEscape)
    }
  }
  document.addEventListener('keydown', handleEscape)

  // Focus cancel button
  if (cancelBtn) cancelBtn.focus()
}

// Helper to escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ---------------------------------------------------------------------------
// RenderOptions — passed to each renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  messageId?: string
  postMessage?: (msg: Record<string, unknown>) => void
  mode?: string
  turnIndex?: number
  sessionId?: string
  skipHeader?: boolean
  collapseConfig?: ToolCollapseConfig
  isStreaming?: boolean
}

// ---------------------------------------------------------------------------
// Strict dispatch table — every block type must have a renderer
// ---------------------------------------------------------------------------

type BlockRenderer = (block: Block, opts: RenderOptions) => HTMLElement | null

const RENDERER_MAP: Readonly<Record<string, BlockRenderer>> = {
  'text': renderTextBlock,
  'code': renderCodeBlock,
  'thinking': renderThinkingBlock,
  'reasoning': renderThinkingBlock,
  'skill_badge': renderSkillBadge,
  'tool_call': renderToolCallBlock,
  'tool-call': renderToolCallBlock,
  'tool': renderToolCallBlock,
  // Canonical SDK part types (ADR-008 §5.1). Each renders a minimal chip/
  // marker; richer presentation can replace these without changing the
  // converter.
  'step-start': renderStepStartBlock,
  'step-finish': renderStepFinishBlock,
  'snapshot': renderSnapshotBlock,
  'patch': renderPatchBlock,
  'agent': renderAgentBlock,
  'retry': renderRetryBlock,
  'compaction': renderCompactionBlock,
  'subtask': renderSubtaskBlock,
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

// renderMessage moved to ./messageRenderer

export function formatRelativeTime(timestamp: number): string {
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

/**
 * Heuristic: does this text look like a written plan?
 *
 * Looks for any TWO of the following signals so we don't false-positive on
 * casual prose that happens to contain a single numbered line:
 *   - A `# Plan` / `## Plan` / `# Implementation` heading
 *   - Two or more `1. … 2. …` numbered steps
 *   - Two or more `- [ ]` / `- [x]` checklist items
 *   - An explicit "Plan:" / "Steps:" / "Implementation:" line opener
 */
export function detectPlanProse(text: string): boolean {
  if (!text || text.length < 30) return false
  const lower = text.toLowerCase()

  const hasPlanHeading = /(^|\n)#{1,3}\s+(plan|implementation|approach|strategy|steps?)\b/i.test(text)
  const numberedSteps = (text.match(/(^|\n)\s*\d+\.\s+\S/g) || []).length
  const checklistItems = (text.match(/(^|\n)\s*-\s*\[[ xX]\]/g) || []).length
  const hasPlanOpener = /(^|\n)\s*(plan|steps?|implementation|approach):\s/i.test(text)
  const mentionsPlan = lower.includes("plan") || lower.includes("approach") || lower.includes("step")

  let signals = 0
  if (hasPlanHeading) signals++
  if (numberedSteps >= 2) signals++
  if (checklistItems >= 2) signals++
  if (hasPlanOpener) signals++
  // The "mentions plan" check is a weak signal — only counts when paired
  // with structural evidence (numbered steps / checklist).
  if (mentionsPlan && (numberedSteps >= 2 || checklistItems >= 2)) signals++

  return signals >= 2
}

function renderTextBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const text = block.text || ""
  if (!text.trim()) return null

  // Plan-prose: wrap the rendered markdown in a styled card when the assistant
  // emits a plan-shaped message during plan mode.
  const isPlanModePlan = opts?.mode === "plan" && detectPlanProse(text)

  const div = document.createElement("div")
  div.className = isPlanModePlan ? "msg-text markdown-content plan-prose" : "msg-text markdown-content"

  if (isPlanModePlan) {
    const header = document.createElement("div")
    header.className = "plan-prose-header"
    header.textContent = "Proposed Plan"
    div.appendChild(header)
  }

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
        const normalized = opts?.isStreaming ? normalizeStreamingMarkdown(part) : normalizeMarkdownText(part)
        span.innerHTML = sanitizeHtml(md.renderInline(normalized, { label: false }))
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
    const isStreaming = opts?.isStreaming ?? false
    const cached = getCachedMarkdown(text, isStreaming)
    const target = isPlanModePlan ? document.createElement("div") : div
    if (target !== div) {
      target.className = "markdown-render-body"
      div.appendChild(target)
    }

    if (!isStreaming && cached === undefined && shouldRenderMarkdownInWorker(text, false)) {
      const renderId = `${Date.now()}-${Math.random()}`
      target.dataset.markdownRenderId = renderId
      target.setAttribute("aria-busy", "true")
      void renderMarkdownAsync(text, false)
        .then((html) => {
          if (target.dataset.markdownRenderId !== renderId) return
          target.innerHTML = html
          target.removeAttribute("aria-busy")
        })
        .catch(() => {
          if (target.dataset.markdownRenderId !== renderId) return
          target.innerHTML = renderMarkdown(text, false)
          target.removeAttribute("aria-busy")
        })
    } else {
      target.innerHTML = cached ?? renderMarkdown(text, isStreaming)
    }
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
  const normalizedLanguage = normalizeMarkdownLanguage(language || "")
  const cacheKey = `${normalizedLanguage}\u0000${code}`
  const cached = highlightCache.get(cacheKey)
  if (cached !== undefined) return cached

  let highlighted: string
  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    try {
      highlighted = hljs.highlight(code, { language: normalizedLanguage }).value
      highlightCache.set(cacheKey, highlighted)
      return highlighted
    } catch {}
  }
  try {
    highlighted = hljs.highlightAuto(code).value
  } catch {
    highlighted = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
  highlightCache.set(cacheKey, highlighted)
  return highlighted
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
        currentTurn.toolCount = blocks.filter(b => b.type === "tool-call" || b.type === "tool_call" || b.type === "tool").length
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
    if (b.type === "tool-call" || b.type === "tool_call" || b.type === "tool") {
      const toolName = typeof b.tool === "string" ? b.tool : (b.name || b.toolName || "tool")
      return `Used ${toolName}`
    }
  }
  return msg.role === "user" ? "Sent a message" : "Thinking..."
}

function renderThinkingBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const thinking = isThinkingBlock(block) ? block : (block as unknown as ThinkingBlock)
  // Tolerate the legacy `text` field: older persisted sessions (and the live
  // "thinking" event before the field-name fix) stored reasoning under `text`
  // instead of `content`. Reading both keeps historical messages renderable
  // without forcing a state migration.
  const legacyText = (thinking as unknown as { text?: unknown }).text
  const content =
    (typeof thinking.content === "string" && thinking.content) ||
    (typeof legacyText === "string" ? legacyText : "") ||
    ""
  if (!content.trim() && !thinking.streaming) return null

  const details = document.createElement("details")
  details.className = "thinking-block"
  details.setAttribute("aria-label", thinking.streaming ? "Thinking in progress" : "Reasoning")

  // While streaming, always show progress. Once final, honor the user pref
  // (Settings → Show thinking) — read live from displayPrefs so blocks that
  // arrive AFTER a toggle still pick up the latest preference.
  if (thinking.streaming) {
    details.open = true
  } else {
    details.open = getThinkingVisible()
  }

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
// Canonical SDK part renderers (Layer 7 of ADR-008)
// ---------------------------------------------------------------------------
// Minimal chips/markers for SDK part types that were previously silently
// dropped. Each renderer is intentionally small: surface that the event
// happened so users see continuity across compactions, retries, agents,
// subtasks, etc. — without claiming UI shape we don't have yet.

function renderStepStartBlock(_block: Block, _opts: RenderOptions): HTMLElement | null {
  // step-start is an SDK lifecycle event with no UX value: the model badge,
  // streaming spinner, and per-turn token bar already convey that work is in
  // progress. Emitting a raw chip for it just clutters the chat. Keep the
  // dispatch entry intact (so the SDK part isn't silently dropped at the
  // type-system level), but produce no DOM.
  return null
}

// Reasons that mean "this step ended the normal way" — chip suppressed.
// Covers the common set across SDK providers (OpenAI: stop / tool_calls,
// Anthropic: end_turn / stop_sequence / tool_use, generic: complete).
// Empty/whitespace reason is treated as normal too.
const NORMAL_FINISH_REASONS = new Set<string>([
  "stop",
  "end_turn",
  "stop_sequence",
  "tool_use",
  "tool_calls",
  "complete",
])

function renderStepFinishBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  // Normal completions need no chip — the assistant's reply is visible and
  // the token/cost displays show the post-step accounting. Only surface
  // unusual finishes (length cap, abort, content filter, error) where the
  // user benefits from knowing *why* the step ended.
  const rawReason = typeof block.reason === "string" ? block.reason.trim() : ""
  if (rawReason === "" || NORMAL_FINISH_REASONS.has(rawReason)) return null

  const tokens = block.tokens as
    | { input?: number; output?: number; reasoning?: number }
    | undefined

  const chip = document.createElement("div")
  chip.className = "step-finish-chip"
  const parts: string[] = [`Step finished (${rawReason})`]
  if (tokens) {
    const summary: string[] = []
    // Use Number.isFinite + >= 0 so NaN, Infinity, and negative counts
    // (which would otherwise pass typeof === "number") don't leak into the UI.
    if (Number.isFinite(tokens.input) && (tokens.input as number) >= 0) {
      summary.push(`in:${tokens.input}`)
    }
    if (Number.isFinite(tokens.output) && (tokens.output as number) >= 0) {
      summary.push(`out:${tokens.output}`)
    }
    if (Number.isFinite(tokens.reasoning) && (tokens.reasoning as number) > 0) {
      summary.push(`reasoning:${tokens.reasoning}`)
    }
    if (summary.length > 0) parts.push(summary.join(" "))
  }
  chip.textContent = parts.join(" — ")
  return chip
}

function renderSnapshotBlock(_block: Block, _opts: RenderOptions): HTMLElement | null {
  const marker = document.createElement("div")
  marker.className = "snapshot-marker"
  marker.textContent = "Snapshot"
  return marker
}

function renderPatchBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const wrapper = document.createElement("div")
  wrapper.className = "patch-summary"
  const files = Array.isArray(block.files) ? (block.files as string[]) : []
  if (files.length === 0) {
    wrapper.textContent = "Patch applied"
    return wrapper
  }
  const label = document.createElement("span")
  label.className = "patch-summary-label"
  label.textContent = `Patched ${files.length} file${files.length === 1 ? "" : "s"}: `
  wrapper.appendChild(label)
  const list = document.createElement("span")
  list.className = "patch-summary-files"
  list.textContent = files.join(", ")
  wrapper.appendChild(list)
  return wrapper
}

function renderAgentBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const chip = document.createElement("div")
  chip.className = "agent-chip"
  const name = typeof block.name === "string" ? block.name : "agent"
  chip.textContent = `Agent: ${name}`
  return chip
}

function renderRetryBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const chip = document.createElement("div")
  chip.className = "retry-chip"
  const attempt = typeof block.attempt === "number" ? block.attempt : 1
  const msg = typeof block.errorMessage === "string" ? block.errorMessage : "retry"
  chip.textContent = `Retry #${attempt} — ${msg}`
  return chip
}

function renderCompactionBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const marker = document.createElement("div")
  marker.className = "compaction-marker"
  const auto = block.auto === true
  marker.textContent = auto ? "Auto-compacted" : "Compacted"
  return marker
}

function renderSubtaskBlock(block: Block, _opts: RenderOptions): HTMLElement | null {
  const wrapper = document.createElement("div")
  wrapper.className = "subtask-block"
  const header = document.createElement("div")
  header.className = "subtask-header"
  const agent = typeof block.agent === "string" ? block.agent : "agent"
  header.textContent = `Subtask → ${agent}`
  wrapper.appendChild(header)
  if (typeof block.description === "string" && block.description.trim()) {
    const desc = document.createElement("div")
    desc.className = "subtask-description"
    desc.textContent = block.description
    wrapper.appendChild(desc)
  }
  return wrapper
}

// ---------------------------------------------------------------------------
// Safe JSON parse with fallback
// ---------------------------------------------------------------------------

export { groupConsecutiveToolCalls, renderToolGroup, truncateMiddle, formatOutputSize, focusAdjacentToolSummary } from "./toolCallRenderer"

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

  // Plan-mode diffs are proposals — not yet applied. Mark the wrapper so a
  // distinct accent border + header pill make the difference visible at a glance.
  const isPlanModeBlock = opts.mode === "plan"

  const wrapper = document.createElement("div")
  wrapper.className = `diff-block diff-block--${diffBlock.state}${isPlanModeBlock ? " diff-block--plan" : ""}`
  wrapper.dataset.diffId = diffBlock.diffId

  // Header: filename + stats + wrap toggle
  const header = document.createElement("div")
  header.className = "diff-header"

  const fileInfo = document.createElement("div")
  fileInfo.className = "diff-file-info"

  if (isPlanModeBlock) {
    const planPill = document.createElement("span")
    planPill.className = "diff-pill diff-pill--plan"
    planPill.textContent = "PLAN"
    planPill.title = "Proposed change — not yet applied"
    fileInfo.appendChild(planPill)
  }

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

  // Wrap toggle button
  const wrapToggle = document.createElement("button")
  wrapToggle.className = "diff-wrap-toggle"
  wrapToggle.setAttribute("aria-label", "Toggle line wrapping")
  wrapToggle.title = "Toggle line wrapping"
  wrapToggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg><span>Wrap</span>`
  wrapToggle.addEventListener("click", () => {
    const tableWrapper = wrapper.querySelector(".diff-table-wrapper")
    if (!tableWrapper) {
      return
    }
    
    const isWrapped = tableWrapper.classList.toggle("diff-table-wrapper--wrapped")
    wrapToggle.classList.toggle("active", isWrapped)
    
    // Store preference in webview state with error handling
    const vscode = (window as any).acquireVsCodeApi?.()
    if (vscode) {
      try {
        const state = vscode.getState()
        if (state?.displayPrefs) {
          state.displayPrefs.diffWrapEnabled = isWrapped
          vscode.setState(state)
        }
      } catch (error) {
        console.warn("Failed to persist diff wrap preference:", error)
      }
    }
  })

  // Check initial state from webview state with error handling
  const vscode = (window as any).acquireVsCodeApi?.()
  if (vscode) {
    try {
      const state = vscode.getState()
      if (state?.displayPrefs?.diffWrapEnabled) {
        wrapToggle.classList.add("active")
      }
    } catch (error) {
      console.warn("Failed to load diff wrap preference:", error)
    }
  }

  header.appendChild(fileInfo)
  header.appendChild(wrapToggle)
  wrapper.appendChild(header)

  // Diff table
  if (diffBlock.hunks.length > 0) {
    const tableWrapper = document.createElement("div")
    tableWrapper.className = "diff-table-wrapper"

    const table = document.createElement("table")
    table.className = "diff-table"

    diffBlock.hunks.forEach((hunk, hunkIndex) => {
      // Hunk header — unified-diff line counts: old = removed+context, new = added+context
      const oldCount = hunk.lines.filter((l) => l.type === "removed" || l.type === "context").length
      const newCount = hunk.lines.filter((l) => l.type === "added" || l.type === "context").length
      const hunkId = hunk.id || `${diffBlock.diffId}:${hunkIndex}`
      const hunkState = hunk.state || "pending"
      const hunkRow = document.createElement("tr")
      hunkRow.className = `diff-hunk-header diff-hunk--${hunkState}`
      hunkRow.dataset.hunkId = hunkId
      const hunkCell = document.createElement("td")
      hunkCell.colSpan = 3
      hunkCell.textContent = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
      hunkRow.appendChild(hunkCell)

      // Per-hunk action buttons (only in pending state and when block is pending)
      const hunkActCell = document.createElement("td")
      hunkActCell.className = "diff-hunk-actions"
      if (diffBlock.state === "pending" && hunkState === "pending") {
        const acceptHunk = document.createElement("button")
        acceptHunk.className = "diff-hunk-btn diff-hunk-btn--accept"
        acceptHunk.textContent = "✓"
        acceptHunk.title = "Accept this hunk"
        acceptHunk.addEventListener("click", (e) => {
          e.stopPropagation()
          opts.postMessage?.({
            type: "accept_hunk",
            diffId: diffBlock.diffId,
            hunkId,
            path: diffBlock.path,
            hunk: { id: hunkId, hunkId, oldStart: hunk.oldStart, oldCount, lines: hunk.lines },
          })
          hunkRow.classList.replace(`diff-hunk--${hunkState}`, "diff-hunk--accepted")
        })
        const rejectHunk = document.createElement("button")
        rejectHunk.className = "diff-hunk-btn diff-hunk-btn--reject"
        rejectHunk.textContent = "✗"
        rejectHunk.title = "Reject this hunk"
        rejectHunk.addEventListener("click", (e) => {
          e.stopPropagation()
          opts.postMessage?.({ type: "reject_hunk", diffId: diffBlock.diffId, hunkId, path: diffBlock.path })
          hunkRow.classList.replace(`diff-hunk--${hunkState}`, "diff-hunk--rejected")
        })
        hunkActCell.appendChild(acceptHunk)
        hunkActCell.appendChild(rejectHunk)
      } else if (hunkState === "accepted") {
        hunkActCell.textContent = "✓"
        hunkActCell.className += " diff-hunk-accepted-chip"
      } else if (hunkState === "rejected") {
        hunkActCell.textContent = "✗"
        hunkActCell.className += " diff-hunk-rejected-chip"
      }
      hunkRow.appendChild(hunkActCell)
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
    
    // Add revert button if diff is revertable
    if (diffBlock.revertable) {
      const revertBtn = document.createElement("button")
      revertBtn.className = "diff-btn diff-btn--revert"
      revertBtn.textContent = "Revert"
      revertBtn.setAttribute("aria-label", `Revert changes to ${diffBlock.path}`)
      revertBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        if (!diffBlock.diffId || !diffBlock.path) {
          console.warn("Cannot show revert confirmation: missing diffId or path")
          return
        }
        showRevertConfirmation(diffBlock.diffId, diffBlock.path, opts.postMessage)
      })
      actionBar.appendChild(revertBtn)
    }
    
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
        postMessage({ type: 'accept_diff', diffId: diffBlock.diffId, path: diffBlock.path })
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
        postMessage({ type: 'reject_diff', diffId: diffBlock.diffId })
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
    openBtn.setAttribute("aria-label", `Open ${diffBlock.path} in editor`)
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const postMessage = opts.postMessage
      if (postMessage && diffBlock.path) {
        postMessage({ type: 'open_file', path: diffBlock.path })
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
