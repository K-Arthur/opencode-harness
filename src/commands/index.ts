export { registerRollbackCommand } from "./rollback"
export { registerThemePreviewCommand, registerCaptureTerminalCommand } from "./theme"
export { registerGenerateAgentsMdCommand } from "./methodology"
export {
  registerOpenChatCommand,
  registerNewSessionCommand,
  registerOpenStoredSessionCommand,
  registerToggleFocusCommand,
  registerInsertMentionCommand,
  registerListSessionsCommand,
  registerDeleteSessionCommand,
  registerRenameSessionCommand,
  registerClearTestSessionsCommand,
  registerContinueLastSessionCommand,
  registerChooseHistorySessionCommand,
  registerAttachRemoteCommand,
  registerAddFileToSessionCommand,
  registerAddSelectionToSessionCommand,
} from "./session"
export { registerSelectModelCommand } from "./model"
export { registerShowRateLimitsCommand, registerCheckCliCommand } from "./misc"
export { registerExportCommand } from "./export"
export { registerStopCommand, registerSlashCommandShortcuts } from "./misc"
