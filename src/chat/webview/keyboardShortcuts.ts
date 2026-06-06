export type ShortcutHandler = (e: KeyboardEvent) => void

export interface ShortcutEntry {
  key: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  handler: ShortcutHandler
  /** If true, only fires when the active element is NOT a text input/textarea/select/contenteditable */
  skipInTextInput?: boolean
  /** If true, only fires when no [aria-modal="true"] element is visible */
  skipInModal?: boolean
}

const _registry: Array<ShortcutEntry & { originalHandler: ShortcutHandler }> = []

/**
 * Register a document-level keyboard shortcut.
 */
export function registerShortcut(entry: ShortcutEntry): void {
  _registry.push({ ...entry, originalHandler: entry.handler })
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName?.toLowerCase()
  return Boolean(el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select")
}

export function isModalOrDialogOpen(): boolean {
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
  for (const m of modals) {
    if (!m.classList.contains("hidden")) return true
  }
  return false
}

/**
 * Create the single document-level keydown listener that dispatches to all
 * registered shortcuts. Call once at startup.
 */
export function createShortcutDispatcher(): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    for (const entry of _registry) {
      const modMatch = !entry.skipInModal || !isModalOrDialogOpen()
      const textMatch = !entry.skipInTextInput || !isTextEntryTarget(e.target)
      const ctrlMatch = entry.ctrl === undefined || entry.ctrl === e.ctrlKey
      const metaMatch = entry.meta === undefined || entry.meta === e.metaKey
      const altMatch = entry.alt === undefined || entry.alt === e.altKey
      const shiftMatch = entry.shift === undefined || entry.shift === e.shiftKey
      const keyMatch = entry.key === e.key

      if (modMatch && textMatch && ctrlMatch && metaMatch && altMatch && shiftMatch && keyMatch) {
        e.preventDefault()
        entry.handler(e)
        return
      }
    }
  }
}

/**
 * Clear the registry and remove the dispatcher. Useful for tests.
 */
export function resetShortcutRegistry(): void {
  _registry.length = 0
}
