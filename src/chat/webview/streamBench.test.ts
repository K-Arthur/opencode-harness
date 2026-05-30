import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom } from "./streamHarness"
import { LiveTextRenderer } from "./liveTextRenderer"

/**
 * P1/A bench — proves the streaming render is no longer O(N·k).
 *
 * We stream a multi-paragraph document in many small chunks and count the TOTAL
 * number of characters handed to the markdown render function. The old code
 * re-parsed the entire accumulated buffer every flush (Σ ≈ N·k/2). The frozen
 * stable-prefix renderer parses each closed block once (≈N) plus the bounded
 * tail per flush (≈ paragraph·k). We assert the total stays a small multiple of
 * N, well under the quadratic baseline.
 */
describe("streamBench: stable-tail keeps streaming render near-linear", () => {
  it("total parsed chars are a small multiple of document size, not quadratic", () => {
    const dom = installDom()
    try {
      // Build a ~60 KB document of ~120 paragraphs separated by blank lines.
      const paras: string[] = []
      for (let i = 0; i < 120; i++) {
        paras.push(`Paragraph ${i}: ` + "lorem ipsum ".repeat(40))
      }
      const doc = paras.join("\n\n")
      const N = doc.length

      let totalParsed = 0
      const renderFn = (text: string, _streaming: boolean) => {
        totalParsed += text.length
        return text
      }
      const r = new LiveTextRenderer(renderFn)
      const container = document.createElement("div")

      // Stream the document one small chunk at a time, rendering each flush.
      const CHUNK = 80
      let buf = ""
      let flushes = 0
      for (let i = 0; i < doc.length; i += CHUNK) {
        buf += doc.slice(i, i + CHUNK)
        r.renderInto(container, buf)
        flushes++
      }

      // Old quadratic baseline would be ~ N*flushes/2.
      const quadraticBaseline = (N * flushes) / 2
      // Frozen prefix (~N once) + tail (one paragraph re-parsed per flush).
      assert.ok(
        totalParsed < N * 6,
        `expected near-linear parse (< 6N=${N * 6}); got ${totalParsed} over ${flushes} flushes`,
      )
      assert.ok(
        totalParsed < quadraticBaseline / 8,
        `expected >=8x better than quadratic baseline ${quadraticBaseline}; got ${totalParsed}`,
      )

      // Sanity: the full document content survived into the DOM.
      assert.match(container.textContent || "", /Paragraph 0:/)
      assert.match(container.textContent || "", /Paragraph 119:/)
    } finally {
      dom.restore()
    }
  })

  it("frozen region is parsed exactly once across the whole stream", () => {
    const dom = installDom()
    try {
      const parsedNonStreaming: string[] = []
      const renderFn = (text: string, streaming: boolean) => {
        if (!streaming) parsedNonStreaming.push(text)
        return text
      }
      const r = new LiveTextRenderer(renderFn)
      const container = document.createElement("div")

      const doc = "Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta tail"
      let buf = ""
      for (let i = 0; i < doc.length; i += 5) {
        buf += doc.slice(i, i + 5)
        r.renderInto(container, buf)
      }

      // Each frozen block should appear in exactly one non-streaming parse, and
      // never be re-parsed.
      const frozenJoined = parsedNonStreaming.join("")
      const alpha = (frozenJoined.match(/Alpha block\./g) || []).length
      const beta = (frozenJoined.match(/Beta block\./g) || []).length
      assert.equal(alpha, 1, "Alpha frozen-parsed exactly once")
      assert.equal(beta, 1, "Beta frozen-parsed exactly once")
    } finally {
      dom.restore()
    }
  })
})
