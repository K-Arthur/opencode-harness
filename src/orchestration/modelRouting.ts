export type AgentRole = "planning" | "implementation" | "review" | "debugging"

export interface RoleInferenceInput {
  explicitRole?: string
  mode?: string
  promptText?: string
}

export interface RoutedModelInput {
  role: AgentRole
  mode?: string
  sessionModel?: string
  currentModel?: string
  workspaceRoleModels?: Partial<Record<AgentRole, string>>
  settingsRoleModels?: Partial<Record<AgentRole, string>>
  workspaceModeModels?: Record<string, string>
  settingsModeModels?: Record<string, string>
}

const ROLE_ALIASES: Record<string, AgentRole> = {
  plan: "planning",
  planning: "planning",
  planner: "planning",
  design: "planning",
  architecture: "planning",
  build: "implementation",
  code: "implementation",
  coding: "implementation",
  implement: "implementation",
  implementation: "implementation",
  act: "implementation",
  review: "review",
  reviewer: "review",
  "code-review": "review",
  codereview: "review",
  audit: "review",
  debug: "debugging",
  debugger: "debugging",
  debugging: "debugging",
  fix: "debugging",
}

const DEBUGGING_RE = /\b(debug|bug|failing|failure|failed|error|exception|stack trace|regression|flaky|crash|timeout)\b/i
const REVIEW_RE = /\b(review|audit|security|pr|pull request|diff|regression risk|code health|quality pass)\b/i
const PLANNING_RE = /\b(plan|design|architecture|strategy|break down|scope|proposal|approach|roadmap)\b/i

export function normalizeAgentRole(value: string | undefined): AgentRole | undefined {
  const key = value?.trim().toLowerCase()
  if (!key) return undefined
  return ROLE_ALIASES[key]
}

export function inferAgentRole(input: RoleInferenceInput): AgentRole {
  const explicit = normalizeAgentRole(input.explicitRole)
  if (explicit) return explicit

  const modeRole = normalizeAgentRole(input.mode)
  if (modeRole && modeRole !== "implementation") return modeRole

  const promptText = input.promptText ?? ""
  if (DEBUGGING_RE.test(promptText)) return "debugging"
  if (REVIEW_RE.test(promptText)) return "review"
  if (PLANNING_RE.test(promptText)) return "planning"
  return modeRole ?? "implementation"
}

function cleanModel(model: string | undefined): string | undefined {
  const trimmed = model?.trim()
  return trimmed ? trimmed : undefined
}

function lookupModel(map: Record<string, string> | Partial<Record<AgentRole, string>> | undefined, key: string | undefined): string | undefined {
  if (!map || !key) return undefined
  return cleanModel(map[key as keyof typeof map] as string | undefined)
}

export function resolveRoutedModel(input: RoutedModelInput): string {
  return (
    lookupModel(input.workspaceRoleModels, input.role) ??
    lookupModel(input.settingsRoleModels, input.role) ??
    lookupModel(input.workspaceModeModels, input.mode) ??
    lookupModel(input.settingsModeModels, input.mode) ??
    cleanModel(input.sessionModel) ??
    cleanModel(input.currentModel) ??
    ""
  )
}
