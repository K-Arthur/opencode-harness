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
 *
 * Stability hardening (research: chat scroll-anchoring literature + TanStack
 * virtual issues + VS Code webview guidance):
 *   - `IntersectionObserver` sentinel is the primary "is at bottom?" signal.
 *     Cheaper and more reliable than polling `scrollHeight` mid-stream (the
 *     classic cause of "scroll jumped while reading").
 *   - `scroll`/`wheel`/`touchmove` listeners remain as a fallback for
 *     browsers/contexts where the sentinel isn't reachable and for fast
 *     user-driven pause detection.
 *   - `pauseForReflow(ms)` lets callers (sidebar toggle, code-block lazy
 *     load, theme swap) briefly suspend autoscroll so width/height reflow
 *     doesn't yank the user. Without this, opening the timeline sidebar
 *     mid-stream re-wraps every line and the autoscroll path fights the
 *     browser's native scroll anchoring.
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
  /**
   * Temporarily suspend autoscroll for `ms` milliseconds. Call this when a
   * layout change is about to reflow the scroll container (sidebar toggle,
   * code-block lazy render, theme swap, diff-mode toggle). During the
   * window, `scrollIfAnchored` becomes a no-op so the reflow doesn't yank
   * the user; the next call after the window expires behaves normally.
   */
  pauseForReflow(ms: number): void
  /** Clean up event listeners + observers */
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

/**
 * Default reflow pause. Sidebar toggles and code-block renders usually settle
 * within one animation frame (~16ms); 150ms covers a worst-case reflow plus
 * the next chunk arrival without making the chat feel unresponsive.
 */
const DEFAULT_REFLOW_PAUSE_MS = 150

export function createScrollAnchor(container: HTMLElement, typingIndicator?: HTMLElement): ScrollAnchor {
  let anchored = true
  let lastProgrammaticScrollAt = 0
  let reflowPausedUntil = 0

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
    // Reflow guard: if a layout change is in progress, do not write scrollTop.
    // The browser's native scroll anchoring + this guard together prevent
    // the "scroll jumped while sidebar opened" symptom. The next call after
    // the reflow window expires will resume normal autoscroll behaviour.
    if (performance.now() < reflowPausedUntil) return
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

  function pauseForReflow(ms: number = DEFAULT_REFLOW_PAUSE_MS): void {
    // Extend — don't truncate — an in-progress pause. Sidebar toggle while
    // a code block is mid-render should respect the longer of the two.
    const until = performance.now() + ms
    if (until > reflowPausedUntil) reflowPausedUntil = until
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

  // IntersectionObserver sentinel — the primary "is at bottom?" signal.
  // Research: this is more robust than polling scrollHeight because it
  // doesn't force layout, doesn't race with streaming chunks, and the
  // browser coalesces callbacks to a microtask batch. The sentinel is a
  // 1px-tall div placed as the LAST child of the container; when it
  // intersects the viewport, the user is at the bottom.
  let sentinel: HTMLDivElement | null = null
  let observer: IntersectionObserver | null = null
  try {
    if (typeof IntersectionObserver !== "undefined") {
      sentinel = document.createElement("div")
      sentinel.style.height = "1px"
      sentinel.style.width = "100%"
      sentinel.setAttribute("aria-hidden", "true")
      sentinel.dataset.scrollSentinel = "1"
      container.appendChild(sentinel)
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (!entry) return
          // Only UPDATE anchored state from the sentinel — never override a
          // user's explicit pause(). If the user scrolled up and the
          // sentinel left the viewport, we keep anchored=false; when they
          // scroll back so the sentinel re-enters, we re-anchor.
          if (entry.isIntersecting) {
            // Sentinel visible → user is at bottom → safe to anchor.
            anchored = true
          } else if (!isAtBottom()) {
            // Sentinel not visible AND not within threshold → user scrolled
            // up. Pause.
            anchored = false
          }
        },
        {
          root: container,
          // Treat "within 80px of the bottom" as at-bottom (matches
          // ANCHOR_THRESHOLD so the two signals agree).
          rootMargin: `0px 0px ${ANCHOR_THRESHOLD}px 0px`,
          threshold: 0,
        },
      )
      observer.observe(sentinel)
    }
  } catch {
    // IntersectionObserver unavailable (older webview) — fall back to the
    // scroll/wheel/touch listeners above. Don't throw; the controller is
    // still functional, just less robust against reflow-driven jumps.
  }

  function dispose() {
    container.removeEventListener("scroll", onScroll)
    container.removeEventListener("wheel", onWheel)
    container.removeEventListener("touchmove", onTouchMove)
    if (typingIndicator) {
      typingIndicator.removeEventListener("wheel", onWheel as unknown as EventListener)
    }
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (sentinel && sentinel.parentElement === container) {
      container.removeChild(sentinel)
      sentinel = null
    }
  }

  return {
    container,
    get isAnchored() { return anchored },
    anchor,
    scrollIfAnchored,
    pause,
    resume,
    pauseForReflow,
    dispose,
  }
}
