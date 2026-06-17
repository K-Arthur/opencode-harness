/**
 * Scroll Anchor Controller
 *
 * Manages auto-scroll-to-bottom behavior for message lists:
 * - During streaming: auto-scroll to bottom on new content
 * - User scrolls up: pause auto-scroll (let them read history)
 * - User scrolls back to bottom: resume auto-scroll
 * - New message sent: force-scroll to bottom and resume
 *
 * Large sessions render only a window of recent messages (see virtualList.ts),
 * with a "load earlier" banner above them — not content-visibility skipping.
 * The scroll anchor is at the bottom of the message list + typing indicator.
 */

export interface ScrollAnchor {
  /** Current scroll target element (message list) */
  readonly container: HTMLElement
  /** Whether auto-scroll is currently active */
  readonly isAnchored: boolean
  /** Force scroll to bottom and anchor */
  anchor(): void
  /** Scroll to bottom only if currently anchored */
  scrollIfAnchored(): void
  /** Pause auto-scroll (user scrolled up) */
  pause(): void
  /** Resume auto-scroll (user scrolled back down or new stream started) */
  resume(): void
  /** Clean up event listeners */
  dispose(): void
}

/** Pixels from bottom within which we consider the user "at the bottom" */
const ANCHOR_THRESHOLD = 80

/**
 * F: grace period (ms) after a programmatic scroll during which the onScroll
 * handler will not re-evaluate anchored state. This prevents the race where
 * RAF-deferred scrollTop assignment triggers onScroll before the browser has
 * settled the layout, causing isAtBottom() to return a stale result.
 */
const PROGRAMMATIC_SCROLL_GRACE_MS = 100

export function createScrollAnchor(container: HTMLElement, typingIndicator?: HTMLElement): ScrollAnchor {
  let anchored = true
  let lastProgrammaticScrollAt = 0

  function isAtBottom(): boolean {
    const scrollBottom = container.scrollTop + container.clientHeight
    const totalHeight = container.scrollHeight
    return totalHeight - scrollBottom < ANCHOR_THRESHOLD
  }

  function scrollToBottom() {
    lastProgrammaticScrollAt = performance.now()
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
      // After the scroll settles, re-check. The RAF fires ~16ms later;
      // extend the grace window so the subsequent onScroll doesn't fight it.
      lastProgrammaticScrollAt = performance.now()
    })
  }

  function onScroll() {
    // F: suppress anchor re-evaluation during programmatic scrolls to
    // prevent the RAF/scroll-event race from toggling anchored state.
    if (performance.now() - lastProgrammaticScrollAt < PROGRAMMATIC_SCROLL_GRACE_MS) return
    anchored = isAtBottom()
  }

  function onWheel(e: WheelEvent) {
    // Scrolling up anywhere in the view pauses anchoring
    if (e.deltaY < 0) {
      // Only pause if user actually scrolled (not at boundary)
      if (!isAtBottom()) {
        anchored = false
      }
    }
    // Scrolling down to the bottom resumes anchoring
    if (e.deltaY > 0 && isAtBottom()) {
      anchored = true
    }
  }

  function anchor() {
    anchored = true
    scrollToBottom()
  }

  function scrollIfAnchored() {
    if (anchored) {
      scrollToBottom()
    }
  }

  function pause() {
    anchored = false
  }

  function resume() {
    anchored = true
    scrollToBottom()
  }

  // Pointer/touch events: treat touch-up scroll as potential anchor-pause
  function onTouchMove() {
    if (!isAtBottom()) {
      anchored = false
    }
  }

  container.addEventListener("scroll", onScroll, { passive: true })
  container.addEventListener("wheel", onWheel, { passive: true })
  container.addEventListener("touchmove", onTouchMove, { passive: true })

  // Also listen on the typing indicator if provided (it sits below messages)
  if (typingIndicator) {
    typingIndicator.addEventListener("wheel", onWheel as unknown as EventListener, { passive: true })
  }

  function dispose() {
    container.removeEventListener("scroll", onScroll)
    container.removeEventListener("wheel", onWheel)
    container.removeEventListener("touchmove", onTouchMove)
    if (typingIndicator) {
      typingIndicator.removeEventListener("wheel", onWheel as unknown as EventListener)
    }
  }

  return {
    container,
    get isAnchored() { return anchored },
    anchor,
    scrollIfAnchored,
    pause,
    resume,
    dispose,
  }
}
