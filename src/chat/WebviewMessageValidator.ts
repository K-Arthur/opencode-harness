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
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const MCP_COMMAND_PATTERN = /^[A-Za-z0-9@._/\\:-]+$/
const MCP_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isSafeStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string" && !/[\u0000-\u001F\u007F]/.test(item) && item.length <= 500))
}

function isSafeStringRecord(value: unknown, keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/): boolean {
  if (value === undefined) return true
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(([key, raw]) => keyPattern.test(key) && typeof raw === "string" && !/[\u0000-\u001F\u007F]/.test(raw) && raw.length <= 4000)
}

function isSafeRemoteUrl(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== "string" || /[\u0000-\u001F\u007F]/.test(value)) return false
  try {
    const parsed = new URL(value)
    const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1"
    return (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback))
  } catch {
    return false
  }
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
  if (!MCP_SERVER_NAME_PATTERN.test(msg.name as string)) return reject(deps, `Invalid name in ${msgType}`)
  if (!isPlainObject(msg.config)) return reject(deps, `Invalid config in ${msgType}`)

  const config = msg.config
  const command = config.command
  const url = config.url
  if (command !== undefined && (typeof command !== "string" || !MCP_COMMAND_PATTERN.test(command) || command.includes("..") || /[\u0000-\u001F\u007F]/.test(command))) {
    return reject(deps, `Invalid command in ${msgType}`)
  }
  if (command === undefined && url === undefined && msgType === "add_mcp_server") {
    return reject(deps, `Missing command or url in ${msgType}`)
  }
  if (!isSafeRemoteUrl(url)) return reject(deps, `Invalid url in ${msgType}`)
  if (!isSafeStringArray(config.args)) return reject(deps, `Invalid args in ${msgType}`)
  if (!isSafeStringRecord(config.env)) return reject(deps, `Invalid env in ${msgType}`)
  if (!isSafeStringRecord(config.headers, MCP_HEADER_NAME_PATTERN)) return reject(deps, `Invalid headers in ${msgType}`)
  if (config.disabled !== undefined && typeof config.disabled !== "boolean") return reject(deps, `Invalid disabled in ${msgType}`)
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") return reject(deps, `Invalid enabled in ${msgType}`)
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

function validatePinSession(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (!requiredStringValidator("targetSessionId", (type) => `Invalid targetSessionId in ${type}`)(msg, msgType, deps)) {
    return false
  }
  if (typeof msg.pinned !== "boolean") {
    return reject(deps, "Invalid pinned flag in pin_session")
  }
  return true
}

function validateSessionTags(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (!requiredStringValidator("targetSessionId", (type) => `Invalid targetSessionId in ${type}`)(msg, msgType, deps)) {
    return false
  }
  if (!Array.isArray(msg.tags) || msg.tags.some((tag) => typeof tag !== "string") || msg.tags.length > 20) {
    return reject(deps, "Invalid tags in set_session_tags")
  }
  return true
}

function validateOpenTerminal(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (typeof msg.command !== "string" || !msg.command.trim()) {
    return reject(deps, "Invalid command in open_terminal")
  }
  if (msg.cwd !== undefined && typeof msg.cwd !== "string") {
    return reject(deps, "Invalid cwd in open_terminal")
  }
  if (msg.autorun !== undefined && typeof msg.autorun !== "boolean") {
    return reject(deps, "Invalid autorun flag in open_terminal")
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

function validateVoiceRequest(msg: Record<string, unknown>, msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (typeof msg.requestId !== "string" || msg.requestId.trim().length === 0 || msg.requestId.length > 120) {
    return reject(deps, `Invalid requestId in ${msgType}`)
  }
  return true
}

function validatePlanComplete(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "sessionId", "Invalid sessionId in plan_complete", deps)) return false
  return true
}

function validateModeSwitchRequest(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (invalidRequiredString(msg, "sessionId", "Invalid sessionId in mode_switch_request", deps)) return false
  const targetMode = msg.targetMode
  if (targetMode !== "plan" && targetMode !== "build" && targetMode !== "auto") {
    return reject(deps, `Invalid targetMode in mode_switch_request: ${String(targetMode)}`)
  }
  return true
}

function validateCopyText(msg: Record<string, unknown>, _msgType: string, deps: WebviewMessageValidatorDeps): boolean {
  if (typeof msg.text !== "string" || !msg.text.trim()) {
    return reject(deps, "Invalid text in copy_text")
  }
  return true
}

const WEBVIEW_MESSAGE_VALIDATORS: Record<string, MessageValidator> = {
  send_prompt: validateSendPrompt,
  copy_text: validateCopyText,
  mention_search: validateMentionSearch,
  change_mode: validateChangeMode,
  plan_complete: validatePlanComplete,
  mode_switch_request: validateModeSwitchRequest,
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
  reveal_in_explorer: requiredStringValidator("path", () => "Invalid path in reveal_in_explorer"),
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
  pin_session: validatePinSession,
  set_session_tags: validateSessionTags,
  open_terminal: validateOpenTerminal,
  resume_server_session: requiredStringValidator("serverSessionId", () => "Invalid serverSessionId in resume_server_session"),
  open_subagent_session: requiredStringValidator("childSessionId", () => "Invalid childSessionId in open_subagent_session"),
  delete_server_session: requiredStringValidator("serverSessionId", () => "Invalid serverSessionId in delete_server_session"),
  update_cost: validateUpdateCost,
  toggle_diff_wrap: validateOptionalEnabled,
  toggle_thinking: validateOptionalEnabled,
  send_steer_prompt: validateSendSteerPrompt,
  get_subagent_detail: requiredStringValidator("subagentId", () => "Invalid subagentId in get_subagent_detail"),
  cancel_subagent: requiredStringValidator("subagentId", () => "Invalid subagentId in cancel_subagent"),
  mark_subagent_read: requiredStringValidator("subagentId", () => "Invalid subagentId in mark_subagent_read"),
  popout_get_subagent_detail: requiredStringValidator("subagentId", () => "Invalid subagentId in popout_get_subagent_detail"),
  popout_cancel_subagent: requiredStringValidator("subagentId", () => "Invalid subagentId in popout_cancel_subagent"),
  voice_start: validateVoiceRequest,
  voice_stop: validateVoiceRequest,
  voice_cancel: validateVoiceRequest,
}

export function validateWebviewMessage(
  msg: Record<string, unknown>,
  msgType: string,
  deps: WebviewMessageValidatorDeps
): boolean {
  return WEBVIEW_MESSAGE_VALIDATORS[msgType]?.(msg, msgType, deps) ?? true
}
