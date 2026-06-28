import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

import {
  normaliseHex,
  hexToRgba,
  computeContrastRatio,
  resolveThemeToken,
  rgbToHex,
  debounce,
  isValidColorFormat,
  isHexColor,
} from "./themeUtils"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as unknown as typeof getComputedStyle
  return dom
}

describe("themeUtils — normaliseHex", () => {
  it("expands 3-digit hex to 6-digit", () => {
    assert.equal(normaliseHex("#fff"), "#ffffff")
    assert.equal(normaliseHex("#abc"), "#aabbcc")
  })

  it("lowercases 6-digit hex", () => {
    assert.equal(normaliseHex("#ABCDEF"), "#abcdef")
    assert.equal(normaliseHex("#1E1E2E"), "#1e1e2e")
  })

  it("returns non-hex strings unchanged", () => {
    assert.equal(normaliseHex("transparent"), "transparent")
    assert.equal(normaliseHex("var(--oc-accent)"), "var(--oc-accent)")
    assert.equal(normaliseHex("rgba(0,0,0,1)"), "rgba(0,0,0,1)")
  })

  it("trims whitespace before processing", () => {
    assert.equal(normaliseHex("  #fff  "), "#ffffff")
  })
})

describe("themeUtils — hexToRgba", () => {
  it("converts 6-digit hex to rgba with alpha 1", () => {
    assert.equal(hexToRgba("#1e1e2e"), "rgba(30, 30, 46, 1)")
    assert.equal(hexToRgba("#ffffff"), "rgba(255, 255, 255, 1)")
  })

  it("converts 3-digit hex to rgba", () => {
    assert.equal(hexToRgba("#fff"), "rgba(255, 255, 255, 1)")
  })

  it("supports custom alpha", () => {
    assert.equal(hexToRgba("#000000", 0.5), "rgba(0, 0, 0, 0.5)")
  })

  it("returns original string for non-hex input", () => {
    assert.equal(hexToRgba("transparent"), "transparent")
    assert.equal(hexToRgba("var(--x)"), "var(--x)")
  })
})

describe("themeUtils — computeContrastRatio", () => {
  it("returns 21:1 for black on white", () => {
    const ratio = computeContrastRatio("#000000", "#ffffff")
    assert.ok(ratio !== null && Math.abs(ratio - 21) < 0.01)
  })

  it("returns 1:1 for same color", () => {
    const ratio = computeContrastRatio("#888888", "#888888")
    assert.ok(ratio !== null && Math.abs(ratio - 1) < 0.01)
  })

  it("returns null for non-hex colors", () => {
    assert.equal(computeContrastRatio("var(--x)", "#000"), null)
    assert.equal(computeContrastRatio("#000", "transparent"), null)
  })

  it("is symmetric", () => {
    const a = computeContrastRatio("#123456", "#abcdef")
    const b = computeContrastRatio("#abcdef", "#123456")
    assert.equal(a, b)
  })
})

describe("themeUtils — rgbToHex", () => {
  it("converts rgb() to hex", () => {
    assert.equal(rgbToHex("rgb(30, 30, 46)"), "#1e1e2e")
    assert.equal(rgbToHex("rgb(255, 255, 255)"), "#ffffff")
  })

  it("converts rgba() to hex (ignoring alpha)", () => {
    assert.equal(rgbToHex("rgba(0, 0, 0, 0.5)"), "#000000")
  })

  it("returns undefined for non-matching strings", () => {
    assert.equal(rgbToHex("not a color"), undefined)
    assert.equal(rgbToHex(""), undefined)
  })
})

describe("themeUtils — resolveThemeToken", () => {
  beforeEach(() => setupDom())

  it("resolves a CSS variable to hex via computed style", () => {
    // jsdom's getComputedStyle does not fully resolve CSS custom properties
    // set via setProperty on inline styles, so we mock getComputedStyle to
    // return a known rgb value — this tests the rgbToHex conversion path
    // that resolveThemeToken relies on.
    const origGCS = globalThis.getComputedStyle
    globalThis.getComputedStyle = (() => ({
      backgroundColor: "rgb(0, 120, 212)",
    })) as unknown as typeof getComputedStyle
    try {
      const result = resolveThemeToken("--test-color")
      assert.equal(result, "#0078d4")
    } finally {
      globalThis.getComputedStyle = origGCS
    }
  })

  it("returns undefined when document is unavailable", () => {
    const origDoc = globalThis.document
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true })
    try {
      assert.equal(resolveThemeToken("--anything"), undefined)
    } finally {
      Object.defineProperty(globalThis, "document", { value: origDoc, configurable: true })
    }
  })
})

describe("themeUtils — debounce", () => {
  it("delays invocation until after wait ms", async () => {
    let called = 0
    const fn = debounce(() => { called++ }, 50)
    fn()
    fn()
    fn()
    assert.equal(called, 0, "not called immediately")
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(called, 1, "called once after wait")
  })

  it("cancel() prevents the pending invocation", async () => {
    let called = 0
    const fn = debounce(() => { called++ }, 50)
    fn()
    fn.cancel()
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(called, 0, "cancel prevents call")
  })
})

describe("themeUtils — isValidColorFormat", () => {
  it("accepts 3/6/8-digit hex", () => {
    assert.equal(isValidColorFormat("#fff"), true)
    assert.equal(isValidColorFormat("#ffffff"), true)
    assert.equal(isValidColorFormat("#ffffffff"), true)
  })

  it("accepts rgba/hsla", () => {
    assert.equal(isValidColorFormat("rgba(0, 0, 0, 1)"), true)
    assert.equal(isValidColorFormat("hsla(120, 50%, 50%, 0.5)"), true)
  })

  it("accepts var() and transparent and color-mix()", () => {
    assert.equal(isValidColorFormat("var(--oc-accent)"), true)
    assert.equal(isValidColorFormat("transparent"), true)
    assert.equal(isValidColorFormat("color-mix(in srgb, #fff 50%, transparent)"), true)
  })

  it("rejects invalid values", () => {
    assert.equal(isValidColorFormat(""), false)
    assert.equal(isValidColorFormat("not-a-color"), false)
    assert.equal(isValidColorFormat("#gggggg"), false)
  })
})

describe("themeUtils — isHexColor", () => {
  it("returns true for 3 and 6-digit hex", () => {
    assert.equal(isHexColor("#fff"), true)
    assert.equal(isHexColor("#ffffff"), true)
    assert.equal(isHexColor("#ABCDEF"), true)
  })

  it("returns false for 8-digit hex (no alpha in native picker)", () => {
    assert.equal(isHexColor("#ffffffff"), false)
  })

  it("returns false for non-hex values", () => {
    assert.equal(isHexColor("transparent"), false)
    assert.equal(isHexColor("var(--x)"), false)
    assert.equal(isHexColor("rgba(0,0,0,1)"), false)
  })
})
