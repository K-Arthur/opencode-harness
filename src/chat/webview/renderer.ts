import hljs from "highlight.js/lib/core"
import MarkdownIt from "markdown-it"
import DOMPurify from "dompurify"
import type { Block, ChatMessage } from "./types"

// Initialize markdown parser with security settings
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})

// Configure DOMPurify for maximum XSS protection
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "b", "i", "em", "strong", "a", "p", "br", "ul", "ol", "li",
    "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "img", "span", "div", "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: [
    "href", "src", "alt", "title", "class", "language", "width", "height",
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp):|\/)/i,
  FORBID_CONTENTS: ["script", "style", "iframe", "frame", "object", "embed"],
  FORBID_TAGS: ["script", "style", "iframe", "frame", "object", "embed", "form"],
  SAFE_FOR_TEMPLATES: true,
  SAFE_FOR_XML: true,
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}

const MARKDOWN_PATTERN = /(\*\*.*?\*\*)|(\*[^*\s][^*]*\*)|(#{1,6}\s)|(`[^`]+`)|(```[\s\S]*?```)|(\[.*?\]\(.*?\))|(^\s*[-*+]\s)/m

// Register common languages
import javascript from "highlight.js/lib/languages/javascript"
import typescript from "highlight.js/lib/languages/typescript"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import go from "highlight.js/lib/languages/go"
import bash from "highlight.js/lib/languages/bash"
import json from "highlight.js/lib/languages/json"
import css from "highlight.js/lib/languages/css"
import markdown from "highlight.js/lib/languages/markdown"
import sql from "highlight.js/lib/languages/sql"
import diff from "highlight.js/lib/languages/diff"
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
hljs.registerLanguage("css", css)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("diff", diff)
hljs.registerLanguage("java", java)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("xml", xml)

hljs.registerAliases(["js", "node"], { languageName: "javascript" })
hljs.registerAliases(["ts"], { languageName: "typescript" })
hljs.registerAliases(["sh", "zsh"], { languageName: "bash" })
hljs.registerAliases(["html", "htm"], { languageName: "xml" })
hljs.registerAliases(["py"], { languageName: "python" })

const OC_LOGO_SVG = '<svg class="oc-logo" viewBox="0 0 480 600" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 0h480v600H0V0zm120 120h240v360H120V120z"/></svg>'
const USER_AVATAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>'
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
const GEAR_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

export function renderMessage(msg: ChatMessage): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "message " + (msg.role || "assistant")
  if (msg.id) div.dataset.messageId = msg.id

  if (msg.role !== "system") {
    const avatar = document.createElement("div")
    avatar.className = "message-avatar"
    avatar.innerHTML = msg.role === "user" ? USER_AVATAR_SVG : OC_LOGO_SVG
    div.appendChild(avatar)
  }

  const contentWrapper = document.createElement("div")
  contentWrapper.className = "message-content"

  if (msg.role !== "system") {
    const header = document.createElement("div")
    header.className = "message-header"
    const roleSpan = document.createElement("span")
    roleSpan.className = "message-role"
    roleSpan.textContent = msg.role === "user" ? "You" : "OpenCode"
    header.appendChild(roleSpan)
    if (msg.timestamp) {
      const ts = document.createElement("span")
      ts.className = "message-timestamp"
      ts.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      header.appendChild(ts)
    }
    contentWrapper.appendChild(header)
  }

  const bubble = document.createElement("div")
  bubble.className = msg.role === "system" ? "system-bubble" : "message-bubble"

  if (msg.blocks && Array.isArray(msg.blocks)) {
    msg.blocks.forEach((block) => {
      const el = renderBlock(block, msg.id)
      if (el) bubble.appendChild(el)
    })
  }

  contentWrapper.appendChild(bubble)
  div.appendChild(contentWrapper)

  return div
}

export function renderBlock(block: Block, messageId?: string): HTMLElement | null {
  if (!block || !block.type) return null
  switch (block.type) {
    case "text": return renderTextBlock(block)
    case "code": return renderCodeBlock(block)
    case "thinking": return renderThinkingBlock(block)
    case "skill_badge": return renderSkillBadge(block)
    case "tool_call": return renderToolCard(block)
    case "diff_block": return renderDiffBlock(block, messageId)
    case "permission": return renderPermissionBlock(block)
    case "task_banner": return renderTaskBanner(block)
    case "context": return renderContextBlock(block)
    default: return null
  }
}

function renderTextBlock(block: Block): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "msg-text markdown-content"
  const text = block.text || ""
  if (MARKDOWN_PATTERN.test(text)) {
    div.innerHTML = sanitizeHtml(md.render(text))
  } else {
    div.textContent = text
  }
  return div
}

function renderCodeBlock(block: Block): HTMLDivElement {
  const outerWrapper = document.createElement("div")
  outerWrapper.className = "code-block"

  const header = document.createElement("div")
  header.className = "code-block-header"
  const lang = document.createElement("span")
  lang.className = "code-block-lang"
  lang.textContent = block.language || "code"
  header.appendChild(lang)

  const copyBtn = document.createElement("button")
  copyBtn.className = "code-block-copy"
  copyBtn.innerHTML = '<span>Copy</span>'
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(block.code || "").then(() => {
      copyBtn.classList.add("copied")
      copyBtn.querySelector("span")!.textContent = "Copied!"
      setTimeout(() => { copyBtn.classList.remove("copied"); copyBtn.querySelector("span")!.textContent = "Copy" }, 1500)
    })
  })
  header.appendChild(copyBtn)
  outerWrapper.appendChild(header)

  const content = document.createElement("div")
  content.className = "code-block-content"
  content.innerHTML = sanitizeHtml(highlightSyntax(block.code || "", block.language || ""))
  outerWrapper.appendChild(content)

  return outerWrapper
}

function highlightSyntax(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try { return hljs.highlight(code, { language }).value } catch {}
  }
  try { return hljs.highlightAuto(code).value } catch (e) {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
}

function renderThinkingBlock(block: Block): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "thinking-block"

  const header = document.createElement("div")
  header.className = "thinking-header"
  const toggle = document.createElement("span")
  toggle.className = "thinking-toggle"
  toggle.innerHTML = CHEVRON_SVG
  header.appendChild(toggle)

  const label = document.createElement("span")
  label.textContent = "Thought Process"
  header.appendChild(label)
  div.appendChild(header)

  const content = document.createElement("div")
  content.className = "thinking-content"
  content.textContent = block.text || ""
  div.appendChild(content)

  div.addEventListener("click", () => {
    div.classList.toggle("expanded")
  })

  return div
}

function renderSkillBadge(block: Block): HTMLDivElement {
  const badge = document.createElement("div")
  badge.className = "skill-badge"
  const icon = document.createElement("span")
  icon.className = "skill-icon"
  icon.innerHTML = GEAR_SVG
  badge.appendChild(icon)
  const name = document.createElement("span")
  const skillName = block.skillName
  name.textContent = (skillName && skillName !== "unknown" && skillName !== "") ? skillName : "system"
  badge.appendChild(name)
  return badge
}

function renderToolCard(block: Block): HTMLDivElement {
  const card = document.createElement("div")
  const toolType = block.toolType || "read"
  const state = block.state || "running"
  card.className = `tool-card tool-${toolType} ${state}`

  const header = document.createElement("div")
  header.className = "tool-header"

  const icon = document.createElement("span")
  icon.className = "tool-icon"
  if (toolType === "write") {
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
  } else if (toolType === "exec") {
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'
  } else {
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
  }
  header.appendChild(icon)

  const name = document.createElement("span")
  name.className = "tool-name"
  name.textContent = block.toolName || "tool"
  header.appendChild(name)

  const args = document.createElement("span")
  args.className = "tool-args"
  args.textContent = block.args || ""
  header.appendChild(args)

  const expand = document.createElement("span")
  expand.className = "tool-expand-icon"
  expand.innerHTML = CHEVRON_SVG
  header.appendChild(expand)

  card.appendChild(header)

  const result = document.createElement("div")
  result.className = "tool-result"
  result.textContent = block.result || ""
  card.appendChild(result)

  header.addEventListener("click", () => {
    card.classList.toggle("expanded")
  })

  return card
}

export function renderDiffBlock(block: Block, messageId?: string, postMessage?: (msg: Record<string, unknown>) => void): HTMLDivElement {
  const wrapper = document.createElement("div")
  wrapper.className = "diff-block"

  const header = document.createElement("div")
  header.className = "diff-header"
  const filePath = document.createElement("span")
  filePath.className = "diff-file-path"
  filePath.textContent = block.filePath || "File Change"
  header.appendChild(filePath)
  wrapper.appendChild(header)

  const content = document.createElement("div")
  content.className = "diff-content"
  content.textContent = block.diffText || ""
  wrapper.appendChild(content)

  const actions = document.createElement("div")
  actions.className = "diff-actions"

  const acceptBtn = document.createElement("button")
  acceptBtn.className = "diff-btn diff-btn-accept"
  acceptBtn.textContent = "Accept"
  acceptBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    emitDiffAction(postMessage, { type: "accept_diff", messageId, blockId: block.id })
    acceptBtn.textContent = "Applied"
    acceptBtn.disabled = true
    rejectBtn.disabled = true
  })
  actions.appendChild(acceptBtn)

  const rejectBtn = document.createElement("button")
  rejectBtn.className = "diff-btn diff-btn-reject"
  rejectBtn.textContent = "Reject"
  rejectBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    emitDiffAction(postMessage, { type: "reject_diff", messageId, blockId: block.id })
    rejectBtn.textContent = "Rejected"
    rejectBtn.disabled = true
    acceptBtn.disabled = true
  })
  actions.appendChild(rejectBtn)

  wrapper.appendChild(actions)
  return wrapper
}

function emitDiffAction(postMessage: ((msg: Record<string, unknown>) => void) | undefined, msg: Record<string, unknown>): void {
  if (postMessage) { postMessage(msg); return }
  window.dispatchEvent(new CustomEvent("oc-diff-action", { detail: msg }))
}

function renderPermissionBlock(block: Block): HTMLDivElement {
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
    allowBtn.className = "permission-btn permission-btn-allow"
    allowBtn.textContent = "Allow"
    allowBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("oc-permission", { detail: { permissionId: block.permissionId, response: "once" } }))
      actions.replaceChildren(document.createTextNode("Allowed"))
    })
    actions.appendChild(allowBtn)
    
    const denyBtn = document.createElement("button")
    denyBtn.className = "permission-btn permission-btn-deny"
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

function renderTaskBanner(block: Block): HTMLDivElement {
  const wrapper = document.createElement("div")
  const status = block.status || "success"
  wrapper.className = "task-banner " + status

  const icon = document.createElement("span")
  icon.className = "task-banner-icon"
  icon.innerHTML = status === "success" 
    ? '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>'
    : '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>'
  wrapper.appendChild(icon)

  const text = document.createElement("span")
  text.textContent = block.text || "Task Status Updated"
  wrapper.appendChild(text)

  return wrapper
}

function renderContextBlock(block: Block): HTMLDivElement {
  const wrapper = document.createElement("div")
  wrapper.className = "context-block"

  const header = document.createElement("div")
  header.className = "context-header"
  const toggle = document.createElement("span")
  toggle.className = "context-toggle"
  toggle.innerHTML = CHEVRON_SVG
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
