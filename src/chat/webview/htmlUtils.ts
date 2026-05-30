export function escapeHtml(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function normalizeMarkdownLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (normalized === "tsx" || normalized === "jsx") return "typescript"
  if (normalized === "shell" || normalized === "sh" || normalized === "zsh") return "bash"
  if (normalized === "yml") return "yaml"
  if (normalized === "html" || normalized === "htm") return "xml"
  if (normalized === "c#" || normalized === "cs") return "cpp"
  if (normalized === "c++") return "cpp"
  if (normalized === "rb") return "ruby"
  if (normalized === "kt") return "kotlin"
  if (normalized === "py") return "python"
  if (normalized === "js" || normalized === "node") return "javascript"
  if (normalized === "ts") return "typescript"
  return normalized
}
