import type { ModelCapabilities } from "../methodology/types"
import { isCapableForRole, scaffoldingForRole, type AutonomyGuidance } from "./capabilityProfiles"

export type AgentRole = "planning" | "implementation" | "review" | "debugging" | "visualReview"

export interface RoleInferenceInput {
  explicitRole?: string
  mode?: string
  promptText?: string
  /**
   * When false, skip the keyword-based sniffing of `promptText` (the
   * DEBUGGING_RE/REVIEW_RE/PLANNING_RE checks below) — an ordinary message
   * that happens to contain a word like "bug" or "review" must not silently
   * reroute to a different model. An explicit role (from the per-message
   * route selector) or the session mode still applies; only the implicit,
   * invisible inference is suppressed. Defaults to true for callers that
   * don't pass it (back-compat).
   */
  enableTextInference?: boolean
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
  /**
   * Master switch for role-based routing (the Model Routing settings
   * panel). When false, role overrides are ignored entirely and resolution
   * falls straight through to mode/session/current model — matching what
   * happens when the user has configured no role models at all. Defaults to
   * true for callers that don't pass it (back-compat).
   */
  roleRoutingEnabled?: boolean
}

const ROLE_ALIASES: Record<string, AgentRole> = {
  plan: "planning",
  planning: "planning",
  planner: "planning",
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
  "visual-review": "visualReview",
  visualreview: "visualReview",
  "visual review": "visualReview",
  "ui-review": "visualReview",
  uireview: "visualReview",
  design: "planning",
  "design-review": "visualReview",
  designreview: "visualReview",
}

const DEBUGGING_RE = /\b(debug|bug|failing|failure|failed|error|exception|stack trace|regression|flaky|crash|timeout)\b/i
const REVIEW_RE = /\b(review|audit|security|pr|pull request|diff|regression risk|code health|quality pass)\b/i
const PLANNING_RE = /\b(plan|design|architecture|strategy|break down|scope|proposal|approach|roadmap)\b/i
const VISUAL_REVIEW_RE = /\b(visual|design review|ui review|appearance|screenshot|layout|css review|style check|responsive|frontend review)\b/i

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

  if (input.enableTextInference === false) return modeRole ?? "implementation"

  const promptText = input.promptText ?? ""
  if (VISUAL_REVIEW_RE.test(promptText)) return "visualReview"
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
  const roleRoutingEnabled = input.roleRoutingEnabled !== false
  return (
    (roleRoutingEnabled ? lookupModel(input.workspaceRoleModels, input.role) : undefined) ??
    (roleRoutingEnabled ? lookupModel(input.settingsRoleModels, input.role) : undefined) ??
    lookupModel(input.workspaceModeModels, input.mode) ??
    lookupModel(input.settingsModeModels, input.mode) ??
    cleanModel(input.sessionModel) ??
    cleanModel(input.currentModel) ??
    ""
  )
}

// ─── Capability-Aware Routing ─────────────────────────────────────────────

export interface CapabilityAwareInput extends RoutedModelInput {
  /** The model's capability profile, if known */
  capabilities?: ModelCapabilities
  /** Whether to gate on capability thresholds (default false) */
  enableCapabilityGating?: boolean
  /** Whether to return autonomy scaffolding guidance */
  enableAutonomyGuidance?: boolean
}

export interface CapabilityAwareResult {
  /** The resolved model ID (empty string if none found) */
  model: string
  /** Whether capability gating was applied */
  capabilityGated: boolean
  /** Capability check result */
  capabilityCheck: { capable: boolean; reason?: string }
  /** Autonomy guidance for structuring delegated prompts */
  autonomyGuidance: AutonomyGuidance | null
  /** Suggested prompt prefix for scaffolding */
  promptPrefix: string
}

/**
 * Resolve a model with capability-aware checks.
 * Extends the standard `resolveRoutedModel` with:
 * 1. Capability gating: checks whether the resolved model has sufficient
 *    capabilities for the role before allowing it.
 * 2. Autonomy scaffolding: when a lower-autonomy model is selected,
 *    returns guidance on how to structure the delegated prompt.
 */
export function resolveCapabilityAwareModel(input: CapabilityAwareInput): CapabilityAwareResult {
  const model = resolveRoutedModel(input)
  const enableGating = input.enableCapabilityGating === true
  const enableScaffolding = input.enableAutonomyGuidance !== false

  // Default: assume capable if no gating or no capabilities data
  let capabilityCheck: { capable: boolean; reason?: string } = { capable: true }
  let autonomyGuidance: AutonomyGuidance | null = null
  let promptPrefix = ''

  if (input.capabilities && enableGating) {
    capabilityCheck = isCapableForRole(input.capabilities, input.role)
  }

  if (input.capabilities && enableScaffolding) {
    const scaffold = scaffoldingForRole(input.capabilities, input.role)
    autonomyGuidance = scaffold.guidance
    promptPrefix = scaffold.promptPrefix
  }

  const result: CapabilityAwareResult = {
    model,
    capabilityGated: enableGating,
    capabilityCheck,
    autonomyGuidance,
    promptPrefix,
  }

  return result
}
