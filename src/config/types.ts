/**
 * Workspace-level configuration parsed from `opencode.jsonc` (or `opencode.json`).
 *
 * Supports the opencode CLI schema (`model`, `small_model`, `provider`, `mcp`,
 * `plugin`) plus extension-specific keys for workspace-aware behavior:
 * - `models` / `modelOverrides` / `roleModelOverrides`: control the model selector and routing overrides
 * - `ignore` / `exclude`: glob patterns to filter out of the file index
 * - `rules` / `instructions`: behavioral rules appended to system prompts
 *
 * Unknown keys are preserved via the index signature for forward compatibility.
 */
export interface WorkspaceConfig {
  /** Default model ID in `provider/model` format (opencode CLI schema). */
  model?: string
  /** Small/fast model ID for lightweight tasks (opencode CLI schema). */
  small_model?: string
  /** Provider → models map for workspace-specific model availability. */
  models?: Record<string, unknown>
  /** Mode → modelId overrides (e.g. `{ "plan": "anthropic/claude-..." }`). */
  modelOverrides?: Record<string, string>
  /** Agent role → modelId overrides (e.g. `{ "review": "anthropic/claude-..." }`). */
  roleModelOverrides?: Record<string, string>
  /** Prompt masking defaults for this workspace. */
  masking?: {
    enabled?: boolean
    maxPromptTokens?: number
    reserveTokens?: number
    exclude?: string[]
  }
  /** Glob patterns to exclude from the workspace file index. */
  ignore?: string[]
  /** Alias for `ignore` — merged with `ignore` if both present. */
  exclude?: string[]
  /** Behavioral rules appended to system prompts sent to the LLM. */
  rules?: string[]
  /** Project description or instructions string appended to system prompts. */
  instructions?: string
  /** Provider configurations (opencode CLI schema). */
  provider?: Record<string, unknown>
  /** MCP server configurations (opencode CLI schema). */
  mcp?: Record<string, unknown>
  /** Plugin configurations (opencode CLI schema). */
  plugin?: unknown
  /** Forward compatibility — unknown keys preserved, never crash. */
  [key: string]: unknown
}

/**
 * Status of the last config load operation.
 * - `"ok"`: config file found and parsed successfully
 * - `"parse_error"`: config file found but contained invalid JSONC
 * - `"not_found"`: no config file discovered in the workspace
 */
export type ConfigLoadStatus = "ok" | "parse_error" | "not_found"

/**
 * Result of loading a workspace config file.
 */
export interface ConfigLoadResult {
  config: WorkspaceConfig
  status: ConfigLoadStatus
  /** Path of the config file that was loaded (undefined if not found). */
  path?: string
  /** Parse errors if status is "parse_error". */
  errors: string[]
}
