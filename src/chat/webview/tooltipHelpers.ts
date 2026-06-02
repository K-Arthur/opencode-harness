/**
 * Small DOM helpers that apply the centralized tooltip copy from
 * `./tooltips.ts` to webview elements.
 *
 * Why a thin helper layer:
 *   - Keeps the call-site one-liner (e.g. `applyTooltip(btn, getSendTooltip(...))`)
 *   - Guarantees `title` and `aria-label` stay in lockstep on icon-only
 *     buttons, so screen readers and hover-tooltip never drift apart.
 *   - Avoids recreating the same `setAttribute("title", …)` /
 *     `setAttribute("aria-label", …)` pattern in every module.
 */

export interface TooltipCopy {
  title: string
  ariaLabel?: string
}

/**
 * Apply a tooltip (and optionally an aria-label) to a single element.
 *
 * The `ariaLabel` is intentionally optional: for buttons whose visible
 * text already describes the control (e.g. "Save" or "Cancel") we want
 * the visible text to be the accessible name, not a redundant hover
 * string. For icon-only buttons, `ariaLabel` should always be set.
 */
export function applyTooltip(el: HTMLElement, copy: TooltipCopy): void {
  el.setAttribute("title", copy.title)
  if (copy.ariaLabel !== undefined) {
    el.setAttribute("aria-label", copy.ariaLabel)
  }
}

/**
 * Apply a tooltip AND a disabled reason. Use this on controls that flip
 * to `disabled` based on application state (e.g. send button while
 * the stream cap is full, mode selector while streaming).
 *
 *   - Sets `aria-disabled` so the disabled state is announced.
 *   - Overrides the tooltip with an "Unavailable: …" reason.
 *   - Leaves the original `aria-label` semantics in place unless an
 *     `ariaLabel` override is provided.
 */
export function applyDisabledReasonTooltip(
  el: HTMLElement,
  reason: string,
  options: { ariaLabel?: string; keepOriginalAria?: boolean } = {},
): void {
  el.setAttribute("aria-disabled", "true")
  el.setAttribute("title", `Unavailable: ${reason}`)
  if (options.ariaLabel !== undefined) {
    el.setAttribute("aria-label", options.ariaLabel)
  } else if (!options.keepOriginalAria) {
    el.setAttribute("aria-label", `Unavailable: ${reason}`)
  }
}
