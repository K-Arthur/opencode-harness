function warnElement(message: string): void {
  console.warn(`[opencode-harness] ${message}`)
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    // Log the missing element but return a shim to prevent a hard crash.
    // The global error boundary in main.ts will still catch any subsequent errors.
    warnElement(`Missing element: ${id} — using fallback`)
    // Return a minimal div as fallback so downstream code doesn't crash
    const fallback = document.createElement("div") as unknown as T
    fallback.id = id
    return fallback
  }
  return element as T
}

export function optionalElement<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id)
  if (!element) {
    warnElement(`Optional element not found: ${id}`)
    return null
  }
  return element as T
}

export interface ElementRefs {
  app: HTMLElement
  tabPanels: HTMLElement
  tabBar: HTMLElement
  newTabBtn: HTMLElement

  promptInput: HTMLTextAreaElement
  sendBtn: HTMLElement
  mentionDropdown: HTMLDivElement
  slashAutocomplete: HTMLDivElement
  inputArea: HTMLDivElement
  inputWrapper: HTMLDivElement
  inputBottomBar: HTMLDivElement
  
  mentionBtn: HTMLElement
  commandsPaletteBtn: HTMLElement | null
  attachBtn: HTMLElement
  voiceInputBtn: HTMLButtonElement
  voiceInputStatus: HTMLElement
  modeDropdown: HTMLDivElement
  modeDropdownBtn: HTMLButtonElement
  modeDropdownMenu: HTMLDivElement
  modeDropdownLabel: HTMLSpanElement
  modeCurrentText: HTMLSpanElement
  modeIndicator: HTMLSpanElement
  modeOptPlan: HTMLButtonElement
  modeOptAuto: HTMLButtonElement
  modeOptBuild: HTMLButtonElement
  modelSelectorBtn: HTMLElement
  modelLabel: HTMLSpanElement
  variantSelectorBtn: HTMLElement
  variantLabel: HTMLSpanElement
  instructionsGearBtn: HTMLButtonElement
  instructionsEditor: HTMLDivElement
  instructionsTextarea: HTMLTextAreaElement
  instructionsSaveBtn: HTMLButtonElement
  instructionsCancelBtn: HTMLButtonElement
  dirToggleBtn: HTMLButtonElement

  modelDropdown: HTMLDivElement
  variantDropdown: HTMLDivElement
  historyBtn: HTMLElement
  mcpBtn: HTMLElement
  timelineToggleBtn: HTMLElement
  /** Header toolbar twin of timelineToggleBtn (discoverability). */
  timelineToggleHeaderBtn: HTMLElement | null
  thinkingToggleMenuItem: HTMLElement
  thinkingCheckmark: HTMLElement | null
  settingsBtn: HTMLElement

  contextBar: HTMLDivElement
  contextChips: HTMLDivElement
  contextUsage: HTMLDivElement
  contextProgressBar: HTMLElement
  contextProgressFill: HTMLElement
  contextLabel: HTMLSpanElement
  contextUsageDropdown: HTMLElement | null
  ctxDropdownContent: HTMLElement | null
  // context-monitor refs removed — panelled monitor was replaced by dropdown
  
  promptStashPanel: HTMLDivElement | null
  promptStashClose: HTMLButtonElement | null
  promptStashList: HTMLDivElement | null
  promptStashToggleBtn: HTMLElement
  
  welcomeRecentSessions: HTMLDivElement | null
  welcomeModelCtx: HTMLSpanElement | null
  welcomeSearchInput: HTMLDivElement | null

  agentStatusLed: HTMLDivElement
  agentStatusText: HTMLSpanElement

  sessionModal: HTMLDivElement
  sessionModalBody: HTMLDivElement
  sessionModalClose: HTMLButtonElement

  modelManagerPanel: HTMLDivElement
  modelManagerSearch: HTMLInputElement
  modelManagerList: HTMLDivElement
  modelManagerClose: HTMLButtonElement
  modelManagerConnect: HTMLButtonElement

  welcomeView: HTMLDivElement
  welcomeModelEmptyBanner: HTMLElement | null
  welcomeEmptyBannerLink: HTMLElement | null

  mcpConfigPanel: HTMLDivElement
  mcpConfigList: HTMLDivElement
  mcpConfigAdd: HTMLButtonElement
  mcpConfigClose: HTMLButtonElement
  mcpConfigForm: HTMLDivElement
  mcpConfigFormTitle: HTMLHeadingElement
  mcpConfigName: HTMLInputElement
  mcpConfigCommand: HTMLInputElement
  mcpConfigArgs: HTMLTextAreaElement
  mcpConfigEnv: HTMLTextAreaElement
  mcpConfigDisabled: HTMLInputElement
  mcpConfigSave: HTMLButtonElement
  mcpConfigCancel: HTMLButtonElement

  // Permission config panel
  permissionConfigPanel: HTMLDivElement
  permissionConfigList: HTMLDivElement
  permissionConfigClose: HTMLButtonElement
  permissionConfigSave: HTMLButtonElement
  permissionConfigBtn: HTMLElement

  // Provider connection panel
  providerPanelBtn: HTMLElement | null

  // Display toggles (Phase 4.2)
  displayToggles: HTMLElement
  toggleText: HTMLInputElement
  toggleTools: HTMLInputElement
  toggleDiffs: HTMLInputElement
  toggleErrors: HTMLInputElement

  // Settings overflow menu
  settingsMenu: HTMLElement
  themeCustomizerBtn: HTMLElement
  // Theme customizer panel is built dynamically by themeOrchestrator.ts —
  // no static element refs needed.

  // Status strip (below tab bar)
  statusStrip: HTMLElement
  statusModel: HTMLSpanElement
  statusMethodology: HTMLSpanElement
  statusRoute: HTMLSpanElement
  statusMasking: HTMLSpanElement
  statusCost: HTMLSpanElement
  statusTokens: HTMLSpanElement
  quotaBar: HTMLDivElement
  quotaProgressBar: HTMLDivElement
  quotaLabel: HTMLSpanElement
  quotaDetail: HTMLSpanElement

  // Welcome context elements
  welcomeWorkspaceName: HTMLSpanElement
  welcomeModelName: HTMLSpanElement
  welcomeContinueBtn: HTMLButtonElement | null
  welcomeNewBtn: HTMLButtonElement
  welcomeTempBtn: HTMLButtonElement | null

  // Token/cost display (Phase 5 — hidden outside header, kept for compatibility)
  tokenDisplay: HTMLElement | null
  costDisplay: HTMLElement | null

  // File change tracking — canonical toolbar dropdown
  changedFilesBtn: HTMLButtonElement | null
  changedFilesDropdown: HTMLElement | null
  cfDropdownTree: HTMLElement | null
  cfCountBadge: HTMLElement | null

  // Checkpoint/undo panel (Phase 5)
  checkpointPanel: HTMLElement | null
  recentPromptsRail: HTMLElement | null
  checkpointToggleBtn: HTMLElement
  todosPanel: HTMLElement
  todosList: HTMLElement
  todoAddForm: HTMLFormElement
  todoAddInput: HTMLInputElement
  todosToggleBtn: HTMLElement
  closeTodosBtn: HTMLElement
  activityToggleBtn: HTMLElement
  activityPanel: HTMLElement
  activityFilters: HTMLElement
  activityList: HTMLElement
  activityCloseBtn: HTMLElement
  tasksToggleBtn: HTMLElement
  tasksPanel: HTMLElement
  tasksFilters: HTMLElement
  tasksList: HTMLElement
  tasksCloseBtn: HTMLElement
  terminalToggleBtn: HTMLElement
  terminalPanel: HTMLElement
  terminalList: HTMLElement
  terminalCloseBtn: HTMLElement
  skillsBtn: HTMLElement
  skillsModal: HTMLElement
  skillsModalCloseBtn: HTMLElement
  skillsSearchInput: HTMLInputElement
  skillsFilter: HTMLElement
  skillsList: HTMLElement
  // Commands modal — populated by setup; querySelector fallback for older HTML bundles is OK.
  commandsModal: HTMLElement | null
  commandsModalCloseBtn: HTMLElement | null
  commandsSearchInput: HTMLInputElement | null
  commandsTitle: HTMLElement | null
  commandsFilter: HTMLElement | null
  commandsList: HTMLElement | null
  subagentPanel: HTMLElement
  subagentsToggleBtn: HTMLElement
  subagentsBadge: HTMLElement | null
  subagentList: HTMLElement
  subagentDetailView: HTMLElement
  subagentDetailBackBtn: HTMLElement
  subagentDetailPopoutBtn: HTMLElement
  subagentDetailCloseBtn: HTMLElement
  subagentDetailContent: HTMLElement
  closeSubagentBtn: HTMLElement
}

export function getElementRefs(): ElementRefs {
  return {
    app: requireElement("app"),
    tabPanels: requireElement("tab-panels"),
    tabBar: requireElement("tab-bar"),
    newTabBtn: requireElement("new-tab-btn"),

    promptInput: requireElement<HTMLTextAreaElement>("prompt-input"),
    sendBtn: requireElement("send-btn"),
    mentionDropdown: requireElement<HTMLDivElement>("mention-dropdown"),
    slashAutocomplete: requireElement<HTMLDivElement>("slash-autocomplete"),
    inputArea: requireElement<HTMLDivElement>("input-area"),
    inputWrapper: requireElement<HTMLDivElement>("input-wrapper"),
    inputBottomBar: requireElement<HTMLDivElement>("input-bottom-bar"),
    
    mentionBtn: requireElement("mention-btn"),
    commandsPaletteBtn: document.getElementById("commands-palette-btn"),
    attachBtn: requireElement("attach-btn"),
    voiceInputBtn: requireElement<HTMLButtonElement>("voice-input-btn"),
    voiceInputStatus: requireElement("voice-input-status"),
    modeDropdown: requireElement<HTMLDivElement>("mode-dropdown"),
    modeDropdownBtn: requireElement<HTMLButtonElement>("mode-dropdown-btn"),
    modeDropdownMenu: requireElement<HTMLDivElement>("mode-dropdown-menu"),
    modeDropdownLabel: requireElement<HTMLSpanElement>("mode-dropdown-label"),
    modeCurrentText: requireElement<HTMLSpanElement>("mode-current-text"),
    modeIndicator: requireElement<HTMLSpanElement>("mode-indicator"),
    modeOptPlan: requireElement<HTMLButtonElement>("mode-opt-plan"),
    modeOptAuto: requireElement<HTMLButtonElement>("mode-opt-auto"),
    modeOptBuild: requireElement<HTMLButtonElement>("mode-opt-build"),
    modelSelectorBtn: requireElement("model-selector-btn"),
    modelLabel: requireElement<HTMLSpanElement>("model-label"),
    variantSelectorBtn: requireElement("variant-selector-btn"),
    variantLabel: requireElement<HTMLSpanElement>("variant-label"),
    instructionsGearBtn: requireElement<HTMLButtonElement>("instructions-gear-btn"),
    instructionsEditor: requireElement<HTMLDivElement>("instructions-editor"),
    instructionsTextarea: requireElement<HTMLTextAreaElement>("instructions-textarea"),
    instructionsSaveBtn: requireElement<HTMLButtonElement>("instructions-save-btn"),
    instructionsCancelBtn: requireElement<HTMLButtonElement>("instructions-cancel-btn"),
    dirToggleBtn: requireElement<HTMLButtonElement>("dir-toggle-btn"),

    modelDropdown: requireElement<HTMLDivElement>("model-dropdown-container"),
    variantDropdown: requireElement<HTMLDivElement>("variant-dropdown-container"),
    historyBtn: requireElement("history-btn"),
    mcpBtn: requireElement("mcp-btn"),
    timelineToggleBtn: requireElement("timeline-toggle-btn"),
    timelineToggleHeaderBtn: document.getElementById("timeline-toggle-header-btn"),
    thinkingToggleMenuItem: requireElement("thinking-toggle-menu-item"),
    thinkingCheckmark: document.querySelector<HTMLElement>("#thinking-toggle-menu-item .settings-menu-checkmark"),
    settingsBtn: requireElement("settings-btn"),

    contextBar: requireElement<HTMLDivElement>("context-bar"),
    contextChips: requireElement<HTMLDivElement>("context-chips"),
    contextUsage: requireElement<HTMLDivElement>("context-usage"),
    contextProgressBar: requireElement("context-progress-track"),
    contextProgressFill: requireElement("context-progress-fill"),
    contextLabel: requireElement<HTMLSpanElement>("context-label"),
    contextUsageDropdown: document.getElementById("context-usage-dropdown"),
    ctxDropdownContent: document.getElementById("ctx-dropdown-content"),
    
    promptStashPanel: optionalElement<HTMLDivElement>("prompt-stash-panel"),
    promptStashClose: optionalElement<HTMLButtonElement>("prompt-stash-close"),
    promptStashList: optionalElement<HTMLDivElement>("prompt-stash-list"),
    promptStashToggleBtn: requireElement("prompt-stash-toggle-btn"),
    
    welcomeRecentSessions: optionalElement<HTMLDivElement>("welcome-recent-sessions"),
    welcomeModelCtx: optionalElement<HTMLSpanElement>("welcome-model-ctx"),
    welcomeSearchInput: optionalElement<HTMLDivElement>("welcome-search-input"),

    agentStatusLed: requireElement<HTMLDivElement>("agent-status-led"),
    agentStatusText: requireElement<HTMLSpanElement>("agent-status-text"),

    sessionModal: requireElement<HTMLDivElement>("session-modal"),
    sessionModalBody: requireElement<HTMLDivElement>("session-modal-body"),
    sessionModalClose: requireElement<HTMLButtonElement>("session-modal-close"),

    modelManagerPanel: requireElement<HTMLDivElement>("model-manager-panel"),
    modelManagerSearch: requireElement<HTMLInputElement>("model-manager-search"),
    modelManagerList: requireElement<HTMLDivElement>("model-manager-list"),
    modelManagerClose: requireElement<HTMLButtonElement>("model-manager-close"),
    modelManagerConnect: requireElement<HTMLButtonElement>("model-manager-connect"),

    welcomeView: requireElement<HTMLDivElement>("welcome-view"),
    welcomeModelEmptyBanner: document.getElementById("welcome-model-empty-banner"),
    welcomeEmptyBannerLink: document.getElementById("welcome-empty-banner-link"),

    mcpConfigPanel: requireElement<HTMLDivElement>("mcp-config-panel"),
    mcpConfigList: requireElement<HTMLDivElement>("mcp-config-list"),
    mcpConfigAdd: requireElement<HTMLButtonElement>("mcp-config-add"),
    mcpConfigClose: requireElement<HTMLButtonElement>("mcp-config-close"),
    mcpConfigForm: requireElement<HTMLDivElement>("mcp-config-form"),
    mcpConfigFormTitle: requireElement<HTMLHeadingElement>("mcp-config-form-title"),
    mcpConfigName: requireElement<HTMLInputElement>("mcp-config-name"),
    mcpConfigCommand: requireElement<HTMLInputElement>("mcp-config-command"),
    mcpConfigArgs: requireElement<HTMLTextAreaElement>("mcp-config-args"),
    mcpConfigEnv: requireElement<HTMLTextAreaElement>("mcp-config-env"),
    mcpConfigDisabled: requireElement<HTMLInputElement>("mcp-config-disabled"),
    mcpConfigSave: requireElement<HTMLButtonElement>("mcp-config-save"),
    mcpConfigCancel: requireElement<HTMLButtonElement>("mcp-config-cancel"),

    // Permission config panel
    permissionConfigPanel: requireElement<HTMLDivElement>("perm-config-panel"),
    permissionConfigList: requireElement<HTMLDivElement>("perm-config-list"),
    permissionConfigClose: requireElement<HTMLButtonElement>("perm-config-close"),
    permissionConfigSave: requireElement<HTMLButtonElement>("perm-config-save"),
    permissionConfigBtn: requireElement("perm-config-btn"),

    // Provider connection panel
    providerPanelBtn: document.getElementById("provider-panel-btn"),

    // Display toggles (Phase 4.2)
    displayToggles: requireElement("display-toggles"),
    toggleText: requireElement<HTMLInputElement>("toggle-text"),
    toggleTools: requireElement<HTMLInputElement>("toggle-tools"),
    toggleDiffs: requireElement<HTMLInputElement>("toggle-diffs"),
    toggleErrors: requireElement<HTMLInputElement>("toggle-errors"),

    // Settings overflow menu
    settingsMenu: requireElement("settings-menu"),
    themeCustomizerBtn: requireElement("theme-customizer-btn"),

    // Status strip (below tab bar)
    statusStrip: requireElement("status-strip"),
    statusModel: requireElement<HTMLSpanElement>("status-model"),
    statusMethodology: requireElement<HTMLSpanElement>("status-methodology"),
    statusRoute: requireElement<HTMLSpanElement>("status-route"),
    statusMasking: requireElement<HTMLSpanElement>("status-masking"),
    statusCost: requireElement<HTMLSpanElement>("status-cost"),
    statusTokens: requireElement<HTMLSpanElement>("status-tokens"),
    quotaBar: requireElement<HTMLDivElement>("quota-bar"),
    quotaProgressBar: requireElement<HTMLDivElement>("quota-progress-bar"),
    quotaLabel: requireElement<HTMLSpanElement>("quota-label"),
    quotaDetail: requireElement<HTMLSpanElement>("quota-detail"),

    // Welcome context elements
    welcomeWorkspaceName: requireElement<HTMLSpanElement>("welcome-workspace-name"),
    welcomeModelName: requireElement<HTMLSpanElement>("welcome-model-name"),
    welcomeContinueBtn: optionalElement<HTMLButtonElement>("welcome-continue-btn"),
    welcomeNewBtn: requireElement<HTMLButtonElement>("welcome-new-btn"),
    welcomeTempBtn: optionalElement<HTMLButtonElement>("welcome-temp-btn"),

    // Token/cost display (Phase 5 — hidden outside header, kept for compatibility)
    tokenDisplay: optionalElement("token-display"),
    costDisplay: optionalElement("cost-display"),

    // File change tracking — canonical inline panel (rendered above the input area)
    changedFilesBtn: document.getElementById("changed-files-btn") as HTMLButtonElement | null,
    changedFilesDropdown: document.getElementById("changed-files-panel"),
    cfDropdownTree: document.getElementById("cf-panel-tree"),
    cfCountBadge: document.getElementById("cf-count-badge"),

    // Checkpoint/undo panel (Phase 5)
    checkpointPanel: document.getElementById("checkpoint-panel"),
    recentPromptsRail: document.getElementById("recent-prompts-rail"),
    checkpointToggleBtn: requireElement("checkpoint-toggle-btn"),
    todosPanel: requireElement("todos-panel"),
    todosList: requireElement("todos-list"),
    todoAddForm: requireElement<HTMLFormElement>("todo-add-form"),
    todoAddInput: requireElement<HTMLInputElement>("todo-add-input"),
    todosToggleBtn: requireElement("todos-toggle-btn"),
    closeTodosBtn: requireElement("close-todos-btn"),
    activityToggleBtn: requireElement("activity-toggle-btn"),
    activityPanel: requireElement("activity-panel"),
    activityFilters: requireElement("activity-filters"),
    activityList: requireElement("activity-list"),
    activityCloseBtn: requireElement("activity-close-btn"),
    tasksToggleBtn: requireElement("tasks-toggle-btn"),
    tasksPanel: requireElement("tasks-panel"),
    tasksFilters: requireElement("tasks-filters"),
    tasksList: requireElement("tasks-list"),
    tasksCloseBtn: requireElement("tasks-close-btn"),
    terminalToggleBtn: requireElement("terminal-toggle-btn"),
    terminalPanel: requireElement("terminal-panel"),
    terminalList: requireElement("terminal-list"),
    terminalCloseBtn: requireElement("terminal-close-btn"),
    skillsBtn: requireElement("skills-btn"),
    skillsModal: requireElement("skills-modal"),
    skillsModalCloseBtn: requireElement("skills-modal-close-btn"),
    skillsSearchInput: requireElement<HTMLInputElement>("skills-search-input"),
    skillsFilter: requireElement("skills-filter"),
    skillsList: requireElement("skills-list"),
    subagentPanel: requireElement("subagent-panel"),
    subagentsToggleBtn: requireElement("subagents-toggle-btn"),
    subagentsBadge: document.getElementById("subagents-badge"),
    subagentList: requireElement("subagent-list"),
    subagentDetailView: requireElement("subagent-detail-view"),
    subagentDetailBackBtn: requireElement("subagent-detail-back-btn"),
    subagentDetailPopoutBtn: document.getElementById("subagent-detail-popout-btn")!,
    subagentDetailCloseBtn: requireElement("subagent-detail-close-btn"),
    subagentDetailContent: requireElement("subagent-detail-content"),
    closeSubagentBtn: requireElement("close-subagent-btn"),
    // Commands modal: optional lookup so older HTML bundles still load.
    commandsModal: document.getElementById("commands-modal"),
    commandsModalCloseBtn: document.getElementById("commands-modal-close-btn"),
    commandsSearchInput: document.getElementById("commands-search-input") as HTMLInputElement | null,
    commandsTitle: document.getElementById("commands-modal-title"),
    commandsFilter: document.getElementById("commands-filter"),
    commandsList: document.getElementById("commands-list"),
  }
}

export function scrollToBottom(el: HTMLElement) {
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
  })
}

export function getActiveMessageList(els: ElementRefs): HTMLDivElement | null {
  const activePanel = els.tabPanels.querySelector(".tab-panel.active")
  if (!activePanel) return null
  return activePanel.querySelector('.message-list')
}

export function getActiveTypingIndicator(els: ElementRefs): HTMLDivElement | null {
  const activePanel = els.tabPanels.querySelector(".tab-panel.active")
  if (!activePanel) return null
  return activePanel.querySelector('.typing-indicator')
}

/**
 * Apply the "Show thinking" preference globally.
 *
 * Two effects, both required:
 *  1. Body class `hide-thinking` — CSS uses this to `display: none` every
 *     `.thinking-block`. Without it the summary chip stays in the flow even
 *     after the user unchecks the toggle (the reported bug).
 *  2. `block.open` flip — keeps the per-block <details> attribute coherent
 *     with the global state so screen-readers, snapshot tests, and a future
 *     "expand on hover" do not see a stale value.
 *
 * Why both: hiding via the body class alone leaves stale `open` attributes
 * which leak through aria queries. Flipping `open` alone leaves the summary
 * chip rendered — which is exactly what the user reported.
 */
export function toggleAllThinkingBlocks(visible: boolean): void {
  document.body.classList.toggle('hide-thinking', !visible)
  const thinkingBlocks = document.querySelectorAll<HTMLDetailsElement>('.thinking-block')
  thinkingBlocks.forEach((block) => {
    if (block.classList.contains('thinking-streaming')) return
    block.open = visible
  })
}
