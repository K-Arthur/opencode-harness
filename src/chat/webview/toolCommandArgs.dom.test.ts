/**
 * DOM tests for command/exec tool INPUT rendering (createToolArgsPanel).
 *
 * Bug report: a running `bash` tool showed its input as a raw JSON tree
 * (`{ command, description, timeout }`) instead of surfacing the command as a
 * readable command line the way `read`/`write` surface their file path. For
 * shell tools the command IS the input and must read like a terminal line.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createToolArgsPanel } from "./toolCallRenderer"
import type { ToolCallBlock } from "./types"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
}

const tool = (over: Partial<ToolCallBlock>): ToolCallBlock =>
  ({ type: "tool-call", id: "t1", name: "bash", class: "exec", state: "running", ...over } as ToolCallBlock)

describe("createToolArgsPanel — command tools", () => {
  beforeEach(setupDom)

  it("renders the bash command as a readable command line, not a JSON tree", () => {
    const panel = createToolArgsPanel(
      tool({ args: { command: "cd /repo && npm run test:unit 2>&1 | tail -10", description: "Run tests", timeout: 180000 } }),
    )!
    assert.ok(panel, "panel rendered")
    const cmd = panel.querySelector(".tool-command-line")
    assert.ok(cmd, "has a command-line element")
    // The FULL command is shown (not truncated to a 30-char chip).
    assert.ok(cmd!.textContent!.includes("npm run test:unit 2>&1 | tail -10"))
    // The raw `timeout` key must NOT be dumped as JSON.
    assert.ok(!panel.textContent!.includes("180000"), "timeout not leaked as JSON")
    assert.ok(!panel.querySelector(".json-viewer"), "no JSON tree for a command tool")
  })

  it("shows the description as a subtitle when present", () => {
    const panel = createToolArgsPanel(tool({ args: { command: "ls", description: "List files" } }))!
    assert.ok(panel.textContent!.includes("List files"))
  })

  it("works when args is a JSON string (still extracts the command line)", () => {
    const panel = createToolArgsPanel(tool({ args: JSON.stringify({ command: "git status" }) as unknown as Record<string, unknown> }))!
    const cmd = panel.querySelector(".tool-command-line")
    assert.ok(cmd, "command line rendered from stringified args")
    assert.ok(cmd!.textContent!.includes("git status"))
  })

  it("falls back to the JSON viewer for a non-command tool (regression guard)", () => {
    const panel = createToolArgsPanel(
      tool({ name: "read", class: "read", args: { path: "src/x.ts", offset: 10 } }),
    )!
    assert.equal(panel.querySelector(".tool-command-line"), null, "no command line for read")
    assert.ok(panel.querySelector(".json-viewer"), "read still uses the JSON viewer")
  })
})
