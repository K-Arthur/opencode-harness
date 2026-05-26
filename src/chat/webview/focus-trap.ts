export const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function trapModalFocus(container: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== "Tab") return
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
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

export interface FocusTrap {
  handler: (e: KeyboardEvent) => void
  destroy: () => void
}

export function createFocusTrap(container: HTMLElement): FocusTrap {
  const handler = trapModalFocus(container)
  return {
    handler,
    destroy: () => {
      document.removeEventListener("keydown", handler)
    },
  }
}
