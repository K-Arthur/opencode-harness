import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { readFileSync } from "fs"
import { resolve } from "path"

void describe("subagent pane architecture", () => {
  void it("#subagent-detail-view is a child of #subagent-panel in index.html", () => {
    const html = readFileSync(resolve(__dirname, "index.html"), "utf-8")
    const dom = new JSDOM(html)
    const doc = dom.window.document

    const detailView = doc.getElementById("subagent-detail-view")
    assert.ok(detailView, "#subagent-detail-view must exist in index.html")

    const panel = doc.getElementById("subagent-panel")
    assert.ok(panel, "#subagent-panel must exist in index.html")

    assert.ok(
      panel!.contains(detailView),
      "#subagent-detail-view must be a descendant of #subagent-panel (nested pane, not a sibling)",
    )
  })

  void it("#subagent-panel has a data-view attribute for list/detail switching", () => {
    const html = readFileSync(resolve(__dirname, "index.html"), "utf-8")
    const dom = new JSDOM(html)
    const doc = dom.window.document

    const panel = doc.getElementById("subagent-panel")
    assert.ok(panel, "#subagent-panel must exist")
    const view = panel!.getAttribute("data-view")
    assert.ok(view === "list", `data-view must default to "list", got "${view}"`)
  })

  void it("#subagent-detail-view is NOT a sibling of the tab panes in side-region-body", () => {
    const html = readFileSync(resolve(__dirname, "index.html"), "utf-8")
    const dom = new JSDOM(html)
    const doc = dom.window.document

    const body = doc.querySelector(".side-region-body")
    assert.ok(body, ".side-region-body must exist")

    const detailView = doc.getElementById("subagent-detail-view")
    assert.ok(detailView)

    const directChildren = Array.from(body!.children)
    const isDirectChild = directChildren.includes(detailView!)
    assert.ok(!isDirectChild, "#subagent-detail-view must NOT be a direct child of .side-region-body (must be nested inside #subagent-panel)")
  })
})
