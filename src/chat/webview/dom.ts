export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing webview element: ${id}`)
  }
  return element as T
}

export interface ElementRefs {
  tabPanels: HTMLElement
  newTabBtn: HTMLElement

  promptInput: HTMLTextAreaElement
  sendBtn: HTMLElement
  abortBtn: HTMLElement
  mentionDropdown: HTMLDivElement
  inputArea: HTMLDivElement
  inputWrapper: HTMLDivElement
  inputBottomBar: HTMLDivElement
  
  mentionBtn: HTMLElement
  attachBtn: HTMLElement
  modeToggle: HTMLElement
  modeLabel: HTMLSpanElement
  modelSelectorBtn: HTMLElement
  modelLabel: HTMLSpanElement

  modelDropdown: HTMLDivElement
  newChatBtn: HTMLElement
  mcpBtn: HTMLElement
  settingsBtn: HTMLElement
  viewAllSessionsBtn: HTMLElement

  contextBar: HTMLDivElement
  contextChips: HTMLDivElement
  contextUsage: HTMLDivElement
  contextProgressBar: HTMLElement
  contextLabel: HTMLSpanElement
  
  recentSessions: HTMLDivElement
  recentList: HTMLDivElement
  
  agentStatusLed: HTMLDivElement
  agentStatusText: HTMLSpanElement
}

export function getElementRefs(): ElementRefs {
  return {
    tabPanels: requireElement("tab-panels"),
    newTabBtn: requireElement("new-tab-btn"),

    promptInput: requireElement<HTMLTextAreaElement>("prompt-input"),
    sendBtn: requireElement("send-btn"),
    abortBtn: requireElement("abort-btn"),
    mentionDropdown: requireElement<HTMLDivElement>("mention-dropdown"),
    inputArea: requireElement<HTMLDivElement>("input-area"),
    inputWrapper: requireElement<HTMLDivElement>("input-wrapper"),
    inputBottomBar: requireElement<HTMLDivElement>("input-bottom-bar"),
    
    mentionBtn: requireElement("mention-btn"),
    attachBtn: requireElement("attach-btn"),
    modeToggle: requireElement("mode-toggle"),
    modeLabel: requireElement<HTMLSpanElement>("mode-label"),
    modelSelectorBtn: requireElement("model-selector-btn"),
    modelLabel: requireElement<HTMLSpanElement>("model-label"),

    modelDropdown: requireElement<HTMLDivElement>("model-dropdown-container"),
    newChatBtn: requireElement("new-chat-btn"),
    mcpBtn: requireElement("mcp-btn"),
    settingsBtn: requireElement("settings-btn"),
    viewAllSessionsBtn: requireElement("view-all-sessions"),

    contextBar: requireElement<HTMLDivElement>("context-bar"),
    contextChips: requireElement<HTMLDivElement>("context-chips"),
    contextUsage: requireElement<HTMLDivElement>("context-usage"),
    contextProgressBar: requireElement("context-progress-bar"),
    contextLabel: requireElement<HTMLSpanElement>("context-label"),
    
    recentSessions: requireElement<HTMLDivElement>("recent-sessions"),
    recentList: requireElement<HTMLDivElement>("recent-list"),

    agentStatusLed: requireElement<HTMLDivElement>("agent-status-led"),
    agentStatusText: requireElement<HTMLSpanElement>("agent-status-text"),
  }
}

export function scrollToBottom(el: HTMLElement) {
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
  })
}

export function getActiveMessageList(els: ElementRefs): HTMLDivElement | null {
  const activeId = els.tabPanels.getAttribute("activeid") || "tab-default"
  // The panel view ID is "view-" + tabId (without the "tab-" prefix)
  const viewId = "view-" + activeId.replace("tab-", "")
  const activeView = els.tabPanels.querySelector(`#${viewId}`)
  if (!activeView) return null
  return activeView.querySelector('.message-list')
}

export function getActiveTypingIndicator(els: ElementRefs): HTMLDivElement | null {
  const activeId = els.tabPanels.getAttribute("activeid") || "tab-default"
  const viewId = "view-" + activeId.replace("tab-", "")
  const activeView = els.tabPanels.querySelector(`#${viewId}`)
  if (!activeView) return null
  return activeView.querySelector('.typing-indicator')
}
