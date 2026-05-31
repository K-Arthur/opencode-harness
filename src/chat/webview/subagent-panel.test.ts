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
      { onCancelSubagent: () => {} },
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
      { onCancelSubagent: () => {} },
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
      { onCancelSubagent: () => {} },
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
      { onCancelSubagent: () => {} },
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
      { onCancelSubagent: (id: string) => { cancelledId = id } },
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
