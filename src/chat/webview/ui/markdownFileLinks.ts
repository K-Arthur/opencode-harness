/**
 * Dependencies required by the markdown file-link handler.
 * Threaded explicitly from the main IIFE to avoid closure capture.
 */
export interface MarkdownFileLinkDeps {
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
  }
}

/**
 * Wires a delegated click/keydown handler on the document that intercepts
 * clicks on `<a class="file-link">` elements (produced by the markdown-it
 * link_open override in renderer.ts / markdownWorker.ts) and posts an
 * `open_file` message to the extension host.
 *
 * External links (http(s)/ftp) are left untouched — they render with
 * `target="_blank"` and no `file-link` class, so the handler ignores them.
 *
 * @param deps - Explicit closure dependencies from the main IIFE.
 */
export function setupMarkdownFileLinksImpl(deps: MarkdownFileLinkDeps): void {
  const { vscode } = deps

  const resolveAnchor = (target: EventTarget | null): HTMLAnchorElement | null => {
    const el = target as HTMLElement | null
    if (!el) return null
    const anchor = el.closest("a.file-link") as HTMLAnchorElement | null
    if (!anchor) return null
    const path = anchor.getAttribute("data-file-path")
    return path ? anchor : null
  }

  const openFile = (anchor: HTMLAnchorElement): void => {
    const path = anchor.getAttribute("data-file-path")
    if (path) {
      vscode.postMessage({ type: "open_file", path })
    }
  }

  document.addEventListener("click", (e) => {
    const anchor = resolveAnchor(e.target)
    if (!anchor) return
    e.preventDefault()
    e.stopPropagation()
    openFile(anchor)
  })

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return
    const anchor = resolveAnchor(e.target)
    if (!anchor) return
    e.preventDefault()
    openFile(anchor)
  })
}
