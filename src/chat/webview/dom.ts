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
  commandsPaletteBtn: HTMLElement
  attachBtn: HTMLElement
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

  modelDropdown: HTMLDivElement
  variantDropdown: HTMLDivElement
  historyBtn: HTMLElement
  mcpBtn: HTMLElement
  timelineToggleBtn: HTMLElement
  thinkingToggleMenuItem: HTMLElement
  thinkingCheckmark: HTMLElement | null
  settingsBtn: HTMLElement

  contextBar: HTMLDivElement
  contextChips: HTMLDivElement
  contextUsage: HTMLDivElement
  contextProgressBar: HTMLElement
  contextLabel: HTMLSpanElement
  contextUsageBtn: HTMLButtonElement | null
  contextUsageDropdown: HTMLElement | null
  ctxDropdownContent: HTMLElement | null
  ctxPctBadge: HTMLElement | null
  // Legacy context-monitor refs — kept for backward compat with context-monitor.ts
  contextMonitorPanel: HTMLDivElement | null
  contextMonitorClose: HTMLButtonElement | null
  contextMonitorHistoryGraph: HTMLDivElement | null
  contextMonitorCostDisplay: HTMLDivElement | null
  contextMonitorSuggestionsPanel: HTMLDivElement | null
  
  promptStashPanel: HTMLDivElement | null
  promptStashClose: HTMLButtonElement | null
  promptStashList: HTMLDivElement | null
  
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

  modeWarningModal: HTMLDivElement
  modeWarningTitle: HTMLSpanElement
  modeWarningDescription: HTMLParagraphElement
  modeWarningDontShow: HTMLInputElement
  modeWarningCancel: HTMLButtonElement
  modeWarningConfirm: HTMLButtonElement

  welcomeView: HTMLDivElement

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

  // Display toggles (Phase 4.2)
  displayToggles: HTMLElement
  toggleText: HTMLInputElement
  toggleTools: HTMLInputElement
  toggleDiffs: HTMLInputElement
  toggleErrors: HTMLInputElement

  // Settings overflow menu
  settingsMenu: HTMLElement
  themeCustomizerBtn: HTMLElement
  themeCustomizerPanel: HTMLDivElement
  themeCustomizerClose: HTMLButtonElement
  themePresetCards: HTMLDivElement
  themeCliSearch: HTMLInputElement
  themeCliList: HTMLDivElement
  themePreviewSwatch: HTMLDivElement
  themeCustomizerReset: HTMLButtonElement
  themeCustomizerSave: HTMLButtonElement

  // Status strip (below tab bar)
  statusStrip: HTMLElement
  statusModel: HTMLSpanElement
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
  checkpointToggleBtn: HTMLElement
  todosPanel: HTMLElement
  closeTodosBtn: HTMLElement
  todosList: HTMLElement
  todoAddForm: HTMLFormElement
  todoAddInput: HTMLInputElement
  todosToggleBtn: HTMLElement
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
  closeSubagentBtn: HTMLElement
  subagentList: HTMLElement
}

export function getElementRefs(): ElementRefs {
  return {
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
    commandsPaletteBtn: requireElement("commands-palette-btn"),
    attachBtn: requireElement("attach-btn"),
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

    modelDropdown: requireElement<HTMLDivElement>("model-dropdown-container"),
    variantDropdown: requireElement<HTMLDivElement>("variant-dropdown-container"),
    historyBtn: requireElement("history-btn"),
    mcpBtn: requireElement("mcp-btn"),
    timelineToggleBtn: requireElement("timeline-toggle-btn"),
    thinkingToggleMenuItem: requireElement("thinking-toggle-menu-item"),
    thinkingCheckmark: document.querySelector<HTMLElement>("#thinking-toggle-menu-item .settings-menu-checkmark"),
    settingsBtn: requireElement("settings-btn"),

    contextBar: requireElement<HTMLDivElement>("context-bar"),
    contextChips: requireElement<HTMLDivElement>("context-chips"),
    contextUsage: requireElement<HTMLDivElement>("context-usage"),
    contextProgressBar: requireElement("context-progress-bar"),
    contextLabel: requireElement<HTMLSpanElement>("context-label"),
    contextUsageBtn: document.getElementById("context-usage-btn") as HTMLButtonElement | null,
    contextUsageDropdown: document.getElementById("context-usage-dropdown"),
    ctxDropdownContent: document.getElementById("ctx-dropdown-content"),
    ctxPctBadge: document.getElementById("ctx-pct-badge"),
    // Legacy context-monitor refs — elements removed from HTML, always null now
    contextMonitorPanel: null,
    contextMonitorClose: null,
    contextMonitorHistoryGraph: null,
    contextMonitorCostDisplay: null,
    contextMonitorSuggestionsPanel: null,
    
    promptStashPanel: optionalElement<HTMLDivElement>("prompt-stash-panel"),
    promptStashClose: optionalElement<HTMLButtonElement>("prompt-stash-close"),
    promptStashList: optionalElement<HTMLDivElement>("prompt-stash-list"),
    
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

    modeWarningModal: requireElement<HTMLDivElement>("mode-warning-modal"),
    modeWarningTitle: requireElement<HTMLSpanElement>("mode-warning-title"),
    modeWarningDescription: requireElement<HTMLParagraphElement>("mode-warning-description"),
    modeWarningDontShow: requireElement<HTMLInputElement>("mode-warning-dont-show"),
    modeWarningCancel: requireElement<HTMLButtonElement>("mode-warning-cancel"),
    modeWarningConfirm: requireElement<HTMLButtonElement>("mode-warning-confirm"),

    welcomeView: requireElement<HTMLDivElement>("welcome-view"),

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

    // Display toggles (Phase 4.2)
    displayToggles: requireElement("display-toggles"),
    toggleText: requireElement<HTMLInputElement>("toggle-text"),
    toggleTools: requireElement<HTMLInputElement>("toggle-tools"),
    toggleDiffs: requireElement<HTMLInputElement>("toggle-diffs"),
    toggleErrors: requireElement<HTMLInputElement>("toggle-errors"),

    // Settings overflow menu
    settingsMenu: requireElement("settings-menu"),
    themeCustomizerBtn: requireElement("theme-customizer-btn"),
    themeCustomizerPanel: requireElement<HTMLDivElement>("theme-customizer-panel"),
    themeCustomizerClose: requireElement<HTMLButtonElement>("theme-customizer-close"),
    themePresetCards: requireElement<HTMLDivElement>("theme-preset-cards"),
    themeCliSearch: requireElement<HTMLInputElement>("theme-cli-search"),
    themeCliList: requireElement<HTMLDivElement>("theme-cli-list"),
    themePreviewSwatch: requireElement<HTMLDivElement>("theme-preview-swatch"),
    themeCustomizerReset: requireElement<HTMLButtonElement>("theme-customizer-reset"),
    themeCustomizerSave: requireElement<HTMLButtonElement>("theme-customizer-save"),

    // Status strip (below tab bar)
    statusStrip: requireElement("status-strip"),
    statusModel: requireElement<HTMLSpanElement>("status-model"),
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

    // Token/cost display (Phase 5 — hidden outside header, kept for compatibility)
    tokenDisplay: optionalElement("token-display"),
    costDisplay: optionalElement("cost-display"),

    // File change tracking — canonical toolbar dropdown
    changedFilesBtn: document.getElementById("changed-files-btn") as HTMLButtonElement | null,
    changedFilesDropdown: document.getElementById("changed-files-dropdown"),
    cfDropdownTree: document.getElementById("cf-dropdown-tree"),
    cfCountBadge: document.getElementById("cf-count-badge"),

    // Checkpoint/undo panel (Phase 5)
    checkpointPanel: document.getElementById("checkpoint-panel"),
    checkpointToggleBtn: requireElement("checkpoint-toggle-btn"),
    todosPanel: requireElement("todos-panel"),
    closeTodosBtn: requireElement("close-todos-btn"),
    todosList: requireElement("todos-list"),
    todoAddForm: requireElement<HTMLFormElement>("todo-add-form"),
    todoAddInput: requireElement<HTMLInputElement>("todo-add-input"),
    todosToggleBtn: requireElement("todos-toggle-btn"),
    skillsBtn: requireElement("skills-btn"),
    skillsModal: requireElement("skills-modal"),
    skillsModalCloseBtn: requireElement("skills-modal-close-btn"),
    skillsSearchInput: requireElement<HTMLInputElement>("skills-search-input"),
    skillsFilter: requireElement("skills-filter"),
    skillsList: requireElement("skills-list"),
    subagentPanel: requireElement("subagent-panel"),
    closeSubagentBtn: requireElement("close-subagent-btn"),
    subagentList: requireElement("subagent-list"),
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
    block.open = visible
  })
}
