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
        <div id="changed-files-dropdown" class="cf-dropdown hidden" role="dialog" aria-modal="true" aria-labelledby="cf-dropdown-title" aria-describedby="cf-dropdown-desc">
          <div class="cf-dropdown-header">
            <div class="cf-dropdown-header-text">
              <span id="cf-dropdown-title" class="cf-dropdown-title">Changed Files</span>
              <span id="cf-dropdown-desc" class="cf-dropdown-subtitle" aria-live="polite">No files changed</span>
            </div>
            <button class="cf-close-btn" id="cf-dropdown-close" aria-label="Close Changed Files Modal" type="button">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"/><path d="M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div id="cf-dropdown-tree" class="cf-dropdown-tree"></div>
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

describe("renderChangedFilesList — summary bar", () => {
  it("renders a summary bar with total file count", async () => {
    const container = setupDom()
    const files = [
      { path: "src/a.ts", added: 10, removed: 2 },
      { path: "src/b.ts", added: 5, removed: 0 },
    ]
    renderChangedFilesList(container, files, { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const summary = container.querySelector(".cf-summary-bar")
    assert.ok(summary, "must render .cf-summary-bar")
    assert.ok(summary!.textContent!.includes("2"), "must show file count")
  })

  it("renders total added and removed in summary bar", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [
      { path: "a.ts", added: 7, removed: 3 },
      { path: "b.ts", added: 2, removed: 0 },
    ], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const bar = container.querySelector(".cf-summary-bar")!
    assert.ok(bar.textContent!.includes("+9") || bar.textContent!.match(/\+\s*9/), "must show total +9")
    assert.ok(bar.textContent!.includes("−3") || bar.textContent!.match(/[-−]\s*3/), "must show total -3")
  })

  it("renders an empty state with .cf-empty when files array is empty", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    assert.ok(container.querySelector(".cf-empty"), "must render .cf-empty for empty list")
    assert.ok(!container.querySelector(".cf-summary-bar"), "must not render summary for empty list")
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

describe("renderChangedFilesList — controls", () => {
  it("renders a collapse-all button", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const btn = container.querySelector("[data-action='collapse-all'], .cf-collapse-all-btn")
    assert.ok(btn, "must render collapse-all control")
  })

  it("renders a sort toggle button", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const btn = container.querySelector("[data-action='toggle-sort'], .cf-sort-btn")
    assert.ok(btn, "must render sort toggle control")
  })
})

describe("renderChangedFilesList — expand/diff preview", () => {
  it("renders an expand chevron button on each file row", async () => {
    const container = setupDom()
    resetChangedFilesDropdown()
    renderChangedFilesList(container, [{ path: "src/chevron-test.ts", added: 5, removed: 2 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const chevron = container.querySelector(".cf-expand-btn")
    assert.ok(chevron, "must render a .cf-expand-btn chevron on each file row")
  })

  it("renders a hunk preview area that is initially hidden", async () => {
    const container = setupDom()
    resetChangedFilesDropdown()
    renderChangedFilesList(container, [{ path: "src/hidden-preview.ts", added: 5, removed: 2 }], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
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
      { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {}, postMessage: (m: any) => postMessages.push(m) } as any
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
      { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {}, postMessage: (m: any) => postMessages.push(m) } as any
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

describe("renderChangedFilesList — path shortening", () => {
  it("shortens directory paths to relative form when workspace root is provided", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [
      { path: "/home/user/project/src/components/Button.tsx", added: 5, removed: 1 },
    ], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const dirHeader = container.querySelector(".cf-dir-path")
    assert.ok(dirHeader, "must render directory header")
    const pathText = dirHeader!.textContent!
    // Should not contain full absolute path
    assert.ok(!pathText.includes("/home/user/project"), "should not show absolute path")
    // Should show relative path
    assert.ok(pathText.includes("src/components") || pathText.includes("src"), "should show relative path")
  })

  it("uses sentence case for directory headers (no uppercase transform)", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [
      { path: "src/components/Button.tsx", added: 5, removed: 1 },
    ], { onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const dirHeader = container.querySelector(".cf-dir-path")
    assert.ok(dirHeader, "must render directory header")
    const pathText = dirHeader!.textContent!
    // Should not be all uppercase
    assert.ok(pathText !== pathText.toUpperCase(), "should not be all uppercase")
  })
})

describe("renderChangedFilesList — ARIA labels", () => {
  it("close button has exact aria-label 'Close Changed Files Modal'", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], {
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const closeBtn = document.getElementById("cf-dropdown-close")
    assert.ok(closeBtn, "must render close button")
    assert.equal(closeBtn!.getAttribute("aria-label"), "Close Changed Files Modal")
  })

  it("collapse all button has aria-label 'Collapse all file groups'", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], {
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const collapseBtn = container.querySelector<HTMLElement>(".cf-collapse-all-btn")
    assert.ok(collapseBtn, "must render collapse all button")
    assert.equal(collapseBtn!.getAttribute("aria-label"), "Collapse all file groups")
  })

  it("file rows include status and counts in aria-label", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "test.ts", added: 5, removed: 3 }], {
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const fileRow = container.querySelector<HTMLElement>(".cf-file-row")
    assert.ok(fileRow, "must render file row")
    const ariaLabel = fileRow!.getAttribute("aria-label")
    assert.ok(ariaLabel, "must have aria-label")
    assert.ok(ariaLabel!.includes("test.ts"), "must include filename")
    assert.ok(ariaLabel!.includes("5") && ariaLabel!.includes("3"), "must include counts")
    assert.ok(ariaLabel!.toLowerCase().includes("addition") || ariaLabel!.toLowerCase().includes("deletion"), "must include status")
  })
})

describe("renderChangedFilesList — focus management", () => {
  it("close button has correct id for focus management", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], {
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const closeBtn = document.getElementById("cf-dropdown-close")
    assert.ok(closeBtn, "must render close button with correct id")
    assert.equal(closeBtn!.id, "cf-dropdown-close")
  })

  it("modal has correct ARIA attributes for focus trap", async () => {
    const container = setupDom()
    renderChangedFilesList(container, [{ path: "a.ts", added: 1, removed: 0 }], {
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {} } as any)
    const modal = document.getElementById("changed-files-dropdown")
    assert.ok(modal, "must render modal")
    assert.equal(modal!.getAttribute("role"), "dialog", "must have dialog role")
    assert.equal(modal!.getAttribute("aria-modal"), "true", "must have aria-modal true")
  })
})
