/**
 * Parsed subagent task invocation from the `task` tool's args.
 * Mirrors the backend bridge in StreamCoordinator.
 */
export interface SubagentInvocation {
  agentName: string
  purpose?: string
  prompt?: string
}

/** True when the tool name matches the subagent-spawning `task` tool. */
export function isSubagentToolName(name: string): boolean {
  return name === "task" || name === "delegate" || name.includes("subagent")
}

/**
 * Extract `{ agentName, purpose, prompt }` from the task tool's args.
 * The `task` tool can be called with either:
 *   - Standard: `{ subagent_type, description, prompt }` (recommended)
 *   - Legacy:   `{ name, purpose, prompt }` or `{ agent, instruction, task }`
 */
export function parseSubagentInvocation(rawArgs: unknown): SubagentInvocation {
  let parsed: Record<string, unknown>
  if (typeof rawArgs === "string") {
    try {
      const trimmed = rawArgs.trim()
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        parsed = JSON.parse(trimmed) as Record<string, unknown>
      } else {
        return { agentName: "subagent", prompt: trimmed }
      }
    } catch {
      parsed = { prompt: rawArgs }
    }
  } else {
    parsed = (rawArgs || {}) as Record<string, unknown>
  }

  const agentName =
    asString(parsed.subagent_type) ||
    asString(parsed.name) ||
    asString(parsed.agent) ||
    "subagent"
  const purpose =
    asString(parsed.description) ||
    asString(parsed.purpose) ||
    asString(parsed.task) ||
    ""
  const prompt =
    asString(parsed.prompt) ||
    asString(parsed.instruction) ||
    ""
  return { agentName, purpose, prompt }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined
}

/**
 * Map an opencode tool name to a display class for icon/color treatment.
 *
 * Canonical tool names (per https://opencode.ai/docs/tools/):
 *   read | write | edit | apply_patch | bash | grep | glob | lsp |
 *   skill | todowrite | webfetch | websearch | question
 *
 * Classes:
 *   - `write` — mutates the workspace (write, edit, apply_patch)
 *   - `exec`  — runs shell commands (bash, anything with "shell"/"exec" in the name)
 *   - `meta`  — workflow/orchestration (todowrite, skill, question, task)
 *   - `read`  — safe inspection (everything else: read, grep, glob, webfetch, websearch, lsp, …)
 *
 * Order of checks matters: `todowrite` contains "write" and would be
 * misclassified as `write` unless we check "todo" first. Same for `webwrite`
 * if it ever appears.
 */
export type ToolClass = "read" | "write" | "exec" | "meta"

export function classifyTool(toolName: string): ToolClass {
  if (!toolName) return "read"
  const lower = toolName.toLowerCase()

  // Workflow/meta tools first — these often have substrings that overlap
  // with write/exec classes (e.g. `todowrite` includes "write").
  if (lower.includes("todo") || lower === "skill" || lower === "question" || lower.includes("task")) {
    return "meta"
  }

  if (lower.includes("bash") || lower.includes("shell") || lower.includes("exec") || lower.includes("run_command")) {
    return "exec"
  }

  if (lower.includes("edit") || lower.includes("write") || lower.includes("patch")) {
    return "write"
  }

  return "read"
}
