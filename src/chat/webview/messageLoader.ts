/**
 * messageLoader — chunked, scroll-preserving message rendering
 *
 * Prevents the main thread from blocking when a session has many messages:
 * - Renders messages in CHUNK_SIZE batches using requestAnimationFrame
 * - Provides a "load earlier messages" banner with scroll-position locking
 * - Throttles the O(n) updateScrollMarkers call so it runs at most once per
 *   SCROLL_MARKER_DEBOUNCE_MS after the last message is added
 */

/** Messages per requestAnimationFrame tick when doing chunked rendering. */
export const CHUNK_SIZE = 20

/**
 * How many messages to send on the initial session resume.
 * Matches MAX_MESSAGES_PER_TAB used by init_state in ChatProvider.
 */
export const INITIAL_LOAD_COUNT = 50

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChunkedLoaderOptions<T> {
  container: HTMLElement
  messages: T[]
  renderFn: (msg: T) => HTMLElement
  onChunkDone?: (rendered: number, total: number) => void
  onAllDone?: () => void
}

export interface ChunkedLoader {
  start(): void
  cancel(): void
  readonly isRunning: boolean
}

// ─── createChunkedLoader ──────────────────────────────────────────────────────

/**
 * Renders `messages` into `container` in batches of CHUNK_SIZE, one batch per
 * animation frame, so the browser stays responsive during large session loads.
 *
 * Usage:
 *   const loader = createChunkedLoader({ container, messages, renderFn })
 *   loader.start()
 *   // later, if tab is closed before completion:
 *   loader.cancel()
 */
export function createChunkedLoader<T>(opts: ChunkedLoaderOptions<T>): ChunkedLoader {
  let cancelled = false
  let frameId: number | null = null
  let rendered = 0
  const { container, messages, renderFn, onChunkDone, onAllDone } = opts

  function renderChunk() {
    if (cancelled) {
      frameId = null
      return
    }

    const end = Math.min(rendered + CHUNK_SIZE, messages.length)
    const frag = document.createDocumentFragment()

    for (let i = rendered; i < end; i++) {
      frag.appendChild(renderFn(messages[i] as T))
    }
    container.appendChild(frag)
    rendered = end

    onChunkDone?.(rendered, messages.length)

    if (rendered < messages.length) {
      frameId = requestAnimationFrame(renderChunk)
    } else {
      frameId = null
      onAllDone?.()
    }
  }

  return {
    start() {
      if (frameId !== null) return
      frameId = requestAnimationFrame(renderChunk)
    },
    cancel() {
      cancelled = true
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      }
    },
    get isRunning() {
      return frameId !== null
    },
  }
}

// ─── prependMessagesPreservingScroll ─────────────────────────────────────────

/**
 * Prepends `elements` to `container` while keeping the user's current scroll
 * position stable.  Without compensation the browser would jump to the top as
 * new DOM nodes push existing content downward.
 *
 * Algorithm:
 *  1. Record scrollHeight and scrollTop before mutation.
 *  2. Insert nodes at the top of the container.
 *  3. Adjust scrollTop by the delta in scrollHeight so the same content stays
 *     in view.
 */
export function prependMessagesPreservingScroll(
  container: HTMLElement,
  elements: HTMLElement[]
): void {
  if (elements.length === 0) return

  const prevScrollTop = container.scrollTop
  const prevScrollHeight = container.scrollHeight

  const frag = document.createDocumentFragment()
  for (const el of elements) {
    frag.appendChild(el)
  }

  const firstChild = container.firstChild
  if (firstChild) {
    container.insertBefore(frag, firstChild)
  } else {
    container.appendChild(frag)
  }

  // Compensate: new content above raised the total height; shift scrollTop by
  // the same amount so the view port doesn't move.
  const newScrollHeight = container.scrollHeight
  container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)
}

// ─── createLoadEarlierBanner ──────────────────────────────────────────────────

/**
 * Creates a sticky banner at the top of the message list that lets users
 * request older messages.  The banner transitions to a loading state while the
 * extension host fetches the next page.
 *
 * @param hiddenCount  Number of messages not yet shown (displayed in the label).
 * @param onLoad       Callback fired when the user triggers a load.  The banner
 *                     enters a loading/aria-busy state immediately so it cannot
 *                     be double-clicked.
 */
export function createLoadEarlierBanner(hiddenCount: number, onLoad: () => void): HTMLElement {
  const banner = document.createElement("div")
  banner.className = "load-earlier-banner"
  banner.setAttribute("role", "status")

  const btn = document.createElement("button")
  btn.className = "load-earlier-btn"
  btn.textContent = `↑ Load ${hiddenCount} earlier message${hiddenCount === 1 ? "" : "s"}`
  btn.setAttribute("aria-label", `Load ${hiddenCount} earlier messages`)

  btn.addEventListener("click", () => {
    if (banner.dataset.loading === "true") return
    banner.dataset.loading = "true"
    banner.setAttribute("aria-busy", "true")
    btn.disabled = true
    btn.textContent = "Loading…"
    onLoad()
  })

  banner.appendChild(btn)
  return banner
}

// ─── throttleScrollMarkers ────────────────────────────────────────────────────

const SCROLL_MARKER_DEBOUNCE_MS = 200

/**
 * Returns a debounced wrapper around `updateFn`.  Calling the returned
 * function many times in quick succession (e.g. on every streamed chunk)
 * only fires `updateFn` once, after SCROLL_MARKER_DEBOUNCE_MS of silence.
 *
 * Usage:
 *   const debouncedUpdate = throttleScrollMarkers((id) => updateScrollMarkers(id))
 *   // In addMessage / stream-chunk handler:
 *   debouncedUpdate(sessionId)
 */
export function throttleScrollMarkers(
  updateFn: (sessionId: string) => void
): (sessionId: string) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return (sessionId: string) => {
    const existing = timers.get(sessionId)
    if (existing !== undefined) {
      clearTimeout(existing)
    }
    const id = setTimeout(() => {
      timers.delete(sessionId)
      updateFn(sessionId)
    }, SCROLL_MARKER_DEBOUNCE_MS)
    timers.set(sessionId, id)
  }
}
