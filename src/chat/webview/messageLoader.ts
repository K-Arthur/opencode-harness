/**
 * messageLoader — chunked, scroll-preserving message rendering
 *
 * Prevents the main thread from blocking when a session has many messages:
 * - Renders messages in adaptive batches using requestAnimationFrame
 * - Provides a "load earlier messages" banner with scroll-position locking
 * - Throttles the O(n) updateScrollMarkers call so it runs at most once per
 *   SCROLL_MARKER_DEBOUNCE_MS after the last message is added
 */

/** Initial messages per requestAnimationFrame tick when doing chunked rendering. */
export const CHUNK_SIZE = 20
export const MIN_CHUNK_SIZE = 8
export const MAX_CHUNK_SIZE = 60
export const TARGET_CHUNK_MS = 8

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
  initialChunkSize?: number
  minChunkSize?: number
  maxChunkSize?: number
  targetFrameMs?: number
  onChunkDone?: (rendered: number, total: number, chunkSize: number, durationMs: number) => void
  onAllDone?: () => void
}

export interface ChunkedLoader {
  start(): void
  cancel(): void
  readonly isRunning: boolean
}

// ─── createChunkedLoader ──────────────────────────────────────────────────────

/**
 * Renders `messages` into `container` in adaptive batches, one batch per
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
  const minChunkSize = clampChunkSize(opts.minChunkSize ?? MIN_CHUNK_SIZE, 1, MAX_CHUNK_SIZE)
  const maxChunkSize = clampChunkSize(opts.maxChunkSize ?? MAX_CHUNK_SIZE, minChunkSize, 200)
  const targetFrameMs = Math.max(2, opts.targetFrameMs ?? TARGET_CHUNK_MS)
  let chunkSize = clampChunkSize(opts.initialChunkSize ?? CHUNK_SIZE, minChunkSize, maxChunkSize)

  function renderChunk() {
    if (cancelled) {
      frameId = null
      return
    }

    const startTime = now()
    const end = Math.min(rendered + chunkSize, messages.length)
    const frag = document.createDocumentFragment()

    for (let i = rendered; i < end; i++) {
      frag.appendChild(renderFn(messages[i] as T))
    }
    container.appendChild(frag)
    rendered = end
    const durationMs = now() - startTime

    onChunkDone?.(rendered, messages.length, chunkSize, durationMs)
    chunkSize = nextChunkSize(chunkSize, durationMs, targetFrameMs, minChunkSize, maxChunkSize)

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

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
}

function clampChunkSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function nextChunkSize(
  current: number,
  durationMs: number,
  targetFrameMs = TARGET_CHUNK_MS,
  min = MIN_CHUNK_SIZE,
  max = MAX_CHUNK_SIZE,
): number {
  const normalized = clampChunkSize(current, min, max)
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return Math.min(max, normalized + 4)
  }
  if (durationMs > targetFrameMs * 1.25) {
    return Math.max(min, Math.floor(normalized * 0.65))
  }
  if (durationMs < targetFrameMs * 0.5) {
    return Math.min(max, normalized + Math.max(2, Math.ceil(normalized * 0.2)))
  }
  return normalized
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
 * @param displayCount  Turn-based count shown in the button text.
 * @param beforeIndex   Raw message index for pagination requests.
 * @param onLoad       Callback fired when the user triggers a load.  The banner
 *                     enters a loading/aria-busy state immediately so it cannot
 *                     be double-clicked.
 */
export function createLoadEarlierBanner(displayCount: number, beforeIndex: number, onLoad: () => void): HTMLElement {
  const banner = document.createElement("div")
  banner.className = "load-earlier-banner"
  banner.setAttribute("role", "status")

  const btn = document.createElement("button")
  btn.className = "load-earlier-btn"
  btn.textContent = `↑ Load ${displayCount} earlier item${displayCount === 1 ? "" : "s"}`
  btn.setAttribute("aria-label", `Load ${displayCount} earlier items`)

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
