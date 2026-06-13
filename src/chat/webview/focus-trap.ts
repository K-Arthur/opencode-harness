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

export interface MountModalFocusOptions {
  /** Element to focus when the modal opens. Defaults to the first focusable
   *  element inside `container`. */
  initialFocus?: HTMLElement | null
  /** Element to restore focus to on release. Defaults to whatever was focused
   *  (the invoker) at the moment `mountModalFocus` was called. */
  restoreTo?: HTMLElement | null
}

export interface ModalFocusHandle {
  /** Remove the Tab trap and return focus to the invoker. Idempotent. */
  release: () => void
}

/**
 * One-call modal focus lifecycle: capture the invoker, attach the Tab trap,
 * move focus into the dialog, and — on `release()` — detach the trap and
 * restore focus to the invoker. This is the missing half of `createFocusTrap`,
 * which only wraps Tab and leaves focus-in / focus-restore to each caller
 * (a step several modals historically skipped, stranding keyboard and screen
 * reader users behind the dialog). WCAG 2.4.3 (Focus Order), 2.1.2 (No Trap).
 */
export function mountModalFocus(
  container: HTMLElement,
  options: MountModalFocusOptions = {}
): ModalFocusHandle {
  const invoker =
    options.restoreTo !== undefined
      ? options.restoreTo
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

  const handler = trapModalFocus(container)
  document.addEventListener("keydown", handler)

  const initial =
    options.initialFocus ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
  initial?.focus()

  let released = false
  return {
    release: () => {
      if (released) return
      released = true
      document.removeEventListener("keydown", handler)
      // Only restore to a still-attached, real element — never the <body>
      // fallback, which would silently blur the dialog's logical successor.
      if (invoker && invoker !== document.body && invoker.isConnected) {
        invoker.focus()
      }
    },
  }
}
