import { normalizeSessionMode } from "./modePolicy"

export interface WebviewMessageValidatorDeps {
  hasPromptContent: (msg: Record<string, unknown>) => boolean
  isValidThemeConfigPayload: (theme: unknown) => boolean
  warn: (message: string) => void
}

type MessageValidator = (
  msg: Record<string, unknown>,
  msgType: string,
  deps: WebviewMessageValidatorDeps
) => boolean

const MODE_VALUES = new Set(["normal", "plan", "build", "auto"])
const STEER_MODE_VALUES = new Set(["interrupt", "append", "queue"])

function reject(deps: WebviewMessageValidatorDeps, message: string): false {
  deps.warn(message)
  return false
}

function hasString(msg: Record<string, unknown>, key: string): boolean {
  return typeof msg[key] === "string" && msg[key] !== ""
}

function invalidRequiredString(
  msg: Record<string, unknown>,
  key: string,
  message: string,
  deps: WebviewMessageValidatorDeps
): boolean {
  if (hasString(msg, key)) return false
  reject(deps, message)
  return true
}

function invalidOptionalString(
  msg: Record<string, unknown>,
  key: string,
  message: string,
  deps: WebviewMessageValidatorDeps,
  maxLength?: number
): boolean {
  const value = msg[key]
  if (value === undefined) return false
  if (typeof value !== "string") {
    reject(deps, message)
    return true
  }
  if (maxLength !== undefined && value.length > maxLength) {
    reject(deps, message)
    return true
  }
  return false
}

function invalidOptionalNumber(
  msg: Record<string, unknown>,
  key: string,
  message: string,
  deps: WebviewMessageValidatorDeps
): boolean {
  if (msg[key] === undefined || typeof msg[key] === "number") return false
  reject(deps, message)
  return true
}

function validateSendPrompt(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  const text = msg.text
  if (text !== undefined && typeof text !== "string") {
    return reject(deps, `Rejected send_prompt: invalid text type (${typeof text})`)
  }
  if (typeof text === "string" && text.length > 50000) {
    return reject(deps, "Rejected oversized prompt")
  }
  if (!deps.hasPromptContent(msg)) {
    const attachmentCount = Array.isArray(msg.attachments) ? msg.attachments.length : 0
    return reject(deps, `Rejected send_prompt: no content (textType=${typeof text}, textLength=${typeof text === "string" ? text.length : "N/A"}, attachments=${attachmentCount})`)
  }
  return true
}

function validateMentionSearch(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidOptionalString(msg, "query", "Rejected oversized mention search query", deps, 500)) return false
  return true
}

function validateChangeMode(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  const mode = msg.mode
  if (typeof mode !== "string" || !MODE_VALUES.has(mode) || !normalizeSessionMode(mode)) {
    return reject(deps, `Invalid mode: ${String(mode)}`)
  }
  return true
}

function validateThemeConfig(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (!deps.isValidThemeConfigPayload(msg.theme)) {
    return reject(deps, "Rejected invalid theme config payload")
  }
  return true
}

function validateModelVariant(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidOptionalString(msg, "model", "Invalid model type", deps)) return false
  if (invalidOptionalString(msg, "variant", "Invalid variant type", deps)) return false
  return true
}

function validateModelFavorite(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  return !invalidRequiredString(msg, "modelId", "Invalid modelId in model_favorite", deps)
}

function validateModelToggle(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "modelId", "Invalid modelId or enabled in model_toggle", deps)) return false
  if (typeof msg.enabled !== "boolean") return reject(deps, "Invalid modelId or enabled in model_toggle")
  return true
}

function validateEditMessage(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "messageId", "Invalid messageId in edit_message", deps)) return false
  if (invalidOptionalString(msg, "text", "Invalid text type in edit_message", deps)) return false
  return true
}

function validateRenameSession(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  const name = msg.name
  if (typeof name !== "string" || name === "" || name.length > 200) {
    return reject(deps, "Invalid session name")
  }
  return true
}

function requiredStringValidator(key: string, messageForType: (msgType: string) => string): MessageValidator {
  return (msg, msgType, deps) => !invalidRequiredString(msg, key, messageForType(msgType), deps)
}

function validateProviderAdd(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "name", "Invalid name in add_provider", deps)) return false
  if (invalidRequiredString(msg, "apiKey", "Invalid apiKey in add_provider", deps)) return false
  return true
}

function validateProviderUpdate(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "id", "Invalid id in update_provider", deps)) return false
  if (!msg.updates || typeof msg.updates !== "object") return reject(deps, "Invalid updates in update_provider")
  return true
}

function validateToggleMcpServer(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "name", "Invalid name in toggle_mcp_server", deps)) return false
  if (typeof msg.disabled !== "boolean") return reject(deps, "Invalid disabled flag in toggle_mcp_server")
  return true
}

function validateMcpServerConfig(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "name", `Invalid name in ${msgType}`, deps)) return false
  if (!msg.config || typeof msg.config !== "object") return reject(deps, `Invalid config in ${msgType}`)
  return true
}

function validateDiffDecision(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (!hasString(msg, "diffId") && !hasString(msg, "blockId")) {
    return reject(deps, `Missing diffId/blockId in ${msgType}`)
  }
  return true
}

function validateAcceptPermission(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "permissionId", "Invalid permissionId in accept_permission", deps)) return false
  if (invalidRequiredString(msg, "response", "Invalid response in accept_permission", deps)) return false
  return true
}

function validateShowDiff(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (hasString(msg, "diffId")) return true
  if (invalidRequiredString(msg, "filePath", "Invalid filePath in show_diff", deps)) return false
  if (invalidRequiredString(msg, "proposedContent", "Invalid proposedContent in show_diff", deps)) return false
  return true
}

function validateCodeExport(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "code", `Invalid code in ${msgType}`, deps)) return false
  if (invalidRequiredString(msg, "language", `Invalid language in ${msgType}`, deps)) return false
  return true
}

function validateForkSession(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (typeof msg.turnIndex !== "number" || !Number.isInteger(msg.turnIndex) || msg.turnIndex < 0) {
    return reject(deps, "Invalid turnIndex in fork_session")
  }
  return true
}

function validateRevertDiff(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "diffId", "Invalid diffId in revert_diff", deps)) return false
  if (invalidRequiredString(msg, "path", "Invalid path in revert_diff", deps)) return false
  return true
}

function validateContextCost(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  return !invalidOptionalNumber(msg, "pendingTokens", "Invalid pendingTokens in context_cost_estimate", deps)
}

function validateContextHistory(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  return !invalidOptionalNumber(msg, "days", `Invalid days in ${msgType}`, deps)
}

function validateRequestMoreMessages(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidOptionalNumber(msg, "beforeIndex", "Invalid beforeIndex in request_more_messages", deps)) return false
  if (invalidOptionalNumber(msg, "limit", "Invalid limit in request_more_messages", deps)) return false
  return true
}

function validateUpdateCost(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  const cost = msg.cost
  if (cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) {
    return reject(deps, "Invalid cost value")
  }
  return true
}

function validateOptionalEnabled(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (msg.enabled !== undefined && typeof msg.enabled !== "boolean") {
    return reject(deps, `Invalid enabled flag in ${msgType}`)
  }
  return true
}

function validateSendSteerPrompt(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (msg.text !== undefined && typeof msg.text !== "string") {
    return reject(deps, "Invalid text in send_steer_prompt")
  }
  if (!deps.hasPromptContent(msg)) {
    return reject(deps, "Invalid text in send_steer_prompt")
  }
  const mode = msg.mode
  if (mode !== undefined && (typeof mode !== "string" || !STEER_MODE_VALUES.has(mode))) {
    return reject(deps, "Invalid mode in send_steer_prompt")
  }
  return true
}

const WEBVIEW_MESSAGE_VALIDATORS: Record<string, MessageValidator> = {
  send_prompt: validateSendPrompt,
  mention_search: validateMentionSearch,
  change_mode: validateChangeMode,
  update_theme_config: validateThemeConfig,
  set_model: validateModelVariant,
  set_variant: validateModelVariant,
  model_favorite: validateModelFavorite,
  model_toggle: validateModelToggle,
  edit_message: validateEditMessage,
  rename_session: validateRenameSession,
  compact_banner_action: requiredStringValidator("action", () => "Invalid action in compact_banner_action"),
  execute_command: requiredStringValidator("command", () => "Invalid command in execute_command"),
  restore_checkpoint: requiredStringValidator("checkpointId", () => "Invalid checkpointId in restore_checkpoint"),
  delete_stash: requiredStringValidator("id", (msgType) => `Invalid id in ${msgType}`),
  delete_provider: requiredStringValidator("id", (msgType) => `Invalid id in ${msgType}`),
  add_provider: validateProviderAdd,
  update_provider: validateProviderUpdate,
  toggle_mcp_server: validateToggleMcpServer,
  add_mcp_server: validateMcpServerConfig,
  update_mcp_server: validateMcpServerConfig,
  remove_mcp_server: requiredStringValidator("name", () => "Invalid name in remove_mcp_server"),
  accept_diff: validateDiffDecision,
  reject_diff: validateDiffDecision,
  accept_permission: validateAcceptPermission,
  open_file: requiredStringValidator("path", () => "Invalid path in open_file"),
  open_folder: requiredStringValidator("dir", () => "Invalid dir in open_folder"),
  open_url: requiredStringValidator("url", () => "Invalid url in open_url"),
  show_diff: validateShowDiff,
  insert_at_cursor: validateCodeExport,
  create_file_from_code: validateCodeExport,
  fork_session: validateForkSession,
  revert_diff: validateRevertDiff,
  accept_hunk: requiredStringValidator("hunkId", (msgType) => `Invalid hunkId in ${msgType}`),
  reject_hunk: requiredStringValidator("hunkId", (msgType) => `Invalid hunkId in ${msgType}`),
  context_cost_estimate: validateContextCost,
  context_history_request: validateContextHistory,
  context_suggestions_request: validateContextHistory,
  request_more_messages: validateRequestMoreMessages,
  delete_session: requiredStringValidator("targetSessionId", (msgType) => `Invalid targetSessionId in ${msgType}`),
  archive_session: requiredStringValidator("targetSessionId", (msgType) => `Invalid targetSessionId in ${msgType}`),
  resume_server_session: requiredStringValidator("serverSessionId", () => "Invalid serverSessionId in resume_server_session"),
  delete_server_session: requiredStringValidator("serverSessionId", () => "Invalid serverSessionId in delete_server_session"),
  update_cost: validateUpdateCost,
  toggle_diff_wrap: validateOptionalEnabled,
  toggle_thinking: validateOptionalEnabled,
  update_setting: requiredStringValidator("key", () => "Invalid key in update_setting"),
  send_steer_prompt: validateSendSteerPrompt,
}

export function validateWebviewMessage(
  msg: Record<string, unknown>,
  msgType: string,
  deps: WebviewMessageValidatorDeps
): boolean {
  return WEBVIEW_MESSAGE_VALIDATORS[msgType]?.(msg, msgType, deps) ?? true
}
