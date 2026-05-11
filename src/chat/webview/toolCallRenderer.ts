import type { Block, ToolCallBlock, ToolCallClass, ToolCallState } from "./types"
import {
  TOOL_READ_SVG,
  TOOL_WRITE_SVG,
  TOOL_EXEC_SVG,
  TOOL_META_SVG,
  CHEVRON_RIGHT_SVG,
} from "./icons"
import { sanitizeHtml, highlightSyntax } from "./renderer"

export interface RenderOptions {
  messageId?: string
  postMessage?: (msg: Record<string, unknown>) => void
  mode?: string
}

export function isToolCallBlock(block: Block): block is ToolCallBlock {
  return block.type === 'tool-call'
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function normalizeToolBlock(block: Block): ToolCallBlock {
  if (isToolCallBlock(block)) return block
  return {
    type: 'tool-call',
    id: block.id || `tool-${Date.now()}`,
    name: block.toolName || block.name || "tool",
    class: (block.class as ToolCallClass) || (block.toolType as ToolCallClass) || 'read',
    state: (block.state as ToolCallState) || 'running',
    args: block.args ? (typeof block.args === 'string' ? safeJsonParse(block.args) : block.args) : undefined,
    result: block.result,
    durationMs: (block.durationMs as number | undefined),
  } as ToolCallBlock
}

export function createToolDetailsContainer(toolBlock: ToolCallBlock): HTMLDetailsElement {
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
  details.addEventListener("toggle", () => {
    details.setAttribute("aria-expanded", details.open ? "true" : "false")
  })

  if (toolState === 'result' && toolBlock.error) {
    details.open = true
  }

  return details
}

export function createToolSummary(toolBlock: ToolCallBlock, details: HTMLDetailsElement): HTMLElement {
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

  appendToolIcon(summary, toolBlock.class || 'read')

  const name = document.createElement("span")
  name.className = "tool-name"
  name.textContent = toolBlock.name
  summary.appendChild(name)

  appendToolKeyArg(summary, toolBlock.args)
  appendToolStatusBadge(summary, toolBlock)
  appendToolTiming(summary, toolBlock)
  appendToolOutputSize(summary, toolBlock)

  return summary
}

export function appendToolIcon(parent: HTMLElement, toolClass: ToolCallClass): void {
  const icon = document.createElement("span")
  icon.className = "tool-icon"
  switch (toolClass) {
    case 'write': icon.innerHTML = TOOL_WRITE_SVG; break
    case 'exec': icon.innerHTML = TOOL_EXEC_SVG; break
    case 'meta': icon.innerHTML = TOOL_META_SVG; break
    default: icon.innerHTML = TOOL_READ_SVG; break
  }
  parent.appendChild(icon)
}

export function appendToolKeyArg(parent: HTMLElement, args: unknown): void {
  const keyArg = extractKeyArg(args)
  if (!keyArg) return
  const argEl = document.createElement("span")
  argEl.className = "tool-arg"
  argEl.textContent = truncateMiddle(keyArg, 30)
  argEl.title = keyArg
  parent.appendChild(argEl)
}

export function appendToolStatusBadge(parent: HTMLElement, toolBlock: ToolCallBlock): void {
  const toolState = toolBlock.state || 'running'
  const badge = document.createElement("span")
  badge.className = `tool-status tool-status--${toolState}`
  if (toolState === 'pending') {
    badge.textContent = '\u25cb Pending'
    badge.setAttribute("aria-label", "Tool pending")
  } else if (toolState === 'running') {
    badge.textContent = '\u25c9 Running'
    badge.setAttribute("aria-label", "Tool running")
  } else if (toolState === 'stale') {
    badge.textContent = 'Stale'
    badge.setAttribute("aria-label", "Tool completion unconfirmed")
  } else if (toolBlock.error || toolState === 'error') {
    badge.textContent = '\u2717 Error'
    badge.setAttribute("aria-label", "Tool error")
  } else {
    badge.textContent = '\u2713 Done'
    badge.setAttribute("aria-label", "Tool complete")
  }
  parent.appendChild(badge)
}

export function appendToolTiming(parent: HTMLElement, toolBlock: ToolCallBlock): void {
  const toolState = toolBlock.state || 'running'
  const isTerminal = toolState === 'result' || toolState === 'completed' || toolState === 'error' || toolState === 'stale'

  if (toolBlock.durationMs && isTerminal) {
    const dur = document.createElement("span")
    dur.className = "tool-duration"
    dur.textContent = toolBlock.durationMs >= 1000
      ? `${(toolBlock.durationMs / 1000).toFixed(1)}s`
      : `${toolBlock.durationMs}ms`
    parent.appendChild(dur)
  } else if (toolState === 'running' || toolState === 'pending') {
    const elapsed = document.createElement("span")
    elapsed.className = "tool-elapsed"
    elapsed.dataset.startTime = String(Date.now())
    elapsed.textContent = "0s"
    parent.appendChild(elapsed)
  }
}

export function appendToolOutputSize(parent: HTMLElement, toolBlock: ToolCallBlock): void {
  const toolState = toolBlock.state || 'running'
  if (!toolBlock.result || (toolState !== 'result' && toolState !== 'completed')) return

  const resultStr = typeof toolBlock.result === 'string' ? toolBlock.result : JSON.stringify(toolBlock.result)
  const size = document.createElement("span")
  size.className = "tool-output-size"
  const chars = resultStr.length
  size.textContent = chars >= 1024 ? `${(chars / 1024).toFixed(1)}KB` : `${chars} chars`
  size.title = `${resultStr.split('\n').length} lines, ${chars} characters`
  parent.appendChild(size)
}

export function createToolArgsPanel(toolBlock: ToolCallBlock): HTMLElement | null {
  if (toolBlock.args === undefined) return null

  const argsDiv = document.createElement("div")
  argsDiv.className = "tool-args-panel"
  const argsStr = typeof toolBlock.args === 'string' ? toolBlock.args : JSON.stringify(toolBlock.args, null, 2)
  const truncated = argsStr.length > 500
  const displayStr = truncated ? argsStr.slice(0, 500) : argsStr
  argsDiv.innerHTML = sanitizeHtml(highlightSyntax(displayStr, 'json'))
  if (truncated) {
    const more = document.createElement("button")
    more.className = "tool-show-more"
    more.textContent = "Show more\u2026"
    more.addEventListener("click", () => {
      argsDiv.innerHTML = sanitizeHtml(highlightSyntax(argsStr, 'json'))
      more.remove()
    })
    argsDiv.appendChild(more)
  }
  return argsDiv
}

export function createToolResultPanel(toolBlock: ToolCallBlock): HTMLElement | null {
  const toolState = toolBlock.state || 'running'
  const isTerminal = toolState === 'result' || toolState === 'completed' || toolState === 'stale' || toolState === 'error'
  const hasOutput = toolBlock.result !== undefined || (toolBlock.error !== undefined && toolBlock.error !== "")
  if (!hasOutput || !isTerminal) return null

  const isErrorPanel = !!toolBlock.error || toolState === 'error'
  const resultDiv = document.createElement("div")
  resultDiv.className = isErrorPanel ? "tool-result-panel tool-result-panel--error" : "tool-result-panel"
  const rawOutput = toolBlock.result !== undefined ? toolBlock.result : toolBlock.error
  const resultText = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2)
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
  return resultDiv
}

export function renderToolCallBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const toolBlock = normalizeToolBlock(block)
  const details = createToolDetailsContainer(toolBlock)
  const summary = createToolSummary(toolBlock, details)
  details.appendChild(summary)

  const argsPanel = createToolArgsPanel(toolBlock)
  if (argsPanel) details.appendChild(argsPanel)

  const resultPanel = createToolResultPanel(toolBlock)
  if (resultPanel) details.appendChild(resultPanel)

  return details
}

export function extractKeyArg(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  const candidates = [a.path, a.file, a.filename, a.url, a.command, a.query, a.name]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return null
}

export function groupConsecutiveToolCalls(blocks: Block[]): Block[][] {
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

export function renderToolGroup(blocks: Block[], opts: RenderOptions): HTMLElement | null {
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
    badge.textContent = '\u2713 Done'
  } else if (completed > 0) {
    badge.textContent = `\u25c9 ${completed}/${blocks.length}`
  } else {
    badge.textContent = '\u25c9 Running'
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

export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  const half = Math.floor((maxLen - 1) / 2)
  return str.slice(0, half) + '\u2026' + str.slice(str.length - half)
}

export function formatOutputSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k chars`
}

export function focusAdjacentToolSummary(current: HTMLElement, key: string): void {
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
