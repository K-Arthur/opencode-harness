import type { ElementRefs } from "./dom"
import type { StashedPrompt } from "../../prompts/PromptStashManager"

export interface PromptStashHandlers {
  open: () => void
  close: () => void
  toggle: () => void
  stash: (name: string, content: string, isGlobal: boolean) => void
  list: () => void
  deleteStash: (id: string) => void
}

export function setupPromptStash(els: ElementRefs, postMessage: (msg: Record<string, unknown>) => void): PromptStashHandlers {
  let isOpen = false
  const panel = els.promptStashPanel
  const closeBtn = els.promptStashClose
  const listContainer = els.promptStashList

  function open(): void {
    if (!panel) return
    isOpen = true
    panel.classList.remove("hidden")
    list()
  }

  function close(): void {
    if (!panel) return
    isOpen = false
    panel.classList.add("hidden")
  }

  function toggle(): void {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }

  function stash(name: string, content: string, isGlobal: boolean): void {
    postMessage({
      type: "stash_prompt",
      name,
      content,
      isGlobal,
    })
  }

  function list(): void {
    postMessage({ type: "list_stashes" })
  }

  function deleteStash(id: string): void {
    postMessage({ type: "delete_stash", id })
  }

  // Event listeners
  if (closeBtn) {
    closeBtn.addEventListener("click", close)
  }

  // Listen for stash-related messages from backend
  window.addEventListener("message", (event) => {
    const data = event.data
    if (!data) return

    switch (data.type) {
      case "stash_success":
        if (data.name) {
          renderSuccess(data.name)
        }
        list()
        break
      case "stash_error":
        if (data.error) {
          renderError(data.error)
        }
        break
      case "stash_list":
        if (data.stashes && Array.isArray(data.stashes)) {
          renderList(data.stashes)
        }
        break
      case "stash_deleted":
        if (data.id) {
          renderDeleted(data.id)
        }
        list()
        break
    }
  })

  function renderSuccess(name: string): void {
    // Show a temporary success notification
    const notification = document.createElement("div")
    notification.className = "stash-notification stash-success"
    notification.textContent = `Prompt "${name}" stashed successfully`
    document.body.appendChild(notification)
    setTimeout(() => notification.remove(), 3000)
  }

  function renderError(error: string): void {
    const notification = document.createElement("div")
    notification.className = "stash-notification stash-error"
    notification.textContent = error
    document.body.appendChild(notification)
    setTimeout(() => notification.remove(), 3000)
  }

  function renderList(stashes: StashedPrompt[]): void {
    if (!listContainer) return
    listContainer.innerHTML = ""

    if (stashes.length === 0) {
      const empty = document.createElement("div")
      empty.className = "stash-empty"
      empty.textContent = "No stashed prompts"
      listContainer.appendChild(empty)
      return
    }

    stashes.forEach((stash) => {
      const item = document.createElement("div")
      item.className = "stash-item"
      item.dataset.id = stash.id

      const header = document.createElement("div")
      header.className = "stash-item-header"

      const name = document.createElement("span")
      name.className = "stash-item-name"
      name.textContent = stash.name

      const meta = document.createElement("span")
      meta.className = "stash-item-meta"
      meta.textContent = `Used ${stash.usageCount} times`

      header.appendChild(name)
      header.appendChild(meta)

      const content = document.createElement("div")
      content.className = "stash-item-content"
      content.textContent = stash.content.slice(0, 100) + (stash.content.length > 100 ? "..." : "")

      const actions = document.createElement("div")
      actions.className = "stash-item-actions"

      const insertBtn = document.createElement("button")
      insertBtn.className = "stash-action-btn"
      insertBtn.textContent = "Insert"
      insertBtn.addEventListener("click", () => {
        const input = els.promptInput
        if (input) {
          input.value = stash.content
          input.dispatchEvent(new Event("input"))
          input.focus()
        }
        postMessage({ type: "record_stash_usage", id: stash.id })
      })

      const copyBtn = document.createElement("button")
      copyBtn.className = "stash-action-btn"
      copyBtn.textContent = "Copy"
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(stash.content)
          renderSuccess("Copied to clipboard")
          postMessage({ type: "record_stash_usage", id: stash.id })
        } catch {
          renderError("Failed to copy to clipboard")
        }
      })

      const deleteBtn = document.createElement("button")
      deleteBtn.className = "stash-action-btn stash-delete"
      deleteBtn.textContent = "Delete"
      deleteBtn.addEventListener("click", () => {
        deleteStash(stash.id)
      })

      actions.appendChild(insertBtn)
      actions.appendChild(copyBtn)
      actions.appendChild(deleteBtn)

      item.appendChild(header)
      item.appendChild(content)
      item.appendChild(actions)

      listContainer.appendChild(item)
    })
  }

  function renderDeleted(id: string): void {
    if (!listContainer) return
    const item = listContainer.querySelector(`[data-id="${id}"]`)
    if (item) {
      item.remove()
    }
  }

  return { open, close, toggle, stash, list, deleteStash }
}
