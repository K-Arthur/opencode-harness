import type { ElementRefs } from "./dom"

export type PermissionAction = "ask" | "allow" | "deny"

export interface PermissionRule {
  permission: string
  pattern: string
  action: PermissionAction
}

export interface PermissionConfigDeps {
  els: Pick<ElementRefs, "permissionConfigPanel" | "permissionConfigList" | "permissionConfigClose" | "permissionConfigSave" | "permissionConfigBtn">
  postMessage: (msg: Record<string, unknown>) => void
  onClose: () => void
}

const PERMISSION_TOOLS: Array<{ id: string; label: string; description: string }> = [
  { id: "read",     label: "Read",     description: "Read files from the workspace" },
  { id: "edit",     label: "Edit",     description: "Modify files in the workspace" },
  { id: "bash",     label: "Bash",     description: "Run shell commands" },
  { id: "glob",     label: "Glob",     description: "Search for files by pattern" },
  { id: "grep",     label: "Grep",     description: "Search file contents" },
  { id: "list",     label: "List",     description: "List directory contents" },
  { id: "task",     label: "Subagent", description: "Delegate work to sub-agents" },
  { id: "webfetch", label: "Web Fetch", description: "Fetch URLs from the web" },
  { id: "websearch",label: "Web Search",description: "Search the web" },
  { id: "todowrite",label: "Todos",    description: "Write task todos" },
  { id: "question", label: "Question", description: "Ask you questions" },
  { id: "lsp",      label: "LSP",      description: "Language server operations" },
  { id: "skill",    label: "Skill",    description: "Load and run skills" },
]

let _currentRules: PermissionRule[] = []

export function getDefaultRules(): PermissionRule[] {
  return PERMISSION_TOOLS.map(t => ({
    permission: t.id,
    pattern: "",
    action: "ask" as PermissionAction,
  }))
}

export function setupPermissionConfig(deps: PermissionConfigDeps): void {
  const { els, postMessage, onClose } = deps

  els.permissionConfigClose.addEventListener("click", close)
  els.permissionConfigSave.addEventListener("click", save)
  els.permissionConfigPanel.addEventListener("click", (e) => {
    if (e.target === els.permissionConfigPanel) close()
  })
  els.permissionConfigPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close() }
  })
  els.permissionConfigBtn?.addEventListener("click", () => {
    open()
  })

  function open(): void {
    _currentRules = loadCurrentRules()
    render()
    els.permissionConfigPanel.classList.remove("hidden")
  }

  function close(): void {
    els.permissionConfigPanel.classList.add("hidden")
    onClose()
  }

  function save(): void {
    const rules = collectRules()
    if (rules.length === 0) return
    _currentRules = rules
    postMessage({ type: "update_permission_config", rules })
    close()
  }

  function render(): void {
    const list = els.permissionConfigList
    list.innerHTML = ""

    const header = document.createElement("div")
    header.className = "perm-config-header"
    header.innerHTML = '<span class="perm-config-header-label">Tool</span><span class="perm-config-header-action">Policy</span>'
    list.appendChild(header)

    for (const tool of PERMISSION_TOOLS) {
      const current = _currentRules.find(r => r.permission === tool.id)
      const action = current?.action ?? "ask"

      const row = document.createElement("div")
      row.className = "perm-config-row"
      row.dataset.permission = tool.id
      row.setAttribute("role", "group")
      row.setAttribute("aria-label", `Permission for ${tool.label}`)

      const info = document.createElement("div")
      info.className = "perm-config-info"

      const label = document.createElement("span")
      label.className = "perm-config-label"
      label.textContent = tool.label
      info.appendChild(label)

      const desc = document.createElement("span")
      desc.className = "perm-config-desc"
      desc.textContent = tool.description
      info.appendChild(desc)

      row.appendChild(info)

      const select = document.createElement("select")
      select.className = "perm-config-select"
      select.setAttribute("aria-label", `Policy for ${tool.label}`)
      select.dataset.permission = tool.id

      const options: Array<{ value: PermissionAction; label: string }> = [
        { value: "ask",   label: "Ask me" },
        { value: "allow", label: "Always allow" },
        { value: "deny",  label: "Deny" },
      ]
      for (const opt of options) {
        const option = document.createElement("option")
        option.value = opt.value
        option.textContent = opt.label
        if (action === opt.value) option.selected = true
        select.appendChild(option)
      }

      row.appendChild(select)
      list.appendChild(row)
    }
  }

  function collectRules(): PermissionRule[] {
    const rules: PermissionRule[] = []
    const rows = els.permissionConfigList.querySelectorAll<HTMLElement>(".perm-config-row")
    for (const row of rows) {
      const perm = row.dataset.permission
      const select = row.querySelector<HTMLSelectElement>(".perm-config-select")
      if (!perm || !select) continue
      const action = select.value as PermissionAction
      const defaultAction = getDefaultRules().find(r => r.permission === perm)?.action ?? "ask"
      if (action !== defaultAction) {
        rules.push({ permission: perm, pattern: "", action })
      }
    }
    return rules
  }

  function loadCurrentRules(): PermissionRule[] {
    const session = document.querySelector("[data-session-permission-rules]")
    if (session) {
      try {
        const raw = session.getAttribute("data-session-permission-rules")
        if (raw) return JSON.parse(raw) as PermissionRule[]
      } catch { /* ignore */ }
    }
    return getDefaultRules()
  }
}

export function closePermissionConfig(panel: HTMLElement): void {
  panel.classList.add("hidden")
}
