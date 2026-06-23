/** Webview type definitions */

import type { VoiceInputSettings } from "../voiceInputCore"

export type MessageRole = "user" | "assistant" | "system"

// ---------------------------------------------------------------------------
// New discriminated block types (preferred for new code)
// ---------------------------------------------------------------------------

export type ToolCallClass = 'read' | 'write' | 'exec' | 'error' | 'meta' | 'mixed'
export type ToolCallState = 'pending' | 'running' | 'result' | 'error' | 'completed' | 'stale' | 'unresolved' | 'cancelled' | 'timed_out' | 'retried'

export interface ToolCollapseConfig {
  groupBy: 'consecutive' | 'name' | 'type'
  defaultCollapsed: boolean
  collapseThreshold: number
  showTypeBreakdown: boolean
  compactMode: boolean
}

export interface ToolCallBlock {
  [key: string]: unknown
  type: 'tool-call'
  id: string
  name: string
  class: ToolCallClass
  state: ToolCallState
  args?: unknown
  result?: string
  partialStdout?: string
  partialStderr?: string
  stdoutLength?: number
  stderrLength?: number
  stdoutLineCount?: number
  stderrLineCount?: number
  token?: number
  replace?: boolean
  resultTruncated?: boolean
  stderr?: string
  exitCode?: number
  error?: string
  durationMs?: number
  /** Unix ms when the tool call started (set from stream_tool_start). */
  startedAt?: number
  /** Working directory for exec-class tool calls, extracted from args. */
  workingDir?: string
}

export interface DiffHunk {
  id: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
  state: 'pending' | 'accepted' | 'rejected'
}

export interface DiffLine {
  type: 'added' | 'removed' | 'context'
  oldLine?: number
  newLine?: number
  content: string
  wordDiffHtml?: string
}

export interface DiffBlock {
  [key: string]: unknown
  type: 'diff'
  diffId: string
  path: string
  hunks: DiffHunk[]
  state: 'pending' | 'accepted' | 'discarded'
  linesAdded: number
  linesRemoved: number
  revertable?: boolean
}

export interface ThinkingBlock {
  [key: string]: unknown
  type: 'thinking'
  content: string
  tokenCount?: number
  streaming: boolean
}

export interface ErrorActionButton {
  label: string
  action: string
  primary?: boolean
  disabled?: boolean
  metadata?: Record<string, unknown>
}

export interface ErrorBlock {
  [key: string]: unknown
  type: 'error'
  code: string
  message: string
  detail?: string
  retryable: boolean
  actionButtons?: ErrorActionButton[]
}

/** One question group within a `QuestionBlock` (a model question may ask several). */
export interface QuestionGroup {
  question: string
  header?: string
  options: string[]
  multiSelect: boolean
}

export interface QuestionBlock {
  [key: string]: unknown
  type: 'question'
  id: string
  toolCallId: string
  requestID?: string
  sessionId?: string
  /**
   * One or more question groups. `text`/`options` are retained as a derived,
   * single-group view for backward compatibility with the `stream_end` blocks
   * contract and existing render paths.
   */
  groups: QuestionGroup[]
  text: string
  options: string[]
  allowFreeText: boolean
  /**
   * Persisted answer state. When true, the transcript renders as a
   * non-interactive record instead of a pending pointer.
   */
  answered?: boolean
  answer?: string
  answerSource?: 'option' | 'freetext'
}

// Legacy block type — kept for backward compatibility with existing renders
 export interface LegacyBlock {
  type: string
  text?: string
  code?: string
  language?: string
  skillName?: string
  toolType?: string
  toolName?: string
  args?: unknown
  result?: string
  filePath?: string
  diffText?: string
  id?: string
  sessionId?: string
  permissionId?: string
  permissionType?: string
  pattern?: string | string[]
  metadata?: Record<string, unknown>
  class?: ToolCallClass
  state?: string
  name?: string
  diffId?: string
  path?: string
  hunks?: DiffHunk[]
  linesAdded?: number
  linesRemoved?: number
  content?: string
  tokenCount?: number
  streaming?: boolean
  detail?: string
  retryable?: boolean
  status?: string
  message?: string
  data?: string
  mimeType?: string
  durationMs?: number
  [key: string]: unknown
 }

// Legacy block type — kept for backward compatibility and as the canonical Block type.
// All new renderers use type guards (isToolCallBlock, etc.) to narrow to specific types
// when needed, but generic block property access uses LegacyBlock.
export type Block = LegacyBlock

// Re-export the canonical discriminated union from the root types module so
// consumers in the webview can import it via the local types barrel.
export type { CanonicalBlock, CanonicalToolState } from "../../types"
export type { TokenBreakdown as CanonicalTokenBreakdown } from "../../types"
import type { CanonicalBlock as _CanonicalBlock } from "../../types"

// ---------------------------------------------------------------------------
// CanonicalBlock type guards (Layer 2)
// ---------------------------------------------------------------------------
// One narrowing function per variant. Each accepts the broad CanonicalBlock
// union and returns a type predicate so call sites can `.filter(isCanonicalX)`
// and read variant-specific fields without casts. The guards are pure, side-
// effect free, and trivially testable.

export function isCanonicalTextBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "text" } {
  return b.type === "text"
}
export function isCanonicalReasoningBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "reasoning" } {
  return b.type === "reasoning"
}
export function isCanonicalFileBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "file" } {
  return b.type === "file"
}
export function isCanonicalToolBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "tool" } {
  return b.type === "tool"
}
export function isCanonicalStepStartBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "step-start" } {
  return b.type === "step-start"
}
export function isCanonicalStepFinishBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "step-finish" } {
  return b.type === "step-finish"
}
export function isCanonicalSnapshotBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "snapshot" } {
  return b.type === "snapshot"
}
export function isCanonicalPatchBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "patch" } {
  return b.type === "patch"
}
export function isCanonicalAgentBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "agent" } {
  return b.type === "agent"
}
export function isCanonicalRetryBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "retry" } {
  return b.type === "retry"
}
export function isCanonicalCompactionBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "compaction" } {
  return b.type === "compaction"
}
export function isCanonicalSubtaskBlock(b: _CanonicalBlock): b is _CanonicalBlock & { type: "subtask" } {
  return b.type === "subtask"
}

export interface ChatMessage {
  role: MessageRole
  id?: string
  blocks: Block[]
  timestamp?: number
  sessionId?: string
  tokenCount?: number
  mode?: string
  /** The model that generated this message (e.g. "anthropic/claude-sonnet-4-5").
   *  Stamped when the stream starts; undefined for user messages and legacy history. */
  model?: string
}

export type SteerMode = "interrupt" | "queue"

export interface SessionState {
  id: string
  name: string
  model: string
  variant?: string
  mode: string
  steerMode?: SteerMode
  messages: ChatMessage[]
  draftText?: string
  isStreaming: boolean
  /** Host-authoritative streaming flag — pushed via streaming_state messages.
   *  Never set by optimistic local code paths. Used to gate abort/stop
   *  affordances so a stale local isStreaming=false can't trap the user.
   *  When the host says isServerStreaming=true the send button MUST show Stop
   *  regardless of any local heuristic. When the host says false and the local
   *  flag is also false, the button returns to Send. The two flags are OR'd. */
  isServerStreaming?: boolean
  /** Server-assigned ID of the message currently being generated, when
   *  isServerStreaming is true. Cleared on stream_end. Used to correlate
   *  late-arriving chunks and to reject stale streaming_state pushes from
   *  a previous run. */
  activeServerMessageId?: string
  /** Server-assigned run id (from run_activity_update.runId) for the active
   *  generation, when known. Used by probe_run_status to disambiguate
   *  resumed runs after reconnect. */
  activeRunId?: string
  cost?: number
  tokenUsage?: TokenUsage
  contextUsage?: ContextUsage
  changedFiles?: string[]
  lastActiveAt?: number
  instructions?: string
  revertHistory?: RevertEntry[]
  subagentActivities?: SubagentActivity[]
  subagentDetail?: unknown
  userTodos?: Todo[]
  todoFilter?: 'all' | 'active' | 'completed' | 'in-progress'
  activityFilter?: 'all' | 'messages' | 'plans' | 'commands' | 'files' | 'errors' | 'approvals'
  commandFilter?: 'all' | 'running' | 'failed' | 'succeeded'
  pinned?: boolean
  tags?: string[]
  /** Message ids of user prompts pinned to the top of this session's prompt rail. */
  pinnedPrompts?: string[]
}

export interface RevertEntry {
  diffId: string
  messageId: string
  path: string
  timestamp: number
}

export interface Todo {
  id: string
  content: string
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled'
  createdAt: number
  priority?: 'low' | 'medium' | 'high' | string
}

export interface FileChange {
  path: string
  added: number
  removed: number
  isPlanDocument?: boolean
  /** Real git status when available (A=added, M=modified, D=deleted).
   *  Falls back to line-count heuristic when absent. */
  status?: "A" | "M" | "D"
}

export interface PromptTemplate {
  id: string
  name: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface SkillInfo {
  id: string
  name: string
  description?: string
  category?: string
  enabled: boolean
  performanceScore?: number
  usageCount?: number
  lastUsed?: number
}

export interface SubagentActivity {
  id: string
  name: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'pending' | 'queued' | 'waiting' | 'unknown'
  output?: string
  progress?: number
  // SADD/TDD fields (Phase 1+)
  tddPhase?: 'red' | 'green' | 'refactor' | 'coverage'
  testsWritten?: number
  testsPassing?: number
  dependencies?: string[]
  domain?: 'frontend' | 'backend' | 'database' | 'api' | 'shared'
  // Enhanced detail fields
  summary?: string
  currentActivity?: string
  durationMs?: number
  startedAt?: number
  completedAt?: number
  error?: string
  isLive?: boolean
  unreadActivityCount?: number
  sessionId?: string
  parentSessionId?: string
  agentMode?: string
  model?: string
  provider?: string
  inputPrompt?: string
  result?: string
  toolCalls?: Array<{ id: string; name: string; status: string; args?: string; result?: string; error?: string; durationMs?: number }>
  commands?: Array<{ command: string; status: string; output?: string; durationMs?: number; error?: string }>
  fileChanges?: Array<{ path: string; type: string; additions?: number; deletions?: number; diff?: string }>
  tokenUsage?: { input: number; output: number; total: number }
  cost?: number
  metadata?: Record<string, unknown>
}

export interface TokenUsageSnapshot {
  timestamp: number
  sessionId: string
  model: string
  prompt: number
  completion: number
  total: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface WebviewState {
  sessions: Record<string, SessionState>
  sessionOrder: string[]
  activeSessionId: string | null
  nextSessionNum: number
  globalModel: string
  globalVariant?: string
  /**
   * Mode the next session will start in, chosen on the welcome screen where no
   * session exists to receive a `change_mode`. Applied by `createSession`.
   */
  pendingMode?: string
  initialized?: boolean
  disabledModels?: string[]
  favoriteModels?: string[]
  recentModels?: string[]
  displayPrefs?: {
    text: boolean
    tools: boolean
    diffs: boolean
    errors: boolean
    diffWrapEnabled?: boolean
    thinkingVisible?: boolean
  }
  isTimelineVisible?: boolean
  skills?: Record<string, SkillInfo>
  toolCollapseConfig?: ToolCollapseConfig
  tokenUsageHistory?: TokenUsageSnapshot[]
  /** Per-session scrollTop for the message list; webview-only UI state. */
  scrollPositions?: Record<string, number>
  /** Per-session prompt queue snapshot — restored on webview reload. */
  queues?: Record<string, import("./queue").QueueItem[]>
}

export interface MentionItem {
  prefix?: string
  display?: string
  description?: string
  icon?: string
  /**
   * Exact text inserted into the prompt when this item is picked. When
   * present, this wins over the default `prefix + display` concatenation —
   * which would otherwise produce nonsense for category items (e.g. clicking
   * the "file" category with prefix "@file:" and display "file" used to
   * insert "@file:file").
   */
  insertText?: string
  /**
   * Short origin label rendered as a chip in the slash dropdown
   * ("Built-in" | "Server" | "MCP" | "Skill" | "Custom"). Lets users tell a
   * built-in command apart from a server/MCP/skill/custom one inline, the
   * same way the commands palette modal does.
   */
  badge?: string
}

export interface SessionSummary {
  id: string
  title?: string
  time?: number
  messageCount?: number
  cost?: number
  cliSessionId?: string
  workspacePath?: string
  pinned?: boolean
  tags?: string[]
}

export interface ContextChip {
  label?: string
  /** Full value (path/URL) surfaced as the chip's hover tooltip. */
  title?: string
  kind?: string
  removable?: boolean
  onRemove?: () => void
}

export type ContextItemType = "active_file" | "picked_file" | "image" | "document"

export interface AttachedContextItem {
  id: string
  type: ContextItemType
  path?: string
  languageId?: string
  mimeType?: string
  data?: string
  sizeBytes?: number
  lineCount?: number
  isActive: boolean
  tokenEstimate?: number
}

export interface ContextTraySummary {
  fileCount: number
  imageCount: number
  documentCount: number
  totalTokens: number
}

export interface TokenBreakdown {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ContextBreakdown {
  system: number
  history: number
  workspace: number
  queued?: number
  steer?: number
}

export interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  sessionId?: string
  breakdown?: ContextBreakdown
  projected?: { withQueue: number; overflow: boolean }
  cost?: number
  source?: "estimated" | "actual"
  updatedAt?: number
}

export interface UsageDelta {
  prompt: number
  completion: number
  total: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

// ---------------------------------------------------------------------------
// Host → Webview message types (discriminated union)
// ---------------------------------------------------------------------------

export interface StreamResumedInfo {
  existingText?: string
  messageId?: string
}

export interface StreamHunkData {
  id: string
  hunkId: string
  oldStart: number
  oldCount: number
  lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }>
}

export interface ToolCallData {
  id: string
  name: string
  class: ToolCallClass
  state: ToolCallState
  args?: unknown
  result?: string
  partialStdout?: string
  partialStderr?: string
  stdout?: string
  stderr?: string
  stdoutLength?: number
  stderrLength?: number
  stdoutLineCount?: number
  stderrLineCount?: number
  token?: number
  replace?: boolean
  error?: string
  exitCode?: number
  durationMs?: number
  /** Unix ms when the tool call started. */
  startedAt?: number
  /** Working directory for exec-class calls. */
  workingDir?: string
}

export interface RateLimitInfo {
  provider?: string
  tokensRemaining?: number
  tokensLimit?: number
  requestsRemaining?: number
  requestsLimit?: number
  resetAt?: string
}

export interface RunActivitySnapshot {
  runId: string
  tabId: string
  cliSessionId?: string
  messageId?: string
  phase: string
  startedAt: number
  acceptedAt: number
  firstActivityAt?: number
  firstVisibleTextAt?: number
  lastActivityAt: number
  lastVisibleTextAt?: number
  activeToolCount: number
  activeSubagentCount: number
  statusLabel: string
  partialOutputPreserved: boolean
  tools?: Array<{ id: string; name: string; status: string; updatedAt?: number }>
  subagents?: Array<{
    id: string
    agentName: string
    status: string
    currentActivity?: string
    childSessionId?: string
    updatedAt?: number
    unreadActivityCount?: number
    error?: string
  }>
  lastError?: {
    kind: string
    source: string
    recoverability: string
    message: string
    technicalDetails?: string
    at: number
  }
}

export interface CheckpointInfo {
  id: string
  sessionId: string
  messageId?: string
  createdAt?: number
  filesChanged?: string[]
  action?: string
}

export type HostMessage =
  | { type: "host_message_batch"; messages: Array<Record<string, unknown> & { type: string }> }
  | { type: "init_state"; state: WebviewState; workspaceName: string; activeSessionId: string | null; globalModel?: string; commands?: unknown[]; showInChat?: boolean }
  | { type: "session_list_update"; sessions: SessionSummary[] }
  | { type: "session_deleted"; sessionId: string }
  | { type: "session_renamed"; sessionId: string; name: string }
  // Race-free title push. Fires directly from SessionStore.setTitleAppliedCallback
  // (host) → patchTabLabel (webview) without going through onDidChangeSession,
  // so the title lands even if the subscriber was registered after the
  // SessionStore mutation. Distinct from session_renamed so the webview can
  // choose the fast in-place patch path vs the legacy full-state-sync path.
  | { type: "session_title_updated"; sessionId: string; name: string }
  | { type: "streaming_state"; sessionId: string; isStreaming: boolean; source?: "host" | "local"; cliSessionId?: string; messageId?: string; runId?: string }
  | { type: "instructions_changed"; sessionId: string; instructions: string }
  | { type: "context_usage"; sessionId: string; percent: number; tokens: number; maxTokens: number; usage?: ContextUsage | UsageDelta; source?: "estimated" | "actual"; updatedAt?: number }
  | { type: "server_status"; sessionId?: string; status: string; errorContext?: unknown }
  | { type: "run_activity_update"; sessionId: string; activity: RunActivitySnapshot; seq?: number }
  | { type: "permission_request"; sessionId: string; permissionId?: string; title: string; permissionType?: string; pattern?: string | string[]; metadata?: Record<string, unknown> }
  | { type: "todos_update"; sessionId: string; todos: unknown[] }
  | { type: "todos_error"; sessionId: string; message: string }
  | { type: "changed_files_update"; sessionId: string; files: FileChange[] }
  | { type: "file_edited"; sessionId: string; file: string }
  | { type: "workspace_file_added"; sessionId: string; path: string }
  | { type: "workspace_file_deleted"; sessionId: string; path: string }
  | { type: "message"; sessionId: string; message: ChatMessage }
  | { type: "prompt_accepted"; sessionId: string; messageId: string; clientRequestId?: string }
  | { type: "prompt_send_failed"; sessionId: string; messageId?: string; clientRequestId?: string; text: string; reason: string; attachments?: Attachment[] }
  | { type: "unknown_server_event"; sessionId?: string; eventType: string; classification: "unclassified" | "safe_ignored"; preview?: string }
  | { type: "session_compacted"; sessionId: string }
  | { type: "compaction_started"; sessionId: string }
  // Shape matches what AutoCompactor.tryCompactIfNeeded actually posts.
  // The previous declaration (pendingTokens / predictedTokens / etc.) didn't
  // match the runtime payload at all — the host has always emitted percent /
  // tokens / maxTokens / actions, and the old type was never enforced because
  // no webview handler consumed the message.
  | { type: "compact_banner"; sessionId: string; percent: number; tokens: number; maxTokens: number; actions: string[] }
  | { type: "compact_banner_dismissed"; sessionId: string }
  | { type: "step_tokens"; sessionId: string; tokens: number | TokenBreakdown; turnIndex?: number }
  | { type: "cost_update"; sessionId?: string; cost: number }
  | { type: "token_usage"; sessionId: string; usage: UsageDelta; tokens?: number | TokenBreakdown }
  | { type: "stream_start"; sessionId: string; messageId: string; resumed?: StreamResumedInfo; isSteerPrompt?: boolean }
  | { type: "stream_chunk"; sessionId: string; text: string; messageId?: string; seq?: number }
  | { type: "stream_end"; sessionId: string; reason?: string; blocks?: Block[]; partial?: boolean; seq?: number; source?: "host" | "watchdog" | "abort" | "finalize" | "ttfb" | "reconcile" }
  | { type: "stream_interrupted"; sessionId: string; cliSessionId?: string; interruptedAt: number }
  | { type: "stream_ping"; sessionId: string; seq?: number }
  | { type: "stream_ack"; sessionId: string; seq?: number }
  | { type: "stream_tool_start"; sessionId: string; toolCall: ToolCallData }
  | { type: "stream_tool_update"; sessionId: string; toolCall: ToolCallData }
  | { type: "stream_tool_partial"; sessionId: string; toolCall: ToolCallData; seq?: number }
  | { type: "stream_tool_end"; sessionId: string; toolCall: ToolCallData }
  | { type: "stream_tool_unresolved"; sessionId: string; toolCallId: string; message: string }
  | { type: "force_rerender"; sessionId: string }
  | { type: "skill_indicator"; sessionId: string; skillName: string }
  | { type: "request_error"; message: string; errorContext?: unknown; sessionId?: string }
  | { type: "webview_request_error"; error: string; requestType?: string; sessionId?: string }
  | { type: "prompt_rejected"; reason: string; sessionId?: string }
  | { type: "voice_settings"; settings: VoiceInputSettings }
  | { type: "voice_recording_started"; requestId: string }
  | { type: "voice_transcribing"; requestId: string }
  | { type: "voice_transcript"; requestId: string; text: string }
  | { type: "voice_error"; requestId?: string; reason: string; message: string }
  | { type: "rate_limit_state"; state?: unknown }
  | { type: "rate_limit_exhausted"; info?: RateLimitInfo }
  | { type: "theme_vars"; vars: Record<string, string> }
  | { type: "theme_config"; config: Record<string, unknown> }
  | { type: "tool_output_config"; renderAnsi: boolean }
  | { type: "chat_font_config"; fontSize: number; fontFamily: string }
  | { type: "chat_dir_config"; direction: "ltr" | "rtl" }
  | { type: "theme"; theme: unknown }
  | { type: "cli_themes_list"; themes: unknown[] }
  | { type: "model_update"; model: string }
  | { type: "variant_update"; variant: string }
  | { type: "open_model_manager"; forRegeneration?: boolean; messageId?: string }
  | { type: "mode_change_result"; sessionId: string; mode: "plan" | "build" | "auto"; accepted: boolean; reason?: string }
  | { type: "model_list"; items: ModelInfo[] }
  | { type: "mention_results"; items: MentionItem[]; query: string }
  | { type: "active_file"; path: string | null; languageId?: string; lineCount?: number; selection?: { startLine: number; endLine: number; text: string } | null }
  | { type: "workspace_files"; files: string[] }
  | { type: "session_list"; sessions: SessionSummary[]; query?: string }
  | { type: "server_session_list"; sessions: unknown[] }
  | { type: "server_session_deleted"; sessionId: string }
  | { type: "resume_session_data"; sessionId: string; messages: ChatMessage[]; model: string; isStreaming: boolean; cost?: number; tokenUsage?: TokenUsage; contextUsage?: ContextUsage; instructions?: string }
  | { type: "more_messages"; messages: ChatMessage[]; sessionId: string; hasMore: boolean; newBeforeIndex: number; totalCount: number; initialBeforeIndex?: number }
  | { type: "clear_messages"; sessionId: string }
  | { type: "active_session_changed"; sessionId: string }
  | { type: "fork_created"; targetSessionId: string }
  | { type: "queue_state"; sessionId: string; items: import("./queue").QueueItem[] }
  | { type: "prompt_queued"; sessionId: string; itemId: string }
  | { type: "prefill_prompt"; text: string; autoSend?: boolean }
  | { type: "edit_message_prefill"; text: string; sessionId?: string }
  | { type: "insert_text"; code: string; language?: string }
  | { type: "command_list"; commands: unknown[]; showInChat?: boolean; partial?: boolean }
  | { type: "mcp_servers"; servers: unknown[] }
  | { type: "diff_result"; sessionId: string; blockId: string; ok: boolean; message?: string; checkpointCreated?: boolean }
  | { type: "revert_result"; ok: boolean; sessionId?: string; error?: string }
  | { type: "unrevert_result"; ok: boolean; sessionId?: string; error?: string }
  | { type: "checkpoint_list"; sessionId: string; checkpoints: CheckpointInfo[] }
  | { type: "checkpoint_restored"; sessionId: string; ok: boolean; checkpointId: string; error?: string }
  | { type: "restore_points"; sessionId: string; points: { index: number; messageID: string; partID?: string; snapshot: string; label: string; kind: "user-turn" | "step" | "snapshot"; time?: number }[] }
  | { type: "restore_point_result"; sessionId: string; ok: boolean; messageID?: string; error?: string }
  | { type: "stash_success"; name: string }
  | { type: "stash_error"; error: string }
  | { type: "stash_list"; stashes: unknown[] }
  | { type: "stash_deleted"; id: string }
  | { type: "template_saved"; template: unknown }
  | { type: "template_list"; templates: unknown[] }
  | { type: "template_deleted"; id: string }
  | { type: "template_error"; error: string }
  | { type: "provider_added"; id: string; name: string }
  | { type: "provider_error"; error: string; providerId?: string }
  | { type: "provider_list"; providers: unknown[] }
  | { type: "provider_updated"; id: string }
  | { type: "provider_deleted"; id: string }
  | { type: "provider_discovery_list"; providers: ProviderDiscoveryItem[] }
  | { type: "provider_auth_methods"; providerId: string; methods: ProviderAuthMethodInfo[] }
  | { type: "provider_oauth_started"; providerId: string; authorizationUrl: string; instructions?: string }
  | { type: "provider_oauth_completed"; providerId: string; ok: boolean; error?: string }
  | { type: "provider_credential_list"; credentials: ProviderCredentialInfo[] }
  | { type: "push_all_state" }
  | { type: "push_visible_state" }
  | { type: "open_commands_palette" }
  | { type: "skills_list"; skills: unknown[] }
  | { type: "skills_search_results"; results: unknown[] }
  | { type: "subagent_activities"; activities: unknown[]; sessionId: string }
  | { type: "subagent_detail"; sessionId: string; subagentId: string; detail: unknown }
  | { type: "subagent_update"; sessionId: string; subagent: unknown }
  | { type: "show_error"; message: string }
  /** Response to get_file_diff — carries unified diff lines for a given path. */
  | { type: "file_diff_response"; path: string; sessionId?: string; lines: DiffLine[]; error?: string; deleted?: boolean; truncated?: boolean }
  | { type: "file_hunks"; path: string; sessionId?: string; hunks: Array<{ id: string; additions: number; deletions: number; lines: string[] }> }
  | { type: "hunk_reverted"; path: string; ok: boolean; reason?: string; sessionId?: string }
  /** Host → Webview: response to `probe_run_status`. Carries the host's
   *  authoritative view of whether a run is still active for a given
   *  cliSessionId. The webview uses this to correct stale optimistic flags
   *  after reconnects / dropped events. When `active` is false, the webview
   *  should clear its local streaming flag (the run really is finished or
   *  gone). When `active` is true, the webview should keep showing the Stop
   *  button even if its optimistic flag was cleared. */
  | { type: "run_status_result"; sessionId: string; cliSessionId?: string; active: boolean; runId?: string; messageId?: string; probedAt: number; serverReachable: boolean }

// Backward-compatible alias — gradual migration; remove once all consumers use the union.
export type LegacyHostMessage = HostMessage & Record<string, unknown>

export interface VsCodeApi {
  postMessage(message: Record<string, unknown>): void
  getState(): WebviewState | undefined
  setState(state: WebviewState): void
}

export interface ModelInfo {
  id: string
  provider: string
  displayName: string
  enabled?: boolean
  supportsVariants?: boolean
  variantNames?: string[]
  favorite?: boolean
  recentRank?: number
  contextWindow?: number
  available?: boolean
  unavailableReason?: string
  connectionStatus?: "connected" | "needs_key" | "needs_oauth"
}

export interface ProviderDiscoveryItem {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  status: "connected" | "needs_key" | "needs_oauth"
  modelCount: number
  envVars: string[]
}

export interface ProviderAuthMethodInfo {
  type: "oauth" | "api"
  label: string
}

export interface ProviderCredentialInfo {
  id: string
  providerId: string
  label: string
  type: "oauth" | "api"
}

export interface TabInfo {
  id: string
  name: string
  model?: string
  isStreaming: boolean
}

export interface Attachment {
  data: string
  mimeType: string
}

export interface SteerPrompt {
  id: string
  text: string
  attachments: Attachment[]
  mode: 'interrupt' | 'queue'
  timestamp: number
  sessionId: string
}

// ---------------------------------------------------------------------------
// Webview → Host message types (discriminated union)
// ---------------------------------------------------------------------------

export type WebviewMessage =
  | { type: "webview_ready" }
  | { type: "init_ack" }
  | { type: "create_tab" }
  | { type: "send_prompt"; sessionId: string; text: string; messageId: string; clientRequestId?: string; model: string; mode?: string; variant?: string; attachments?: Attachment[]; isSteerPrompt?: boolean; contextItems?: Array<{ type: string; path: string; selection?: { startLine: number; endLine: number; text: string } }> }
  | { type: "send_steer_prompt"; id: string; text: string; attachments: Attachment[]; mode: "interrupt" | "queue"; sessionId: string }
  | { type: "change_mode"; mode: string; sessionId: string }
  | { type: "set_model"; model: string; sessionId?: string }
  | { type: "set_variant"; variant: string; sessionId: string }
  | { type: "abort"; sessionId: string }
  | { type: "cancel_tool"; sessionId: string; toolId: string; stdout?: string; stderr?: string; durationMs?: number }
  /** Webview → Host: ask the host to probe the server for the live status of
   *  the run associated with `cliSessionId`. The host replies with
   *  `run_status_result`. Used by the webview when its local streaming flag
   *  may be stale — e.g. after a server reconnect, an error that did not
   *  carry stream_end context, or any time the send button state diverges
   *  from observed reality. */
  | { type: "probe_run_status"; sessionId: string; cliSessionId?: string }
  | { type: "close_tab"; sessionId: string }
  | { type: "switch_tab"; sessionId: string }
  | { type: "accept_diff"; diffId: string; path?: string; sessionId?: string }
  | { type: "reject_diff"; diffId: string; sessionId?: string }
  | { type: "accept_hunk"; sessionId: string; hunkId: string; diffId?: string }
  | { type: "reject_hunk"; sessionId: string; hunkId: string; diffId?: string }
  | { type: "get_file_hunks"; path: string; sessionId?: string }
  | { type: "revert_hunk"; path: string; hunkId: string; sessionId?: string }
  | { type: "revert_diff"; diffId: string; path: string; sessionId?: string }
  | { type: "accept_permission"; sessionId?: string; permissionId?: string; response?: string }
  | { type: "mention_search"; query: string }
  | { type: "get_workspace_files" }
  | { type: "toggle_active_file"; sessionId: string; include: boolean }
  | { type: "list_sessions"; limit?: number; query?: string }
  | { type: "resume_session"; sessionId: string }
  | { type: "new_session" }
  | { type: "get_models" }
  | { type: "update_cost"; cost: number; sessionId?: string }
  | { type: "webview_log"; level?: string; message?: string }
  | { type: "rename_session"; sessionId: string; name: string }
  | { type: "delete_session"; targetSessionId: string }
  | { type: "archive_session"; targetSessionId: string }
  | { type: "pin_session"; targetSessionId: string; pinned: boolean }
  | { type: "set_session_tags"; targetSessionId: string; tags: string[] }
  | { type: "open_terminal"; command: string; cwd?: string; autorun?: boolean }
  | { type: "open_settings" }
  | { type: "connect_provider" }
  | { type: "open_mcp_settings" }
  | { type: "open_mcp_config" }
  | { type: "attach_files" }
  | { type: "attach_image" }
  | { type: "export_chat" }
  | { type: "export_chat_json" }
  | { type: "export_chat_text" }
  | { type: "copy_chat" }
  | { type: "stash_prompt"; name?: string; content?: string; isGlobal?: boolean }
  | { type: "list_stashes" }
  | { type: "delete_stash"; id: string }
  | { type: "record_stash_usage"; id: string }
  | { type: "save_template"; name: string; content: string; tags?: string[]; existingId?: string }
  | { type: "list_templates" }
  | { type: "delete_template"; id: string }
  | { type: "save_message_as_template"; name: string; content: string; tags?: string[] }
  | { type: "add_provider"; name: string; config: Record<string, unknown> }
  | { type: "list_providers" }
  | { type: "update_provider"; id: string; config: Record<string, unknown> }
  | { type: "delete_provider"; id: string }
  | { type: "discover_providers" }
  | { type: "get_provider_auth_methods"; providerId: string }
  | { type: "connect_provider_key"; providerId: string; key: string; label?: string }
  | { type: "connect_provider_oauth"; providerId: string; methodIndex?: number }
  | { type: "complete_provider_oauth"; providerId: string; code?: string; methodIndex?: number }
  | { type: "list_provider_credentials" }
  | { type: "remove_provider_credential"; credentialId: string }
  | { type: "compact_session"; sessionId: string }
  | { type: "execute_command"; command: string; arguments?: string; sessionId?: string }
  | { type: "list_commands" }
  | { type: "insert_at_cursor"; code: string; language?: string }
  | { type: "create_file_from_code"; code: string; language?: string; filePath?: string }
  | { type: "compact_banner_action"; action: string; sessionId: string }
  | { type: "edit_message"; sessionId?: string }
  | { type: "list_server_sessions"; query?: string }
  | { type: "delete_server_session"; sessionId: string }
  | { type: "resume_server_session"; sessionId: string; title?: string }
  | { type: "add_mcp_server"; name: string; config: Record<string, unknown> }
  | { type: "update_mcp_server"; name: string; config: Record<string, unknown> }
  | { type: "remove_mcp_server"; name: string }
  | { type: "toggle_mcp_server"; name: string; disabled: boolean }
  | { type: "get_mcp_servers" }
  | { type: "show_diff"; filePath: string; proposedContent: string; title?: string; sessionId?: string }
  | { type: "list_checkpoints"; sessionId: string }
  | { type: "restore_checkpoint"; checkpointId: string; sessionId?: string }
  | { type: "list_restore_points"; sessionId: string }
  | { type: "restore_point"; sessionId: string; messageID: string; partID?: string; snapshot?: string }
  | { type: "revert_message"; sessionId?: string; messageId?: string }
  | { type: "unrevert"; sessionId?: string }
  | { type: "preview_theme"; theme: unknown }
  | { type: "get_theme_config" }
  | { type: "update_theme_config"; theme: unknown }
  | { type: "list_cli_themes" }
  | { type: "request_more_messages"; sessionId: string; beforeIndex: number; limit?: number }
  | { type: "stream_ack"; sessionId: string; seq?: number; lastRenderedChunkSeq?: number }
  | { type: "retry_stream"; sessionId: string }
  | { type: "open_model_selector_for_regen"; sessionId: string; messageId: string }
  | { type: "regenerate_with_model"; sessionId: string; messageId: string; model: string }
  | { type: "resume_stream"; sessionId: string }
  | { type: "decline_resume"; sessionId: string }
  | { type: "request_state_sync" }
  | { type: "get_voice_settings" }
  | { type: "setup_voice_input" }
  | { type: "voice_start"; requestId: string }
  | { type: "voice_stop"; requestId: string }
  | { type: "voice_cancel"; requestId: string }
  | { type: "set_instructions"; sessionId: string; instructions: string }
  | { type: "fork_session"; sessionId: string }
  | { type: "toggle_diff_wrap"; sessionId?: string }
  | { type: "toggle_thinking"; sessionId?: string }
  | { type: "context_history_request"; sessionId?: string }
  | { type: "context_cost_estimate"; sessionId?: string; pendingTokens?: number; predictedTokens?: number }
  | { type: "context_suggestions_request" }
  | { type: "remove_from_queue"; sessionId: string; itemId: string }
  | { type: "edit_queue_item"; sessionId: string; itemId: string; text: string }
  | { type: "reorder_queue"; sessionId: string; fromIndex: number; toIndex: number }
  | { type: "retry_queue_item"; sessionId: string; itemId: string }
  | { type: "send_queue_item"; sessionId: string; itemId: string }
  | { type: "request_queue_state"; sessionId?: string }
  | { type: "resume_queue"; sessionId: string }
  | { type: "get_todos"; sessionId: string }
  | { type: "get_skills" }
  | { type: "toggle_skill"; skillId: string; enabled: boolean }
  | { type: "search_skills"; query: string }
  | { type: "get_changed_files"; sessionId: string }
  | { type: "open_file"; path: string }
  | { type: "get_subagent_activities"; sessionId?: string }
  | { type: "get_subagent_detail"; sessionId: string; subagentId: string }
  | { type: "cancel_subagent"; subagentId: string }
  | { type: "mark_subagent_read"; sessionId: string; subagentId: string }
  | { type: "popout_get_subagent_detail"; subagentId: string; sessionId: string }
  | { type: "popout_cancel_subagent"; subagentId: string }
  | { type: "show_error"; message: string }
  | { type: "get_context_usage"; sessionId: string }
  | { type: "question_answer"; sessionId: string; toolCallId?: string; requestID?: string; messageId?: string; value: string; source?: string; structuredAnswers?: string[][] }
  /** Request unified diff hunks for a specific file path in the active session. */
  | { type: "get_file_diff"; path: string; sessionId?: string }
  /** Sprint 3 / M7: open a real VS Code diff editor comparing the git HEAD
   *  (before) against current workspace content (after) for a changed file.
   *  The dropdown invokes this when the user clicks "Open diff" on a row. */
  | { type: "open_changed_file_diff"; path: string; sessionId: string }
  /** Reveal a file in the VS Code Explorer sidebar. */
  | { type: "reveal_in_explorer"; path: string }
  /** W1.E: Undo changes to a single file (revert to git HEAD) */
  | { type: "undo_file"; path: string; sessionId?: string }
  /** W1.F: Revert all changed files to git HEAD */
  | { type: "revert_all_files"; sessionId: string }
  /** Toggle chat text direction (LTR/RTL); host persists to globalState */
  | { type: "chat_dir_change"; direction: "ltr" | "rtl" }

// Backward-compatible alias
export type LegacyWebviewMessage = WebviewMessage & Record<string, unknown>

/** Compile-time exhaustiveness check for discriminated unions. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(x)}`)
}

/** Type guard: check if a value has a string `type` field. */
export function hasType(x: unknown): x is { type: string; [key: string]: unknown } {
  return typeof x === "object" && x !== null && "type" in x && typeof (x as { type: unknown }).type === "string"
}
