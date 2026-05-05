export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing webview element: ${id}`)
  }
  return element as T
}

export function optionalElement<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id)
  if (!element) {
    console.warn(`[OpenCode] Optional element not found: ${id}`)
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
  modePlanBtn: HTMLElement
  modeAutoBtn: HTMLElement
  modeBuildBtn: HTMLElement
  modelSelectorBtn: HTMLElement
  modelLabel: HTMLSpanElement
  variantSelectorBtn: HTMLElement
  variantLabel: HTMLSpanElement
  
  modelDropdown: HTMLDivElement
  variantDropdown: HTMLDivElement
  historyBtn: HTMLElement
  mcpBtn: HTMLElement
  settingsBtn: HTMLElement

  contextBar: HTMLDivElement
  contextChips: HTMLDivElement
  contextUsage: HTMLDivElement
  contextProgressBar: HTMLElement
  contextLabel: HTMLSpanElement
  
  recentSessions: HTMLDivElement | null

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
    modePlanBtn: requireElement("mode-plan-btn"),
    modeAutoBtn: requireElement("mode-auto-btn"),
    modeBuildBtn: requireElement("mode-build-btn"),
    modelSelectorBtn: requireElement("model-selector-btn"),
    modelLabel: requireElement<HTMLSpanElement>("model-label"),
    variantSelectorBtn: requireElement("variant-selector-btn"),
    variantLabel: requireElement<HTMLSpanElement>("variant-label"),
    
    modelDropdown: requireElement<HTMLDivElement>("model-dropdown-container"),
    variantDropdown: requireElement<HTMLDivElement>("variant-dropdown-container"),
    historyBtn: requireElement("history-btn"),
    mcpBtn: requireElement("mcp-btn"),
    settingsBtn: requireElement("settings-btn"),

    contextBar: requireElement<HTMLDivElement>("context-bar"),
    contextChips: requireElement<HTMLDivElement>("context-chips"),
    contextUsage: requireElement<HTMLDivElement>("context-usage"),
    contextProgressBar: requireElement("context-progress-bar"),
    contextLabel: requireElement<HTMLSpanElement>("context-label"),
    
    recentSessions: optionalElement<HTMLDivElement>("recent-sessions"),

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
