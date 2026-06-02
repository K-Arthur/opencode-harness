import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

function createEls() {
  const container = document.createElement("div")
  container.className = "subagent-detail-view hidden"
  const content = document.createElement("div")
  const backBtn = document.createElement("button")
  const closeBtn = document.createElement("button")
  container.append(backBtn, closeBtn, content)
  document.body.appendChild(container)
  return { container, content, backBtn, closeBtn }
}

void describe("subagentDetailView", () => {
  beforeEach(() => setupDom())

  void it("showDetail replaces the loading state with hydrated detail content", async () => {
    const { setupSubagentDetailView } = await import("./subagentDetailView")
    const { container, content, backBtn, closeBtn } = createEls()

    const api = setupSubagentDetailView(
      {
        subagentDetailView: container,
        subagentDetailContent: content,
        subagentDetailBackBtn: backBtn,
        subagentDetailCloseBtn: closeBtn,
      },
      { onBack: () => {}, onClose: () => {}, onCancelSubagent: () => {} },
    )

    api.renderLoading()
    assert.match(content.textContent ?? "", /Loading subagent detail/)

    api.showDetail(
      { id: "child-1", name: "Review Agent", status: "completed" },
      {
        result: "Found two risky paths.",
        messages: [
          { role: "assistant", text: "Reviewed src/chat/subagentDetailView.ts" },
        ],
      },
    )

    assert.ok(!container.classList.contains("hidden"))
    assert.doesNotMatch(content.textContent ?? "", /Loading subagent detail/)
    assert.match(content.textContent ?? "", /Found two risky paths/)
    assert.match(content.textContent ?? "", /Reviewed src\/chat\/subagentDetailView\.ts/)

    api.dispose()
    document.body.removeChild(container)
  })
})
