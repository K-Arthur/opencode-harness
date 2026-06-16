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

let panel: HTMLElement | null = null
let discoverList: HTMLElement | null = null
let credentialList: HTMLElement | null = null
let apiKeyModal: HTMLElement | null = null
let apiKeyInput: HTMLInputElement | null = null
let apiKeyLabel: HTMLElement | null = null
let apiKeyHint: HTMLElement | null = null
let focusTrap: ((e: KeyboardEvent) => void) | null = null
let lastFocus: HTMLElement | null = null
let activeTab = "discover"
let pendingOAuthProviderId: string | null = null
let cachedDeps: ProviderPanelDeps | null = null

export function setupProviderPanel(deps: ProviderPanelDeps): void {
  cachedDeps = deps
  panel = document.getElementById("provider-panel")
  discoverList = document.getElementById("provider-discovery-list")
  credentialList = document.getElementById("provider-credential-list")
  apiKeyModal = document.getElementById("api-key-modal")
  apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement
  apiKeyLabel = document.getElementById("api-key-label")
  apiKeyHint = document.getElementById("api-key-hint")

  if (!panel) return

  const closeBtn = document.getElementById("provider-panel-close")
  closeBtn?.addEventListener("click", () => closeProviderPanel())

  panel.addEventListener("click", (e) => {
    if (e.target === panel) closeProviderPanel()
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (apiKeyModal && !apiKeyModal.classList.contains("hidden")) {
        closeApiKeyModal()
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

  setupApiKeyModal(deps)
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

function setupApiKeyModal(deps: ProviderPanelDeps): void {
  const closeBtn = document.getElementById("api-key-modal-close")
  const cancelBtn = document.getElementById("api-key-cancel")
  const submitBtn = document.getElementById("api-key-submit")

  closeBtn?.addEventListener("click", () => closeApiKeyModal())
  cancelBtn?.addEventListener("click", () => closeApiKeyModal())
  submitBtn?.addEventListener("click", () => {
    if (!apiKeyInput || !pendingOAuthProviderId) return
    const key = apiKeyInput.value.trim()
    if (!key) return
    deps.postMessage({
      type: "connect_provider_key",
      providerId: pendingOAuthProviderId,
      key,
    })
    closeApiKeyModal()
  })

  apiKeyInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      submitBtn?.click()
    }
  })

  apiKeyModal?.addEventListener("click", (e) => {
    if (e.target === apiKeyModal) closeApiKeyModal()
  })
}

function openApiKeyModal(providerId: string, providerName: string): void {
  pendingOAuthProviderId = providerId
  if (apiKeyModal) apiKeyModal.classList.remove("hidden")
  if (apiKeyLabel) apiKeyLabel.textContent = `API Key for ${providerName}`
  if (apiKeyHint) apiKeyHint.textContent = `Your key for ${providerName} is stored locally and never sent to OpenCode servers.`
  if (apiKeyInput) {
    apiKeyInput.value = ""
    apiKeyInput.placeholder = "sk-..."
    setTimeout(() => apiKeyInput?.focus(), 50)
  }
}

function closeApiKeyModal(): void {
  pendingOAuthProviderId = null
  if (apiKeyModal) apiKeyModal.classList.add("hidden")
}

export function openProviderPanel(): void {
  if (!panel) return
  lastFocus = document.activeElement as HTMLElement
  panel.classList.remove("hidden")
  if (cachedDeps) {
    focusTrap = cachedDeps.trapFocus(panel)
  }
}

export function closeProviderPanel(): void {
  if (!panel) return
  panel.classList.add("hidden")
  if (focusTrap) {
    document.removeEventListener("keydown", focusTrap)
    focusTrap = null
  }
  if (lastFocus && typeof lastFocus.focus === "function") {
    lastFocus.focus()
    lastFocus = null
  }
}

export function renderProviderDiscoveryList(
  providers: ProviderDiscoveryItem[],
  authMethods: Map<string, ProviderAuthMethodInfo[]>,
  postMessage: (msg: Record<string, unknown>) => void,
): void {
  if (!discoverList) return
  discoverList.replaceChildren()

  if (providers.length === 0) {
    const empty = document.createElement("div")
    empty.className = "provider-empty"
    empty.textContent = "No providers found. Start the OpenCode server to discover providers."
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
      meta.textContent += ` · env: ${provider.envVars.join(", ")}`
    }
    info.appendChild(meta)

    row.appendChild(info)

    const actions = document.createElement("div")
    actions.className = "provider-actions"

    const statusBadge = document.createElement("span")
    statusBadge.className = `provider-status ${STATUS_CLASSES[provider.status]}`
    statusBadge.textContent = STATUS_LABELS[provider.status] ?? "Unknown"
    actions.appendChild(statusBadge)

    if (provider.status === "needs_key") {
      const connectBtn = document.createElement("button")
      connectBtn.className = "btn btn-sm btn-primary"
      connectBtn.textContent = "Add Key"
      connectBtn.addEventListener("click", () => {
        openApiKeyModal(provider.id, provider.name)
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

export function handleOAuthStarted(providerId: string, authorizationUrl: string): void {
  pendingOAuthProviderId = providerId
  window.open(authorizationUrl, "_blank")
}

export function handleOAuthCompleted(providerId: string, ok: boolean, error?: string): void {
  if (pendingOAuthProviderId === providerId) {
    pendingOAuthProviderId = null
  }
  if (!ok && error) {
    console.warn(`[provider-panel] OAuth failed for ${providerId}: ${error}`)
  }
}
