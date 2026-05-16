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
