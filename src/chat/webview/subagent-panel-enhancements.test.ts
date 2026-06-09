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

function createPanel() {
  const container = document.createElement("div")
  container.className = "subagent-panel hidden"
  const list = document.createElement("div")
  const closeBtn = document.createElement("button")
  container.append(list, closeBtn)
  document.body.appendChild(container)
  return { container, list, closeBtn }
}

function completedAgent(id: string, ix: number) {
  return {
    id,
    name: `Completed Agent ${ix}`,
    status: "completed" as const,
    durationMs: 1000 + ix * 100,
    completedAt: Date.now() - ix * 1000,
  }
}

void describe("subagent-panel enhancements", () => {
  beforeEach(() => setupDom())

  void it("completed subagents render with collapsed class by default", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "c1", name: "Done Agent", status: "completed" },
    ])

    const item = list.querySelector(".subagent-item") as HTMLElement
    assert.ok(item, "item must exist")
    assert.ok(item.classList.contains("subagent-item--collapsed"), "completed item must have --collapsed class")
    assert.ok(!item.querySelector(".subagent-item-progress"), "collapsed item must not show progress")
    assert.ok(!item.querySelector(".subagent-output"), "collapsed item must not show output")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("running subagents do NOT have collapsed class", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "r1", name: "Runner", status: "running", progress: 50 },
    ])

    const item = list.querySelector(".subagent-item") as HTMLElement
    assert.ok(item, "item must exist")
    assert.ok(!item.classList.contains("subagent-item--collapsed"), "running item must NOT be collapsed")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("clicking a collapsed completed item expands it", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "c1", name: "Done Agent", status: "completed", progress: 100, output: "Finished" },
    ])

    const item = list.querySelector(".subagent-item") as HTMLElement
    assert.ok(item.classList.contains("subagent-item--collapsed"))

    const expandBtn = item.querySelector(".subagent-expand-btn") as HTMLElement
    assert.ok(expandBtn, "collapsed item must have an expand toggle button")
    expandBtn.click()

    assert.ok(!item.classList.contains("subagent-item--collapsed"), "item must be expanded after click")
    assert.equal(expandBtn.getAttribute("aria-expanded"), "true")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("caps visible completed subagents to 10, keeping newest first", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    const activities = Array.from({ length: 15 }, (_, i) => completedAgent(`c${i}`, i))
    api.renderActivities(activities)

    const items = list.querySelectorAll(".subagent-item")
    assert.equal(items.length, 10, "must cap at 10 completed items")
    const first = items[0]!
    const last = items[9]!
    assert.ok(first.textContent!.includes("Completed Agent 0"), "first must be newest (index 0, highest completedAt)")
    assert.ok(last.textContent!.includes("Completed Agent 9"), "last must be 10th newest (index 9)")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("clear-completed button appears when there are completed subagents", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    let cleared = false
    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {}, onClearCompleted: () => { cleared = true } },
    )!

    api.renderActivities([
      { id: "r1", name: "Runner", status: "running" },
      { id: "c1", name: "Done", status: "completed" },
    ])

    const clearBtn = list.querySelector(".subagent-clear-completed-btn") as HTMLElement
    assert.ok(clearBtn, "clear-completed button must appear when completed > 0")
    clearBtn.click()
    assert.ok(cleared, "onClearCompleted must be invoked")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("clear-completed button does NOT appear when no completed subagents", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {}, onClearCompleted: () => {} },
    )!

    api.renderActivities([
      { id: "r1", name: "Runner", status: "running" },
    ])

    const clearBtn = list.querySelector(".subagent-clear-completed-btn")
    assert.ok(!clearBtn, "clear-completed must NOT appear when no completed items")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("cancel button is not rendered for completed subagents", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "c1", name: "Done Agent", status: "completed" },
    ])

    const cancelBtn = list.querySelector(".subagent-cancel-btn")
    assert.ok(!cancelBtn, "cancel button must NOT be rendered for completed subagent")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("clicking item body opens detail even for collapsed completed items", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    let openedId = ""
    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: (a) => { openedId = a.id }, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "c1", name: "Done Agent", status: "completed" },
    ])

    const item = list.querySelector(".subagent-item") as HTMLElement
    item.click()
    assert.equal(openedId, "c1", "clicking a collapsed completed item must still open detail")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("stats bar shows completed count in collapsed summary", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "r1", name: "Runner", status: "running" },
      { id: "c1", name: "Done 1", status: "completed" },
      { id: "c2", name: "Done 2", status: "completed" },
    ])

    const statsBar = list.querySelector(".subagent-stats-bar")
    assert.ok(statsBar, "stats bar must exist")
    assert.ok(statsBar!.textContent!.includes("3 subagents"), "must show total count")
    assert.ok(statsBar!.textContent!.includes("2 done"), "must show completed count")
    assert.ok(statsBar!.textContent!.includes("1 running"), "must show running count")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("mark-read callback is invoked when clicking a subagent item", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")
    const { container, list, closeBtn } = createPanel()

    let readId = ""
    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      {
        onOpenDetail: () => {},
        onCancelSubagent: () => {},
        onMarkRead: (id: string) => { readId = id },
      },
    )!

    api.renderActivities([
      { id: "r1", name: "Runner", status: "running" },
    ])

    const item = list.querySelector(".subagent-item") as HTMLElement
    item.click()
    assert.equal(readId, "r1", "onMarkRead must be called with the clicked subagent id")

    api.dispose()
    document.body.removeChild(container)
  })
})
