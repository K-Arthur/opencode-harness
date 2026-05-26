import hljs from "highlight.js/lib/core"
import DOMPurify from "dompurify"
import { normalizeMarkdownLanguage } from "./htmlUtils"

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

class HighlightCache {
  private map = new Map<string, string>()

  constructor(private readonly maxEntries: number) {}

  get(key: string): string | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}

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

const highlightCache = new HighlightCache(500)

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

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG as any) as unknown as string
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

export function clearHighlightCache(): void {
  highlightCache.clear()
}

export function getHighlightCacheSize(): number {
  return highlightCache.size
}
