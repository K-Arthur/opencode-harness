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
  handleDiffResponse
} from "./changed-files-dropdown"

function setupDom() {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <div id="container"></div>
        <div id="changed-files-strip"></div>
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
  })
  updateChangedFiles(files)
  // Open the dropdown to render the tree into container
  btn.click()
}

describe("renderChangedFilesList — summary bar", () => {
  it("renders a summary bar with total file count", async () => {
    const container = setupDom()
    const files = [
      { path: "src/a.ts", added: 10, removed: 2 },
      { path: "src/b.ts", added: 5, removed: 0 },
    ]
    renderChangedFilesList(container, files, { onOpenFile: () => {} } as any)
    const summary = container.querySelector(".cf-summary-bar")
    assert.ok(summary, "must render .cf-summary-bar")
    assert.ok(summary!.textContent!.includes("2"), "must show file count")
  })

  it("renders total added and removed in summary bar", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [
      { path: "a.ts", added: 7, removed: 3 },
      { path: "b.ts", added: 2, removed: 0 },
    ], { onOpenFile: () => {} } as any)
    const bar = container.querySelector(".cf-summary-bar")!
    assert.ok(bar.textContent!.includes("+9") || bar.textContent!.match(/\+\s*9/), "must show total +9")
    assert.ok(bar.textContent!.includes("−3") || bar.textContent!.match(/[-−]\s*3/), "must show total -3")
  })

  it("renders an empty state with .cf-empty when files array is empty", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [], { onOpenFile: () => {} } as any)
    assert.ok(container.querySelector(".cf-empty"), "must render .cf-empty for empty list")
    assert.ok(!container.querySelector(".cf-summary-bar"), "must not render summary for empty list")
  })
})

describe("renderChangedFilesList — status badge inference", () => {
  it("assigns badge A (added) when removed === 0 and added > 0", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "new.ts", added: 20, removed: 0 }], { onOpenFile: () => {} } as any)
    const badge = container.querySelector(".cf-status-badge")
    assert.ok(badge, "must render a status badge")
    assert.ok(
      badge!.textContent === "A" || badge!.classList.contains("cf-status-badge--A"),
      `badge should be A, got: ${badge!.textContent} classes: ${badge!.className}`
    )
  })

  it("assigns badge D (deleted) when added === 0 and removed > 0", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "gone.ts", added: 0, removed: 15 }], { onOpenFile: () => {} } as any)
    const badge = container.querySelector(".cf-status-badge")
    assert.ok(
      badge!.textContent === "D" || badge!.classList.contains("cf-status-badge--D"),
      `badge should be D, got: ${badge!.textContent}`
    )
  })

  it("assigns badge M (modified) when both added > 0 and removed > 0", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "edit.ts", added: 5, removed: 3 }], { onOpenFile: () => {} } as any)
    const badge = container.querySelector(".cf-status-badge")
    assert.ok(
      badge!.textContent === "M" || badge!.classList.contains("cf-status-badge--M"),
      `badge should be M, got: ${badge!.textContent}`
    )
  })

  it("handles non-number added/removed safely (coerced to 0)", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "x.ts", added: NaN as any, removed: undefined as any }], { onOpenFile: () => {} } as any)
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
    ], { onOpenFile: () => {} } as any)
    const groups = container.querySelectorAll(".cf-dir-group")
    assert.ok(groups.length >= 2, `expected ≥ 2 directory groups, got ${groups.length}`)
  })

  it("groups files at root level under a root group", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "README.md", added: 1, removed: 0 }], { onOpenFile: () => {} } as any)
    const groups = container.querySelectorAll(".cf-dir-group")
    assert.ok(groups.length >= 1, "must create at least one group for root files")
  })
})

describe("renderChangedFilesList — controls", () => {
  it("renders a collapse-all button", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], { onOpenFile: () => {} } as any)
    const btn = container.querySelector("[data-action='collapse-all'], .cf-collapse-all-btn")
    assert.ok(btn, "must render collapse-all control")
  })

  it("renders a sort toggle button", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], { onOpenFile: () => {} } as any)
    const btn = container.querySelector("[data-action='toggle-sort'], .cf-sort-btn")
    assert.ok(btn, "must render sort toggle control")
  })
})

describe("renderChangedFilesList — expand/diff preview", () => {
  it("renders an expand chevron button on each file row", async () => {
    const container = setupDom()
    resetChangedFilesDropdown()
    renderChangedFilesList(container, [{ path: "src/chevron-test.ts", added: 5, removed: 2 }], { onOpenFile: () => {} } as any)
    const chevron = container.querySelector(".cf-expand-btn")
    assert.ok(chevron, "must render a .cf-expand-btn chevron on each file row")
  })

  it("renders a hunk preview area that is initially hidden", async () => {
    const container = setupDom()
    resetChangedFilesDropdown()
    renderChangedFilesList(container, [{ path: "src/hidden-preview.ts", added: 5, removed: 2 }], { onOpenFile: () => {} } as any)
    const preview = container.querySelector(".cf-hunk-preview")
    assert.ok(preview, "must render .cf-hunk-preview")
    assert.ok(
      !preview!.classList.contains("cf-hunk-preview--open"),
      "hunk preview must be closed by default"
    )
  })

  it("renders a loading state inside the hunk preview when clicked (before response arrives)", async () => {
    const container = setupDom()
    resetChangedFilesDropdown()
    const postMessages: any[] = []
    renderChangedFilesList(
      container,
      [{ path: "src/loading-state-test.ts", added: 5, removed: 2 }],
      { onOpenFile: () => {}, postMessage: (m: any) => postMessages.push(m) } as any
    )
    const chevron = container.querySelector<HTMLElement>(".cf-expand-btn")
    chevron!.click()
    const preview = container.querySelector(".cf-hunk-preview")!
    assert.ok(
      preview.classList.contains("cf-hunk-preview--open"),
      "clicking chevron must open the hunk preview"
    )
    assert.ok(
      preview.querySelector(".cf-hunk-loading") || preview.textContent!.toLowerCase().includes("loading"),
      "must show loading state while diff data is pending"
    )
  })

  it("posts get_file_diff message when a file row is expanded", async () => {
    const container = setupDom()
    resetChangedFilesDropdown()
    const postMessages: any[] = []
    renderChangedFilesList(
      container,
      [{ path: "src/post-msg-test.ts", added: 5, removed: 2 }],
      { onOpenFile: () => {}, postMessage: (m: any) => postMessages.push(m) } as any
    )
    const chevron = container.querySelector<HTMLElement>(".cf-expand-btn")
    chevron!.click()
    assert.ok(
      postMessages.some(m => m.type === "get_file_diff" && m.path === "src/post-msg-test.ts"),
      `expected get_file_diff message, got: ${JSON.stringify(postMessages)}`
    )
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
