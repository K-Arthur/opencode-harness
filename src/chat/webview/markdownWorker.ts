import hljs from "highlight.js/lib/core"
import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"
import { escapeHtml, normalizeMarkdownLanguage } from "./htmlUtils"
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

type RenderRequest = {
  id: number
  text: string
}

type HighlightRequest = {
  id: number
  code: string
  language: string
  type: "highlight"
}

type WorkerRequest = RenderRequest | HighlightRequest

type WorkerResponse =
  | { id: number; html: string }
  | { id: number; error: string }

let registered = false
// markdown-it 15 ships MarkdownIt as a value-only export; use InstanceType
// for the instance type (a bare `MarkdownIt` annotation is no longer a type).
let md: InstanceType<typeof MarkdownIt> | undefined

function ensureLanguagesRegistered() {
  if (registered) return
  registered = true
  registerAllLanguages()
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const id = Number(event.data?.id)
  if (!Number.isFinite(id)) return

  try {
    ensureLanguagesRegistered()
    if (event.data && (event.data as HighlightRequest).type === "highlight") {
      const { code, language } = event.data as HighlightRequest
      const html = highlightSyntax(code, language)
      const response: WorkerResponse = { id, html }
      self.postMessage(response)
      return
    }
    const text = typeof (event.data as RenderRequest).text === "string" ? (event.data as RenderRequest).text : ""
    const response: WorkerResponse = { id, html: getMarkdown().render(text) }
    self.postMessage(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker request failed"
    const response: WorkerResponse = { id, error: message }
    self.postMessage(response)
  }
}

function registerAllLanguages() {
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
}

// markdown-it 15 renderer rules are strictly typed; keep a minimal structural
// view of the Token surface the link rules touch instead of importing the
// package-internal types (the CJS entry only exports the MarkdownIt value).
type LinkRuleToken = {
  attrGet(name: string): string | number | null
  attrSet(name: string, value: string | number): void
}
type LinkRuleSelf = { renderToken(tokens: LinkRuleToken[], idx: number, options: unknown): string }
type LinkOpenRule = (tokens: LinkRuleToken[], idx: number, options: unknown, env: unknown, self: LinkRuleSelf) => string

function getMarkdown(): InstanceType<typeof MarkdownIt> {
  if (md) return md
  md = new MarkdownIt/* lazy */({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight: (str, lang) => highlightSyntax(str, lang || ""),
  }).use(taskLists, { label: false })

  const defaultLinkOpen: LinkOpenRule = (tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options)
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (!token) return defaultLinkOpen(tokens, idx, options, env, self)
    const href = String(token.attrGet("href") ?? "")
    if (/^(https?|ftp):/i.test(href)) {
      token.attrSet("target", "_blank")
      token.attrSet("rel", "noopener noreferrer")
    } else if (/^(mailto|tel):/i.test(href)) {
      // leave default
    } else if (href.startsWith("#")) {
      // in-document fragment; leave default
    } else if (href !== "") {
      token.attrSet("href", "#")
      token.attrSet("class", "file-link")
      token.attrSet("data-file-path", href)
      token.attrSet("role", "button")
      token.attrSet("tabindex", "0")
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }
  return md
}

// Mirror of MAX_HIGHLIGHT_CHARS in syntaxHighlighter.ts. Off-thread here, so it
// does not jank the UI, but it still avoids wasted CPU and a delayed worker
// response when a pathological large block (e.g. a huge no-language paste) would
// otherwise hit highlightAuto() against every registered grammar.
const MAX_HIGHLIGHT_CHARS = 50_000

function highlightSyntax(code: string, language: string): string {
  if (code.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(code)
  const normalized = normalizeMarkdownLanguage(language)
  try {
    if (normalized && hljs.getLanguage(normalized)) {
      return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}
