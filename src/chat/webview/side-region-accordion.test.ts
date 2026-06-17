import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupSideRegion, type SideTabId } from "./sideRegion"

let previousDocument: Document | undefined
let previousWindow: Window | undefined

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="side-region" class="hidden">
      <div id="side-region-header">
        <button id="pin-btn" aria-pressed="false" title="Pin panel"></button>
        <button id="close-btn" title="Close panel"></button>
      </div>
      <div id="side-region-body">
        <div id="todos-pane" class="tab-pane collapsed" data-tab="todos">
          <button class="side-tab" data-tab="todos" aria-expanded="false"></button>
          <div class="tab-pane-content">Todos content</div>
        </div>
        <div id="activity-pane" class="tab-pane collapsed" data-tab="activity">
          <button class="side-tab" data-tab="activity" aria-expanded="false"></button>
          <div class="tab-pane-content">Activity content</div>
        </div>
        <div id="tasks-pane" class="tab-pane collapsed" data-tab="tasks">
          <button class="side-tab" data-tab="tasks" aria-expanded="false"></button>
          <div class="tab-pane-content">Tasks content</div>
        </div>
        <div id="subagent-pane" class="tab-pane collapsed" data-tab="subagent">
          <button class="side-tab" data-tab="subagent" aria-expanded="false"></button>
          <div class="tab-pane-content">Subagent content</div>
        </div>
      </div>
    </div>
  </body></html>`, { url: "http://localhost" })
  
  previousDocument = globalThis.document
  previousWindow = globalThis.window
  
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).sessionStorage = dom.window.sessionStorage
  
  return dom
}

describe("side-region vertical accordion logic", () => {
  let dom: JSDOM
  
  beforeEach(() => {
    dom = setupDom()
    sessionStorage.clear()
  })
  
  afterEach(() => {
    ;(globalThis as any).document = previousDocument
    ;(globalThis as any).window = previousWindow
    sessionStorage.clear()
  })

  function getElements() {
    const regionEl = document.getElementById("side-region")!
    const pinBtn = document.getElementById("pin-btn")!
    const closeBtn = document.getElementById("close-btn")!
    const tabButtons = document.querySelectorAll(".side-tab") as unknown as NodeListOf<HTMLElement>
    
    const paneMap: Record<SideTabId, HTMLElement> = {
      todos: document.getElementById("todos-pane")!,
      activity: document.getElementById("activity-pane")!,
      tasks: document.getElementById("tasks-pane")!,
      subagent: document.getElementById("subagent-pane")!,
    }
    
    return { regionEl, pinBtn, closeBtn, tabButtons, paneMap }
  }

  it("should initialize with 'todos' expanded and others collapsed by default", () => {
    const { regionEl, tabButtons, paneMap, pinBtn, closeBtn } = getElements()
    
    setupSideRegion(regionEl, null, tabButtons, paneMap, pinBtn, closeBtn)
    
    assert.ok(paneMap.todos.classList.contains("expanded"), "todos pane must be expanded by default")
    assert.ok(!paneMap.todos.classList.contains("collapsed"), "todos pane must not be collapsed")
    
    assert.ok(paneMap.activity.classList.contains("collapsed"), "activity pane must be collapsed by default")
    assert.ok(paneMap.tasks.classList.contains("collapsed"), "tasks pane must be collapsed by default")
    assert.ok(paneMap.subagent.classList.contains("collapsed"), "subagent pane must be collapsed by default")
    
    assert.equal(sessionStorage.getItem("oc:side-panel-expanded:todos"), "true")
    assert.equal(sessionStorage.getItem("oc:side-panel-expanded:activity"), "false")
  })

  it("should restore expanded states from sessionStorage on initialization", () => {
    const { regionEl, tabButtons, paneMap, pinBtn, closeBtn } = getElements()
    
    sessionStorage.setItem("oc:side-panel-expanded:todos", "false")
    sessionStorage.setItem("oc:side-panel-expanded:activity", "true")
    
    setupSideRegion(regionEl, null, tabButtons, paneMap, pinBtn, closeBtn)
    
    assert.ok(paneMap.todos.classList.contains("collapsed"), "todos pane should be collapsed from storage")
    assert.ok(paneMap.activity.classList.contains("expanded"), "activity pane should be expanded from storage")
  })

  it("should toggle panel expansion when accordion header clicked", () => {
    const { regionEl, tabButtons, paneMap, pinBtn, closeBtn } = getElements()
    
    const api = setupSideRegion(regionEl, null, tabButtons, paneMap, pinBtn, closeBtn)
    api.open()
    
    const todosBtn = Array.from(tabButtons).find(b => b.dataset.tab === "todos")!
    const activityBtn = Array.from(tabButtons).find(b => b.dataset.tab === "activity")!
    
    // Collapse todos
    todosBtn.click()
    assert.ok(paneMap.todos.classList.contains("collapsed"), "todos should collapse on click")
    assert.equal(sessionStorage.getItem("oc:side-panel-expanded:todos"), "false")
    
    // Expand activity
    activityBtn.click()
    assert.ok(paneMap.activity.classList.contains("expanded"), "activity should expand on click")
    assert.equal(sessionStorage.getItem("oc:side-panel-expanded:activity"), "true")
  })

  it("should switch tabs and make them expanded", () => {
    const { regionEl, tabButtons, paneMap, pinBtn, closeBtn } = getElements()
    
    const api = setupSideRegion(regionEl, null, tabButtons, paneMap, pinBtn, closeBtn)
    
    // Switch to tasks
    api.switchTab("tasks")
    assert.ok(paneMap.tasks.classList.contains("expanded"), "tasks must be expanded after switchTab")
    assert.equal(sessionStorage.getItem("oc:side-panel-expanded:tasks"), "true")
    assert.ok(!regionEl.classList.contains("hidden"), "sidebar should be open on switchTab")
  })

  it("should support pin/unpin status and prevent close when pinned", () => {
    const { regionEl, tabButtons, paneMap, pinBtn, closeBtn } = getElements()
    
    const api = setupSideRegion(regionEl, null, tabButtons, paneMap, pinBtn, closeBtn)
    
    api.open()
    assert.ok(api.isOpen(), "sidebar is open")
    
    // Pin it
    pinBtn.click()
    assert.equal(pinBtn.getAttribute("aria-pressed"), "true")
    
    // Try to close
    api.close()
    assert.ok(api.isOpen(), "sidebar must remain open when pinned")
    
    // Unpin and close
    pinBtn.click()
    assert.equal(pinBtn.getAttribute("aria-pressed"), "false")
    api.close()
    assert.ok(!api.isOpen(), "sidebar should close when unpinned")
  })
})
