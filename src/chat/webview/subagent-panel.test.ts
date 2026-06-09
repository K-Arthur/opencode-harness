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

void describe("subagent-panel", () => {
  beforeEach(() => setupDom())

  void it("setupSubagentPanel returns API with renderActivities, open, close, dispose", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )

    assert.ok(api, "api must be returned")
    assert.equal(typeof api!.renderActivities, "function")
    assert.equal(typeof api!.open, "function")
    assert.equal(typeof api!.close, "function")
    assert.equal(typeof api!.dispose, "function")

    api!.dispose()
    document.body.removeChild(container)
  })

  void it("open removes hidden class, close adds it", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    assert.ok(container.classList.contains("hidden"))
    api.open()
    assert.ok(!container.classList.contains("hidden"))
    api.close()
    assert.ok(container.classList.contains("hidden"))

    api.dispose()
    document.body.removeChild(container)
  })

  void it("renderActivities shows subagent names", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "a1", name: "Test Agent", status: "running" },
      { id: "a2", name: "Build Agent", status: "completed" },
    ])

    assert.ok(list.textContent!.includes("Test Agent"), "must show Test Agent")
    assert.ok(list.textContent!.includes("Build Agent"), "must show Build Agent")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("renderActivities uses styled status and progress hooks", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "a1", name: "Styled Agent", status: "running", progress: 45 },
    ])

    assert.ok(list.querySelector(".subagent-item-header"), "header must use the class styled by components.css")
    assert.ok(list.querySelector(".subagent-item-status--running"), "status badge must use the styled status class")
    assert.ok(list.querySelector(".subagent-item-progress"), "progress track must use the styled progress wrapper")
    assert.equal(
      (list.querySelector(".subagent-item-progress-bar") as HTMLElement | null)?.style.getPropertyValue("--p"),
      "0.45",
    )

    api.dispose()
    document.body.removeChild(container)
  })

  void it("opens detail from keyboard activation", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    let openedId = ""
    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: (activity) => { openedId = activity.id }, onCancelSubagent: () => {} },
    )!

    api.renderActivities([
      { id: "agent-keyboard", name: "Keyboard Agent", status: "completed" },
    ])

    const item = list.querySelector(".subagent-item") as HTMLElement
    assert.equal(item.getAttribute("role"), "option")
    assert.equal(item.tabIndex, 0)
    item.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    assert.equal(openedId, "agent-keyboard")

    api.dispose()
    document.body.removeChild(container)
  })

  void it("renderActivities with empty list shows empty state", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: () => {} },
    )!

    api.renderActivities([])
    assert.ok(list.textContent!.includes("No active subagents"))

    api.dispose()
    document.body.removeChild(container)
  })

  void it("cancel button invokes onCancelSubagent callback", async () => {
    const { setupSubagentPanel } = await import("./subagent-panel")

    const container = document.createElement("div")
    container.className = "subagent-panel hidden"
    const list = document.createElement("div")
    const closeBtn = document.createElement("button")
    container.append(list, closeBtn)
    document.body.appendChild(container)

    let cancelledId = ""
    const api = setupSubagentPanel(
      { subagentPanel: container, subagentList: list, closeSubagentBtn: closeBtn },
      { onOpenDetail: () => {}, onCancelSubagent: (id: string) => { cancelledId = id } },
    )!

    api.renderActivities([
      { id: "agent-42", name: "Agent To Cancel", status: "running" },
    ])

    const cancelBtn = list.querySelector(".subagent-cancel-btn") as HTMLButtonElement
    assert.ok(cancelBtn, "cancel button must exist for running agent")
    cancelBtn.click()
    assert.equal(cancelledId, "agent-42")

    api.dispose()
    document.body.removeChild(container)
  })
})
