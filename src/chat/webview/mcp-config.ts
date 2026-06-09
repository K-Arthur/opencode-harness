import type { McpServerInfo } from "../../mcp/McpServerManager"
import type { ElementRefs } from "./dom"

export interface McpConfigCallbacks {
  onAddServer: (name: string, config: { command: string; args?: string[]; env?: Record<string, string> }) => void
  onUpdateServer: (name: string, config: Partial<{ command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean }>) => void
  onRemoveServer: (name: string) => void
  onToggleServer: (name: string, disabled: boolean) => void
  onClose: () => void
}

export interface McpConfigHandlers {
  open: () => void
  close: () => void
  setServers: (servers: McpServerInfo[]) => void
  isOpen: () => boolean
}

export function setupMcpConfig(els: ElementRefs, callbacks: McpConfigCallbacks): McpConfigHandlers {
  let servers: McpServerInfo[] = []
  let isOpen = false
  let editingServer: string | null = null
  let mcpFocusTrap: ((e: KeyboardEvent) => void) | null = null
  let mcpLastFocus: HTMLElement | null = null

  const panel = els.mcpConfigPanel
  const list = els.mcpConfigList
  const addBtn = els.mcpConfigAdd
  const closeBtn = els.mcpConfigClose
  const form = els.mcpConfigForm
  const formTitle = els.mcpConfigFormTitle
  const nameInput = els.mcpConfigName
  const commandInput = els.mcpConfigCommand
  const argsInput = els.mcpConfigArgs
  const envInput = els.mcpConfigEnv
  const disabledCheck = els.mcpConfigDisabled
  const saveBtn = els.mcpConfigSave
  const cancelBtn = els.mcpConfigCancel

  function trapFocus(container: HTMLElement): (e: KeyboardEvent) => void {
    return (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function open() {
    isOpen = true
    panel.classList.remove("hidden")
    mcpLastFocus = document.activeElement as HTMLElement | null
    mcpFocusTrap = trapFocus(panel)
    document.addEventListener("keydown", mcpFocusTrap)
    const firstBtn = panel.querySelector<HTMLElement>('button, [href], input:not([type="hidden"])')
    if (firstBtn) firstBtn.focus()
    render()
  }

  function close() {
    isOpen = false
    panel.classList.add("hidden")
    resetForm()
    if (mcpFocusTrap) {
      document.removeEventListener("keydown", mcpFocusTrap)
      mcpFocusTrap = null
    }
    if (mcpLastFocus) {
      mcpLastFocus.focus({ preventScroll: true })
      mcpLastFocus = null
    }
    callbacks.onClose()
  }

  function setServers(newServers: McpServerInfo[]) {
    servers = newServers
    if (isOpen) render()
  }

  function render() {
    list.innerHTML = ""

    if (servers.length === 0) {
      const empty = document.createElement("div")
      empty.className = "mcp-config-empty"
      empty.textContent = "No MCP servers configured"
      list.appendChild(empty)
      return
    }

    for (const server of servers) {
      const disabled = server.config.disabled === true || server.config.enabled === false
      const row = document.createElement("div")
      row.className = "mcp-config-row" + (disabled ? " disabled" : "")

      const info = document.createElement("div")
      info.className = "mcp-config-row-info"

      const name = document.createElement("span")
      name.className = "mcp-config-row-name"
      name.textContent = server.name
      info.appendChild(name)

      const status = document.createElement("span")
      const statusClass = disabled ? "disabled" : server.status
      status.className = `mcp-config-row-status ${statusClass}`
      status.textContent = disabled ? "Disabled" : server.status
      info.appendChild(status)

      if (server.tools.length > 0 && !disabled) {
        const tools = document.createElement("span")
        tools.className = "mcp-config-row-tools"
        tools.textContent = `${server.tools.length} tools`
        info.appendChild(tools)
      }

      row.appendChild(info)

      const actions = document.createElement("div")
      actions.className = "mcp-config-row-actions"

      const editBtn = document.createElement("button")
      editBtn.className = "mcp-config-row-edit"
      editBtn.textContent = "Edit"
      editBtn.addEventListener("click", () => {
        editingServer = server.name
        showForm(server)
      })
      actions.appendChild(editBtn)

      const toggleBtn = document.createElement("button")
      toggleBtn.className = `mcp-config-row-toggle ${disabled ? "enable" : "disable"}`
      toggleBtn.textContent = disabled ? "Enable" : "Disable"
      toggleBtn.setAttribute("aria-pressed", String(!disabled))
      toggleBtn.title = disabled ? "Enable server" : "Disable server"
      toggleBtn.addEventListener("click", () => {
        callbacks.onToggleServer(server.name, !disabled)
      })
      actions.appendChild(toggleBtn)

      const removeBtn = document.createElement("button")
      removeBtn.className = "mcp-config-row-remove"
      removeBtn.textContent = "Remove"
      removeBtn.addEventListener("click", async () => {
        const confirmed = await confirmDialog(`Remove MCP server "${server.name}"?`)
        if (confirmed) {
          callbacks.onRemoveServer(server.name)
        }
      })
      actions.appendChild(removeBtn)

      row.appendChild(actions)
      list.appendChild(row)
    }
  }

  function showForm(server?: McpServerInfo) {
    form.classList.remove("hidden")
    if (server) {
      formTitle.textContent = `Edit: ${server.name}`
      nameInput.value = server.name
      nameInput.disabled = true
      commandInput.value = server.config.command || server.config.url || ""
      argsInput.value = server.config.args?.join("\n") || ""
      envInput.value = server.config.env ? JSON.stringify(server.config.env, null, 2) : ""
      disabledCheck.checked = server.config.disabled || false
    } else {
      formTitle.textContent = "Add MCP Server"
      nameInput.disabled = false
      resetForm()
    }
  }

  function resetForm() {
    nameInput.value = ""
    commandInput.value = ""
    argsInput.value = ""
    envInput.value = ""
    disabledCheck.checked = false
    editingServer = null
    form.classList.add("hidden")
  }

  function parseForm(): { name: string; config: { command: string; args?: string[]; env?: Record<string, string> } } | null {
    const name = nameInput.value.trim()
    const command = commandInput.value.trim()
    if (!name || !command) {
      alert("Name and command are required")
      return null
    }

    const args = argsInput.value.trim() ? argsInput.value.split("\n").map(s => s.trim()).filter(Boolean) : undefined
    let env: Record<string, string> | undefined
    if (envInput.value.trim()) {
      try {
        env = JSON.parse(envInput.value)
      } catch {
        alertMessage("Environment variables must be valid JSON")
        return null
      }
    }

    return { name, config: { command, args, env } }
  }

  function confirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div")
      overlay.className = "mcp-confirm-overlay"
      overlay.setAttribute("role", "dialog")
      overlay.setAttribute("aria-modal", "true")

      const box = document.createElement("div")
      box.className = "mcp-confirm-box"

      const msg = document.createElement("p")
      msg.textContent = message
      box.appendChild(msg)

      const btnContainer = document.createElement("div")
      btnContainer.className = "mcp-confirm-buttons"

      const okBtn = document.createElement("button")
      okBtn.textContent = "OK"
      okBtn.addEventListener("click", () => {
        document.body.removeChild(overlay)
        resolve(true)
      })

      const cancelBtn = document.createElement("button")
      cancelBtn.textContent = "Cancel"
      cancelBtn.addEventListener("click", () => {
        document.body.removeChild(overlay)
        resolve(false)
      })

      btnContainer.appendChild(cancelBtn)
      btnContainer.appendChild(okBtn)
      box.appendChild(btnContainer)
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      okBtn.focus()

      const trap = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          document.body.removeChild(overlay)
          resolve(false)
        }
        if (e.key !== "Tab") return
        const focusable = box.querySelectorAll<HTMLElement>("button")
        if (focusable.length === 0) return
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
      overlay.addEventListener("keydown", trap)
    })
  }

  function alertMessage(message: string) {
    const live = document.createElement("div")
    live.setAttribute("role", "alert")
    live.setAttribute("aria-live", "assertive")
    live.className = "mcp-alert"
    live.textContent = message
    panel.appendChild(live)
    setTimeout(() => live.remove(), 3000)
  }

  addBtn.addEventListener("click", () => showForm())
  closeBtn.addEventListener("click", close)
  saveBtn.addEventListener("click", () => {
    const parsed = parseForm()
    if (!parsed) return
    if (editingServer) {
      callbacks.onUpdateServer(editingServer, parsed.config)
    } else {
      callbacks.onAddServer(parsed.name, parsed.config)
    }
    resetForm()
    render()
  })
  cancelBtn.addEventListener("click", resetForm)

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      if (!form.classList.contains("hidden")) {
        resetForm()
      } else {
        close()
      }
    }
  })

  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      close()
    }
  })

  return {
    open,
    close,
    setServers,
    isOpen: () => isOpen,
  }
}
