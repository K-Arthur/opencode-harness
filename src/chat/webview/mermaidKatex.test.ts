import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendererSource = readFileSync(resolve(__dirname, "renderer.ts"), "utf8")
const vendorLoaderSource = readFileSync(resolve(__dirname, "vendorLoader.ts"), "utf8")
const vendorMermaidSource = readFileSync(resolve(__dirname, "vendor", "mermaidEntry.ts"), "utf8")
const vendorKatexSource = readFileSync(resolve(__dirname, "vendor", "katexEntry.ts"), "utf8")
const cssSource = readFileSync(resolve(__dirname, "css", "blocks.css"), "utf8")

void describe("renderer.ts — Mermaid diagram rendering (W3.A)", () => {
  void it("exports renderMermaidBlocks function", () => {
    assert.ok(
      /export async function renderMermaidBlocks/.test(rendererSource),
      "must export renderMermaidBlocks",
    )
  })

  void it("queries code.language-mermaid elements", () => {
    assert.ok(
      /\.querySelectorAll\(\s*"code\.language-mermaid"\s*\)/.test(rendererSource),
      "must query for code.language-mermaid elements",
    )
  })

  void it("loads mermaid via loadMermaid()", () => {
    assert.ok(
      /loadMermaid\(\)/.test(rendererSource),
      "must call loadMermaid to lazy-load the mermaid vendor bundle",
    )
  })

  void it("replaces pre element with mermaid-diagram wrapper", () => {
    assert.ok(
      /pre\.parentNode\.replaceChild\(wrapper,\s*pre\)/.test(rendererSource),
      "must replace the pre element with the SVG wrapper",
    )
  })

  void it("sanitizes mermaid SVG output", () => {
    assert.ok(
      /sanitizeHtml\(\s*svg\s*\)/.test(rendererSource),
      "must sanitize mermaid SVG output",
    )
  })

  void it("catches mermaid render errors gracefully", () => {
    assert.ok(
      /catch.*err/.test(rendererSource),
      "must catch and log mermaid render errors",
    )
  })

  void it("uses mermaid-diagram class on wrapper", () => {
    assert.ok(
      /"mermaid-diagram"/.test(rendererSource),
      "must use .mermaid-diagram class on SVG wrapper",
    )
  })
})

void describe("renderer.ts — KaTeX math rendering (W3.B)", () => {
  void it("exports renderMathBlocks function", () => {
    assert.ok(
      /export async function renderMathBlocks/.test(rendererSource),
      "must export renderMathBlocks",
    )
  })

  void it("uses TreeWalker to find text nodes containing math", () => {
    assert.ok(
      /createTreeWalker/.test(rendererSource),
      "must use TreeWalker for text node traversal",
    )
  })

  void it("skips CODE, PRE, SCRIPT, STYLE elements", () => {
    assert.ok(
      /tagName === "CODE"/.test(rendererSource),
      "must skip CODE elements",
    )
    assert.ok(
      /tagName === "PRE"/.test(rendererSource),
      "must skip PRE elements",
    )
  })

  void it("loads katex via loadKatex()", () => {
    assert.ok(
      /loadKatex\(\)/.test(rendererSource),
      "must call loadKatex to lazy-load the KaTeX vendor bundle",
    )
  })

  void it("detects display math $$...$$ pattern", () => {
    assert.ok(
      /\$\$(.+?)\$\$/gs.test(rendererSource),
      "must detect display math $$...$$",
    )
  })

  void it("detects inline math $...$ pattern", () => {
    assert.ok(
      /\(\?\<\!/.test(rendererSource),
      "must detect inline math with negative lookbehind for $",
    )
  })

  void it("replaces inline math with .katex span", () => {
    assert.ok(
      /"katex"/.test(rendererSource),
      "must create .katex spans for inline math",
    )
  })

  void it("replaces display math with .katex-display div", () => {
    assert.ok(
      /"katex-display"|katex-display/.test(rendererSource),
      "must create .katex-display divs for display math",
    )
  })

  void it("calls katex.renderToString with options", () => {
    assert.ok(
      /renderToString/.test(rendererSource),
      "must call katex.renderToString",
    )
    assert.ok(
      /displayMode:/.test(rendererSource),
      "must pass displayMode option to katex",
    )
  })
})

void describe("vendorLoader.ts — dynamic script loading", () => {
  void it("exports loadMermaid function", () => {
    assert.ok(
      /export function loadMermaid/.test(vendorLoaderSource),
      "must export loadMermaid",
    )
  })

  void it("exports loadKatex function", () => {
    assert.ok(
      /export function loadKatex/.test(vendorLoaderSource),
      "must export loadKatex",
    )
  })

  void it("reads __OC_MERMAID_URI__ from window", () => {
    assert.ok(
      /__OC_MERMAID_URI__/.test(vendorLoaderSource),
      "must read mermaid URI from window global",
    )
  })

  void it("reads __OC_KATEX_URI__ from window", () => {
    assert.ok(
      /__OC_KATEX_URI__/.test(vendorLoaderSource),
      "must read katex URI from window global",
    )
  })

  void it("creates script elements for dynamic loading", () => {
    assert.ok(
      /document\.createElement\(\s*"script"\s*\)/.test(vendorLoaderSource),
      "must create script elements dynamically",
    )
  })

  void it("caches loaded libraries (idempotent)", () => {
    assert.ok(
      /=== "loaded"/.test(vendorLoaderSource),
      "must check load state and return cached module",
    )
  })

  void it("has timeout (MERMAID_TIMEOUT_MS)", () => {
    assert.ok(
      /MERMAID_TIMEOUT_MS/.test(vendorLoaderSource),
      "must define a timeout constant",
    )
  })

  void it("deduplicates concurrent load requests", () => {
    assert.ok(
      /=== "loading" &&.*Promise/.test(vendorLoaderSource),
      "must return existing promise when already loading",
    )
  })
})

void describe("vendor entry points — global export", () => {
  void it("mermaidEntry exposes mermaid on window.__OC_MERMAID__", () => {
    assert.ok(
      /__OC_MERMAID__\s*=/.test(vendorMermaidSource),
      "must assign mermaid to window.__OC_MERMAID__",
    )
  })

  void it("katexEntry exposes katex on window.__OC_KATEX__", () => {
    assert.ok(
      /__OC_KATEX__\s*=/.test(vendorKatexSource),
      "must assign katex to window.__OC_KATEX__",
    )
  })
})

void describe("blocks.css — KaTeX and Mermaid styles (W3.A+W3.B)", () => {
  void it("has .katex class styles", () => {
    assert.ok(
      /\.katex\s*\{/.test(cssSource),
      "must style .katex class",
    )
  })

  void it("has .katex-display class styles", () => {
    assert.ok(
      /\.katex-display\s*\{/.test(cssSource),
      "must style .katex-display class",
    )
  })

  void it("has .mermaid-diagram class styles", () => {
    assert.ok(
      /\.mermaid-diagram\s*\{/.test(cssSource),
      "must style .mermaid-diagram class",
    )
  })

  void it("provides overflow-x: auto for diagrams", () => {
    assert.ok(
      /overflow-x:\s*auto/.test(cssSource),
      "must allow horizontal overflow scroll for diagrams",
    )
  })
})
