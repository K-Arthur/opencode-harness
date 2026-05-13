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
  settingsBtn: HTMLElement

  contextBar: HTMLDivElement
  contextChips: HTMLDivElement
  contextUsage: HTMLDivElement
  contextProgressBar: HTMLElement
  contextLabel: HTMLSpanElement
  contextUsagePanel: HTMLElement
  closeContextUsageBtn: HTMLButtonElement
  
  welcomeRecentSessions: HTMLDivElement | null
  welcomeModelCtx: HTMLSpanElement | null

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

  // File change tracking (Phase 5)
  changedFilesList: HTMLElement | null

  // Checkpoint/undo panel (Phase 5)
  checkpointPanel: HTMLElement | null
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
    settingsBtn: requireElement("settings-btn"),

    contextBar: requireElement<HTMLDivElement>("context-bar"),
    contextChips: requireElement<HTMLDivElement>("context-chips"),
    contextUsage: requireElement<HTMLDivElement>("context-usage"),
    contextProgressBar: requireElement("context-progress-bar"),
    contextLabel: requireElement<HTMLSpanElement>("context-label"),
    contextUsagePanel: requireElement("context-usage-panel"),
    closeContextUsageBtn: requireElement<HTMLButtonElement>("close-context-usage-btn"),
    
    welcomeRecentSessions: optionalElement<HTMLDivElement>("welcome-recent-sessions"),
    welcomeModelCtx: optionalElement<HTMLSpanElement>("welcome-model-ctx"),

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

    // File change tracking (Phase 5)
    changedFilesList: optionalElement("changed-files-list"),

    // Checkpoint/undo panel (Phase 5)
    checkpointPanel: optionalElement("checkpoint-panel"),
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
