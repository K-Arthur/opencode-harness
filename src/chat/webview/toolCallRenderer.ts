import type { Block, ToolCallBlock, ToolCallClass, ToolCallState } from "./types"
import {
  TOOL_READ_SVG,
  TOOL_WRITE_SVG,
  TOOL_EXEC_SVG,
  TOOL_META_SVG,
  CHEVRON_RIGHT_SVG,
  toolIconFor,
  toolStateOverlayFor,
} from "./icons"
import { sanitizeHtml } from "./syntaxHighlighter"
import { escapeHtml } from "./htmlUtils"
import { getMarkdownWorkerClient } from "./markdownWorkerClient"
import { isTaskTool, renderSubagentTaskCard } from "./subagentCard"
import { isToolOutputRenderAnsiEnabled, renderAnsiToHtml, stripAnsi } from "./ansiUtils"
import { buildGroupSummaryLabel } from "./groupSummary"
import { renderJsonViewer } from "./jsonViewer"
import { isWebSearchTool, renderWebSearchResult } from "./webSearchRenderer"
import { isTerminalState } from "./toolState"
import { renderLiveCommandCard } from "./liveCommandCard"
import { renderFileEditCard } from "./fileEditCard"

export interface RenderOptions {
  messageId?: string
  sessionId?: string
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
  if (!isToolCallBlock(block)) {
    return {
      type: 'tool-call',
      id: block.id || `tool-${Date.now()}`,
      name: (typeof block.tool === "string" ? block.tool : undefined) || block.toolName || block.name || "tool",
      class: (block.class as ToolCallClass) || (block.toolType as ToolCallClass) || 'read',
      state: (block.state as ToolCallState) || 'running',
    args: block.args ? (typeof block.args === 'string' ? safeJsonParse(block.args) : block.args) : undefined,
    result: block.result,
    partialStdout: (block as ToolCallBlock).partialStdout,
    partialStderr: (block as ToolCallBlock).partialStderr,
    stdoutLength: (block as ToolCallBlock).stdoutLength,
    stderrLength: (block as ToolCallBlock).stderrLength,
    stdoutLineCount: (block as ToolCallBlock).stdoutLineCount,
    stderrLineCount: (block as ToolCallBlock).stderrLineCount,
    stderr: (block as ToolCallBlock).stderr,
    exitCode: (block as ToolCallBlock).exitCode,
    durationMs: (block.durationMs as number | undefined),
    } as ToolCallBlock
  }
  const tb = block as ToolCallBlock
  const tbId = tb.id || `tool-${Date.now()}`
  const tbName = tb.name || (typeof (tb as any).tool === "string" ? (tb as any).tool : undefined) || tb.toolName
    || (tbId ? `tool:${tbId.slice(0, 8)}` : "tool")
  return {
    type: 'tool-call',
    id: tbId,
    name: tbName,
    class: tb.class || (tb as any).toolType || 'read',
    state: tb.state || 'running',
    args: tb.args ? (typeof tb.args === 'string' ? safeJsonParse(tb.args) : tb.args) : undefined,
    result: tb.result,
    partialStdout: tb.partialStdout,
    partialStderr: tb.partialStderr,
    stdoutLength: tb.stdoutLength,
    stderrLength: tb.stderrLength,
    stdoutLineCount: tb.stdoutLineCount,
    stderrLineCount: tb.stderrLineCount,
    stderr: tb.stderr,
    exitCode: tb.exitCode,
    durationMs: tb.durationMs,
    startedAt: tb.startedAt,
    workingDir: tb.workingDir,
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
    if (event.key === "Enter" || event.key === " " || event.key === "e" || event.key === "E") {
      event.preventDefault()
      details.open = !details.open
      details.setAttribute("aria-expanded", details.open ? "true" : "false")
    } else if (event.key === "c" || event.key === "C") {
      event.preventDefault()
      const text = details.textContent || ""
      void navigator.clipboard?.writeText(text).catch(() => {})
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      focusAdjacentToolSummary(summary, event.key)
    }
  })

  appendToolIcon(summary, toolBlock.class || 'read', toolBlock.name)

  const name = document.createElement("span")
  name.className = "tool-name"
  name.textContent = formatToolSummary(toolBlock)
  summary.appendChild(name)

  appendToolKeyArg(summary, toolBlock.args, toolBlock, opts?.postMessage)
  appendToolStatusBadge(summary, toolBlock)
  appendToolTiming(summary, toolBlock)
  appendToolOutputSize(summary, toolBlock)

  if (toolBlock.class === 'write') {
    appendWriteToolActions(summary, toolBlock, opts?.postMessage)
  }

  return summary
}

export function appendToolIcon(parent: HTMLElement, toolClass: ToolCallClass, toolName?: string): void {
  const icon = document.createElement("span")
  icon.className = "tool-icon"
  icon.innerHTML = toolIconFor(toolName ?? "", toolClass)
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

function appendWriteToolActions(
  parent: HTMLElement,
  toolBlock: ToolCallBlock,
  postMessage?: (msg: Record<string, unknown>) => void
): void {
  const filePath = extractKeyArg(toolBlock.args)
  if (!filePath) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vscodePm = typeof window !== "undefined" ? (window as any).vscode?.postMessage?.bind((window as any).vscode) as ((msg: Record<string, unknown>) => void) | undefined : undefined
  const pm = postMessage ?? vscodePm

  const actions = document.createElement("span")
  actions.className = "tool-file-actions"

  const openBtn = document.createElement("button")
  openBtn.className = "tool-file-action-btn"
  openBtn.title = "Open file in editor"
  openBtn.textContent = "Open"
  // C2: tag the button so reRenderMessage can restore focus into the
  // equivalent button in the new DOM after a stream-end swap. The key
  // is unique within the tool card so the lookup is unambiguous.
  openBtn.setAttribute("data-restore-focus-id", "tool-open-file")
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    e.preventDefault()
    pm?.({ type: "open_file", path: filePath })
  })
  actions.appendChild(openBtn)

  const copyBtn = document.createElement("button")
  copyBtn.className = "tool-file-action-btn"
  copyBtn.title = "Copy file path"
  copyBtn.textContent = "Copy path"
  copyBtn.setAttribute("data-restore-focus-id", "tool-copy-path")
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    e.preventDefault()
    void navigator.clipboard?.writeText(filePath).catch(() => {})
    copyBtn.textContent = "Copied!"
    setTimeout(() => { copyBtn.textContent = "Copy path" }, 1500)
  })
  actions.appendChild(copyBtn)

  if (pm) {
    const revealBtn = document.createElement("button")
    revealBtn.className = "tool-file-action-btn"
    revealBtn.title = "Reveal in Explorer"
    revealBtn.textContent = "Reveal"
    revealBtn.setAttribute("data-restore-focus-id", "tool-reveal-in-explorer")
    revealBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      e.preventDefault()
      pm({ type: "reveal_in_explorer", path: filePath })
    })
    actions.appendChild(revealBtn)
  }

  parent.appendChild(actions)
}

export function appendToolStatusBadge(parent: HTMLElement, toolBlock: ToolCallBlock): void {
  const toolState = toolBlock.state || 'running'
  const badge = document.createElement("span")
  badge.className = `tool-status tool-status--${toolState}`
  const overlay = toolStateOverlayFor(toolState)
  let label: string
  let ariaLabel: string
  if (toolState === 'pending') {
    label = 'Pending'; ariaLabel = 'Tool pending'
  } else if (toolState === 'running') {
    label = 'Running'; ariaLabel = 'Tool running'
  } else if (toolState === 'stale') {
    label = 'Stale'; ariaLabel = 'Tool completion unconfirmed'
  } else if (toolBlock.error || toolState === 'error') {
    label = 'Error'; ariaLabel = 'Tool error'
  } else if (toolState === 'cancelled') {
    label = 'Cancelled'; ariaLabel = 'Tool cancelled'
  } else if (toolState === 'timed_out') {
    label = 'Timed out'; ariaLabel = 'Tool timed out'
  } else if (toolState === 'retried') {
    label = 'Retried'; ariaLabel = 'Tool retried'
  } else {
    label = 'Done'; ariaLabel = 'Tool complete'
  }
  if (overlay) {
    const icon = document.createElement("span")
    icon.className = "tool-status-icon"
    icon.setAttribute("aria-hidden", "true")
    icon.innerHTML = overlay
    badge.appendChild(icon)
  }
  const text = document.createElement("span")
  text.className = "tool-status-label"
  text.textContent = label
  badge.appendChild(text)
  badge.setAttribute("aria-label", ariaLabel)
  parent.appendChild(badge)
}

export function appendToolTiming(parent: HTMLElement, toolBlock: ToolCallBlock): void {
  const toolState = toolBlock.state || 'running'
  const isTerminal = isTerminalState(toolState)

  if (toolBlock.durationMs && isTerminal) {
    const dur = document.createElement("span")
    dur.className = "tool-duration"
    dur.textContent = toolBlock.durationMs >= 1000
      ? `${(toolBlock.durationMs / 1000).toFixed(1)}s`
      : `${toolBlock.durationMs}ms`
    if (toolBlock.startedAt) {
      dur.title = `Started: ${new Date(toolBlock.startedAt).toLocaleString()}`
    }
    parent.appendChild(dur)
  } else if (toolState === 'running' || toolState === 'pending') {
    const elapsed = document.createElement("span")
    elapsed.className = "tool-elapsed"
    elapsed.dataset.blockId = toolBlock.id
    elapsed.textContent = "0s"
    if (toolBlock.startedAt) {
      elapsed.dataset.timestamp = String(toolBlock.startedAt)
      elapsed.title = `Started: ${new Date(toolBlock.startedAt).toLocaleString()}`
    }
    parent.appendChild(elapsed)
  }
}

export function appendToolOutputSize(parent: HTMLElement, toolBlock: ToolCallBlock): void {
  const toolState = toolBlock.state || 'running'
  if (!toolBlock.result) return
  if (!isTerminalState(toolState)) return

  const resultStr = typeof toolBlock.result === 'string' ? toolBlock.result : JSON.stringify(toolBlock.result)
  const size = document.createElement("span")
  size.className = "tool-output-size"
  const chars = resultStr.length
  size.textContent = chars >= 1024 ? `${(chars / 1024).toFixed(1)}KB` : `${chars} chars`
  size.title = `${resultStr.split('\n').length} lines, ${chars} characters`
  parent.appendChild(size)
}

/** First non-empty string value among the given keys, else null. */
function firstStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string") return v
  }
  return null
}

/** Render a multi-line string as removed/added diff lines (edit-tool input preview). */
function appendDiffSide(parent: HTMLElement, text: string, kind: "removed" | "added"): void {
  const marker = kind === "removed" ? "-" : "+"
  for (const raw of text.split("\n")) {
    const line = document.createElement("div")
    line.className = `diff-line diff-line--${kind}`
    const mark = document.createElement("span")
    mark.className = "diff-line-marker"
    mark.setAttribute("aria-hidden", "true")
    mark.textContent = marker
    const content = document.createElement("span")
    content.className = "diff-line-content"
    content.textContent = raw
    line.appendChild(mark)
    line.appendChild(content)
    parent.appendChild(line)
  }
}

export function createToolArgsPanel(toolBlock: ToolCallBlock): HTMLElement | null {
  if (toolBlock.args === undefined) return null

  const argsDiv = document.createElement("div")
  argsDiv.className = "tool-args-panel"

  const args = toolBlock.args

  // Command/exec tools: the command IS the input. Surface it as a readable
  // command line (like a terminal prompt) instead of dumping the raw
  // `{ command, description, timeout }` object as a JSON tree.
  const isCommandTool =
    toolBlock.class === "exec" ||
    ["bash", "shell", "command", "terminal"].some((k) => (toolBlock.name?.toLowerCase() ?? "").includes(k))
  if (isCommandTool) {
    const parsed = typeof args === "string" ? safeJsonParse(args) : args
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    const command =
      obj && typeof obj.command === "string" ? obj.command : typeof args === "string" ? args : null
    if (command && command.trim()) {
      argsDiv.classList.add("tool-args-panel--command")
      const line = document.createElement("code")
      line.className = "tool-command-line"
      const prompt = document.createElement("span")
      prompt.className = "tool-command-prompt"
      prompt.setAttribute("aria-hidden", "true")
      prompt.textContent = "$ "
      line.appendChild(prompt)
      const cmdText = document.createElement("span")
      cmdText.className = "tool-command-text"
      cmdText.textContent = command
      line.appendChild(cmdText)
      argsDiv.appendChild(line)
      const description = obj && typeof obj.description === "string" ? obj.description.trim() : ""
      if (description) {
        const desc = document.createElement("div")
        desc.className = "tool-command-desc"
        desc.textContent = description
        argsDiv.appendChild(desc)
      }
      return argsDiv
    }
  }

  // Write/edit tools: show the change as a diff (edit) or a code block (write),
  // not a JSON-escaped string with literal \n noise.
  const isWriteTool =
    toolBlock.class === "write" ||
    ["edit", "write", "patch"].some((k) => (toolBlock.name?.toLowerCase() ?? "").includes(k))
  if (isWriteTool) {
    const parsedW = typeof args === "string" ? safeJsonParse(args) : args
    const obj = parsedW && typeof parsedW === "object" ? (parsedW as Record<string, unknown>) : null
    if (obj) {
      const oldStr = firstStringField(obj, ["oldString", "old_string", "old", "search"])
      const newStr = firstStringField(obj, ["newString", "new_string", "new", "replace"])
      const content = firstStringField(obj, ["content", "contents", "text", "fileText"])
      if (oldStr !== null || newStr !== null) {
        argsDiv.classList.add("tool-args-panel--edit")
        if (oldStr !== null) appendDiffSide(argsDiv, oldStr, "removed")
        if (newStr !== null) appendDiffSide(argsDiv, newStr, "added")
        return argsDiv
      }
      if (content !== null) {
        argsDiv.classList.add("tool-args-panel--write")
        const body = document.createElement("pre")
        body.className = "tool-result-body"
        addTruncatedContent(body, content, 2000, 40)
        argsDiv.appendChild(body)
        return argsDiv
      }
    }
  }

  if (args !== null && typeof args === "object") {
    // Use the collapsible JSON tree for structured args.
    // Guard against very large payloads (e.g. full file content in write args):
    // if the serialised size exceeds 10KB, fall through to the truncated text view.
    const jsonStr = JSON.stringify(args)
    if (jsonStr.length <= 10_240) {
      argsDiv.appendChild(renderJsonViewer(args, { maxDepth: 3 }))
      return argsDiv
    }
    // Large payload: fall through to truncated plain-text display
    const truncated2 = jsonStr.length > 500
    const display2 = truncated2 ? jsonStr.slice(0, 500) : jsonStr
    argsDiv.innerHTML = sanitizeHtml(escapeHtml(display2))
    if (truncated2) {
      const more2 = document.createElement("button")
      more2.className = "tool-show-more"
      more2.textContent = "Show more\u2026"
      more2.addEventListener("click", () => {
        argsDiv.innerHTML = sanitizeHtml(escapeHtml(jsonStr))
        void getMarkdownWorkerClient().highlight(jsonStr, "json").then((result) => {
          if (result) argsDiv.innerHTML = sanitizeHtml(result)
        }).catch(() => { /* fallback: escapeHtml already applied above */ })
        more2.remove()
      })
      argsDiv.appendChild(more2)
    }
  } else {
    const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
    const truncated = argsStr.length > 500
    const displayStr = truncated ? argsStr.slice(0, 500) : argsStr
    argsDiv.innerHTML = sanitizeHtml(escapeHtml(displayStr))
    if (truncated) {
      const more = document.createElement("button")
      more.className = "tool-show-more"
      more.textContent = "Show more\u2026"
      more.addEventListener("click", () => {
        argsDiv.innerHTML = sanitizeHtml(escapeHtml(argsStr))
        void getMarkdownWorkerClient().highlight(argsStr, "json").then((result) => {
          if (result) argsDiv.innerHTML = sanitizeHtml(result)
        }).catch(() => { /* fallback: escapeHtml already applied above */ })
        more.remove()
      })
      argsDiv.appendChild(more)
    }
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

export function createToolResultPanel(toolBlock: ToolCallBlock, opts?: RenderOptions): HTMLElement | null {
  const toolState = toolBlock.state || 'running'
  const isTerminal = isTerminalState(toolState)
  const liveStdout = typeof toolBlock.partialStdout === "string" ? toolBlock.partialStdout : undefined
  const liveStderr = typeof toolBlock.partialStderr === "string" ? toolBlock.partialStderr : undefined
  const hasLiveOutput = liveStdout !== undefined || liveStderr !== undefined
  const isCommand = toolBlock.class === "exec" || ["bash","shell","command","terminal"].some(k => toolBlock.name?.toLowerCase().includes(k))
  const isRunningCommand = isCommand && !isTerminal
  const hasOutput = toolBlock.result !== undefined || (toolBlock.error !== undefined && toolBlock.error !== "") || hasLiveOutput || isRunningCommand
  if (!hasOutput || (!isTerminal && !hasLiveOutput && !isRunningCommand)) return null

  const isErrorPanel = !!toolBlock.error || toolState === 'error' || toolState === 'timed_out'

  // Web search tools get a rich result card instead of raw text
  if (!isErrorPanel && isWebSearchTool(toolBlock)) {
    const webResult = renderWebSearchResult(toolBlock)
    if (webResult) {
      const wrapper = document.createElement("div")
      wrapper.className = "tool-result-panel"
      wrapper.appendChild(webResult)
      return wrapper
    }
  }

  const resultDiv = document.createElement("div")
  resultDiv.className = isErrorPanel ? "tool-result-panel tool-result-panel--error" : "tool-result-panel"

  const meta = document.createElement("div")
  meta.className = "tool-result-meta"

  const pieces: string[] = []

  // Working directory (exec tools only)
  if (isCommand && toolBlock.workingDir) {
    const cwdEl = document.createElement("span")
    cwdEl.className = "tool-result-cwd"
    cwdEl.textContent = `cwd: ${truncateMiddle(toolBlock.workingDir, 40)}`
    cwdEl.title = toolBlock.workingDir
    meta.appendChild(cwdEl)
  }

  if (toolBlock.exitCode !== undefined && isCommand) {
    const ec = document.createElement("span")
    ec.className = `tool-exit-code tool-exit-code--${toolBlock.exitCode === 0 ? 'ok' : 'error'}`
    ec.textContent = `exit ${toolBlock.exitCode}`
    meta.appendChild(ec)
    pieces.push(`exit ${toolBlock.exitCode}`)
  }

  if (toolBlock.durationMs && (isTerminal || hasLiveOutput)) {
    pieces.push(toolBlock.durationMs >= 1000 ? `${(toolBlock.durationMs / 1000).toFixed(1)}s` : `${toolBlock.durationMs}ms`)
  }

  if (hasLiveOutput && !isTerminal) {
    const live = document.createElement("span")
    live.className = "tool-live-indicator"
    live.title = "Streaming output"
    live.setAttribute("aria-label", "Streaming output")
    live.innerHTML = '<span class="codicon codicon-sync"></span>'
    meta.appendChild(live)
  }

  const rawOutput = hasLiveOutput
    ? liveStdout ?? ""
    : toolBlock.result !== undefined ? toolBlock.result : toolBlock.error
  const rawText = rawOutput === undefined ? "" : typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2)
  const resultText = stripAnsi(rawText)
  const stdoutText = hasLiveOutput ? stripAnsi(liveStdout ?? "") : resultText
  const stderrText = hasLiveOutput ? stripAnsi(liveStderr ?? "") : (toolBlock.stderr ? stripAnsi(toolBlock.stderr) : "")
  const stdoutRenderText = hasLiveOutput ? liveStdout ?? "" : resultText
  const stderrRenderText = hasLiveOutput ? liveStderr ?? "" : toolBlock.stderr ?? ""
  const copyOutputText = stderrText ? `${stdoutText}${stderrText}` : stdoutText

  const isDiff = !isErrorPanel && isDiffContent(resultText)

  const totalLength = (toolBlock.stdoutLength ?? stdoutText.length) + (toolBlock.stderrLength ?? stderrText.length)
  const totalLines = (toolBlock.stdoutLineCount ?? (stdoutText ? stdoutText.split("\n").length : 0)) + (toolBlock.stderrLineCount ?? (stderrText ? stderrText.split("\n").length : 0))
  const metaText = `${formatOutputSize(totalLength)}${totalLines > 1 ? `, ${totalLines} lines` : ""}`
  pieces.push(metaText)

  const metaTextEl = document.createElement("span")
  metaTextEl.textContent = metaText
  meta.appendChild(metaTextEl)

  if (isDiff) {
    const body = document.createElement("pre")
    body.className = "tool-result-body tool-result-body--diff"
    const { fragment, added, removed } = renderDiffBody(resultText)
    body.appendChild(fragment)
    meta.appendChild(document.createTextNode(` · +${added}/-${removed}`))
    resultDiv.appendChild(meta)
    resultDiv.appendChild(body)
  } else if (isCommand && (stderrText || hasLiveOutput)) {
    resultDiv.appendChild(meta)
    const stdoutEl = document.createElement("div")
    stdoutEl.className = "tool-command-output"
    const stdoutLabel = document.createElement("div")
    stdoutLabel.className = "tool-command-output-label"
    stdoutLabel.textContent = "stdout"
    stdoutEl.appendChild(stdoutLabel)
    const stdoutBody = document.createElement("pre")
    stdoutBody.className = "tool-result-body"
    addTruncatedContent(stdoutBody, stdoutRenderText, 2000, 40)
    stdoutEl.appendChild(stdoutBody)
    resultDiv.appendChild(stdoutEl)

    if (stderrText || hasLiveOutput) {
      const stderrEl = document.createElement("div")
      stderrEl.className = "tool-command-output tool-command-output--stderr"
      const stderrLabel = document.createElement("div")
      stderrLabel.className = "tool-command-output-label"
      stderrLabel.textContent = "stderr"
      stderrEl.appendChild(stderrLabel)
      const stderrBody = document.createElement("pre")
      stderrBody.className = "tool-result-body"
      addTruncatedContent(stderrBody, stderrRenderText, 2000, 40)
      stderrEl.appendChild(stderrBody)
      resultDiv.appendChild(stderrEl)
    }
  } else if (isRunningCommand && !hasLiveOutput && !resultText) {
    resultDiv.appendChild(meta)
  } else {
    resultDiv.appendChild(meta)
    const body = document.createElement("pre")
    body.className = "tool-result-body"
    addTruncatedContent(body, isToolOutputRenderAnsiEnabled() ? rawText : resultText, 2000, 40)
    resultDiv.appendChild(body)
  }

  // Quick action buttons for exec-class (command) tools
  if (isCommand) {
    const actions = document.createElement("div")
    actions.className = "tool-result-actions"

    const command = extractKeyArg(toolBlock.args) ?? ""

    if (command) {
      const copyCmd = document.createElement("button")
      copyCmd.className = "tool-result-action-btn"
      copyCmd.textContent = "Copy command"
      copyCmd.title = "Copy command to clipboard"
      copyCmd.setAttribute("data-restore-focus-id", "tool-copy-command")
      copyCmd.addEventListener("click", (e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(command).catch(() => {})
        copyCmd.textContent = "Copied!"
        setTimeout(() => { copyCmd.textContent = "Copy command" }, 1500)
      })
      actions.appendChild(copyCmd)
    }

    if (copyOutputText) {
      const copyOut = document.createElement("button")
      copyOut.className = "tool-result-action-btn"
      copyOut.textContent = "Copy output"
      copyOut.title = "Copy full output to clipboard"
      copyOut.setAttribute("data-restore-focus-id", "tool-copy-output")
      copyOut.addEventListener("click", (e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(copyOutputText).catch(() => {})
        copyOut.textContent = "Copied!"
        setTimeout(() => { copyOut.textContent = "Copy output" }, 1500)
      })
      actions.appendChild(copyOut)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vscodePm = (window as any).vscode?.postMessage?.bind((window as any).vscode) as ((msg: Record<string, unknown>) => void) | undefined
    const pm: ((msg: Record<string, unknown>) => void) | undefined = opts?.postMessage ?? vscodePm
    if (command && pm) {
      const openTerm = document.createElement("button")
      openTerm.className = "tool-result-action-btn"
      openTerm.textContent = "Open in terminal"
      openTerm.title = "Open a VS Code terminal with this command"
      openTerm.setAttribute("data-restore-focus-id", "tool-open-terminal")
      openTerm.addEventListener("click", (e) => {
        e.stopPropagation()
        pm({ type: "open_terminal", command, cwd: toolBlock.workingDir, autorun: false })
      })
      actions.appendChild(openTerm)
    }

    if (!isTerminal && pm) {
      const cancel = document.createElement("button")
      cancel.className = "tool-result-action-btn tool-result-action-btn--danger"
      cancel.textContent = "Cancel"
      cancel.title = "Cancel this running command"
      cancel.setAttribute("data-restore-focus-id", "tool-cancel")
      cancel.addEventListener("click", (e) => {
        e.stopPropagation()
        pm({
          type: "cancel_tool",
          sessionId: opts?.sessionId,
          toolId: toolBlock.id,
          stdout: liveStdout ?? "",
          stderr: liveStderr ?? "",
          durationMs: toolBlock.durationMs,
        })
      })
      actions.appendChild(cancel)
    }

    if (actions.childElementCount > 0) resultDiv.appendChild(actions)
  }

  return resultDiv
}

function addTruncatedContent(container: HTMLElement, text: string, maxChars: number, maxLines: number): void {
  const lines = text.split("\n")
  const truncated = text.length > maxChars || lines.length > maxLines
  const displayText = truncated ? lines.slice(0, maxLines).join("\n").slice(0, maxChars) : text
  if (isToolOutputRenderAnsiEnabled()) container.innerHTML = renderAnsiToHtml(displayText)
  else container.textContent = displayText
  if (truncated) {
    const more = document.createElement("button")
    more.className = "tool-show-more"
    more.textContent = "Show full"
    more.addEventListener("click", () => {
      if (isToolOutputRenderAnsiEnabled()) container.innerHTML = renderAnsiToHtml(text)
      else container.textContent = text
      more.remove()
    })
    container.parentElement?.appendChild(more)
  }
}

export function renderToolCallBlock(block: Block, opts: RenderOptions): HTMLElement | null {
  const toolBlock = normalizeToolBlock(block)

  // The `task` tool spawns a subagent — render it as a first-class subagent
  // card (purpose/status/duration/result, prompt behind a debug expander)
  // instead of a generic tool whose args leak the full prompt as raw JSON.
  if (isTaskTool(toolBlock)) {
    return renderSubagentTaskCard(toolBlock, opts)
  }

  // Exec/shell tools render as standalone live command cards in the chat stream.
  if (toolBlock.class === "exec") {
    return renderLiveCommandCard(toolBlock, opts)
  }

  // Check if this is a plan file write
  const planData = detectPlanFile(toolBlock)
  if (planData) {
    return renderPlanCard(planData, opts)
  }

  // Write-class file edits render as inline preview cards in the chat stream.
  if (toolBlock.class === "write") {
    const fileEditCard = renderFileEditCard(toolBlock, opts)
    if (fileEditCard) return fileEditCard
  }

  const details = createToolDetailsContainer(toolBlock)
  const summary = createToolSummary(toolBlock, details, opts)
  details.appendChild(summary)

  const argsPanel = createToolArgsPanel(toolBlock)
  if (argsPanel) details.appendChild(argsPanel)

  const resultPanel = createToolResultPanel(toolBlock, opts)
  if (resultPanel) details.appendChild(resultPanel)

  return details
}

/**
 * Produce a scannable, verb-phrased label for a tool's summary row. The verb
 * pairs with the key-arg chip rendered next to it (e.g. "Ran" + "npm test",
 * "Read" + "ChatView.tsx"). Transitive verbs only apply when a target arg
 * exists; otherwise we keep the raw tool name so argless/unknown tools aren't
 * mislabeled. The subagent `task` tool never reaches here — it renders as a card.
 */
export function formatToolSummary(toolBlock: ToolCallBlock): string {
  const rawName = (toolBlock.name || "tool").trim()
  const name = rawName.toLowerCase()
  const cls = toolBlock.class || 'read'
  const hasArg = !!extractKeyArg(toolBlock.args)

  // Self-contained labels — read fine without a target arg.
  if (name.includes("todo")) return "Updated todos"
  if (name === "skill") return "Loaded skill"

  // Transitive verbs — only when a target arg is shown beside them.
  if (hasArg) {
    if (name.includes("grep") || name.includes("glob") || name === "search" || name.includes("ripgrep")) return "Searched"
    if (name.includes("websearch")) return "Searched web"
    if (name.includes("webfetch") || name === "fetch") return "Fetched"
    if (name.includes("list") || name === "ls") return "Listed"
    if (name.includes("lsp")) return "Inspected"
    if (cls === "exec") return "Ran"
    if (cls === "write") {
      if (name.includes("edit")) return "Edited"
      if (name.includes("patch") || name.includes("apply")) return "Patched"
      return "Wrote"
    }
    if (cls === "read" && (name.includes("read") || name === "cat" || name === "open" || name === "view")) return "Read"
  }

  return rawName
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

function normalizePlanTodoStatus(status: string): "pending" | "in-progress" | "completed" {
  const normalized = status.trim().toLowerCase().replace(/_/g, "-")
  if (normalized === "done" || normalized === "complete" || normalized === "completed") return "completed"
  if (normalized === "running" || normalized === "active" || normalized === "in-progress") return "in-progress"
  return "pending"
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
  const todosIndex = frontmatter.search(/^todos:\s*$/m)
  if (todosIndex === -1) return null

  const nameMatch = frontmatter.match(/name:\s*(.+)/)
  const overviewMatch = frontmatter.match(/overview:\s*(.+)/)

  const todos: PlanData['todos'] = []
  const todoLines = frontmatter.slice(todosIndex).split('\n').slice(1)
  let currentTodo: PlanData['todos'][0] | null = null
  for (const line of todoLines) {
    if (/^\S/.test(line)) break
    const todoStart = line.match(/^\s+-\s+id:\s*(.+)/)
    const contentMatch = line.match(/^\s+(?:-\s+)?content:\s*(.+)/)
    const statusMatch = line.match(/^\s+(?:-\s+)?status:\s*(.+)/)
    if (todoStart) {
      if (currentTodo) todos.push(currentTodo)
      currentTodo = { id: todoStart[1]?.trim() ?? '', content: '', status: 'pending' }
    } else if (currentTodo) {
      if (contentMatch) currentTodo.content = contentMatch[1]?.trim() ?? ''
      if (statusMatch) currentTodo.status = normalizePlanTodoStatus(statusMatch[1]?.trim() ?? 'pending')
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

  const completed = plan.todos.filter(t => normalizePlanTodoStatus(t.status) === 'completed').length
  const total = plan.todos.length
  const progressValue = total > 0 ? completed / total : 0
  const progress = document.createElement("div")
  progress.className = "plan-card-progress"
  progress.setAttribute("role", "progressbar")
  progress.setAttribute("aria-valuemin", "0")
  progress.setAttribute("aria-valuenow", String(completed))
  progress.setAttribute("aria-valuemax", String(total))
  progress.setAttribute("aria-label", `Plan progress: ${completed} of ${total} completed`)
  const progressFill = document.createElement("div")
  progressFill.className = "plan-card-progress-fill"
  progressFill.style.setProperty("--p", progressValue.toFixed(3).replace(/\.?0+$/, ""))
  progress.appendChild(progressFill)
  card.appendChild(progress)

  const todosList = document.createElement("div")
  todosList.className = "plan-card-todos"

  for (const todo of plan.todos) {
    const statusValue = normalizePlanTodoStatus(todo.status)
    const item = document.createElement("div")
    item.className = `plan-card-todo plan-card-todo--${statusValue}`
    const checkbox = document.createElement("span")
    checkbox.className = "plan-card-todo-checkbox"
    checkbox.textContent = statusValue === 'completed' ? '✓' : '○'
    item.appendChild(checkbox)

    const text = document.createElement("span")
    text.className = "plan-card-todo-text"
    text.textContent = todo.content
    item.appendChild(text)

    const status = document.createElement("span")
    status.className = `plan-card-todo-status plan-card-todo-status--${statusValue}`
    status.textContent = statusValue
    item.appendChild(status)

    todosList.appendChild(item)
  }

  card.appendChild(todosList)

  const actions = document.createElement("div")
  actions.className = "plan-card-actions"
  const approveBtn = document.createElement("button")
  approveBtn.className = "plan-card-action-btn plan-card-action-btn--approve"
  approveBtn.textContent = "Approve"
  approveBtn.addEventListener("click", () => {
    opts.postMessage?.({ type: "plan_action", action: "approve", filePath: plan.filePath })
  })
  const reviseBtn = document.createElement("button")
  reviseBtn.className = "plan-card-action-btn plan-card-action-btn--revise"
  reviseBtn.textContent = "Revise"
  reviseBtn.addEventListener("click", () => {
    opts.postMessage?.({ type: "plan_action", action: "revise", filePath: plan.filePath })
  })
  actions.appendChild(approveBtn)
  actions.appendChild(reviseBtn)
  card.appendChild(actions)

  const footer = document.createElement("div")
  footer.className = "plan-card-footer"
  footer.textContent = `${completed}/${plan.todos.length} completed · ${plan.filePath}`
  card.appendChild(footer)

  return card
}

/**
 * Render or refresh the group-level status badge for a set of tool blocks.
 * Extracted so both initial render (renderToolGroup) and streaming updates
 * (updateToolGroupHeader) share the same state → label mapping.
 */
export function renderToolGroupBadge(blocks: Block[]): HTMLSpanElement | null {
  if (blocks.length === 0) return null
  const hasError = blocks.some(b => {
    const s = b.state
    return s === 'error' || s === 'timed_out' || b.error
  })
  const completed = blocks.filter(b => {
    const s = b.state
    return s === 'result' || s === 'completed' || s === 'success'
  }).length
  const cancelled = blocks.filter(b => b.state === 'cancelled').length
  const timedOut = blocks.filter(b => b.state === 'timed_out').length
  const badge = document.createElement("span")
  badge.className = "tool-status"
  if (hasError) {
    badge.textContent = '\u2717 Error'
    badge.className += ' tool-status--error'
  } else if (timedOut > 0) {
    badge.textContent = '\u23f3 Timed out'
    badge.className += ' tool-status--timed_out'
  } else if (cancelled > 0) {
    badge.textContent = '\u2715 Cancelled'
    badge.className += ' tool-status--cancelled'
  } else if (completed === blocks.length) {
    badge.textContent = '\u2713 Done'
    badge.className += ' tool-status--completed'
  } else if (completed > 0) {
    badge.textContent = `\u25c9 ${completed}/${blocks.length}`
    badge.className += ' tool-status--running'
  } else {
    badge.textContent = '\u25c9 Running'
    badge.className += ' tool-status--running'
  }
  return badge
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

    // Subagent (`task`) tools never fold into a generic tool group — each one
    // renders as its own standalone card so parallel subagents stay distinct.
    if (isTaskTool(block)) {
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
  // Human-readable summary: "3 file reads, 1 command" instead of raw class names
  const groupLabel = buildGroupSummaryLabel(blocks) || (tc?.name || 'tool calls')

  // Edge case: Auto-expand if any tool in group has error state
   const hasError = blocks.some(b => {
     const s = b.state
     return s === 'error' || s === 'timed_out' || b.error
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
    if (event.key === "Enter" || event.key === " " || event.key === "e" || event.key === "E") {
      event.preventDefault()
      group.open = !group.open
    } else if (event.key === "c" || event.key === "C") {
      event.preventDefault()
      const text = group.textContent || ""
      void navigator.clipboard?.writeText(text).catch(() => {})
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
  name.textContent = groupLabel
  summary.appendChild(name)

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

  const badge = renderToolGroupBadge(blocks)
  if (badge) summary.appendChild(badge)

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
