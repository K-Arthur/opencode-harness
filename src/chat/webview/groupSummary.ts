/**
 * buildGroupSummaryLabel — produce a human-readable summary for a group of
 * consecutive tool calls, e.g. "3 file reads, 1 search, 2 file edits".
 *
 * This replaces the raw class-name breakdown "(2 read, 1 exec)" and the
 * first-tool-name fallback ("read" / "tools") that previously appeared in
 * renderToolGroup().
 */
import type { Block } from "./types"

type ActionCategory =
  | "file read"
  | "search"
  | "web lookup"
  | "file edit"
  | "command"
  | "todo update"
  | "inspection"
  | "tool call"  // unknown fallback

const PLURAL: Record<ActionCategory, string> = {
  "file read": "file reads",
  "search": "searches",
  "web lookup": "web lookups",
  "file edit": "file edits",
  "command": "commands",
  "todo update": "todo updates",
  "inspection": "inspections",
  "tool call": "tool calls",
}

function categorize(block: Block): ActionCategory {
  const name = ((block.name as string | undefined) ?? "").toLowerCase()
  const cls = ((block.class as string | undefined) ?? "read").toLowerCase()

  // Web tools (before generic read to take priority)
  if (name.includes("websearch") || name.includes("web_search")) return "web lookup"
  if (name.includes("webfetch") || name === "fetch" || name.includes("web_fetch")) return "web lookup"

  // Search tools
  if (name.includes("grep") || name.includes("glob") || name.includes("ripgrep")) return "search"
  if (name === "search" || name.includes("find_")) return "search"

  // LSP / code inspection
  if (name.includes("lsp") || name.includes("hover") || name.includes("diagnostic") ||
      name.includes("definition") || name.includes("reference") || name.includes("inspect")) {
    return "inspection"
  }

  // Todo tools
  if (name.includes("todo")) return "todo update"

  // Exec class → command
  if (cls === "exec") return "command"
  // Common bash/shell names even if misclassified
  if (name === "bash" || name === "shell" || name.includes("command") || name.includes("terminal") ||
      name.includes("run_") || name.includes("execute")) return "command"

  // Write class → file edit
  if (cls === "write") return "file edit"
  if (name.includes("write") || name.includes("edit") || name.includes("patch") ||
      name.includes("apply") || name.includes("create_file") || name.includes("delete_file")) return "file edit"

  // Read class with explicit file indicators → file read
  if (cls === "read") {
    if (name.includes("read") || name === "cat" || name === "open" || name === "view" ||
        name.includes("file") || name.includes("list") || name === "ls") return "file read"
    // Generic read-class without a more specific match
    return "file read"
  }

  return "tool call"
}

function plural(n: number, singular: ActionCategory): string {
  return n === 1 ? `1 ${singular}` : `${n} ${PLURAL[singular]}`
}

/**
 * Builds a compact, human-readable summary for a tool call group.
 * Returns "" for empty input.
 */
export function buildGroupSummaryLabel(blocks: Block[]): string {
  if (blocks.length === 0) return ""

  // Count by category, preserving insertion order.
  const counts = new Map<ActionCategory, number>()
  for (const block of blocks) {
    const cat = categorize(block)
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }

  const parts: string[] = []
  for (const [cat, n] of counts) {
    parts.push(plural(n, cat))
  }
  return parts.join(", ")
}
