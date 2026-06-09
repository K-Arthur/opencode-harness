import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let container: HTMLElement
let posted: Array<Record<string, unknown>>

beforeEach(() => {
  const dom = new JSDOM(`<!doctype html><div id="host"></div>`)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).Element = dom.window.Element
  ;(globalThis as any).Node = dom.window.Node

  container = document.getElementById("host")!
  posted = []
})

function makeDeps() {
  return {
    getContainer: (_sessionId: string) => container,
    postMessage: (m: Record<string, unknown>) => {
      posted.push(m)
    },
  }
}

describe("compact-banner", () => {
  it("renders a banner with percent / tokens / maxTokens and two action buttons", async () => {
    const { showCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), {
      sessionId: "s",
      percent: 82,
      tokens: 164_000,
      maxTokens: 200_000,
    })

    const banner = document.querySelector(".compact-banner") as HTMLElement | null
    assert.ok(banner, "banner element should be present")
    assert.equal(banner!.dataset.sessionId, "s")
    assert.ok(banner!.textContent!.includes("82%"), "headline should include percent")
    assert.ok(banner!.textContent!.includes("164,000"), "headline should include tokens")
    assert.ok(banner!.textContent!.includes("200,000"), "headline should include maxTokens")
    assert.ok(banner!.getAttribute("role"), "banner should have a role for assistive tech")

    const buttons = banner!.querySelectorAll(".compact-banner-btn")
    assert.equal(buttons.length, 2, "default action set should produce 2 buttons")
  })

  it("clicking 'Compact now' posts a compact_banner_action with compact_now", async () => {
    const { showCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), {
      sessionId: "s1",
      percent: 90,
      tokens: 180000,
      maxTokens: 200000,
    })

    const primary = document.querySelector(".compact-banner-btn--primary") as HTMLButtonElement
    primary.click()

    assert.equal(posted.length, 1)
    assert.deepEqual(posted[0], {
      type: "compact_banner_action",
      action: "compact_now",
      sessionId: "s1",
    })
    // Optimistic hide so the user can't double-fire.
    assert.equal(document.querySelectorAll(".compact-banner").length, 0)
  })

  it("clicking 'Remind me later' posts a compact_banner_action with remind_later", async () => {
    const { showCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), {
      sessionId: "s1",
      percent: 90,
      tokens: 180000,
      maxTokens: 200000,
    })

    const buttons = document.querySelectorAll<HTMLButtonElement>(".compact-banner-btn")
    const remindBtn = Array.from(buttons).find((b) => b.dataset.action === "remind_later")!
    remindBtn.click()

    assert.deepEqual(posted[0], {
      type: "compact_banner_action",
      action: "remind_later",
      sessionId: "s1",
    })
  })

  it("re-rendering for the same session replaces the previous banner (no duplicates)", async () => {
    const { showCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), { sessionId: "s", percent: 80, tokens: 160000, maxTokens: 200000 })
    showCompactBanner(makeDeps(), { sessionId: "s", percent: 85, tokens: 170000, maxTokens: 200000 })

    const banners = document.querySelectorAll(".compact-banner")
    assert.equal(banners.length, 1, "second render must replace, not stack")
    assert.ok(banners[0]!.textContent!.includes("85%"), "must reflect the newer payload")
  })

  it("hideCompactBanner removes the banner", async () => {
    const { showCompactBanner, hideCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), { sessionId: "s", percent: 80, tokens: 100, maxTokens: 200000 })
    hideCompactBanner("s")
    assert.equal(document.querySelectorAll(".compact-banner").length, 0)
  })

  it("hideCompactBanner with no arg clears all banners", async () => {
    const { showCompactBanner, hideCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), { sessionId: "a", percent: 80, tokens: 100, maxTokens: 200000 })
    // simulate a second session's banner appearing in the same DOM (defensive)
    const fake = document.createElement("div")
    fake.className = "compact-banner"
    fake.dataset.sessionId = "b"
    container.appendChild(fake)

    hideCompactBanner()
    assert.equal(document.querySelectorAll(".compact-banner").length, 0)
  })

  it("falls back gracefully when percent/tokens are NaN or negative", async () => {
    const { showCompactBanner } = await import("./compact-banner")
    showCompactBanner(makeDeps(), {
      sessionId: "s",
      percent: NaN,
      tokens: -1,
      maxTokens: 0,
    })
    const banner = document.querySelector(".compact-banner") as HTMLElement | null
    assert.ok(banner)
    // NaN percent should clamp to 0; negative tokens / unknown max → "?"
    assert.match(banner!.textContent!, /0%/)
    assert.match(banner!.textContent!, /\?/)
  })

  it("does nothing when the container is missing", async () => {
    const { showCompactBanner } = await import("./compact-banner")
    showCompactBanner(
      { getContainer: () => null, postMessage: () => {} },
      { sessionId: "s", percent: 80, tokens: 1, maxTokens: 200000 },
    )
    assert.equal(document.querySelectorAll(".compact-banner").length, 0)
  })
})
