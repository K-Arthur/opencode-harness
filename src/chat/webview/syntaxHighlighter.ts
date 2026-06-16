import DOMPurify from "dompurify"

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
  return DOMPurify.sanitize(html, PURIFY_CONFIG as any) as unknown as string
}
