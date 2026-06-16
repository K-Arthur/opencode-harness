# Provider Delete UI — Implementation Plan

## Summary

The host-side extension already has full plumbing for deleting providers:
- `ProviderManagementService.handleDeleteProvider(id)` — calls `ProviderConfigManager.deleteConfig()`
- `WebviewEventRouter` handles `delete_provider` messages
- `ChatProvider.handleDeleteProvider()` delegates to the service
- `ProviderConfigManager.deleteConfig()` persists via `context.globalState`

The webview side has partial wiring but **no visible UI** to list or delete providers.

## Files to Change

### 1. `src/chat/webview/model-manager.ts`

**Add `onDeleteProvider` to `ModelManagerCallbacks`** (line 6):
```ts
export interface ModelManagerCallbacks {
  onToggleModel: (modelId: string, enabled: boolean) => void
  onToggleFavorite: (modelId: string) => void
  onSelectModel: (modelId: string) => void
  onConnectProvider: () => void
  onDeleteProvider: (id: string) => void  // NEW
}
```

**Wire up `onDeleteProvider` in the returned handlers** (line 285):
```ts
deleteProvider: (id: string) => {
  callbacks.onDeleteProvider(id)  // delegate instead of local filter
  providers = providers.filter((p) => p.id !== id)
  render()
},
```

**Add a providers section to `render()`** — after the model groups, add:
```ts
function render() {
  modelList.innerHTML = ""
  // ... existing model rendering ...

  // NEW: render configured providers section
  if (providers.length > 0) {
    renderProvidersSection()
  }
}

function renderProvidersSection() {
  const group = document.createElement("div")
  group.className = "model-manager-group"
  const header = document.createElement("div")
  header.className = "model-manager-group-header"
  header.textContent = "Configured providers"
  group.appendChild(header)

  for (const provider of providers) {
    const row = document.createElement("div")
    row.className = "model-manager-provider-row"

    const name = document.createElement("span")
    name.className = "model-manager-provider-name"
    name.textContent = provider.name
    row.appendChild(name)

    const baseUrl = document.createElement("span")
    baseUrl.className = "model-manager-provider-url"
    baseUrl.textContent = provider.baseUrl ?? ""
    row.appendChild(baseUrl)

    const deleteBtn = document.createElement("button")
    deleteBtn.className = "model-manager-provider-delete"
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>'
    deleteBtn.setAttribute("aria-label", `Remove ${provider.name} provider`)
    deleteBtn.title = "Remove provider"
    deleteBtn.addEventListener("click", () => {
      if (confirm(`Remove "${provider.name}" provider? This will delete its API key configuration.`)) {
        callbacks.onDeleteProvider(provider.id)
      }
    })
    row.appendChild(deleteBtn)

    group.appendChild(row)
  }
  modelList.appendChild(group)
}
```

### 2. `src/chat/webview/main.ts`

**Add provider message handlers** in the `messageHandlers` map (around line 3722):
```ts
["provider_list", (msg) => {
  const providers = (msg as Record<string, unknown>).providers as ProviderConfig[] | undefined
  if (providers) {
    modelManager.setProviders(providers)
  }
}],
["provider_added", () => {
  vscode.postMessage({ type: "list_providers" })
}],
["provider_deleted", () => {
  vscode.postMessage({ type: "list_providers" })
}],
```

**Wire up `onDeleteProvider` callback** in the `setupModelManager` call (line 464):
```ts
modelManager = setupModelManager(els, {
  onToggleModel: (modelId, enabled) => { /* existing */ },
  onToggleFavorite: (modelId) => { /* existing */ },
  onSelectModel: (modelId) => { /* existing */ },
  onConnectProvider: () => {
    vscode.postMessage({ type: "connect_provider" })
  },
  // NEW
  onDeleteProvider: (id: string) => {
    vscode.postMessage({ type: "delete_provider", id })
  },
})
```

**Request provider list on init** — after `init_state` handling, add (around line 3530):
```ts
vscode.postMessage({ type: "list_providers" })
```

### 3. `src/chat/webview/css/layout.css`

Add styles for the provider rows (after `.model-manager-toggle` styles around line 2520):
```css
/* ── Provider list in model manager ── */
.model-manager-provider-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
  transition: background 0.15s;
}
.model-manager-provider-row:hover {
  background: var(--vscode-list-hoverBackground);
}
.model-manager-provider-name {
  flex: 1;
  font-size: 13px;
  color: var(--vscode-editor-foreground);
  font-weight: 500;
}
.model-manager-provider-url {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-manager-provider-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-errorForeground);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
}
.model-manager-provider-delete:hover,
.model-manager-provider-delete:focus-visible {
  opacity: 1;
  background: color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent);
}
```

### 4. `src/chat/WebviewEventRouter.ts`

**Already done.** Confirm `delete_provider` is in the allowed message type list (line 159) and the handler is registered (line 909). No changes needed.

### 5. `src/chat/ProviderManagementService.ts`

**Already done.** `handleDeleteProvider` exists at line 56. No changes needed.

### 6. `src/chat/ChatProvider.ts`

**Already done.** `handleDeleteProvider` at line 2120. No changes needed.

## Verification

1. `npm run typecheck` — no type errors
2. `npm run build` — bundle succeeds
3. `npm run test:unit` — existing provider tests pass
4. Manual: Open model manager → see "Configured providers" section → click trash icon → provider removed from local state and host

## Key Constraints

- `ProviderConfig` must be imported in `main.ts` (`import type { ProviderConfig } from "../../model/ProviderConfigManager"`)
- The `confirm()` dialog is intentional — prevents accidental deletion of API key config
- Use `color-mix()` for delete button hover — VS Code theme aware, no hardcoded colors
- The provider list re-fetches on `provider_added`/`provider_deleted` to stay in sync with host state
