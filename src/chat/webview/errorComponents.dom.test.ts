import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { ErrorDisplay } from "./errorComponents"
import { ErrorCategory, ErrorSeverity, type ErrorContext } from "./errorTypes"

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  return dom
}

function makeError(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.HIGH,
    code: "stream_error",
    message: "raw",
    userMessage: "The model rejected the message ID format.",
    technicalDetails: '{"name":"BadRequest","data":{"message":"bad id"}}',
    suggestedActions: [
      { label: "Retry", action: "retry", primary: true },
      { label: "Dismiss", action: "dismiss" },
    ],
    retryable: true,
    timestamp: 0,
    ...overrides,
  }
}

describe("ErrorDisplay — compact oc-card rendering", () => {
  beforeEach(() => setupDom())

  it("renders a compact .oc-card with a severity modifier and no heavy inline styling", () => {
    const el = new ErrorDisplay().render(makeError())
    assert.ok(el.classList.contains("oc-card"), "must use the shared .oc-card class")
    assert.ok(el.classList.contains("oc-card--error"), "HIGH severity maps to .oc-card--error")
    assert.equal(el.getAttribute("role"), "alert")
    // Compactness comes from CSS, not inline styles: the old bloat (inline
    // padding/box-shadow/border) must be gone.
    assert.equal(el.style.padding, "", "no inline padding — sizing is class-driven")
    assert.equal(el.style.boxShadow, "", "no inline box-shadow")
    assert.equal(el.style.borderLeft, "", "no inline border")
  })

  it("maps severities to the right modifier class", () => {
    const mod = (s: ErrorSeverity) =>
      new ErrorDisplay().render(makeError({ severity: s })).className
    assert.ok(mod(ErrorSeverity.LOW).includes("oc-card--info"))
    assert.ok(mod(ErrorSeverity.MEDIUM).includes("oc-card--warning"))
    assert.ok(mod(ErrorSeverity.HIGH).includes("oc-card--error"))
    assert.ok(mod(ErrorSeverity.CRITICAL).includes("oc-card--critical"))
  })

  it("shows a theme-driven SVG icon (not an emoji)", () => {
    const el = new ErrorDisplay().render(makeError())
    const icon = el.querySelector(".oc-card__icon")
    assert.ok(icon, "icon present")
    assert.ok(icon!.querySelector("svg"), "icon is an inline SVG, not an emoji glyph")
  })

  it("puts the human-readable message in .oc-card__message", () => {
    const el = new ErrorDisplay().render(makeError())
    assert.equal(el.querySelector(".oc-card__message")?.textContent, "The model rejected the message ID format.")
  })

  it("collapses technical details by default with a Copy action", () => {
    const el = new ErrorDisplay().render(makeError())
    const details = el.querySelector(".oc-card__details") as HTMLElement
    assert.ok(details, "details section present")
    assert.ok(details.hasAttribute("hidden"), "details are collapsed by default")
    assert.ok(details.querySelector(".oc-card__details-pre")?.textContent?.includes("BadRequest"), "raw payload lives in details")
    const copy = Array.from(details.querySelectorAll("button")).find((b) => b.textContent === "Copy")
    assert.ok(copy, "Copy action present in details")
  })

  it("toggles details open/closed via the Details button without re-rendering the card", () => {
    const el = new ErrorDisplay().render(makeError())
    document.body.appendChild(el)
    const details = el.querySelector(".oc-card__details") as HTMLElement
    const toggle = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Details") as HTMLButtonElement
    assert.ok(toggle, "Details toggle present")
    assert.equal(toggle.getAttribute("aria-expanded"), "false")

    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.ok(!details.hasAttribute("hidden"), "details visible after first click")
    assert.equal(toggle.textContent, "Hide details")
    assert.equal(toggle.getAttribute("aria-expanded"), "true")
    // Same node — not replaced (focus/identity preserved).
    assert.equal(el.querySelector(".oc-card__details"), details)

    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.ok(details.hasAttribute("hidden"), "details hidden again after second click")
    assert.equal(toggle.textContent, "Details")
  })

  it("renders compact action buttons with a primary modifier", () => {
    const el = new ErrorDisplay().render(makeError())
    const buttons = Array.from(el.querySelectorAll(".oc-card__btn"))
    const retry = buttons.find((b) => b.textContent === "Retry") as HTMLButtonElement
    const dismiss = buttons.find((b) => b.textContent === "Dismiss") as HTMLButtonElement
    assert.ok(retry?.classList.contains("oc-card__btn--primary"), "primary action gets --primary")
    assert.ok(dismiss && !dismiss.classList.contains("oc-card__btn--primary"), "secondary action does not")
    assert.equal(retry.getAttribute("aria-label"), "Retry")
  })

  it("omits the details section when there are no technical details", () => {
    const el = new ErrorDisplay().render(makeError({ technicalDetails: undefined }))
    assert.equal(el.querySelector(".oc-card__details"), null)
    // …and there is no orphan Details toggle.
    const toggle = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Details")
    assert.equal(toggle, undefined)
  })
})
