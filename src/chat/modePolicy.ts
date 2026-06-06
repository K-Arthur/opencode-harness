export const SESSION_MODES = ["plan", "build", "auto"] as const
export type SessionMode = (typeof SESSION_MODES)[number]
export const DEFAULT_MODE: SessionMode = "build"

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

export const PROTECTED_PATH_PATTERNS = [
  ".git/",
  ".vscode/",
  ".opencode/",
  "node_modules/",
  ".env",
  ".env.local",
  ".env.production",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
] as const

export function isProtectedPath(filePath: string | string[] | undefined): boolean {
  if (!filePath) return false
  const paths = Array.isArray(filePath) ? filePath : [filePath]
  return paths.some((p) =>
    PROTECTED_PATH_PATTERNS.some(
      (pattern) => p === pattern || p.startsWith(pattern),
    ),
  )
}

export function resolvePermissionForMode(
  mode: SessionMode | null | undefined,
  data: { type?: string; permissionType?: string; pattern?: string | string[] },
): "once" | "reject" | "prompt" {
  if (!mode) return "prompt"
  if (mode === "auto") return "once"
  if (mode === "plan") return resolvePlanPermission(data)
  if (mode === "build" && isProtectedPath(data.pattern)) return "reject"
  return "prompt"
}
