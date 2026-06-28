import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { ToolCallBlock, Block } from "./types"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  globalThis.HTMLDetailsElement = dom.window.HTMLDetailsElement as unknown as typeof HTMLDetailsElement
  // Align CustomEvent with the jsdom realm so dispatched events keep their
  // `detail` (in the browser window.CustomEvent === CustomEvent).
  globalThis.CustomEvent = dom.window.CustomEvent as unknown as typeof CustomEvent
  return dom
}

function taskBlock(overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
  return {
    type: "tool-call",
    id: "task-1",
    name: "task",
    class: "meta",
    state: "running",
    args: { subagent_type: "explore", description: "Audit UI components", prompt: "Look at all the files and report back." },
    ...overrides,
  } as ToolCallBlock
}

describe("subagentCard — detection & parsing", () => {
  it("isTaskTool matches task/subagent/delegate, not bash/read", async () => {
    const { isTaskTool } = await import("./subagentCard")
    assert.equal(isTaskTool({ type: "tool-call", name: "task" } as Block), true)
    assert.equal(isTaskTool({ type: "tool-call", name: "subagent" } as Block), true)
    assert.equal(isTaskTool({ type: "tool", tool: "delegate" } as Block), true)
    assert.equal(isTaskTool({ type: "tool-call", name: "bash" } as Block), false)
    assert.equal(isTaskTool({ type: "tool-call", name: "read" } as Block), false)
    assert.equal(isTaskTool({ type: "tool-call", name: "todowrite" } as Block), false)
  })

  it("parseTaskInvocation reads object args with aliases", async () => {
    const { parseTaskInvocation } = await import("./subagentCard")
    const r = parseTaskInvocation({ subagent_type: "test-writer", description: "Write tests", prompt: "Do it" })
    assert.equal(r.agentName, "test-writer")
    assert.equal(r.purpose, "Write tests")
    assert.equal(r.prompt, "Do it")
  })

  it("parseTaskInvocation parses string-encoded JSON args", async () => {
    const { parseTaskInvocation } = await import("./subagentCard")
    const r = parseTaskInvocation(JSON.stringify({ agent: "explore", prompt: "scan" }))
    assert.equal(r.agentName, "explore")
    assert.equal(r.prompt, "scan")
  })

  it("parseTaskInvocation treats a bare string as the prompt", async () => {
    const { parseTaskInvocation } = await import("./subagentCard")
    const r = parseTaskInvocation("just a raw prompt")
    assert.equal(r.agentName, "subagent")
    assert.equal(r.prompt, "just a raw prompt")
  })

  it("parseTaskInvocation falls back gracefully on missing fields", async () => {
    const { parseTaskInvocation } = await import("./subagentCard")
    const r = parseTaskInvocation({})
    assert.equal(r.agentName, "subagent")
    assert.equal(r.purpose, "")
    assert.equal(r.prompt, "")
  })
})

describe("subagentCard — rendering", () => {
  beforeEach(() => setupDom())

  it("renders a running card: open, agent name, purpose, Running badge, no result", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock())
    assert.ok(el.classList.contains("subagent-card"))
    assert.ok(el.classList.contains("subagent-card--running"))
    assert.equal((el as HTMLDetailsElement).open, true, "running cards expand by default")
    assert.match(el.querySelector(".subagent-card-title")?.textContent || "", /explore/)
    assert.equal(el.querySelector(".subagent-card-purpose")?.textContent, "Audit UI components")
    assert.equal(el.querySelector(".subagent-card-status")?.textContent, "Running")
    assert.equal(el.querySelector(".subagent-card-section"), null, "no result/error section while running")
  })

  it("does NOT leak the raw prompt as visible text — it lives behind a debug expander", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock())
    // No generic tool args panel (the source of the raw-JSON leak).
    assert.equal(el.querySelector(".tool-args-panel"), null)
    // The prompt is present only inside the collapsed debug <details>.
    const debug = el.querySelector("details.subagent-card-debug")
    assert.ok(debug, "debug expander exists")
    assert.equal((debug as HTMLDetailsElement).open, false, "debug is collapsed by default")
    assert.match(debug?.querySelector(".subagent-card-debug-body")?.textContent || "", /Look at all the files/)
  })

  it("renders a completed card collapsed with a Result section", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({ state: "completed", result: "Found 3 stale components.", durationMs: 262000 }))
    assert.ok(el.classList.contains("subagent-card--completed"))
    assert.equal((el as HTMLDetailsElement).open, false)
    assert.equal(el.querySelector(".subagent-card-status")?.textContent, "Done")
    assert.equal(el.querySelector(".subagent-card-duration")?.textContent, "4m 22s")
    const section = el.querySelector(".subagent-card-section:not(.subagent-card-section--error)")
    assert.match(section?.textContent || "", /Found 3 stale components/)
  })

  it("renders a failed card: open, Error section with role=alert", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({ state: "error", error: "boom" }))
    assert.ok(el.classList.contains("subagent-card--failed"))
    assert.equal((el as HTMLDetailsElement).open, true)
    const err = el.querySelector(".subagent-card-section--error")
    assert.ok(err)
    assert.equal(err?.getAttribute("role"), "alert")
    assert.match(err?.textContent || "", /boom/)
  })

  it("handles a completed subagent with no result without crashing", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({ state: "completed", result: undefined }))
    assert.ok(el.classList.contains("subagent-card--completed"))
    assert.equal(el.querySelector(".subagent-card-section"), null)
  })

  it("renders a View activity link that dispatches oc:open-subagent-panel", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const events: Array<{ subagentId?: string }> = []
    window.addEventListener("oc:open-subagent-panel", (e) => {
      events.push((e as CustomEvent).detail)
    })
    const el = renderSubagentTaskCard(taskBlock())
    const link = el.querySelector(".subagent-card-activity-link") as HTMLButtonElement
    assert.ok(link)
    link.click()
    assert.equal(events[0]?.subagentId, "task-1")
  })
})

describe("subagentCard — dynamic title resolution", () => {
  beforeEach(() => setupDom())

  it("shows the real agentName in the title when a subagent_type is specified", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock())
    // Title is the agentName without the noisy "Subagent: " prefix — the icon
    // and card context already signal "subagent".
    assert.match(el.querySelector(".subagent-card-title")?.textContent || "", /explore/)
    // Purpose shows as subtitle when title came from agentName
    assert.equal(el.querySelector(".subagent-card-purpose")?.textContent, "Audit UI components")
  })

  it("shows the purpose in the title when agentName is the generic 'subagent' fallback", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({
      args: { description: "Refactor the auth module", prompt: "Do the refactor" },
    }))
    // Title is the purpose-derived name, no "Subagent: " prefix
    assert.match(el.querySelector(".subagent-card-title")?.textContent || "", /Refactor the auth module/)
    // Purpose subtitle is suppressed when title already came from purpose
    assert.equal(el.querySelector(".subagent-card-purpose"), null)
  })

  it("shows bare 'Subagent' when neither agentName nor purpose is available", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({ args: {} }))
    assert.match(el.querySelector(".subagent-card-title")?.textContent || "", /^Subagent$/)
    assert.equal(el.querySelector(".subagent-card-purpose"), null)
  })

  it("truncates long purpose in the title to 80 characters", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const longPurpose = "A".repeat(120)
    const el = renderSubagentTaskCard(taskBlock({ args: { description: longPurpose } }))
    const titleText = el.querySelector(".subagent-card-title")?.textContent || ""
    assert.ok(titleText.length < longPurpose.length + 20, "title must be truncated")
    assert.ok(titleText.endsWith("..."), "truncated title must end with ellipsis")
  })

  it("uses the resolved title in the card aria-label", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({
      args: { description: "Fix the bug", prompt: "Do it" },
    }))
    assert.match(el.getAttribute("aria-label") || "", /Fix the bug/)
  })

  it("uses the resolved title in the activity link aria-label", async () => {
    const { renderSubagentTaskCard } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock({
      args: { description: "Fix the bug", prompt: "Do it" },
    }))
    const link = el.querySelector(".subagent-card-activity-link") as HTMLElement
    assert.match(link.getAttribute("aria-label") || "", /Fix the bug/)
  })
})

describe("subagentCard — live updates", () => {
  beforeEach(() => setupDom())

  it("running → completed adds a Result section, flips the badge, freezes duration", async () => {
    const { renderSubagentTaskCard, applySubagentCardUpdate } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock())
    applySubagentCardUpdate(el, { state: "completed", result: "done summary", durationMs: 5200 })
    assert.ok(el.classList.contains("subagent-card--completed"))
    assert.equal(el.querySelector(".subagent-card-status")?.textContent, "Done")
    const dur = el.querySelector(".subagent-card-duration") as HTMLElement
    assert.equal(dur.textContent, "5.2s")
    assert.ok(!dur.classList.contains("tool-elapsed"), "live ticker hook removed on terminal")
    assert.match(el.querySelector(".subagent-card-section")?.textContent || "", /done summary/)
  })

  it("running → failed adds an Error section and opens the card", async () => {
    const { renderSubagentTaskCard, applySubagentCardUpdate } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock())
    ;(el as HTMLDetailsElement).open = false
    applySubagentCardUpdate(el, { state: "error", error: "subagent crashed" })
    assert.ok(el.classList.contains("subagent-card--failed"))
    assert.equal((el as HTMLDetailsElement).open, true)
    assert.match(el.querySelector(".subagent-card-section--error")?.textContent || "", /subagent crashed/)
  })

  it("does not duplicate the Result section on repeated updates", async () => {
    const { renderSubagentTaskCard, applySubagentCardUpdate } = await import("./subagentCard")
    const el = renderSubagentTaskCard(taskBlock())
    applySubagentCardUpdate(el, { state: "completed", result: "r" })
    applySubagentCardUpdate(el, { state: "completed", result: "r" })
    assert.equal(el.querySelectorAll(".subagent-card-section").length, 1)
  })
})

describe("subagentCard — integration with the tool dispatch", () => {
  beforeEach(() => setupDom())

  it("renderToolCallBlock routes a task tool to the subagent card (no tool-args-panel)", async () => {
    const { renderToolCallBlock } = await import("./toolCallRenderer")
    const el = renderToolCallBlock(taskBlock(), {})
    assert.ok(el?.classList.contains("subagent-card"))
    assert.equal(el?.querySelector(".tool-args-panel"), null)
  })

  it("groupConsecutiveToolCalls keeps task tools standalone", async () => {
    const { groupConsecutiveToolCalls } = await import("./toolCallRenderer")
    const blocks = [
      taskBlock({ id: "t1" }),
      taskBlock({ id: "t2" }),
    ] as Block[]
    const groups = groupConsecutiveToolCalls(blocks)
    assert.equal(groups.length, 2, "two task tools must not fold into one group")
    assert.equal(groups[0]?.length, 1)
    assert.equal(groups[1]?.length, 1)
  })
})
