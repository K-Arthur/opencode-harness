import { splitAtStableBoundary } from "./streamTail"
import { renderMarkdown } from "./renderer"

export type RenderFn = (text: string, isStreaming: boolean) => string
export const MAX_LIVE_TAIL_RENDER_CHARS = 64_000

/**
 * Renders a growing streaming-text buffer into a container by freezing closed
 * markdown blocks and re-parsing only the unstable tail (P1/A).
 *
 * The container holds two children:
 *   - `.stream-frozen`: stable blocks, appended once via insertAdjacentHTML and
 *     never reassigned, so text selection and <details> open-state survive
 *     across flushes (fixes P3) and the prefix is never re-parsed (fixes P1).
 *   - `.stream-tail`: the unstable remainder, re-rendered each flush (bounded).
 *
 * The stable prefix is rendered with `isStreaming=false` so it is cache- and
 * worker-eligible (P2); the tail uses `isStreaming=true`.
 *
 * The renderer reattaches (and rebuilds frozen state) whenever it is pointed at
 * a different container — e.g. a new text block created after a tool boundary.
 */
export class LiveTextRenderer {
  private container: HTMLElement | null = null
  private frozenEl: HTMLElement | null = null
  private tailEl: HTMLElement | null = null
  private frozenLen = 0

  constructor(private readonly render: RenderFn = renderMarkdown) {}

  renderInto(container: HTMLElement, displayText: string): void {
    if (container !== this.container || !this.frozenEl || !container.contains(this.frozenEl)) {
      this.attach(container)
    }
    const frozenEl = this.frozenEl as HTMLElement
    const tailEl = this.tailEl as HTMLElement

    const { stable, tail } = splitAtStableBoundary(displayText)

    // Defensive: if the stable prefix shrank (e.g. a <context> strip shifted the
    // visible text), the frozen DOM is stale — rebuild it from scratch.
    if (stable.length < this.frozenLen) {
      frozenEl.innerHTML = ""
      this.frozenLen = 0
    }
    if (stable.length > this.frozenLen) {
      const delta = stable.slice(this.frozenLen)
      frozenEl.insertAdjacentHTML("beforeend", this.render(delta, false))
      this.frozenLen = stable.length
    }
    if (tail.length > MAX_LIVE_TAIL_RENDER_CHARS) {
      tailEl.textContent = tail
    } else {
      tailEl.innerHTML = this.render(tail, true)
    }
  }

  /** Forget all DOM/frozen state so the next renderInto starts fresh. */
  reset(): void {
    this.container = null
    this.frozenEl = null
    this.tailEl = null
    this.frozenLen = 0
  }

  private attach(container: HTMLElement): void {
    const doc = container.ownerDocument
    container.innerHTML = ""
    this.frozenEl = doc.createElement("div")
    this.frozenEl.className = "stream-frozen"
    this.tailEl = doc.createElement("div")
    this.tailEl.className = "stream-tail"
    container.appendChild(this.frozenEl)
    container.appendChild(this.tailEl)
    this.container = container
    this.frozenLen = 0
  }
}
