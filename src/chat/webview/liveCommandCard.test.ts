/**
 * Behavioral DOM tests for live command cards (agent-visibility UX).
 *
 * Exec-class tool calls are rendered as standalone terminal-like cards in the
 * chat stream: command header, live output area, status/duration footer. This
 * module is pure DOM; it only needs a JSDOM document to test.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { ToolCallBlock } from "./types"

function setupDom(): JSDOM {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  return dom
}

function execBlock(overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
  return {
    type: "tool-call",
    id: "exec-1",
    name: "bash",
    class: "exec",
    state: "running",
    args: { command: "npm test" },
    ...overrides,
  } as ToolCallBlock
}

describe("liveCommandCard", () => {
  beforeEach(() => setupDom())

  it("renders a running exec command with a live terminal card", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock({ partialStdout: "PASS 1/2\n" }))

    assert.ok(el.classList.contains("live-command-card"))
    assert.ok(el.classList.contains("live-command-card--running"))
    assert.equal(el.querySelector(".live-command-card__command")?.textContent, "npm test")
    assert.equal(el.querySelector(".live-command-card__status")?.textContent, "Running")
    assert.ok(el.querySelector(".live-command-card__output"))
  })

  it("shows stdout content in the live output area", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock({ partialStdout: "installing deps…\n" }))
    const output = el.querySelector(".live-command-card__output")
    assert.ok(output?.textContent?.includes("installing deps…"))
  })

  it("renders a succeeded command with exit code and duration", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(
      execBlock({ state: "result", exitCode: 0, durationMs: 1250, result: "done" }),
    )
    assert.ok(el.classList.contains("live-command-card--succeeded"))
    assert.equal(el.querySelector(".live-command-card__status")?.textContent, "Succeeded")
    assert.ok(el.textContent?.includes("0"))
    assert.ok(el.textContent?.includes("1.25s"))
  })

  it("renders a failed command with non-zero exit code", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock({ state: "result", exitCode: 1, result: "error" }))
    assert.ok(el.classList.contains("live-command-card--failed"))
    assert.equal(el.querySelector(".live-command-card__status")?.textContent, "Failed")
  })

  it("renders the working directory when provided", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock({ workingDir: "/project" }))
    assert.ok(el.textContent?.includes("/project"))
  })

  it("renders stderr in the output area", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock({ partialStderr: "warning: deprecated\n" }))
    const output = el.querySelector(".live-command-card__output")
    assert.ok(output?.textContent?.includes("warning: deprecated"))
  })

  it("is used by the tool-call renderer for exec-class blocks", async () => {
    const { renderToolCallBlock } = await import("./toolCallRenderer")
    const el = renderToolCallBlock(execBlock({ args: { command: "npm test" } }), {})
    assert.ok(el)
    assert.ok(el!.classList.contains("live-command-card"))
    assert.equal(el!.querySelector(".live-command-card__command")?.textContent, "npm test")
  })

  it("exposes data-block-id so the streaming layer can locate the card", async () => {
    const { renderLiveCommandCard } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock())
    assert.equal(el.dataset.blockId, "exec-1")
  })
})

describe("applyLiveCommandCardUpdate", () => {
  beforeEach(() => setupDom())

  it("fills the command in once real args arrive (was the name fallback)", async () => {
    const { renderLiveCommandCard, applyLiveCommandCardUpdate } = await import("./liveCommandCard")
    // No command in args → first render falls back to the tool name.
    const el = renderLiveCommandCard(execBlock({ args: {} }))
    assert.equal(el.querySelector(".live-command-card__command")?.textContent, "bash")
    applyLiveCommandCardUpdate(el, { args: { command: "git status" } })
    assert.equal(el.querySelector(".live-command-card__command")?.textContent, "git status")
  })

  it("streams stdout into the live output area", async () => {
    const { renderLiveCommandCard, applyLiveCommandCardUpdate } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock())
    applyLiveCommandCardUpdate(el, { stdout: "line 1\nline 2\n" })
    assert.ok(el.querySelector(".live-command-card__output")?.textContent?.includes("line 2"))
  })

  it("resolves a running card to succeeded on completion", async () => {
    const { renderLiveCommandCard, applyLiveCommandCardUpdate } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock())
    assert.ok(el.classList.contains("live-command-card--running"))
    applyLiveCommandCardUpdate(el, { state: "completed", exitCode: 0, durationMs: 1250 })
    assert.ok(el.classList.contains("live-command-card--succeeded"))
    assert.ok(!el.classList.contains("live-command-card--running"))
    assert.equal(el.querySelector(".live-command-card__status")?.textContent, "Succeeded")
    assert.ok(el.textContent?.includes("1.25s"))
    assert.ok(el.textContent?.includes("exit 0"))
  })

  it("marks a non-zero exit as failed", async () => {
    const { renderLiveCommandCard, applyLiveCommandCardUpdate } = await import("./liveCommandCard")
    const el = renderLiveCommandCard(execBlock())
    applyLiveCommandCardUpdate(el, { state: "result", exitCode: 1 })
    assert.ok(el.classList.contains("live-command-card--failed"))
    assert.equal(el.querySelector(".live-command-card__status")?.textContent, "Failed")
  })
})
