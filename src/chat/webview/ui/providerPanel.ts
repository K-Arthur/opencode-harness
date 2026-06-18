import type { ProviderDiscoveryItem, ProviderAuthMethodInfo, ProviderCredentialInfo } from "../types"

export interface ProviderPanelDeps {
  postMessage: (msg: Record<string, unknown>) => void
  trapFocus: (container: HTMLElement) => (e: KeyboardEvent) => void
}

const STATUS_LABELS: Record<ProviderDiscoveryItem["status"], string> = {
  connected: "Connected",
  needs_key: "Needs API Key",
  needs_oauth: "Needs OAuth",
}

const STATUS_CLASSES: Record<ProviderDiscoveryItem["status"], string> = {
  connected: "provider-status-connected",
  needs_key: "provider-status-needs-key",
  needs_oauth: "provider-status-needs-oauth",
}

const STATUS_ICON_SVGS: Record<ProviderDiscoveryItem["status"], string> = {
  connected: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>',
  needs_key: "",
  needs_oauth: "",
}

let panel: HTMLElement | null = null
let discoverList: HTMLElement | null = null
let credentialList: HTMLElement | null = null
let stepList: HTMLElement | null = null
let stepKey: HTMLElement | null = null
let apiKeyInput: HTMLInputElement | null = null
let apiKeyLabel: HTMLElement | null = null
let apiKeyHint: HTMLElement | null = null
let apiKeyTitle: HTMLElement | null = null
let apiKeyError: HTMLElement | null = null
let apiKeySubmitBtn: HTMLButtonElement | null = null
let apiKeySubmitLabel: HTMLElement | null = null
let apiKeySubmitSpinner: HTMLElement | null = null
let searchInput: HTMLInputElement | null = null
let focusTrap: ((e: KeyboardEvent) => void) | null = null
let lastFocus: HTMLElement | null = null
let activeTab = "discover"
let pendingOAuthProviderId: string | null = null
let cachedDeps: ProviderPanelDeps | null = null
let oauthPollTimer: ReturnType<typeof setInterval> | null = null
let cachedProviders: ProviderDiscoveryItem[] = []
let cachedAuthMethods: Map<string, ProviderAuthMethodInfo[]> = new Map()
let cachedPostMessage: ((msg: Record<string, unknown>) => void) | null = null
let connectingProviderId: string | null = null

export function setupProviderPanel(deps: ProviderPanelDeps): void {
  cachedDeps = deps
  panel = document.getElementById("provider-panel")
  discoverList = document.getElementById("provider-discovery-list")
  credentialList = document.getElementById("provider-credential-list")
  stepList = document.getElementById("provider-step-list")
  stepKey = document.getElementById("provider-step-key")
  apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement
  apiKeyLabel = document.getElementById("api-key-label")
  apiKeyHint = document.getElementById("api-key-hint")
  apiKeyTitle = document.getElementById("api-key-title")
  apiKeyError = document.getElementById("api-key-error")
  apiKeySubmitBtn = document.getElementById("api-key-submit") as HTMLButtonElement
  apiKeySubmitLabel = document.getElementById("api-key-submit-label")
  apiKeySubmitSpinner = document.getElementById("api-key-submit-spinner")
  searchInput = document.getElementById("provider-search-input") as HTMLInputElement

  if (!panel) return

  const closeBtn = document.getElementById("provider-panel-close")
  closeBtn?.addEventListener("click", () => closeProviderPanel())

  panel.addEventListener("click", (e) => {
    if (e.target === panel) closeProviderPanel()
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (stepKey && !stepKey.classList.contains("provider-step--hidden")) {
        showListStep()
        return
      }
      if (panel && !panel.classList.contains("hidden")) {
        closeProviderPanel()
      }
    }
  })

  const tabs = panel.querySelectorAll(".provider-tab")
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const tabName = (tab as HTMLElement).dataset.tab
      if (tabName) switchTab(tabName)
    })
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => filterProviders())
  }

  setupInlineKeyEntry(deps)
}

function switchTab(tabName: string): void {
  activeTab = tabName
  if (!panel) return

  const tabs = panel.querySelectorAll(".provider-tab")
  for (const tab of tabs) {
    const isActive = (tab as HTMLElement).dataset.tab === tabName
    tab.classList.toggle("active", isActive)
    tab.setAttribute("aria-selected", isActive ? "true" : "false")
  }

  const contents = panel.querySelectorAll(".provider-tab-content")
  for (const content of contents) {
    const isTarget = (content as HTMLElement).dataset.tab === tabName
    content.classList.toggle("hidden", !isTarget)
  }
}

// ── Inline step transitions ──

function showKeyStep(providerId: string, providerName: string): void {
  pendingOAuthProviderId = providerId
  connectingProviderId = null

  if (apiKeyTitle) apiKeyTitle.textContent = providerName
  if (apiKeyLabel) apiKeyLabel.textContent = `API Key for ${providerName}`
  if (apiKeyHint) apiKeyHint.textContent = `Your key for ${providerName} is stored locally and never sent to OpenCode servers.`
  if (apiKeyInput) {
    apiKeyInput.value = ""
    apiKeyInput.placeholder = "sk-..."
  }
  hideKeyError()
  setSubmitLoading(false)

  if (stepList) {
    stepList.classList.add("provider-step--hidden")
  }
  if (stepKey) {
    stepKey.classList.remove("provider-step--hidden")
    stepKey.classList.add("provider-step--slide-in")
    stepKey.addEventListener("animationend", () => {
      stepKey?.classList.remove("provider-step--slide-in")
    }, { once: true })
  }
  setTimeout(() => apiKeyInput?.focus(), 80)
}

function showListStep(): void {
  pendingOAuthProviderId = null
  connectingProviderId = null

  if (stepKey) {
    stepKey.classList.add("provider-step--hidden")
    stepKey.classList.remove("provider-step--slide-in")
  }
  if (stepList) {
    stepList.classList.remove("provider-step--hidden")
  }
}

function setupInlineKeyEntry(deps: ProviderPanelDeps): void {
  const backBtn = document.getElementById("api-key-back")
  const cancelBtn = document.getElementById("api-key-cancel")

  backBtn?.addEventListener("click", () => showListStep())
  cancelBtn?.addEventListener("click", () => showListStep())

  apiKeySubmitBtn?.addEventListener("click", () => {
    if (!apiKeyInput || !pendingOAuthProviderId) return
    const key = apiKeyInput.value.trim()
    if (!key) {
      showKeyError("Please enter an API key.")
      return
    }
    hideKeyError()
    setSubmitLoading(true)
    connectingProviderId = pendingOAuthProviderId
    deps.postMessage({
      type: "connect_provider_key",
      providerId: pendingOAuthProviderId,
      key,
    })
  })

  apiKeyInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      apiKeySubmitBtn?.click()
    }
  })

  apiKeyInput?.addEventListener("input", () => hideKeyError())
}

function showKeyError(msg: string): void {
  if (apiKeyError) {
    apiKeyError.textContent = msg
    apiKeyError.classList.remove("hidden")
  }
}

function hideKeyError(): void {
  if (apiKeyError) {
    apiKeyError.textContent = ""
    apiKeyError.classList.add("hidden")
  }
}

function setSubmitLoading(loading: boolean): void {
  if (apiKeySubmitBtn) apiKeySubmitBtn.disabled = loading
  if (apiKeySubmitLabel) apiKeySubmitLabel.textContent = loading ? "Connecting..." : "Connect"
  if (apiKeySubmitSpinner) apiKeySubmitSpinner.classList.toggle("hidden", !loading)
}

export function onProviderKeyResult(providerId: string, success: boolean, error?: string): void {
  if (connectingProviderId !== providerId) return
  setSubmitLoading(false)
  if (success) {
    showListStep()
  } else if (error) {
    showKeyError(error)
  }
}

// ── Search ──

function filterProviders(): void {
  if (!cachedPostMessage) return
  const query = (searchInput?.value ?? "").toLowerCase().trim()
  const filtered = query
    ? cachedProviders.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query),
      )
    : cachedProviders
  renderProviderDiscoveryList(filtered, cachedAuthMethods, cachedPostMessage, true)
}

// ── Open / close ──

export function openProviderPanel(): void {
  if (!panel) return
  lastFocus = document.activeElement as HTMLElement
  panel.classList.remove("hidden")
  showListStep()
  if (searchInput) {
    searchInput.value = ""
    searchInput.focus()
  }
  if (cachedDeps) {
    focusTrap = cachedDeps.trapFocus(panel)
  }
}

export function closeProviderPanel(): void {
  if (!panel) return
  panel.classList.add("hidden")
  showListStep()
  if (focusTrap) {
    document.removeEventListener("keydown", focusTrap)
    focusTrap = null
  }
  if (lastFocus && typeof lastFocus.focus === "function") {
    lastFocus.focus()
    lastFocus = null
  }
}

// ── Render discovery list ──

export function renderProviderDiscoveryList(
  providers: ProviderDiscoveryItem[],
  authMethods: Map<string, ProviderAuthMethodInfo[]>,
  postMessage: (msg: Record<string, unknown>) => void,
  skipCache = false,
): void {
  if (!skipCache) {
    cachedProviders = providers
    cachedAuthMethods = authMethods
    cachedPostMessage = postMessage
    if (searchInput) searchInput.value = ""
  }

  if (!discoverList) return
  discoverList.replaceChildren()

  if (providers.length === 0) {
    const empty = document.createElement("div")
    empty.className = "provider-empty"
    const searchActive = searchInput !== null && searchInput.value.trim().length > 0
    empty.textContent = searchActive
      ? `No providers matching "${searchInput!.value.trim()}".`
      : "No providers found. Start the OpenCode server to discover providers."
    discoverList.appendChild(empty)
    return
  }

  for (const provider of providers) {
    const row = document.createElement("div")
    row.className = "provider-row"
    row.dataset.providerId = provider.id

    const info = document.createElement("div")
    info.className = "provider-info"

    const name = document.createElement("span")
    name.className = "provider-name"
    name.textContent = provider.name
    info.appendChild(name)

    const meta = document.createElement("span")
    meta.className = "provider-meta"
    meta.textContent = `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}`
    if (provider.envVars.length > 0) {
      meta.textContent += ` \u00b7 env: ${provider.envVars.join(", ")}`
    }
    info.appendChild(meta)

    row.appendChild(info)

    const actions = document.createElement("div")
    actions.className = "provider-actions"

    const statusBadge = document.createElement("span")
    statusBadge.className = `provider-status ${STATUS_CLASSES[provider.status]}`
    const iconSvg = STATUS_ICON_SVGS[provider.status]
    if (iconSvg) {
      const iconWrap = document.createElement("span")
      iconWrap.innerHTML = iconSvg
      statusBadge.appendChild(iconWrap.firstChild as Node)
    }
    const statusText = document.createElement("span")
    statusText.textContent = STATUS_LABELS[provider.status] ?? "Unknown"
    statusBadge.appendChild(statusText)
    actions.appendChild(statusBadge)

    if (provider.status === "needs_key") {
      const connectBtn = document.createElement("button")
      connectBtn.className = "btn btn-sm btn-primary"
      connectBtn.textContent = "Add Key"
      connectBtn.addEventListener("click", () => {
        showKeyStep(provider.id, provider.name)
      })
      actions.appendChild(connectBtn)
    } else if (provider.status === "needs_oauth") {
      const methods = authMethods.get(provider.id) ?? []
      const oauthMethod = methods.find((m) => m.type === "oauth")
      if (oauthMethod) {
        const oauthBtn = document.createElement("button")
        oauthBtn.className = "btn btn-sm btn-primary"
        oauthBtn.textContent = "Connect OAuth"
        oauthBtn.addEventListener("click", () => {
          postMessage({ type: "connect_provider_oauth", providerId: provider.id })
        })
        actions.appendChild(oauthBtn)
      }
    }

    row.appendChild(actions)
    discoverList.appendChild(row)
  }
}

// ── Render credential list ──

export function renderProviderCredentialList(
  credentials: ProviderCredentialInfo[],
  postMessage: (msg: Record<string, unknown>) => void,
): void {
  if (!credentialList) return
  credentialList.replaceChildren()

  if (credentials.length === 0) {
    const empty = document.createElement("div")
    empty.className = "provider-empty"
    empty.textContent = "No stored credentials. Connect a provider to add credentials."
    credentialList.appendChild(empty)
    return
  }

  for (const cred of credentials) {
    const row = document.createElement("div")
    row.className = "provider-credential-row"

    const info = document.createElement("div")
    info.className = "provider-info"

    const name = document.createElement("span")
    name.className = "provider-name"
    name.textContent = cred.label
    info.appendChild(name)

    const meta = document.createElement("span")
    meta.className = "provider-meta"
    meta.textContent = cred.type === "api" ? "API Key" : "OAuth"
    info.appendChild(meta)

    row.appendChild(info)

    const removeBtn = document.createElement("button")
    removeBtn.className = "btn btn-sm btn-danger"
    removeBtn.textContent = "Remove"
    removeBtn.addEventListener("click", () => {
      postMessage({ type: "remove_provider_credential", credentialId: cred.id })
    })
    row.appendChild(removeBtn)

    credentialList.appendChild(row)
  }
}

// ── OAuth ──

export function handleOAuthStarted(providerId: string, authorizationUrl: string, postMessage: (msg: Record<string, unknown>) => void): void {
  pendingOAuthProviderId = providerId
  window.open(authorizationUrl, "_blank")

  stopOAuthPolling()
  let attempts = 0
  const MAX_ATTEMPTS = 60
  oauthPollTimer = setInterval(() => {
    attempts++
    if (attempts > MAX_ATTEMPTS || !pendingOAuthProviderId) {
      stopOAuthPolling()
      return
    }
    postMessage({ type: "discover_providers" })
  }, 2000)
}

function stopOAuthPolling(): void {
  if (oauthPollTimer) {
    clearInterval(oauthPollTimer)
    oauthPollTimer = null
  }
}

export function handleOAuthCompleted(providerId: string, ok: boolean, error?: string): void {
  if (pendingOAuthProviderId === providerId) {
    pendingOAuthProviderId = null
    stopOAuthPolling()
  }
  if (!ok && error) {
    console.warn(`[provider-panel] OAuth failed for ${providerId}: ${error}`)
  }
}
