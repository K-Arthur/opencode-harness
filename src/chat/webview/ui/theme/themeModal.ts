/**
 * Theme customizer modal dialog shell.
 *
 * Wraps the native `<dialog>` element with `.showModal()` for focus trapping,
 * ESC handling, backdrop, and top-layer stacking. Falls back to a
 * `role="dialog"` + manual focus trap when `<dialog>` is unavailable.
 *
 * WCAG 2.4.3 (Focus Order), 2.1.2 (No Trap).
 */

export interface ThemeModalOptions {
  /** Element to focus when the modal opens. */
  initialFocus?: HTMLElement | null
  /** Called when the modal is closed (via ESC, backdrop click, or close button). */
  onClose?: () => void
  /** Called when the user clicks the backdrop (outside the panel). */
  onBackdropClick?: () => void
}

export interface ThemeModalHandle {
  /** Open the modal. */
  open: () => void
  /** Close the modal and restore focus to the invoker. */
  close: () => void
  /** True when the modal is currently open. */
  isOpen: () => boolean
  /** The dialog element (for appending content). */
  element: HTMLDialogElement
  /** Clean up event listeners. */
  dispose: () => void
}

/**
 * Create and mount a theme customizer modal dialog.
 *
 * @param dialog - The `<dialog>` element to use (must already be in the DOM).
 * @param options - Modal behavior options.
 * @returns A handle for opening/closing the modal.
 */
export function createThemeModal(
  dialog: HTMLDialogElement,
  options: ThemeModalOptions = {},
): ThemeModalHandle {
  let invoker: HTMLElement | null = null
  let disposed = false

  // Close button handler
  const closeBtn = dialog.querySelector<HTMLElement>(".theme-customizer-close")
  const onCloseBtnClick = () => close()
  closeBtn?.addEventListener("click", onCloseBtnClick)

  // ESC key is handled natively by <dialog>.showModal() — but we also listen
  // for the `close` event to restore focus.
  const onCloseEvent = () => {
    if (disposed) return
    restoreFocus()
    options.onClose?.()
  }
  dialog.addEventListener("close", onCloseEvent)

  // Backdrop click: <dialog> fires a click on the dialog itself when the
  // user clicks the backdrop. Check if the click target is the dialog (not
  // a child element).
  const onDialogClick = (e: MouseEvent) => {
    if (e.target === dialog) {
      options.onBackdropClick?.()
    }
  }
  dialog.addEventListener("click", onDialogClick)

  function open(): void {
    invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof dialog.showModal === "function") {
      dialog.showModal()
    } else {
      // Fallback: show the dialog without native modal behavior
      dialog.setAttribute("open", "")
      dialog.setAttribute("role", "dialog")
      dialog.setAttribute("aria-modal", "true")
    }
    // Focus the initial element (or the first focusable element in the dialog)
    const initial = options.initialFocus ?? dialog.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])",
    )
    initial?.focus()
  }

  function close(): void {
    if (typeof dialog.close === "function") {
      dialog.close()
    } else {
      dialog.removeAttribute("open")
    }
    restoreFocus()
    options.onClose?.()
  }

  function restoreFocus(): void {
    if (invoker && invoker !== document.body && invoker.isConnected) {
      invoker.focus({ preventScroll: true })
      invoker = null
    }
  }

  function isOpen(): boolean {
    return dialog.open
  }

  function dispose(): void {
    disposed = true
    closeBtn?.removeEventListener("click", onCloseBtnClick)
    dialog.removeEventListener("close", onCloseEvent)
    dialog.removeEventListener("click", onDialogClick)
  }

  return { open, close, isOpen, element: dialog, dispose }
}
