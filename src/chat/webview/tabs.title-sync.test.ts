import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

// Behavioral test for patchTabLabel — the no-teardown in-place patch path
// that fixes the D4 defect (focus clobber, IME composition state destruction,
// stream-indicator reset every time a title updated).
//
// Background: the legacy updateTabBar() → renderTabs() path cleared
// tabContainer.innerHTML on every invocation and rebuilt every button from
// scratch. That worked for structural changes (create / close / reorder)
// but was triggered unnecessarily for title-only updates, destroying focus
// and mid-composition IME state on whichever tab button the user was
// interacting with. patchTabLabel does the minimum: textContent on the
// .tab-label span + aria-label on the close button. Nothing else.

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  // JSDOM doesn't expose CSS.escape by default. Polyfill from the dom window
  // if present, else use a minimal regex-based escaper (covers the test
  // cases — dots, brackets, quotes).
  const domCss = (dom.window as unknown as { CSS?: typeof CSS }).CSS
  if (domCss && typeof domCss.escape === "function") {
    globalThis.CSS = domCss
  } else {
    globalThis.CSS = {
      escape: (s: string) => s.replace(/["'\\<>\[\](){}\s.:,;#!@$%^&*+=|/?]/g, "\\$&"),
      supports: () => false,
    } as unknown as typeof CSS
  }
  return dom
}

describe("patchTabLabel — in-place title update (D4 fix)", () => {
  beforeEach(() => setupDom())

  async function mountTabs(initial: Array<{ id: string; name: string; isStreaming?: boolean }>) {
    const { createTabBar, patchTabLabel } = await import("./tabs")
    const tabBar = document.createElement("div")
    const tabPanels = document.createElement("div")
    const newTabBtn = document.createElement("button")
    const els = { tabBar, tabPanels, newTabBtn } as unknown as import("./dom").ElementRefs
    const bar = createTabBar(els, { onSwitch: () => {}, onClose: () => {}, onNew: () => {} })
    bar.renderTabs(initial, initial[0]?.id || "", undefined)
    return { els, bar, patchTabLabel }
  }

  it("updates the .tab-label textContent in place for the targeted tab", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "Old A" },
      { id: "b", name: "B" },
    ])
    const ok = patchTabLabel(els, "a", "New A")
    assert.equal(ok, true)
    const label = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"] .tab-label`)
    assert.equal(label?.textContent, "New A")
  })

  it("updates only the targeted tab; other tabs are untouched", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "Old A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ])
    patchTabLabel(els, "a", "New A")
    assert.equal(
      els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="b"] .tab-label`)?.textContent,
      "B",
      "tab B must remain unchanged",
    )
    assert.equal(
      els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="c"] .tab-label`)?.textContent,
      "C",
      "tab C must remain unchanged",
    )
  })

  it("does NOT wipe the tabContainer (no innerHTML = '')", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ])
    const beforeButtons = Array.from(els.tabBar.querySelectorAll(".tab-btn"))
    patchTabLabel(els, "a", "New A")
    const afterButtons = Array.from(els.tabBar.querySelectorAll(".tab-btn"))
    assert.equal(afterButtons.length, beforeButtons.length, "button count must be unchanged")
  })

  it("preserves the streaming indicator on the patched tab", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "Old A", isStreaming: true },
    ])
    patchTabLabel(els, "a", "New A")
    const indicator = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"] .tab-indicator`)
    assert.ok(
      indicator?.classList.contains("tab-indicator--streaming"),
      "streaming indicator must survive the title patch",
    )
    const btn = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"]`)
    assert.ok(btn?.classList.contains("streaming"), "tab-btn.streaming class must survive")
  })

  it("does NOT clobber focus — patchTabLabel never calls .focus() or modifies tabIndex", async () => {
    // JSDOM doesn't fully model button.focus() delegation, so we can't
    // assert document.activeElement directly. Instead, assert the structural
    // invariant that patchTabLabel only touches .tab-label textContent and
    // .tab-close aria-label — it never calls focus()/blur() or modifies
    // tabindex/active class on any tab button. That's the property that
    // guarantees focus survives a title update in a real browser.
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ])
    const btnA = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"]`)
    const btnB = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="b"]`)
    const tabindexBeforeA = btnA?.getAttribute("tabindex")
    const tabindexBeforeB = btnB?.getAttribute("tabindex")
    const classBeforeA = btnA?.className
    const classBeforeB = btnB?.className
    patchTabLabel(els, "a", "New A")
    assert.equal(btnA?.getAttribute("tabindex"), tabindexBeforeA, "tabindex on A unchanged")
    assert.equal(btnB?.getAttribute("tabindex"), tabindexBeforeB, "tabindex on B unchanged")
    assert.equal(btnA?.className, classBeforeA, "class on A unchanged (no focus active toggle)")
    assert.equal(btnB?.className, classBeforeB, "class on B unchanged")
  })

  it("preserves the active class on the currently-active tab when a different tab is patched", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ])
    // Initially tab A is active (renderTabs initial activeId is initial[0].id)
    const btnA = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"]`)
    assert.ok(btnA?.classList.contains("active"), "precondition: A is active")
    // Patch B — A must remain active
    patchTabLabel(els, "b", "New B")
    assert.ok(
      btnA?.classList.contains("active"),
      "active class on A must survive patching B (the D4 focus/selection regression)",
    )
  })

  it("updates the close button aria-label to match the new name", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "Old A" },
    ])
    patchTabLabel(els, "a", "New A")
    const close = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"] .tab-close`)
    assert.equal(close?.getAttribute("aria-label"), "Close New A")
  })

  it("falls back to 'Untitled session' when newName is empty", async () => {
    const { els, patchTabLabel } = await mountTabs([
      { id: "a", name: "Real title" },
    ])
    patchTabLabel(els, "a", "")
    const label = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"] .tab-label`)
    assert.equal(label?.textContent, "Untitled session")
  })

  it("returns false when no tab with the given id exists (caller falls back to renderTabs)", async () => {
    const { els, patchTabLabel } = await mountTabs([{ id: "a", name: "A" }])
    const ok = patchTabLabel(els, "nonexistent", "Whatever")
    assert.equal(ok, false, "must return false so the caller can fall back to renderTabs")
  })

  it("the tab-label DOM node is reference-identical before and after (no teardown)", async () => {
    const { els, patchTabLabel } = await mountTabs([{ id: "a", name: "Old A" }])
    const labelBefore = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"] .tab-label`)
    patchTabLabel(els, "a", "New A")
    const labelAfter = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="a"] .tab-label`)
    assert.equal(
      labelBefore,
      labelAfter,
      "label DOM node must be reference-identical (no teardown + recreate)",
    )
  })

  it("handles CSS.escape special characters in tabId (e.g. dots)", async () => {
    const { els, patchTabLabel } = await mountTabs([{ id: "session.1.2", name: "Old" }])
    const ok = patchTabLabel(els, "session.1.2", "Updated")
    assert.equal(ok, true)
    const label = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="session.1.2"] .tab-label`)
    assert.equal(label?.textContent, "Updated")
  })
})
