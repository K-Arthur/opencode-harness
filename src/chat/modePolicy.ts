export const SESSION_MODES = ["plan", "build", "auto"] as const
export type SessionMode = (typeof SESSION_MODES)[number]

const SESSION_MODE_SET = new Set<string>(SESSION_MODES)
const FILE_MUTATION_PERMISSION_TYPES = new Set(["edit", "write", "patch", "apply_patch", "multiedit"])
const MUTATING_PERMISSION_TYPES = new Set([
  ...FILE_MUTATION_PERMISSION_TYPES,
  "bash",
  "external_directory",
])

export type PlanPermissionDecision = "once" | "reject"

export function normalizeSessionMode(mode: unknown): SessionMode | null {
  if (mode === "normal") return "build"
  if (typeof mode !== "string") return null
  return SESSION_MODE_SET.has(mode) ? mode as SessionMode : null
}

export function isPlanDocumentPattern(pattern: string | string[] | undefined): boolean {
  if (!pattern) return false
  const patterns = Array.isArray(pattern) ? pattern : [pattern]
  return patterns.some((entry) => entry.startsWith(".opencode/plans/") && entry.endsWith(".md"))
}

export function isMutatingPermissionType(type: string | undefined): boolean {
  return typeof type === "string" && MUTATING_PERMISSION_TYPES.has(type.toLowerCase())
}

export function isFileMutationPermissionType(type: string | undefined): boolean {
  return typeof type === "string" && FILE_MUTATION_PERMISSION_TYPES.has(type.toLowerCase())
}

export function resolvePlanPermission(data: {
  type?: string
  permissionType?: string
  pattern?: string | string[]
}): PlanPermissionDecision {
  const type = data.type ?? data.permissionType
  if (!type) return "reject"

  if (isFileMutationPermissionType(type) && isPlanDocumentPattern(data.pattern)) {
    return "once"
  }

  return isMutatingPermissionType(type) ? "reject" : "once"
}
