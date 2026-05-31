import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom } from "./streamHarness"
import { LiveTextRenderer, MAX_LIVE_TAIL_RENDER_CHARS } from "./liveTextRenderer"

// Deterministic fake render: wraps text so we can count invocations and see
// exactly which substrings were (re)parsed.
function spyRender() {
  const calls: Array<{ text: string; streaming: boolean }> = []
  const fn = (text: string, streaming: boolean) => {
    calls.push({ text, streaming })
    return `<span data-s="${streaming ? 1 : 0}">${text}</span>`
  }
  return { fn, calls }
}

describe("LiveTextRenderer (P1/A: freeze stable prefix, re-render only tail)", () => {
  it("does not re-render a frozen paragraph when a new paragraph streams in", () => {
    const dom = installDom()
    try {
      const spy = spyRender()
      const r = new LiveTextRenderer(spy.fn)
      const container = document.createElement("div")

      r.renderInto(container, "Para one.\n\nPara two typ")
      const frozen = container.querySelector(".stream-frozen") as HTMLElement
      const frozenHtmlAfterFirst = frozen.innerHTML

      r.renderInto(container, "Para one.\n\nPara two typing more")

      assert.equal(frozen.innerHTML, frozenHtmlAfterFirst, "frozen DOM must be untouched")
      // "Para one." must have been parsed exactly once (non-streaming).
      const frozenParses = spy.calls.filter((c) => !c.streaming && c.text.includes("Para one."))
      assert.equal(frozenParses.length, 1, "stable prefix parsed exactly once")
    } finally {
      dom.restore()
    }
  })

  it("is lossless — full text is present across frozen + tail", () => {
    const dom = installDom()
    try {
      const r = new LiveTextRenderer((t: string) => t) // identity render
      const container = document.createElement("div")
      r.renderInto(container, "Alpha.\n\nBeta.\n\nGamma tail")
      assert.match(container.textContent || "", /Alpha\./)
      assert.match(container.textContent || "", /Beta\./)
      assert.match(container.textContent || "", /Gamma tail/)
    } finally {
      dom.restore()
    }
  })

  it("keeps an open code fence entirely in the tail (re-renderable)", () => {
    const dom = installDom()
    try {
      const spy = spyRender()
      const r = new LiveTextRenderer(spy.fn)
      const container = document.createElement("div")
      r.renderInto(container, "intro\n\n```ts\nconst x = 1")
      const frozen = container.querySelector(".stream-frozen") as HTMLElement
      // The fence is open, so nothing past "intro\n\n" may freeze... but "intro"
      // is a closed paragraph and may freeze; the fence content must be in tail.
      assert.ok(!frozen.innerHTML.includes("const x"), "open fence body must stay in tail")
    } finally {
      dom.restore()
    }
  })

  it("rebuilds frozen state when attached to a different container (new text block)", () => {
    const dom = installDom()
    try {
      const r = new LiveTextRenderer((t: string) => t)
      const c1 = document.createElement("div")
      const c2 = document.createElement("div")
      r.renderInto(c1, "First block.\n\ntail one")
      r.renderInto(c2, "Second block.\n\ntail two")
      assert.match(c2.textContent || "", /Second block\./)
      assert.ok(!(c2.textContent || "").includes("First block"), "must not carry frozen content across blocks")
    } finally {
      dom.restore()
    }
  })

  it("rebuilds frozen when the stable prefix shrinks (e.g. context strip shift)", () => {
    const dom = installDom()
    try {
      const r = new LiveTextRenderer((t: string) => t)
      const container = document.createElement("div")
      r.renderInto(container, "Keep.\n\nmore")
      r.renderInto(container, "Short tail") // stable shrank to empty
      assert.equal(container.textContent, "Short tail")
    } finally {
      dom.restore()
    }
  })

  it("renders pathological live tails as escaped plain text until stream end", () => {
    const dom = installDom()
    try {
      const spy = spyRender()
      const r = new LiveTextRenderer(spy.fn)
      const container = document.createElement("div")
      const giantTail = "x".repeat(MAX_LIVE_TAIL_RENDER_CHARS + 1)

      r.renderInto(container, giantTail)

      assert.equal(spy.calls.length, 0, "giant live tail must not enter markdown render")
      assert.equal(container.textContent, giantTail)
      assert.equal(container.innerHTML.includes("<span"), false)
    } finally {
      dom.restore()
    }
  })
})
