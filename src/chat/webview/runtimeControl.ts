export type RuntimePreference = "auto" | "opencode" | "opencode2"
export type ConnectedRuntime = "opencode" | "opencode2" | "unknown"

export interface RuntimeControlStatus {
  connected: boolean
  runtime: ConnectedRuntime
  apiSurface?: "legacy" | "opencode2" | "unknown"
  version?: string
  preference?: RuntimePreference
}

export interface RuntimeControlDeps {
  select: HTMLSelectElement | null
  badge: HTMLElement | null
  postMessage: (message: Record<string, unknown>) => void
}

export interface RuntimeControl {
  applyStatus(status: RuntimeControlStatus): void
  applySwitchResult(result: { ok: boolean; runtime?: RuntimePreference; error?: string }): void
  dispose(): void
}

const RUNTIME_LABELS: Record<RuntimePreference, string> = {
  auto: "Auto",
  opencode: "OpenCode",
  opencode2: "OpenCode 2",
}

function isRuntimePreference(value: unknown): value is RuntimePreference {
  return value === "auto" || value === "opencode" || value === "opencode2"
}

function isConnectedRuntime(value: unknown): value is ConnectedRuntime {
  return value === "opencode" || value === "opencode2" || value === "unknown"
}

function runtimeLabel(runtime: ConnectedRuntime): string {
  return runtime === "opencode2" ? "OpenCode 2" : runtime === "opencode" ? "OpenCode" : "Unknown runtime"
}

/**
 * Header control for selecting the active OpenCode API/runtime.
 *
 * The control reports the persisted preference separately from the verified
 * runtime badge: Auto may resolve to either executable, while the badge always
 * reflects the health route that actually answered.
 */
export function setupRuntimeControl(deps: RuntimeControlDeps): RuntimeControl {
  let preference: RuntimePreference = isRuntimePreference(deps.select?.value) ? deps.select.value : "auto"
  let previousPreference = preference
  let lastStatus: RuntimeControlStatus = { connected: false, runtime: "unknown", preference }
  let switching = false

  const setBadge = (text: string, title: string, state: "connected" | "disconnected" | "switching"): void => {
    if (!deps.badge) return
    deps.badge.textContent = text
    deps.badge.title = title
    deps.badge.dataset.state = state
    deps.badge.setAttribute("aria-label", title)
    deps.badge.setAttribute("aria-busy", state === "switching" ? "true" : "false")
  }

  const renderStatus = (): void => {
    if (switching) {
      setBadge("Switching…", "Switching OpenCode runtime", "switching")
      return
    }
    if (!lastStatus.connected || !isConnectedRuntime(lastStatus.runtime) || lastStatus.runtime === "unknown") {
      setBadge("Not connected", "No verified OpenCode runtime connection", "disconnected")
      return
    }
    const label = runtimeLabel(lastStatus.runtime)
    const version = lastStatus.version ? ` v${lastStatus.version}` : ""
    setBadge(`${label} · verified`, `${label}${version} verified by the server handshake`, "connected")
  }

  const onChange = (): void => {
    const next = deps.select?.value
    if (!isRuntimePreference(next) || next === preference || switching) {
      if (deps.select && !isRuntimePreference(next)) deps.select.value = preference
      return
    }
    previousPreference = preference
    preference = next
    switching = true
    if (deps.select) deps.select.disabled = true
    renderStatus()
    deps.postMessage({ type: "set_runtime", runtime: next })
  }

  deps.select?.addEventListener("change", onChange)
  if (deps.select && isRuntimePreference(deps.select.value)) preference = deps.select.value
  renderStatus()

  return {
    applyStatus(status): void {
      lastStatus = {
        connected: status.connected,
        runtime: isConnectedRuntime(status.runtime) ? status.runtime : "unknown",
        apiSurface: status.apiSurface,
        version: status.version,
        preference: isRuntimePreference(status.preference) ? status.preference : preference,
      }
      if (lastStatus.preference) {
        preference = lastStatus.preference
        if (deps.select) deps.select.value = preference
      }
      renderStatus()
    },

    applySwitchResult(result): void {
      switching = false
      if (result.ok && result.runtime && isRuntimePreference(result.runtime)) {
        preference = result.runtime
        if (deps.select) deps.select.value = preference
      } else if (!result.ok && deps.select) {
        preference = previousPreference
        deps.select.value = previousPreference
      }
      if (deps.select) deps.select.disabled = false
      if (!result.ok) {
        setBadge("Switch failed", result.error || "OpenCode runtime switch failed", "disconnected")
      } else {
        renderStatus()
      }
    },

    dispose(): void {
      deps.select?.removeEventListener("change", onChange)
    },
  }
}

export { RUNTIME_LABELS }
