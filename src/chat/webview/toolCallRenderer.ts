import type { Block, ToolCallBlock, ToolCallClass, ToolCallState } from "./types"
import {
  TOOL_READ_SVG,
  TOOL_WRITE_SVG,
  TOOL_EXEC_SVG,
  TOOL_META_SVG,
  CHEVRON_RIGHT_SVG,
} from "./icons"
import { sanitizeHtml, highlightSyntax } from "./syntaxHighlighter"

export interface RenderOptions {
  messageId?: string
  postMessage?: (msg: Record<string, unknown>) => void
  mode?: string
  role?: string
  collapseConfig?: import("./types").ToolCollapseConfig
}

export function isToolCallBlock(block: Block): block is ToolCallBlock {
  return block.type === 'tool-call' || block.type === 'tool_call' || block.type === 'tool'
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
    name: (typeof block.tool === "string" ? block.tool : undefined) || block.toolName || block.name || "tool",
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

export function createToolSummary(
  toolBlock: ToolCallBlock,
  details: HTMLDetailsElement,
  opts?: RenderOptions
): HTMLElement {
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

  appendToolKeyArg(summary, toolBlock.args, toolBlock, opts?.postMessage)
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

export function appendToolKeyArg(
  parent: HTMLElement,
  args: unknown,
  toolBlock?: ToolCallBlock,
  postMessage?: (msg: Record<string, unknown>) => void
): void {
  const keyArg = extractKeyArg(args)
  if (!keyArg) return
  const argEl = document.createElement("span")
  argEl.className = "tool-arg"
  argEl.textContent = truncateMiddle(keyArg, 30)
  argEl.title = keyArg

  const toolName = toolBlock?.name?.toLowerCase() || ""
  const toolClass = toolBlock?.class?.toLowerCase() || ""

  const isCommand =
    toolClass === "exec" ||
    toolName.includes("command") ||
    toolName.includes("bash") ||
    toolName.includes("shell") ||
    toolName.includes("terminal") ||
    keyArg.startsWith("npm ") ||
    keyArg.startsWith("git ") ||
    keyArg.startsWith("node ") ||
    keyArg.startsWith("python ")

  if (!isCommand) {
    // Make the file path / directory / URL interactive and hoverable
    argEl.style.cursor = "pointer"
    argEl.addEventListener("click", (e) => {
      e.stopPropagation()
      e.preventDefault()

      const pm = postMessage || (window as any).vscode?.postMessage
      if (!pm) return

      if (keyArg.startsWith("http://") || keyArg.startsWith("https://")) {
        pm({ type: "open_url", url: keyArg })
      } else {
        const isFolder =
          toolName.includes("dir") ||
          toolName.includes("folder") ||
          toolName.includes("grep") ||
          toolName.includes("search")

        if (isFolder) {
          pm({ type: "open_folder", dir: keyArg })
        } else {
          pm({ type: "open_file", path: keyArg })
        }
      }
    })
  }

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
    elapsed.dataset.blockId = toolBlock.id
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

function isDiffContent(text: string): boolean {
  const lines = text.split("\n")
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("++")) added++
    else if (line.startsWith("-") && !line.startsWith("--")) removed++
  }
  return added + removed >= 3 && added > 0 && removed > 0
}

function renderDiffBody(text: string): { fragment: DocumentFragment; added: number; removed: number } {
  const fragment = document.createDocumentFragment()
  let added = 0
  let removed = 0
  const lines = text.split("\n")
  for (const line of lines) {
    const span = document.createElement("span")
    if (line.startsWith("+") && !line.startsWith("++")) {
      span.className = "diff-line diff-line--added"
      added++
    } else if (line.startsWith("-") && !line.startsWith("--")) {
      span.className = "diff-line diff-line--removed"
      removed++
    } else if (line.startsWith("@@")) {
      span.className = "diff-line diff-line--hunk"
    } else {
      span.className = "diff-line diff-line--context"
    }
    span.textContent = line + "\n"
    fragment.appendChild(span)
  }
  return { fragment, added, removed }
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

  const isDiff = !isErrorPanel && isDiffContent(resultText)

  const meta = document.createElement("div")
  meta.className = "tool-result-meta"
  const lines = resultText.split("\n")
  let metaText = `${formatOutputSize(resultText.length)}${lines.length > 1 ? `, ${lines.length} lines` : ""}`

  if (isDiff) {
    const body = document.createElement("pre")
    body.className = "tool-result-body tool-result-body--diff"
    const { fragment, added, removed } = renderDiffBody(resultText)
    body.appendChild(fragment)
    metaText += ` · +${added}/-${removed}`
    resultDiv.appendChild(meta)
    meta.textContent = metaText
    resultDiv.appendChild(body)
  } else {
    const truncated = resultText.length > 2000 || lines.length > 40
    const displayResult = truncated ? lines.slice(0, 40).join("\n").slice(0, 2000) : resultText
    meta.textContent = metaText
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
  }
  return resultDiv
}

export function renderToolCallBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const toolBlock = normalizeToolBlock(block)

  // Check if this is a plan file write
  const planData = detectPlanFile(toolBlock)
  if (planData) {
    return renderPlanCard(planData, opts)
  }

  const details = createToolDetailsContainer(toolBlock)
  const summary = createToolSummary(toolBlock, details, opts)
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

export interface PlanData {
  name: string
  overview: string
  todos: Array<{ id: string; content: string; status: string }>
  filePath: string
}

/**
 * Detect if a tool call's args represent a plan file (markdown with YAML frontmatter containing todos).
 */
export function detectPlanFile(toolBlock: ToolCallBlock): PlanData | null {
  // Only check write-class tools
  if (toolBlock.class !== 'write') return null

  const args = toolBlock.args
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>

  // Check file path
  const filePath = (a.path ?? a.file ?? a.filename ?? '') as string
  if (!filePath || (!filePath.endsWith('.md') && !filePath.endsWith('.plan.md'))) return null

  // Check content for YAML frontmatter with todos
  const content = (a.content ?? a.text ?? a.diff ?? '') as string
  if (!content) return null

  // Look for YAML frontmatter (--- at start) with todos array
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  if (!frontmatter) return null
  const todosMatch = frontmatter.match(/todos:\s*\n((?:\s+-[\s\S]*?)+)/)
  if (!todosMatch || !todosMatch[1]) return null

  const nameMatch = frontmatter.match(/name:\s*(.+)/)
  const overviewMatch = frontmatter.match(/overview:\s*(.+)/)

  const todos: PlanData['todos'] = []
  const todoLines = todosMatch[1].split('\n')
  let currentTodo: PlanData['todos'][0] | null = null
  for (const line of todoLines) {
    const todoStart = line.match(/^\s+-\s+id:\s*(.+)/)
    const contentMatch = line.match(/^\s+(?:-\s+)?content:\s*(.+)/)
    const statusMatch = line.match(/^\s+(?:-\s+)?status:\s*(.+)/)
    if (todoStart) {
      if (currentTodo) todos.push(currentTodo)
      currentTodo = { id: todoStart[1]?.trim() ?? '', content: '', status: 'pending' }
    } else if (currentTodo) {
      if (contentMatch) currentTodo.content = contentMatch[1]?.trim() ?? ''
      if (statusMatch) currentTodo.status = statusMatch[1]?.trim() ?? 'pending'
    }
  }
  if (currentTodo) todos.push(currentTodo)

  if (todos.length === 0) return null

  return {
    name: nameMatch?.[1]?.trim() || filePath.split('/').pop() || 'Plan',
    overview: overviewMatch?.[1]?.trim() || '',
    todos,
    filePath,
  }
}

/**
 * Render a plan card with open-in-editor support.
 */
export function renderPlanCard(plan: PlanData, opts: RenderOptions): HTMLElement {
  const card = document.createElement("div")
  card.className = "plan-card"

  const header = document.createElement("div")
  header.className = "plan-card-header"

  const icon = document.createElement("span")
  icon.className = "plan-card-icon"
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`
  header.appendChild(icon)

  const title = document.createElement("span")
  title.className = "plan-card-title"
  title.textContent = plan.name
  header.appendChild(title)

  const openBtn = document.createElement("button")
  openBtn.className = "plan-card-open-btn"
  openBtn.textContent = "Open in Editor"
  openBtn.title = `Open ${plan.filePath} in VS Code`
  openBtn.addEventListener("click", () => {
    opts.postMessage?.({ type: "open_file", path: plan.filePath })
  })
  header.appendChild(openBtn)

  card.appendChild(header)

  if (plan.overview) {
    const overview = document.createElement("div")
    overview.className = "plan-card-overview"
    overview.textContent = plan.overview
    card.appendChild(overview)
  }

  const todosList = document.createElement("div")
  todosList.className = "plan-card-todos"

  for (const todo of plan.todos) {
    const item = document.createElement("div")
    item.className = `plan-card-todo plan-card-todo--${todo.status}`
    const checkbox = document.createElement("span")
    checkbox.className = "plan-card-todo-checkbox"
    checkbox.textContent = todo.status === 'completed' ? '✓' : '○'
    item.appendChild(checkbox)

    const text = document.createElement("span")
    text.className = "plan-card-todo-text"
    text.textContent = todo.content
    item.appendChild(text)

    const status = document.createElement("span")
    status.className = "plan-card-todo-status"
    status.textContent = todo.status
    item.appendChild(status)

    todosList.appendChild(item)
  }

  card.appendChild(todosList)

  const footer = document.createElement("div")
  footer.className = "plan-card-footer"
  footer.textContent = `${plan.todos.filter(t => t.status === 'completed').length}/${plan.todos.length} completed · ${plan.filePath}`
  card.appendChild(footer)

  return card
}

/**
 * SDK lifecycle blocks (`step-start`, and `step-finish` with a normal
 * completion reason) render to `null` — the user never sees them. The
 * grouper must therefore treat them as *transparent*: they don't break a
 * run of tool calls, they don't reset the current tool name/class, but
 * they DO still appear in the output (emitted as single-element groups
 * after the current tool group is closed) so downstream code that wants
 * to know they existed (debug overlays, token accounting) can find them.
 *
 * Without this, a single assistant turn that runs 6 tools — each followed
 * by an SDK step-finish event — rendered as 6 separate one-element groups
 * instead of one folded group of 6. That was the "wall of tool rows" the
 * user reported.
 */
function isSilentLifecycleBlock(block: Block): boolean {
  if (block.type === "step-start") return true
  if (block.type === "step-finish") {
    const raw = typeof block.reason === "string" ? block.reason.trim() : ""
    if (raw === "") return true
    // Mirror NORMAL_FINISH_REASONS in renderer.ts (hyphen-normalised).
    const normalized = raw.replace(/-/g, "_")
    return (
      normalized === "stop" ||
      normalized === "end_turn" ||
      normalized === "stop_sequence" ||
      normalized === "tool_use" ||
      normalized === "tool_calls" ||
      normalized === "complete"
    )
  }
  return false
}

function getToolInfo(block: Block): { isTool: boolean; toolName: string; toolClass: ToolCallClass | null } {
  const isTool = block.type === "tool-call" || block.type === "tool_call" || block.type === "tool"
  const canonicalToolName = typeof block.tool === "string" ? block.tool : ""
  const toolName: string = isTool ? (canonicalToolName || block.name || block.toolName || "tool") : ""
  const toolClass = isTool ? (block.class as ToolCallClass) || 'read' : null
  return { isTool, toolName, toolClass }
}

type GroupStrategy = (toolName: string, toolClass: ToolCallClass | null, lastToolName: string | null, lastToolClass: ToolCallClass | null, hasCurrentGroup: boolean) => boolean

function consecutiveStrategy(_name: string, _cls: ToolCallClass | null, _lastName: string | null, _lastCls: ToolCallClass | null, hasGroup: boolean): boolean {
  return hasGroup
}

function nameStrategy(name: string, _cls: ToolCallClass | null, lastName: string | null, _lastCls: ToolCallClass | null, hasGroup: boolean): boolean {
  return name === lastName && hasGroup
}

function typeStrategy(_name: string, cls: ToolCallClass | null, _lastName: string | null, lastCls: ToolCallClass | null, hasGroup: boolean): boolean {
  return cls === lastCls && hasGroup
}

function getGroupStrategy(groupBy: 'consecutive' | 'name' | 'type'): GroupStrategy {
  if (groupBy === 'name') return nameStrategy
  if (groupBy === 'type') return typeStrategy
  return consecutiveStrategy
}

export function groupConsecutiveToolCalls(blocks: Block[], groupBy: 'consecutive' | 'name' | 'type' = 'consecutive'): Block[][] {
  const groups: Block[][] = []
  let currentGroup: Block[] = []
  let lastToolName: string | null = null
  let lastToolClass: ToolCallClass | null = null
  const pendingLifecycle: Block[] = []

  const flushLifecycle = () => {
    for (const lc of pendingLifecycle) groups.push([lc])
    pendingLifecycle.length = 0
  }

  const flushCurrentGroup = () => {
    if (currentGroup.length > 0) groups.push(currentGroup)
    flushLifecycle()
  }

  const strategy = getGroupStrategy(groupBy)

  for (const block of blocks) {
    const { isTool, toolName, toolClass } = getToolInfo(block)

    if (!isTool && isSilentLifecycleBlock(block)) {
      if (currentGroup.length > 0) {
        pendingLifecycle.push(block)
      } else {
        groups.push([block])
      }
      continue
    }

    if (!isTool) {
      flushCurrentGroup()
      groups.push([block])
      currentGroup = []
      lastToolName = null
      lastToolClass = null
      continue
    }

    if (strategy(toolName, toolClass, lastToolName, lastToolClass, currentGroup.length > 0)) {
      currentGroup.push(block)
    } else {
      flushCurrentGroup()
      currentGroup = [block]
      lastToolName = toolName
      lastToolClass = toolClass
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup)
  flushLifecycle()
  return groups
}

export function renderToolGroup(blocks: Block[], opts: RenderOptions): HTMLElement | null {
  if (blocks.length === 0) return null

  const config = opts.collapseConfig || {
    groupBy: 'consecutive',
    defaultCollapsed: true,
    collapseThreshold: 1,
    showTypeBreakdown: true,
    compactMode: false
  }

  const firstTool = blocks[0]!
  const tc = isToolCallBlock(firstTool) ? firstTool : null
  const toolClasses = new Set(blocks.map((b) => (b.class as ToolCallClass | undefined) || 'read'))
  const isMixedGroup = toolClasses.size > 1
  const toolClass = isMixedGroup ? 'mixed' : (tc?.class || 'read')
  const toolName = isMixedGroup ? 'tools' : (tc?.name || 'tool')

  // Edge case: Auto-expand if any tool in group has error state
   const hasError = blocks.some(b => {
     const s = b.state
     return s === 'error' || b.error
   })

  // Edge case: Auto-expand if any tool is still running or pending
  const hasActive = blocks.some(b => {
    const s = b.state
    return s === 'running' || s === 'pending'
  })

  // Edge case: Collapse by default for groups with 2+ tools, unless error or active
  const shouldCollapse = config.defaultCollapsed && !hasError && !hasActive && blocks.length >= config.collapseThreshold

  const group = document.createElement("details")
  group.className = `tool-call tool-group tool-call--${toolClass} tool-group--${hasActive ? 'active' : 'idle'}${config.compactMode ? ' tool-group--compact' : ''}`
  group.dataset.blockId = `group-${tc?.id || Date.now()}`
  group.open = !shouldCollapse

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
    case 'mixed': icon.innerHTML = TOOL_META_SVG; break
    default: icon.innerHTML = TOOL_READ_SVG; break
  }
  summary.appendChild(icon)

  const name = document.createElement("span")
  name.className = "tool-name"
  name.textContent = toolName
  summary.appendChild(name)

  // Add type breakdown if enabled
  if (config.showTypeBreakdown && blocks.length > 1) {
    const typeCounts: Record<string, number> = {}
    blocks.forEach(b => {
       const cls = b.class || 'read'
      typeCounts[cls] = (typeCounts[cls] || 0) + 1
    })
    const breakdown = Object.entries(typeCounts)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ')
    const breakdownEl = document.createElement("span")
    breakdownEl.className = "tool-group-breakdown"
    breakdownEl.textContent = `(${breakdown})`
    summary.appendChild(breakdownEl)
  }

  const count = document.createElement("span")
  count.className = "tool-group-count"
  count.setAttribute("aria-live", "polite")
  const runningCount = blocks.filter(b => {
    const s = b.state
    return s === 'running' || s === 'pending'
  }).length
  const baseCount = `${blocks.length} call${blocks.length > 1 ? 's' : ''}`
  count.textContent = runningCount > 0 ? `${baseCount} (${runningCount} running)` : baseCount
  summary.appendChild(count)

   const completed = blocks.filter(b => {
     const s = b.state
     return s === 'result' || s === 'completed'
   }).length
  const badge = document.createElement("span")
  badge.className = "tool-status"
  if (hasError) {
    badge.textContent = '\u2717 Error'
  } else if (completed === blocks.length) {
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

export function createToolCollapseControls(
  container: HTMLElement,
  onCollapseAll: () => void,
  onExpandAll: () => void,
  onToggleCompact: () => void,
  isCompact: boolean
): void {
  const controls = document.createElement("div")
  controls.className = "tool-collapse-controls"

  const collapseAllBtn = document.createElement("button")
  collapseAllBtn.className = "tool-collapse-btn"
  collapseAllBtn.textContent = "Collapse All"
  collapseAllBtn.setAttribute("aria-label", "Collapse all tool calls")
  collapseAllBtn.addEventListener("click", onCollapseAll)
  controls.appendChild(collapseAllBtn)

  const expandAllBtn = document.createElement("button")
  expandAllBtn.className = "tool-collapse-btn"
  expandAllBtn.textContent = "Expand All"
  expandAllBtn.setAttribute("aria-label", "Expand all tool calls")
  expandAllBtn.addEventListener("click", onExpandAll)
  controls.appendChild(expandAllBtn)

  const compactBtn = document.createElement("button")
  compactBtn.className = "tool-collapse-btn tool-collapse-btn--compact"
  compactBtn.textContent = isCompact ? "Standard" : "Compact"
  compactBtn.setAttribute("aria-label", isCompact ? "Switch to standard view" : "Switch to compact view")
  compactBtn.setAttribute("aria-pressed", String(isCompact))
  compactBtn.addEventListener("click", onToggleCompact)
  controls.appendChild(compactBtn)

  container.appendChild(controls)
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
