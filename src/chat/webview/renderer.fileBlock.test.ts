/**
 * Behavioural tests for the `'file'` block renderer.
 *
 * Regression: the `RENDERER_MAP` in `renderer.ts` previously had no entry
 * for `type: "file"`, so blocks produced by the SDK FilePart converter
 * (sdkMessageConverter.ts:71-89) silently rendered as `null`. That made
 * server-snapshot / reconnect / history-replay images disappear after the
 * initial local send.
 *
 * These tests feed `renderBlock` synthetic file-shaped blocks and assert
 * that the DOM contains an `<img>` (for image mimes with loadable URLs)
 * or a labelled chip (for everything else). The two paths cover both the
 * inline-image case and the file:// / non-image fallback.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let warn: typeof console.warn
function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).HTMLImageElement = dom.window.HTMLImageElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
  warn = console.warn
  console.warn = () => {}
}

// renderBlock pulls in MarkdownIt, syntax highlighter, etc. — too heavy to
// import for one renderer. We import it directly and accept the cost.
import { renderBlock } from "./renderer"

describe("renderer — 'file' block dispatch", () => {
  beforeEach(() => {
    setupDom()
  })
  afterEach(() => {
    console.warn = warn
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  })

  it("renders an inline <img> for an image file with a data: URL", () => {
    const el = renderBlock({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      filename: "tiny.png",
    })
    assert.ok(el, "renderBlock must return an HTMLElement for a file block (regression: was returning null)")
    const img = el!.querySelector("img")
    assert.ok(img, "image file blocks must render an <img>")
    assert.equal(img!.getAttribute("alt"), "tiny.png")
    assert.ok(img!.classList.contains("attached-image-thumb"))
  })

  it("renders an inline <img> for an image file with an https: URL", () => {
    const el = renderBlock({
      type: "file",
      mime: "image/jpeg",
      url: "https://example.com/photo.jpg",
      filename: "photo.jpg",
    })
    const img = el!.querySelector("img")
    assert.ok(img, "https image file blocks must render an <img>")
    assert.equal(img!.getAttribute("src"), "https://example.com/photo.jpg")
  })

  it("falls back to a labelled chip for image files with a file:// URL (webview cannot inline file://)", () => {
    const el = renderBlock({
      type: "file",
      mime: "image/png",
      url: "file:///tmp/opencode-harness-attach-abc/12345.png",
      filename: "screenshot.png",
    })
    assert.ok(el)
    // No <img> for file:// URLs (browsers refuse to load them in a webview).
    assert.equal(el!.querySelector("img"), null, "file:// images must not render an <img>")
    // The user must still see the attachment: a chip with the filename.
    const chip = el!.querySelector(".msg-file-chip")
    assert.ok(chip, "file:// images must fall back to a labelled .msg-file-chip")
    assert.ok(
      chip!.textContent?.includes("screenshot.png"),
      "chip must display the filename so the user can see the attachment exists",
    )
    assert.ok(chip!.textContent?.includes("image/png"), "chip must display the mime")
  })

  it("renders a file chip for non-image attachments (text, pdf, etc.)", () => {
    const el = renderBlock({
      type: "file",
      mime: "application/pdf",
      url: "https://example.com/report.pdf",
      filename: "report.pdf",
    })
    assert.ok(el)
    assert.equal(el!.querySelector("img"), null, "non-image file blocks must not render an <img>")
    const chip = el!.querySelector(".msg-file-chip")
    assert.ok(chip, "non-image file blocks must render a .msg-file-chip")
    assert.ok(chip!.textContent?.includes("report.pdf"))
    assert.ok(chip!.textContent?.includes("application/pdf"))
  })

  it("returns null only when the block carries neither mime nor url", () => {
    const el = renderBlock({ type: "file" } as { type: string; mime?: string; url?: string })
    assert.equal(el, null, "a file block with no mime and no url has nothing to render")
  })

  it("uses the legacy mimeType field as a fallback when mime is missing", () => {
    const el = renderBlock({
      type: "file",
      mimeType: "image/webp",
      url: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJZQCdAEO/gbsAAA=",
      filename: "anim.webp",
    })
    const img = el!.querySelector("img")
    assert.ok(img, "mimeType must be honoured when mime is absent")
  })
})
