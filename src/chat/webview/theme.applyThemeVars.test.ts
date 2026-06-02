import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { applyThemeVars } from "./theme"

/**
 * Behavioral test for the theme-switch "remnants" fix: applyThemeVars must
 * reconcile the inline custom-property set so values from a previous theme that
 * the new theme omits are removed (and fall back to tokens.css), not left
 * dangling. Uses a minimal Map-backed :root style shim — tsx runs under Node
 * with no DOM.
 */

interface FakeRoot {
  props: Map<string, string>
  style: {
    setProperty(k: string, v: string): void
    removeProperty(k: string): void
    getPropertyValue(k: string): string
  }
}

function installFakeDocument(): FakeRoot {
  const props = new Map<string, string>()
  const root: FakeRoot = {
    props,
    style: {
      setProperty: (k, v) => { props.set(k, v) },
      removeProperty: (k) => { props.delete(k) },
      getPropertyValue: (k) => props.get(k) ?? "",
    },
  }
  ;(globalThis as unknown as { document: unknown }).document = { documentElement: root }
  return root
}

describe("applyThemeVars", () => {
  beforeEach(() => { installFakeDocument() })

  it("clears stale properties the new theme no longer defines (no remnants)", () => {
    const root = installFakeDocument()

    applyThemeVars({ "--oc-bg": "#111111", "--oc-markdown-text": "#ffffff", "--oc-syn-keyword": "#ff0000" })
    assert.equal(root.props.get("--oc-bg"), "#111111")
    assert.equal(root.props.get("--oc-markdown-text"), "#ffffff")
    assert.equal(root.props.get("--oc-syn-keyword"), "#ff0000")

    // Switch to a theme that only defines --oc-bg.
    applyThemeVars({ "--oc-bg": "#222222" })
    assert.equal(root.props.get("--oc-bg"), "#222222", "updated key should change")
    assert.equal(root.props.has("--oc-markdown-text"), false, "omitted key must be cleared")
    assert.equal(root.props.has("--oc-syn-keyword"), false, "omitted key must be cleared")
  })

  it("rejects non-custom properties and unsafe values, keeps valid ones", () => {
    const root = installFakeDocument()

    applyThemeVars({
      "color": "red",                       // not a custom property
      "--oc-evil": "url(http://exfil)",     // unsafe value
      "--oc-evil2": "javascript:alert(1)",  // unsafe value
      "--oc-ok": "#abcdef",                 // valid
    })

    assert.equal(root.props.has("color"), false)
    assert.equal(root.props.has("--oc-evil"), false)
    assert.equal(root.props.has("--oc-evil2"), false)
    assert.equal(root.props.get("--oc-ok"), "#abcdef")
  })

  it("ignores missing/invalid payloads without throwing", () => {
    installFakeDocument()
    assert.doesNotThrow(() => applyThemeVars(undefined))
    assert.doesNotThrow(() => applyThemeVars({}))
  })
})
