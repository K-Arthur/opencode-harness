/**
 * Sidebar resize via drag handle.
 *
 * A draggable separator between #tab-panels and the side-panel group.
 * Updates `--sidebar-width` CSS variable on the .main-layout element
 * on mousedown+mousemove, with keyboard support via Left/Right arrows.
 *
 * Persisted in sessionStorage so the user's preferred width survives
 * navigation within the same VS Code session.
 */

const STORAGE_KEY = "oc:sidebar-width"
const MIN_WIDTH = 200
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 320

export function setupSidebarResize(
  handle: HTMLElement,
  container: HTMLElement,
): () => void {
  const stored = sessionStorage.getItem(STORAGE_KEY)
  let currentWidth = stored ? clamp(parseInt(stored, 10) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH) : DEFAULT_WIDTH

  function setWidth(w: number): void {
    currentWidth = clamp(w, MIN_WIDTH, MAX_WIDTH)
    container.style.setProperty("--sidebar-width", `${currentWidth}px`)
    handle.setAttribute("aria-valuenow", String(currentWidth))
    sessionStorage.setItem(STORAGE_KEY, String(currentWidth))
  }

  // Apply stored width on init
  if (stored) setWidth(currentWidth)

  function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
  }

  function onPointerDown(e: PointerEvent): void {
    if (!e.isPrimary) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)

    const startX = e.clientX
    const startWidth = currentWidth
    const bodyCursor = document.body.style.cursor
    document.body.style.cursor = "col-resize"
    handle.classList.add("resizing")

    function onPointerMove(ev: PointerEvent): void {
      if (!ev.isPrimary) return
      const delta = startX - ev.clientX
      setWidth(startWidth + delta)
    }

    function onPointerUp(): void {
      handle.releasePointerCapture(e.pointerId)
      document.body.style.cursor = bodyCursor
      handle.classList.remove("resizing")
      handle.removeEventListener("pointermove", onPointerMove)
      handle.removeEventListener("pointerup", onPointerUp)
    }

    handle.addEventListener("pointermove", onPointerMove)
    handle.addEventListener("pointerup", onPointerUp)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      setWidth(currentWidth - 20)
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      setWidth(currentWidth + 20)
    } else if (e.key === "Home") {
      e.preventDefault()
      setWidth(MIN_WIDTH)
    } else if (e.key === "End") {
      e.preventDefault()
      setWidth(MAX_WIDTH)
    }
  }

  handle.addEventListener("pointerdown", onPointerDown)
  handle.addEventListener("keydown", onKeyDown)

  // Prevent text selection while dragging
  const onSelectStart = (e: Event) => {
    if (handle.classList.contains("resizing")) e.preventDefault()
  }
  document.addEventListener("selectstart", onSelectStart)

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown)
    handle.removeEventListener("keydown", onKeyDown)
    document.removeEventListener("selectstart", onSelectStart)
  }
}
