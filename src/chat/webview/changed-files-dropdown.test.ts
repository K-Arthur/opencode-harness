/**
 * Unit tests for the consolidated Changed Files rendering engine.
 * Relies on the canonical changed-files-dropdown.ts implementation.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  setupChangedFilesDropdown,
  updateChangedFiles,
  resetChangedFilesDropdown,
  handleDiffResponse,
  setCurrentSession,
} from "./changed-files-dropdown"

function setupDom() {
  resetChangedFilesDropdown()
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <div id="container"></div>
        <div id="changed-files-strip"></div>
        <div id="changed-files-panel" class="cf-panel hidden" role="region" aria-label="Changed files" aria-live="polite">
          <div class="cf-panel-header">
            <div class="cf-panel-header-left">
              <span id="cf-panel-title" class="cf-panel-title">Changed Files</span>
              <span id="cf-panel-count" class="cf-panel-count">0 files</span>
            </div>
            <div class="cf-panel-header-right">
              <button class="cf-collapse-all-btn" id="cf-panel-collapse-all" type="button" aria-label="Collapse all file groups">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M5 15l7-7 7 7"/>
                </svg>
                Collapse all
              </button>
              <button class="cf-close-panel-btn" id="cf-panel-close" type="button" aria-label="Close changed files">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          <div id="cf-panel-tree" class="cf-panel-tree"></div>
        </div>
      </body>
    </html>
  `)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0)
  return dom.window.document.getElementById("container") as HTMLElement
}

function renderChangedFilesList(container: HTMLElement, files: any[], options: any) {
  const btn = document.createElement("button")
  const panel = document.createElement("div")
  const badge = document.createElement("div")
  setupChangedFilesDropdown({
    btn,
    panel,
    treeContainer: container,
    badge,
    postMessage: options.postMessage || (() => {}),
    onOpenFile: options.onOpenFile || (() => {}),
    onOpenChangedFileDiff: options.onOpenChangedFileDiff || (() => {}),
  })
  setCurrentSession("test-session")
  updateChangedFiles("test-session", files)
  // Open the dropdown to render the tree into container
  btn.click()
}

describe("renderChangedFilesList — empty state", () => {
  it("renders an empty state with .cf-empty when files array is empty", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    assert.ok(container.querySelector(".cf-empty"), "must render .cf-empty for empty list")
  })
})

describe("renderChangedFilesList — status badge inference", () => {
  it("defaults to M when only added > 0 (cannot distinguish A from M without git status)", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "new.ts", added: 20, removed: 0 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const badge = container.querySelector(".cf-status-badge")
    assert.ok(badge, "must render a status badge")
    assert.ok(
      badge!.textContent === "M" || badge!.classList.contains("cf-status-badge--M"),
      `badge should be M, got: ${badge!.textContent} classes: ${badge!.className}`
    )
  })

  it("defaults to M when only removed > 0 (cannot distinguish D from M without git status)", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "gone.ts", added: 0, removed: 15 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const badge = container.querySelector(".cf-status-badge")
    assert.ok(
      badge!.textContent === "M" || badge!.classList.contains("cf-status-badge--M"),
      `badge should be M, got: ${badge!.textContent}`
    )
  })

  it("assigns badge M (modified) when both added > 0 and removed > 0", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "edit.ts", added: 5, removed: 3 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const badge = container.querySelector(".cf-status-badge")
    assert.ok(
      badge!.textContent === "M" || badge!.classList.contains("cf-status-badge--M"),
      `badge should be M, got: ${badge!.textContent}`
    )
  })

  it("uses explicit status field when provided", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [
      { path: "new.ts", added: 20, removed: 0, status: "A" },
      { path: "gone.ts", added: 0, removed: 15, status: "D" },
    ], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const badges = container.querySelectorAll(".cf-status-badge")
    assert.equal(badges.length, 2, "must render 2 badges")
    assert.ok(badges[0]!.textContent === "A" || badges[0]!.classList.contains("cf-status-badge--A"),
      `first badge should be A, got: ${badges[0]!.textContent}`)
    assert.ok(badges[1]!.textContent === "D" || badges[1]!.classList.contains("cf-status-badge--D"),
      `second badge should be D, got: ${badges[1]!.textContent}`)
  })

  it("handles non-number added/removed safely (coerced to 0)", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "x.ts", added: NaN as any, removed: undefined as any }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    // Should not throw; badge should be M or A or D (not crash)
    assert.ok(container.querySelector(".cf-status-badge"), "must not crash on non-numeric stats")
  })
})

describe("renderChangedFilesList — directory grouping", () => {
  it("groups files by parent directory", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [
      { path: "src/components/Button.tsx", added: 5, removed: 1 },
      { path: "src/components/Input.tsx", added: 3, removed: 0 },
      { path: "tests/button.test.ts", added: 10, removed: 2 },
    ], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const groups = container.querySelectorAll(".cf-dir-group")
    assert.ok(groups.length >= 2, `expected ≥ 2 directory groups, got ${groups.length}`)
  })

  it("groups files at root level under a root group", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "README.md", added: 1, removed: 0 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const groups = container.querySelectorAll(".cf-dir-group")
    assert.ok(groups.length >= 1, "must create at least one group for root files")
  })
})

describe("renderChangedFilesList — open file button", () => {
  it("calls onOpenFile with full path when open button is clicked", async () => {
    const container = setupDom()
    let opened = ""
    renderChangedFilesList(container, [{ path: "src/main.ts", added: 1, removed: 0 }], {
      onOpenFile: (p: string) => { opened = p },
    } as any)
    const btn = container.querySelector<HTMLElement>(".cf-open-btn")
    btn!.click()
    assert.equal(opened, "src/main.ts")
  })
})

