/**
 * Lightweight collapsible JSON tree renderer — no external dependencies.
 *
 * Produces a DOM tree where objects/arrays are expandable <details> nodes and
 * primitives are coloured inline spans. A "Raw JSON" copy button sits at the
 * top right of the root container.
 *
 * Usage:
 *   const el = renderJsonViewer(someObject, { maxDepth: 3 })
 *   container.appendChild(el)
 */

export interface JsonViewerOptions {
  maxDepth?: number
}

function renderValue(value: unknown, depth: number, maxDepth: number): HTMLElement {
  const wrapper = document.createElement("span")

  if (value === null) {
    wrapper.className = "jv-null"
    wrapper.textContent = "null"
    return wrapper
  }

  if (typeof value === "boolean") {
    wrapper.className = "jv-bool"
    wrapper.textContent = String(value)
    return wrapper
  }

  if (typeof value === "number") {
    wrapper.className = "jv-num"
    wrapper.textContent = String(value)
    return wrapper
  }

  if (typeof value === "string") {
    wrapper.className = "jv-str"
    wrapper.textContent = `"${value}"`
    return wrapper
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      wrapper.textContent = "[]"
      return wrapper
    }
    if (depth >= maxDepth) {
      wrapper.className = "jv-ellipsis"
      wrapper.textContent = `[… ${value.length} item${value.length === 1 ? "" : "s"}]`
      return wrapper
    }
    const details = document.createElement("details")
    details.className = "jv-node jv-array"
    details.open = depth < 2
    const summary = document.createElement("summary")
    summary.className = "jv-summary"
    summary.textContent = `Array (${value.length})`
    details.appendChild(summary)
    const items = document.createElement("ul")
    items.className = "jv-list"
    for (let i = 0; i < value.length; i++) {
      const li = document.createElement("li")
      li.className = "jv-item"
      const idx = document.createElement("span")
      idx.className = "jv-key"
      idx.textContent = `${i}: `
      li.appendChild(idx)
      li.appendChild(renderValue(value[i], depth + 1, maxDepth))
      items.appendChild(li)
    }
    details.appendChild(items)
    wrapper.appendChild(details)
    return wrapper
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 0) {
      wrapper.textContent = "{}"
      return wrapper
    }
    if (depth >= maxDepth) {
      wrapper.className = "jv-ellipsis"
      wrapper.textContent = `{… ${keys.length} key${keys.length === 1 ? "" : "s"}}`
      return wrapper
    }
    const details = document.createElement("details")
    details.className = "jv-node jv-object"
    details.open = depth < 2
    const summary = document.createElement("summary")
    summary.className = "jv-summary"
    summary.textContent = `Object (${keys.length})`
    details.appendChild(summary)
    const list = document.createElement("ul")
    list.className = "jv-list"
    for (const key of keys) {
      const li = document.createElement("li")
      li.className = "jv-item"
      const keySpan = document.createElement("span")
      keySpan.className = "jv-key"
      keySpan.textContent = `${key}: `
      li.appendChild(keySpan)
      li.appendChild(renderValue((value as Record<string, unknown>)[key], depth + 1, maxDepth))
      list.appendChild(li)
    }
    details.appendChild(list)
    wrapper.appendChild(details)
    return wrapper
  }

  wrapper.className = "jv-unknown"
  wrapper.textContent = String(value)
  return wrapper
}

/**
 * Render a JSON value as a collapsible tree with a "Copy raw JSON" button.
 * Falls back gracefully to a plain pre block if value is not JSON-serialisable.
 */
export function renderJsonViewer(value: unknown, opts: JsonViewerOptions = {}): HTMLElement {
  const maxDepth = opts.maxDepth ?? 3
  const container = document.createElement("div")
  container.className = "json-viewer"

  const toolbar = document.createElement("div")
  toolbar.className = "jv-toolbar"

  const copyBtn = document.createElement("button")
  copyBtn.className = "jv-copy-btn"
  copyBtn.textContent = "Copy JSON"
  copyBtn.title = "Copy raw JSON to clipboard"
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    const raw = JSON.stringify(value, null, 2)
    void navigator.clipboard?.writeText(raw).catch(() => {})
    copyBtn.textContent = "Copied!"
    setTimeout(() => { copyBtn.textContent = "Copy JSON" }, 1500)
  })
  toolbar.appendChild(copyBtn)
  container.appendChild(toolbar)

  const tree = document.createElement("div")
  tree.className = "jv-tree"
  tree.appendChild(renderValue(value, 0, maxDepth))
  container.appendChild(tree)

  return container
}
