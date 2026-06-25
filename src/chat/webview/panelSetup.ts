import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"

import { setupModelDropdown } from "./model-dropdown"
import { setupModelManager } from "./model-manager"
import { setupVariantSelector } from "./variant-selector"
import { setupMcpConfig } from "./mcp-config"
import { createTabBar } from "./tabs"

export interface PanelSetupDeps {
  els: ElementRefs
  vscode: { postMessage: (msg: Record<string, unknown>) => void }
  stateManager: {
    getState: () => { activeSessionId: string | null; globalModel?: string; globalVariant?: string }
    getActiveSession: () => { id: string; name?: string; model?: string; isStreaming?: boolean; mode?: string } | undefined
    setGlobalModel: (model: string) => void
    setGlobalVariant: (variant: string) => void
    setSessionModel: (id: string, model: string) => void
    setSessionVariant: (id: string, variant: string) => void
    setModelDisabled: (modelId: string, disabled: boolean) => void
    toggleModelFavorite?: (modelId: string) => boolean
    applyModelState: (models: ModelInfo[]) => ModelInfo[]
  }
  openProviderPanel: () => void
  onTabSwitch: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabNew: () => void
}

export interface PanelSetupAPI {
  modelDropdown: ReturnType<typeof setupModelDropdown>
  modelManager: ReturnType<typeof setupModelManager>
  variantSelector: ReturnType<typeof setupVariantSelector>
  tabBar: ReturnType<typeof createTabBar>
  mcpConfig: ReturnType<typeof setupMcpConfig>
  syncModelViews: () => void
}

export function setupPanels(deps: PanelSetupDeps): PanelSetupAPI {
  const { els, vscode, stateManager, openProviderPanel } = deps

  const modelDropdown = setupModelDropdown(els, {
    onOpen: () => {
      vscode.postMessage({ type: "get_models" })
    },
    onSelect: (modelId) => {
      stateManager.setGlobalModel(modelId)
      modelDropdown.setCurrentModel(modelId)
      syncModelViews()
      const model = modelManager.getEnabledModels().find((m) => `${m.provider}/${m.id}` === modelId)
      variantSelector.setModel(model || null)
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionModel(active.id, modelId)
        vscode.postMessage({ type: "set_model", model: modelId, sessionId: active.id })
      } else {
        vscode.postMessage({ type: "set_model", model: modelId })
      }
    },
    onManageModels: () => {
      modelManager.open()
      vscode.postMessage({ type: "get_models" })
    },
  })

  const modelManager = setupModelManager(els, {
    onToggleModel: (modelId, enabled) => {
      modelManager.updateModelEnabled(modelId, enabled)
      stateManager.setModelDisabled(modelId, !enabled)
      vscode.postMessage({ type: "model_toggle", modelId, enabled })
      syncModelViews()
    },
    onToggleFavorite: (modelId) => {
      const favorite = stateManager.toggleModelFavorite
        ? stateManager.toggleModelFavorite(modelId)
        : false
      modelManager.updateModelFavorite(modelId, favorite)
      vscode.postMessage({ type: "model_favorite", modelId })
      syncModelViews()
    },
    onSelectModel: (modelId) => {
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionModel(active.id, modelId)
      }
      stateManager.setGlobalModel(modelId)
      modelDropdown.setCurrentModel(modelId)
      syncModelViews()
      const model = modelManager.getAllModels().find((m) => `${m.provider}/${m.id}` === modelId)
      variantSelector.setModel(model || null)
      vscode.postMessage({ type: "set_model", model: modelId, sessionId: active?.id })
      modelManager.close()
    },
    onConnectProvider: () => {
      openProviderPanel()
      vscode.postMessage({ type: "discover_providers" })
      vscode.postMessage({ type: "list_provider_credentials" })
    },
    onDeleteProvider: (id: string) => {
      vscode.postMessage({ type: "delete_provider", id })
    },
  })

  const variantSelector = setupVariantSelector(els, {
    onSelect: (variant) => {
      const normalized = variant === "Default" ? "" : variant
      stateManager.setGlobalVariant(normalized)
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionVariant(active.id, normalized)
        vscode.postMessage({ type: "set_variant", variant: normalized, sessionId: active.id })
      }
    },
  })

  function syncModelViews() {
    const models = modelManager.getAllModels()
    const modelsWithState = stateManager.applyModelState(models)
    const active = stateManager.getActiveSession()
    const currentModel = active?.model || stateManager.getState().globalModel || ""
    modelManager.setModels(modelsWithState)
    modelDropdown.render(modelsWithState, currentModel)
  }

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => deps.onTabSwitch(tabId),
    onClose: (tabId) => deps.onTabClose(tabId),
    onNew: () => deps.onTabNew(),
  })

  const mcpConfig = setupMcpConfig(els, {
    onAddServer: (name, config) => vscode.postMessage({ type: "add_mcp_server", name, config }),
    onUpdateServer: (name, config) => vscode.postMessage({ type: "update_mcp_server", name, config }),
    onRemoveServer: (name) => vscode.postMessage({ type: "remove_mcp_server", name }),
    onToggleServer: (name, disabled) => vscode.postMessage({ type: "toggle_mcp_server", name, disabled }),
    onClose: () => {},
  })

  return {
    modelDropdown,
    modelManager,
    variantSelector,
    tabBar,
    mcpConfig,
    syncModelViews,
  }
}
