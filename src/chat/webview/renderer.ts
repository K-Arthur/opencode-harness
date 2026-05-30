import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"
import { escapeHtml } from "./htmlUtils"
import { sanitizeHtml, highlightSyntax, clearHighlightCache, getHighlightCacheSize } from "./syntaxHighlighter"
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
import { renderFileChipListHtml } from "./file-chip-list"
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
  const normalized = normalizeMarkdownText(text)

  let fenceCount = 0
  let inInlineCode = false
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch !== "`") continue
    if (!inInlineCode && normalized.slice(i, i + 3) === "```") {
      fenceCount++
      i += 2
      continue
    }
    inInlineCode = !inInlineCode
  }

  let result = normalized
  if (fenceCount % 2 !== 0) result += "\n```"
  if (inInlineCode) result += "`"

  return result
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

    const id = this.nextId
    this.nextId = (this.nextId % 0x7fffffff) + 1
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
      if ("error" in message) {
        console.warn("[opencode] Markdown worker render error:", message.error)
      }
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
  clearHighlightCache()
  markdownWorkerClient?.dispose()
  markdownWorkerClient = undefined
}

export function getRendererCacheStats(): { markdownEntries: number; highlightEntries: number } {
  return {
    markdownEntries: markdownCache.size,
    highlightEntries: getHighlightCacheSize(),
  }
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight: (str, lang) => highlightSyntax(str, lang || ""),
}).use(taskLists, { label: false })

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


export { sanitizeHtml, highlightSyntax } from "./syntaxHighlighter"


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

// ---------------------------------------------------------------------------
// RenderOptions — passed to each renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  messageId?: string
  postMessage?: (msg: Record<string, unknown>) => void
  mode?: string
  role?: string
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
  'question': renderQuestionBlock,
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
  if (text.startsWith("[methodology]")) return null
  if (!text.trim()) return null

  const isPlanModePlan = opts?.mode === "plan" && opts?.role === "assistant" && detectPlanProse(text)
  const div = createTextBlockContainer(isPlanModePlan)
  if (appendMentionRichText(div, text, opts)) return div
  appendMarkdownText(div, text, isPlanModePlan, opts)
  return div
}

function createTextBlockContainer(isPlanModePlan: boolean): HTMLElement {
  const div = document.createElement("div")
  div.className = isPlanModePlan ? "msg-text markdown-content plan-prose" : "msg-text markdown-content"
  if (isPlanModePlan) {
    const header = document.createElement("div")
    header.className = "plan-prose-header"
    header.textContent = "Proposed Plan"
    div.appendChild(header)
  }
  return div
}

function appendMentionRichText(container: HTMLElement, text: string, opts: RenderOptions): boolean {
  const mentionPattern = /(@(file|folder|url|problems|terminal):(?:"[^"]+"|\S+))/g
  if (!mentionPattern.test(text)) return false

  const parts = text.split(mentionPattern)
  const fragment = document.createDocumentFragment()
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    if (i % 3 === 0) {
      fragment.appendChild(createMentionPlainText(part, opts))
    } else if (i % 3 === 1) {
      fragment.appendChild(createMentionChip(part, parts[i + 1] || "file", opts))
      i++
    }
  }
  container.appendChild(fragment)
  return true
}

function createMentionPlainText(text: string, opts: RenderOptions): HTMLElement {
  const span = document.createElement("span")
  const normalized = opts?.isStreaming ? normalizeStreamingMarkdown(text) : normalizeMarkdownText(text)
  span.innerHTML = sanitizeHtml(md.renderInline(normalized, { label: false }))
  return span
}

function createMentionChip(fullMatch: string, type: string, opts: RenderOptions): HTMLElement {
  const chip = document.createElement("span")
  chip.className = "context-chip"
  chip.dataset.kind = type
  chip.textContent = fullMatch
  chip.style.cursor = "pointer"
  chip.title = `Click to open ${type}`
  chip.addEventListener("click", (e) => {
    e.stopPropagation()
    postMentionOpenMessage(fullMatch, type, opts)
  })
  return chip
}

function postMentionOpenMessage(fullMatch: string, type: string, opts: RenderOptions): void {
  const rawValue = fullMatch.substring(type.length + 2)
  const value = rawValue.replace(/^["']|["']$/g, "")
  if (type === "file") {
    opts?.postMessage?.({ type: "open_file", path: value })
  } else if (type === "folder") {
    opts?.postMessage?.({ type: "open_folder", dir: value })
  } else if (type === "url") {
    opts?.postMessage?.({ type: "open_url", url: value })
  }
}

function appendMarkdownText(container: HTMLElement, text: string, isPlanModePlan: boolean, opts: RenderOptions): void {
  const isStreaming = opts?.isStreaming ?? false
  const cached = getCachedMarkdown(text, isStreaming)
  const target = isPlanModePlan ? createMarkdownRenderBody(container) : container

  if (!isStreaming && cached === undefined && shouldRenderMarkdownInWorker(text, false)) {
    renderMarkdownIntoTargetAsync(target, text)
  } else {
    target.innerHTML = cached ?? renderMarkdown(text, isStreaming)
  }
}

function createMarkdownRenderBody(container: HTMLElement): HTMLElement {
  const target = document.createElement("div")
  target.className = "markdown-render-body"
  container.appendChild(target)
  return target
}

function renderMarkdownIntoTargetAsync(target: HTMLElement, text: string): void {
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
    const fullHighlighted = sanitizeHtml(highlightSyntax(code, block.language || ""))
    const highlightedLines = fullHighlighted.split("\n")
    lines.forEach((_, i) => {
      const numEl = document.createElement("span")
      numEl.className = "code-line-num"
      numEl.textContent = String(i + 1)
      grid.appendChild(numEl)
      const codeEl = document.createElement("span")
      codeEl.className = "code-line-content"
      codeEl.innerHTML = highlightedLines[i] || "&nbsp;"
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
    if (b.type === "text" && (b.text || b.content)) {
      const rawText = typeof b.text === "string" ? b.text : String(b.content ?? "")
      const text = rawText.trim().replace(/\n/g, " ")
      if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
    }
    if (b.type === "tool-call" || b.type === "tool_call" || b.type === "tool") {
      const toolName = typeof b.tool === "string" ? b.tool : (b.name || b.toolName || "tool")
      return `Used ${toolName}`
    }
  }
  const loose = msg as unknown as {
    text?: unknown
    content?: unknown
    message?: unknown
    parts?: unknown[]
  }
  for (const value of [loose.text, loose.content, loose.message]) {
    if (typeof value === "string") {
      const text = value.trim().replace(/\n/g, " ")
      if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
    }
  }
  if (Array.isArray(loose.parts)) {
    for (const part of loose.parts) {
      if (!part || typeof part !== "object") continue
      const p = part as { type?: unknown; text?: unknown; content?: unknown }
      if (p.type === "text" && (typeof p.text === "string" || typeof p.content === "string")) {
        const rawText = typeof p.text === "string" ? p.text : String(p.content ?? "")
        const text = rawText.trim().replace(/\n/g, " ")
        if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
      }
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
//
// Some opencode providers emit hyphenated variants ("tool-calls",
// "end-turn"). We normalize hyphens → underscores before the set lookup
// so both shapes suppress the chip — otherwise every assistant step that
// ran tools would render a redundant "Step finished (tool-calls) — …"
// row beneath the tool, which is exactly the clutter the user reported.
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
  const normalizedReason = rawReason.replace(/-/g, "_")
  if (rawReason === "" || NORMAL_FINISH_REASONS.has(normalizedReason)) return null

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
  const diffBlock = toDiffBlock(block)
  const wrapper = createDiffWrapper(diffBlock, opts.mode === "plan")

  wrapper.appendChild(createDiffHeader(diffBlock, opts, wrapper))
  appendDiffBody(wrapper, block, diffBlock, opts)
  wrapper.appendChild(createDiffActionBar(wrapper, diffBlock, opts))

  return wrapper
}

function toDiffBlock(block: Block): DiffBlock {
  if (isDiffBlock(block)) return block
  return {
    type: "diff",
    diffId: block.diffId || block.id || `diff-${Date.now()}`,
    path: block.filePath || block.path || "File Change",
    hunks: block.hunks || [],
    state: (block.state as "pending" | "accepted" | "discarded") || "pending",
    linesAdded: block.linesAdded || 0,
    linesRemoved: block.linesRemoved || 0,
    revertable: (block as any).revertable ?? false,
  }
}

function createDiffWrapper(diffBlock: DiffBlock, isPlanMode: boolean): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = `diff-block diff-block--${diffBlock.state}${isPlanMode ? " diff-block--plan" : ""}`
  wrapper.dataset.diffId = diffBlock.diffId
  return wrapper
}

function createDiffHeader(diffBlock: DiffBlock, opts: RenderOptions, wrapper: HTMLElement): HTMLElement {
  const header = document.createElement("div")
  header.className = "diff-header"

  const fileInfo = document.createElement("div")
  fileInfo.className = "diff-file-info"
  if (opts.mode === "plan") fileInfo.appendChild(createPlanDiffPill())
  fileInfo.appendChild(createDiffFilePath(diffBlock, opts))
  fileInfo.appendChild(createDiffStats(diffBlock))

  header.appendChild(fileInfo)
  header.appendChild(createDiffWrapToggle(wrapper))
  return header
}

function createPlanDiffPill(): HTMLElement {
  const planPill = document.createElement("span")
  planPill.className = "diff-pill diff-pill--plan"
  planPill.textContent = "PLAN"
  planPill.title = "Proposed change — not yet applied"
  return planPill
}

function createDiffFilePath(diffBlock: DiffBlock, opts: RenderOptions): HTMLElement {
  const filePath = document.createElement("span")
  filePath.className = "diff-file-path"
  filePath.textContent = diffBlock.path

  if (!isCommandLikeDiffPath(diffBlock.path)) {
    filePath.style.cursor = "pointer"
    filePath.title = "Click to open file"
    filePath.addEventListener("click", (e) => {
      e.stopPropagation()
      e.preventDefault()
      opts.postMessage?.({ type: "open_file", path: diffBlock.path })
    })
  }

  return filePath
}

function isCommandLikeDiffPath(filePath: string | undefined): boolean {
  const lowerPath = (filePath || "").trim().toLowerCase()
  return lowerPath === "file change" ||
    lowerPath.startsWith("npm ") ||
    lowerPath.startsWith("git ") ||
    lowerPath.startsWith("node ") ||
    lowerPath.startsWith("python ") ||
    lowerPath.startsWith("bash ") ||
    lowerPath.startsWith("sh ") ||
    lowerPath.includes("&&") ||
    lowerPath.includes("||") ||
    lowerPath.includes("|") ||
    lowerPath.includes(">")
}

function createDiffStats(diffBlock: DiffBlock): HTMLElement {
  const stats = document.createElement("span")
  stats.className = "diff-stats"
  if (diffBlock.linesAdded > 0) stats.appendChild(createDiffStat("added", `+${diffBlock.linesAdded}`))
  if (diffBlock.linesRemoved > 0) stats.appendChild(createDiffStat("removed", `-${diffBlock.linesRemoved}`))
  return stats
}

function createDiffStat(kind: "added" | "removed", text: string): HTMLElement {
  const stat = document.createElement("span")
  stat.className = `diff-stat diff-stat--${kind}`
  stat.textContent = text
  return stat
}

function createDiffWrapToggle(wrapper: HTMLElement): HTMLButtonElement {
  const wrapToggle = document.createElement("button")
  wrapToggle.className = "diff-wrap-toggle"
  wrapToggle.setAttribute("aria-label", "Toggle line wrapping")
  wrapToggle.title = "Toggle line wrapping"
  wrapToggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg><span>Wrap</span>`
  wrapToggle.classList.toggle("active", readDiffWrapPreference())
  wrapToggle.addEventListener("click", () => toggleDiffWrap(wrapper, wrapToggle))
  return wrapToggle
}

function toggleDiffWrap(wrapper: HTMLElement, wrapToggle: HTMLElement): void {
  const tableWrapper = wrapper.querySelector(".diff-table-wrapper")
  if (!tableWrapper) return

  const isWrapped = tableWrapper.classList.toggle("diff-table-wrapper--wrapped")
  wrapToggle.classList.toggle("active", isWrapped)
  persistDiffWrapPreference(isWrapped)
}

function readDiffWrapPreference(): boolean {
  const vscode = (window as any).acquireVsCodeApi?.()
  if (!vscode) return false
  try {
    return vscode.getState()?.displayPrefs?.diffWrapEnabled === true
  } catch (error) {
    console.warn("Failed to load diff wrap preference:", error)
    return false
  }
}

function persistDiffWrapPreference(isWrapped: boolean): void {
  const vscode = (window as any).acquireVsCodeApi?.()
  if (!vscode) return
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

function appendDiffBody(wrapper: HTMLElement, block: Block, diffBlock: DiffBlock, opts: RenderOptions): void {
  if (diffBlock.hunks.length > 0) {
    wrapper.appendChild(createDiffTableWrapper(diffBlock, opts))
    return
  }
  if (block.diffText) wrapper.appendChild(createRawDiffContent(block.diffText))
}

// A large diff (e.g. a whole-file rewrite) would otherwise build one DOM row
// per line synchronously on the webview's only thread — freezing input and the
// prompt queue. Mirror the changed-files dropdown's cap: render up to this many
// lines eagerly, then defer the remainder behind a one-click expander.
export const MAX_DIFF_LINES_RENDERED = 500

function createDiffTableWrapper(diffBlock: DiffBlock, opts: RenderOptions): HTMLElement {
  const tableWrapper = document.createElement("div")
  tableWrapper.className = "diff-table-wrapper"

  const table = document.createElement("table")
  table.className = "diff-table"

  let budget = MAX_DIFF_LINES_RENDERED
  diffBlock.hunks.forEach((hunk, hunkIndex) => {
    budget = appendHunkRows(table, diffBlock, hunk, hunkIndex, opts, budget)
  })

  const remaining = diffBlock.hunks.reduce((sum, h) => sum + h.lines.length, 0) - countRenderedLines(table)
  if (remaining > 0) {
    const showAll = document.createElement("button")
    showAll.type = "button"
    showAll.className = "diff-show-all"
    showAll.textContent = `Show all changes (${remaining} more line${remaining === 1 ? "" : "s"})`
    showAll.addEventListener("click", () => {
      showAll.remove()
      // Re-render every hunk with no budget. Cheap relative to the click — the
      // user explicitly opted into the full diff.
      while (table.firstChild) table.removeChild(table.firstChild)
      diffBlock.hunks.forEach((hunk, hunkIndex) => appendHunkRows(table, diffBlock, hunk, hunkIndex, opts, Infinity))
    })
    tableWrapper.appendChild(table)
    tableWrapper.appendChild(showAll)
    return tableWrapper
  }

  tableWrapper.appendChild(table)
  return tableWrapper
}

function countRenderedLines(table: HTMLElement): number {
  return table.querySelectorAll("tr.diff-line").length
}

/**
 * Append a hunk's header plus up to `budget` of its lines. Returns the budget
 * left for the next hunk. `Infinity` renders everything (the expander path).
 */
function appendHunkRows(
  table: HTMLElement,
  diffBlock: DiffBlock,
  hunk: DiffHunk,
  hunkIndex: number,
  opts: RenderOptions,
  budget: number = Infinity,
): number {
  const oldCount = hunk.lines.filter((l) => l.type === "removed" || l.type === "context").length
  const newCount = hunk.lines.filter((l) => l.type === "added" || l.type === "context").length
  const hunkId = hunk.id || `${diffBlock.diffId}:${hunkIndex}`
  const hunkState = hunk.state || "pending"

  // Skip the header entirely when there's no budget left for any of its lines.
  if (budget <= 0) return budget

  table.appendChild(createHunkHeaderRow(diffBlock, hunk, hunkId, hunkState, oldCount, newCount, opts))
  let left = budget
  for (const line of hunk.lines) {
    if (left <= 0) break
    table.appendChild(createDiffLineRow(line))
    left--
  }
  return left
}

function createHunkHeaderRow(
  diffBlock: DiffBlock,
  hunk: DiffHunk,
  hunkId: string,
  hunkState: string,
  oldCount: number,
  newCount: number,
  opts: RenderOptions
): HTMLElement {
  const hunkRow = document.createElement("tr")
  hunkRow.className = `diff-hunk-header diff-hunk--${hunkState}`
  hunkRow.dataset.hunkId = hunkId

  const hunkCell = document.createElement("td")
  hunkCell.colSpan = 3
  hunkCell.textContent = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
  hunkRow.appendChild(hunkCell)
  hunkRow.appendChild(createHunkActionCell(diffBlock, hunk, hunkId, hunkState, oldCount, opts, hunkRow))

  return hunkRow
}

function createHunkActionCell(
  diffBlock: DiffBlock,
  hunk: DiffHunk,
  hunkId: string,
  hunkState: string,
  oldCount: number,
  opts: RenderOptions,
  hunkRow: HTMLElement
): HTMLElement {
  const actionCell = document.createElement("td")
  actionCell.className = "diff-hunk-actions"

  if (diffBlock.state === "pending" && hunkState === "pending") {
    actionCell.appendChild(createHunkButton("accept", "✓", "Accept this hunk", () => {
      opts.postMessage?.({
        type: "accept_hunk",
        diffId: diffBlock.diffId,
        hunkId,
        path: diffBlock.path,
        hunk: { id: hunkId, hunkId, oldStart: hunk.oldStart, oldCount, lines: hunk.lines },
      })
      hunkRow.classList.replace(`diff-hunk--${hunkState}`, "diff-hunk--accepted")
    }))
    actionCell.appendChild(createHunkButton("reject", "✗", "Reject this hunk", () => {
      opts.postMessage?.({ type: "reject_hunk", diffId: diffBlock.diffId, hunkId, path: diffBlock.path })
      hunkRow.classList.replace(`diff-hunk--${hunkState}`, "diff-hunk--rejected")
    }))
  } else if (hunkState === "accepted") {
    actionCell.textContent = "✓"
    actionCell.className += " diff-hunk-accepted-chip"
  } else if (hunkState === "rejected") {
    actionCell.textContent = "✗"
    actionCell.className += " diff-hunk-rejected-chip"
  }

  return actionCell
}

function createHunkButton(kind: "accept" | "reject", text: string, title: string, onClick: () => void): HTMLElement {
  const button = document.createElement("button")
  button.className = `diff-hunk-btn diff-hunk-btn--${kind}`
  button.textContent = text
  button.title = title
  button.addEventListener("click", (e) => {
    e.stopPropagation()
    onClick()
  })
  return button
}

function createDiffLineRow(line: DiffLine): HTMLElement {
  const row = document.createElement("tr")
  row.className = `diff-line diff-line--${line.type}`
  row.appendChild(createDiffLineNumber("old", line.oldLine))
  row.appendChild(createDiffLineNumber("new", line.newLine))
  row.appendChild(createDiffLineMarker(line))
  row.appendChild(createDiffLineContent(line.content))
  return row
}

function createDiffLineNumber(kind: "old" | "new", value: number | undefined): HTMLElement {
  const cell = document.createElement("td")
  cell.className = `diff-line-num diff-line-num--${kind}`
  cell.textContent = value != null ? String(value) : ""
  return cell
}

function createDiffLineMarker(line: DiffLine): HTMLElement {
  const marker = document.createElement("td")
  marker.className = "diff-line-marker"
  marker.textContent = line.type === "added" ? "+" : line.type === "removed" ? "-" : " "
  return marker
}

function createDiffLineContent(contentText: string): HTMLElement {
  const content = document.createElement("td")
  content.className = "diff-line-content"
  content.textContent = contentText
  return content
}

function createRawDiffContent(diffText: string): HTMLElement {
  const pre = document.createElement("pre")
  pre.className = "diff-content"
  pre.textContent = diffText
  return pre
}

function createDiffActionBar(wrapper: HTMLElement, diffBlock: DiffBlock, opts: RenderOptions): HTMLElement {
  const actionBar = document.createElement("div")
  actionBar.className = "diff-action-bar"

  if (diffBlock.state === "accepted") {
    renderAcceptedDiffActions(actionBar, wrapper, diffBlock, opts)
  } else if (diffBlock.state === "discarded") {
    renderDiscardedDiffActions(actionBar, wrapper)
  } else {
    renderPendingDiffActions(actionBar, wrapper, diffBlock, opts)
  }

  return actionBar
}

function renderAcceptedDiffActions(actionBar: HTMLElement, wrapper: HTMLElement, diffBlock: DiffBlock, opts: RenderOptions): void {
  showDiffStateChip(actionBar, wrapper, "accepted")
  if (diffBlock.revertable) actionBar.appendChild(createRevertDiffButton(diffBlock, opts))
}

function renderDiscardedDiffActions(actionBar: HTMLElement, wrapper: HTMLElement): void {
  showDiffStateChip(actionBar, wrapper, "discarded")
  collapseDiffContent(wrapper)
}

function renderPendingDiffActions(actionBar: HTMLElement, wrapper: HTMLElement, diffBlock: DiffBlock, opts: RenderOptions): void {
  const isPlanMode = opts.mode === "plan"
  if (isPlanMode) actionBar.appendChild(createDiffReviewLabel())

  actionBar.appendChild(createDiffButton(isPlanMode ? "approve" : "accept", isPlanMode ? "Approve & Apply" : "Accept", `Accept changes to ${diffBlock.path}`, (e) => {
    e.stopPropagation()
    opts.postMessage?.({ type: "accept_diff", diffId: diffBlock.diffId, path: diffBlock.path })
    showDiffStateChip(actionBar, wrapper, "accepted")
  }))
  actionBar.appendChild(createDiffButton("discard", "Discard", `Discard changes to ${diffBlock.path}`, (e) => {
    e.stopPropagation()
    opts.postMessage?.({ type: "reject_diff", diffId: diffBlock.diffId })
    showDiffStateChip(actionBar, wrapper, "discarded")
    collapseDiffContent(wrapper)
  }))
  actionBar.appendChild(createDiffButton("review", "Review Changes", `Review changes to ${diffBlock.path} in diff editor`, (e) => {
    e.stopPropagation()
    opts.postMessage?.({ type: "show_diff", diffId: diffBlock.diffId, filePath: diffBlock.path })
  }))
  actionBar.appendChild(createDiffButton("open", "Open File", `Open ${diffBlock.path} in editor`, (e) => {
    e.stopPropagation()
    if (diffBlock.path) opts.postMessage?.({ type: "open_file", path: diffBlock.path })
  }))
}

function createDiffReviewLabel(): HTMLElement {
  const reviewLabel = document.createElement("span")
  reviewLabel.className = "diff-review-label"
  reviewLabel.textContent = "Review"
  return reviewLabel
}

const DIFF_BUTTON_CLASS_BY_KIND: Record<string, string> = {
  accept: "diff-btn--accept",
  approve: "diff-btn--approve",
  discard: "diff-btn--discard",
  review: "diff-btn--review",
  open: "diff-btn--open",
  revert: "diff-btn--revert",
}

function createDiffButton(kind: string, text: string, ariaLabel: string, onClick: (event: MouseEvent) => void): HTMLElement {
  const button = document.createElement("button")
  button.className = `diff-btn ${DIFF_BUTTON_CLASS_BY_KIND[kind] ?? `diff-btn--${kind}`}`
  button.textContent = text
  button.setAttribute("aria-label", ariaLabel)
  button.addEventListener("click", onClick)
  return button
}

function createRevertDiffButton(diffBlock: DiffBlock, opts: RenderOptions): HTMLElement {
  return createDiffButton("revert", "Revert", `Revert changes to ${diffBlock.path}`, (e) => {
    e.stopPropagation()
    if (!diffBlock.diffId || !diffBlock.path) {
      console.warn("Cannot show revert confirmation: missing diffId or path")
      return
    }
    showRevertConfirmation(diffBlock.diffId, diffBlock.path, opts.postMessage)
  })
}

function showDiffStateChip(actionBar: HTMLElement, wrapper: HTMLElement, state: "accepted" | "discarded"): void {
  actionBar.innerHTML = ""
  const chip = document.createElement("span")
  chip.className = `diff-state-chip diff-state--${state}`
  chip.innerHTML = (state === "accepted" ? SUCCESS_SVG : ERROR_SVG) + (state === "accepted" ? " Applied" : " Discarded")
  actionBar.appendChild(chip)
  wrapper.classList.add(`diff-block--${state}`)
}

function collapseDiffContent(wrapper: HTMLElement): void {
  wrapper.querySelector(".diff-table-wrapper")?.classList.add("hidden")
  wrapper.querySelector(".diff-content")?.classList.add("hidden")
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
  wrapper.role = "region"
  wrapper.ariaLabel = "Permission request"

  const text = document.createElement("div")
  text.className = "permission-text"
  text.textContent = block.text || "Requesting permission..."
  wrapper.appendChild(text)

  const actions = document.createElement("div")
  actions.className = "permission-actions"
  actions.role = "group"
  actions.ariaLabel = "Permission response options"

  if (block.permissionId) {
    const allowBtn = document.createElement("button")
    allowBtn.className = "permission-btn permission-btn--allow"
    allowBtn.textContent = "Allow"
    allowBtn.ariaLabel = "Allow this action once"
    allowBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("oc-permission", { detail: { sessionId: block.sessionId, permissionId: block.permissionId, response: "once", permissionType: block.permissionType, pattern: block.pattern } }))
      wrapper.ariaLive = "polite"
      actions.replaceChildren(document.createTextNode("Allowed"))
    })
    actions.appendChild(allowBtn)

    if (block.pattern) {
      const alwaysBtn = document.createElement("button")
      alwaysBtn.className = "permission-btn permission-btn--allow"
      alwaysBtn.textContent = "Always"
      alwaysBtn.ariaLabel = "Always allow this pattern"
      alwaysBtn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("oc-permission", { detail: { sessionId: block.sessionId, permissionId: block.permissionId, response: "always", permissionType: block.permissionType, pattern: block.pattern } }))
        wrapper.ariaLive = "polite"
        actions.replaceChildren(document.createTextNode("Always allowed"))
      })
      actions.appendChild(alwaysBtn)
    }

    const denyBtn = document.createElement("button")
    denyBtn.className = "permission-btn permission-btn--deny"
    denyBtn.textContent = "Deny"
    denyBtn.ariaLabel = "Deny this action"
    denyBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("oc-permission", { detail: { sessionId: block.sessionId, permissionId: block.permissionId, response: "reject", permissionType: block.permissionType, pattern: block.pattern } }))
      wrapper.ariaLive = "polite"
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
  const textVal = block.text || "Task Status Updated"

  const multiMatch = textVal.match(/^Edited (\d+) files:\s*(.*)$/)
  const singleMatch = !multiMatch ? textVal.match(/^Edited (?!.*files:)(.*)$/) : null

  // Non-edit banners (errors, warnings, generic status) keep the original
  // card layout — those carry alert weight and benefit from the larger
  // visual footprint. Edit banners get a compact single-row layout that
  // shares the file-chip helper with the bottom strip.
  if (status !== "success" || (!multiMatch && !singleMatch)) {
    return renderLegacyTaskBanner(block, _opts, status, textVal)
  }

  const files: string[] = multiMatch
    ? multiMatch[2]!.split(",").map((f) => f.trim()).filter(Boolean)
    : [singleMatch![1]!.trim()]

  const wrapper = document.createElement("div")
  wrapper.className = `task-banner task-banner--success task-banner--compact`
  wrapper.setAttribute("role", "status")
  wrapper.setAttribute("aria-label", `Edited ${files.length} file${files.length !== 1 ? "s" : ""} — click to expand`)
  wrapper.style.cursor = files.length > FILE_CHIP_VISIBLE ? "pointer" : "default"

  const chevron = document.createElement("span")
  chevron.className = "task-banner-chevron"
  chevron.setAttribute("aria-hidden", "true")
  chevron.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`
  wrapper.appendChild(chevron)

  const checkmark = document.createElement("span")
  checkmark.className = "task-banner-check"
  checkmark.setAttribute("aria-hidden", "true")
  checkmark.innerHTML = SUCCESS_SVG
  wrapper.appendChild(checkmark)

  // Inline chip list — shares the same helper (and therefore the same look)
  // as the persistent #changed-files-strip at the bottom of the composer.
  const chipHost = document.createElement("span")
  chipHost.className = "task-banner-chips"
  chipHost.innerHTML = renderFileChipListHtml(files, {
    maxVisible: FILE_CHIP_VISIBLE,
    showLeadingIcon: false,
    showCountLabel: true,
  })
  wrapper.appendChild(chipHost)

  // Wire chip-click and toggle-expand. Click on a chip opens the file;
  // click anywhere else on the banner toggles the expanded chip list.
  wrapper.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null
    const chip = target?.closest?.(".cf-strip-chip") as HTMLElement | null
    if (chip && chipHost.contains(chip)) {
      e.stopPropagation()
      const path = chip.getAttribute("data-path") || ""
      if (path) _opts.postMessage?.({ type: "open_file", path })
      return
    }
    if (files.length > FILE_CHIP_VISIBLE) {
      const isExpanded = wrapper.classList.toggle("task-banner--expanded")
      // Re-render chips in expanded mode (no overflow pill, all chips shown)
      chipHost.innerHTML = renderFileChipListHtml(files, {
        maxVisible: isExpanded ? files.length : FILE_CHIP_VISIBLE,
        showLeadingIcon: false,
        showCountLabel: true,
      })
    }
  })

  return wrapper
}

const FILE_CHIP_VISIBLE = 4

// ---------------------------------------------------------------------------
// Question block — interactive UI for the opencode `question` tool
// ---------------------------------------------------------------------------

interface RenderQuestionGroup {
  question: string
  header?: string
  options: string[]
  multiSelect: boolean
}

/**
 * Derive question groups for rendering. Prefers the normalized `block.groups`
 * (set by the stream handler via parseQuestionArgs); falls back to the legacy
 * flat `text`/`options` fields so the `stream_end` contract and existing
 * single-question renders keep working.
 */
function questionGroupsFromBlock(block: Block): RenderQuestionGroup[] {
  const raw = block.groups
  if (Array.isArray(raw) && raw.length > 0) {
    return (raw as unknown[]).map((g) => {
      const o = (g && typeof g === "object" ? g : {}) as Record<string, unknown>
      return {
        question: typeof o.question === "string" ? o.question : "",
        header: typeof o.header === "string" && o.header ? o.header : undefined,
        options: Array.isArray(o.options) ? (o.options as unknown[]).map(String) : [],
        multiSelect: o.multiSelect === true,
      }
    })
  }
  const question = (block.text as string | undefined) || (block.question as string | undefined) || ""
  const options = Array.isArray(block.options) ? (block.options as unknown[]).map(String) : []
  return [{ question, options, multiSelect: block.multiSelect === true }]
}

function renderQuestionBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const wrapper = document.createElement("div")
  wrapper.className = "question-block"
  wrapper.setAttribute("role", "form")
  wrapper.setAttribute("aria-label", "Question from model")

  const sessionId = (block.sessionId as string | undefined) || ""
  const toolCallId = (block.toolCallId as string | undefined) || (block.id as string | undefined) || ""
  const messageId = (opts.messageId as string | undefined) || ""
  // Stable handle so the live stream can re-render this block in place when the
  // tool input finishes streaming (initial start often carries empty args).
  if (toolCallId) wrapper.setAttribute("data-block-id", toolCallId)

  const groups = questionGroupsFromBlock(block)
  const allowFreeText = block.allowFreeText !== false

  let answered = false

  const header = document.createElement("div")
  header.className = "question-block-header"
  const icon = document.createElement("span")
  icon.className = "question-block-icon"
  icon.setAttribute("aria-hidden", "true")
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  header.appendChild(icon)
  const label = document.createElement("span")
  label.className = "question-block-label"
  label.textContent = "Question from model"
  header.appendChild(label)
  wrapper.appendChild(header)

  function postAnswer(value: string, source: "option" | "freetext") {
    if (answered) return
    if (!value) return
    answered = true
    wrapper.classList.add("question-block--answered")
    wrapper.querySelectorAll<HTMLButtonElement>(".question-option, .question-submit").forEach((b) => {
      b.disabled = true
    })
    const ta = wrapper.querySelector(".question-freetext") as HTMLTextAreaElement | null
    if (ta) ta.disabled = true

    const echo = document.createElement("div")
    echo.className = "question-answer"
    echo.textContent = `Answered: ${value}`
    wrapper.appendChild(echo)

    opts.postMessage?.({
      type: "question_answer",
      sessionId,
      toolCallId,
      messageId,
      value,
      source,
    })
  }

  function appendFreeText(): HTMLTextAreaElement {
    const ta = document.createElement("textarea")
    ta.className = "question-freetext"
    ta.rows = 2
    ta.maxLength = 10000
    ta.placeholder = "Or type a custom answer…"
    ta.setAttribute("aria-label", "Type a custom answer")
    wrapper.appendChild(ta)
    return ta
  }

  // ── Simple path: a single, single-select question. Clicking an option
  //    submits immediately. This preserves the original DOM/behaviour. ──
  const simpleMode = groups.length <= 1 && !groups.some((g) => g.multiSelect)
  if (simpleMode) {
    const g = groups[0] ?? { question: "", options: [], multiSelect: false }

    const text = document.createElement("div")
    text.className = "question-text"
    text.textContent = g.question
    wrapper.appendChild(text)

    if (g.options.length > 0) {
      const optionsList = document.createElement("div")
      optionsList.className = "question-options"
      optionsList.setAttribute("role", "group")
      optionsList.setAttribute("aria-label", "Answer options")
      for (const opt of g.options) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "question-option"
        btn.textContent = opt
        btn.addEventListener("click", (e) => {
          e.stopPropagation()
          postAnswer(opt, "option")
        })
        optionsList.appendChild(btn)
      }
      wrapper.appendChild(optionsList)
    }

    if (allowFreeText) {
      const ta = appendFreeText()
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          postAnswer(ta.value.trim(), "freetext")
        }
      })
      const submitBtn = document.createElement("button")
      submitBtn.type = "button"
      submitBtn.className = "question-submit"
      submitBtn.textContent = "Submit"
      submitBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        postAnswer(ta.value.trim(), "freetext")
      })
      wrapper.appendChild(submitBtn)
    }

    return wrapper
  }

  // ── Multi path: several groups and/or multi-select. Selections are gathered
  //    and submitted together via a single Submit button. ──
  const selections: Array<Set<string>> = groups.map(() => new Set<string>())

  groups.forEach((g, gi) => {
    const section = document.createElement("div")
    section.className = "question-group"

    if (g.header) {
      const hdr = document.createElement("div")
      hdr.className = "question-group-header"
      hdr.textContent = g.header
      section.appendChild(hdr)
    }

    if (g.question) {
      const text = document.createElement("div")
      text.className = "question-text"
      text.textContent = g.question
      section.appendChild(text)
    }

    if (g.options.length > 0) {
      const optionsList = document.createElement("div")
      optionsList.className = "question-options"
      optionsList.setAttribute("role", "group")
      optionsList.setAttribute("aria-label", g.header ? `Options: ${g.header}` : "Answer options")
      const sel = selections[gi]!
      const buttons: HTMLButtonElement[] = []
      for (const opt of g.options) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "question-option"
        btn.setAttribute("aria-pressed", "false")
        btn.textContent = opt
        btn.addEventListener("click", (e) => {
          e.stopPropagation()
          if (answered) return
          if (g.multiSelect) {
            if (sel.has(opt)) { sel.delete(opt); btn.classList.remove("selected"); btn.setAttribute("aria-pressed", "false") }
            else { sel.add(opt); btn.classList.add("selected"); btn.setAttribute("aria-pressed", "true") }
          } else {
            sel.clear(); sel.add(opt)
            for (const b of buttons) { b.classList.remove("selected"); b.setAttribute("aria-pressed", "false") }
            btn.classList.add("selected"); btn.setAttribute("aria-pressed", "true")
          }
        })
        buttons.push(btn)
        optionsList.appendChild(btn)
      }
      section.appendChild(optionsList)
    }

    wrapper.appendChild(section)
  })

  const ta = allowFreeText ? appendFreeText() : null

  const submitBtn = document.createElement("button")
  submitBtn.type = "button"
  submitBtn.className = "question-submit"
  submitBtn.textContent = "Submit"
  submitBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    const parts: string[] = []
    let hasSelection = false
    groups.forEach((g, gi) => {
      const chosen = Array.from(selections[gi] ?? [])
      if (chosen.length > 0) {
        hasSelection = true
        const heading = g.header || g.question || `Answer ${gi + 1}`
        parts.push(`${heading}: ${chosen.join(", ")}`)
      }
    })
    const free = ta?.value.trim()
    if (free) parts.push(free)
    postAnswer(parts.join("\n"), hasSelection ? "option" : "freetext")
  })
  wrapper.appendChild(submitBtn)

  return wrapper
}

function renderLegacyTaskBanner(
  block: Block,
  _opts: RenderOptions,
  status: "success" | "error" | "warning",
  textVal: string,
): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = `task-banner task-banner--${status}`
  wrapper.setAttribute("role", status === "error" ? "alert" : "status")

  const header = document.createElement("div")
  header.className = "task-banner-header"

  const icon = document.createElement("span")
  icon.className = "task-banner-icon"
  icon.innerHTML = status === "success" ? SUCCESS_SVG : ERROR_SVG
  header.appendChild(icon)

  const title = document.createElement("span")
  title.className = "task-banner-title"
  title.textContent = textVal
  header.appendChild(title)
  wrapper.appendChild(header)

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
    const close = () => {
      viewer.removeEventListener("click", close)
      document.removeEventListener("keydown", onKey)
      viewer.remove()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") close()
    }
    viewer.addEventListener("click", close)
    document.addEventListener("keydown", onKey)
    document.body.appendChild(viewer)
  })

  wrapper.appendChild(img)
  return wrapper
}
