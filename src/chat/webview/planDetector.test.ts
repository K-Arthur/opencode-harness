/**
 * Regression tests for plan-file detection.
 *
 * Both copies (planDetector.ts and the live one exported from toolCallRenderer.ts)
 * previously used an unanchored lazy regex that captured only "  -", so
 * detectPlanFile() returned null for every well-formed plan and the plan card
 * never rendered. These tests lock in the line-based parse.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { detectPlanFile as detectStandalone } from "./planDetector"
import { detectPlanFile as detectLive, type PlanData } from "./toolCallRenderer"
import type { ToolCallBlock } from "./types"

const PLAN = [
  "---",
  "name: My Plan",
  "overview: do the things",
  "todos:",
  "  - id: 1",
  "    content: first step",
  "    status: completed",
  "  - id: 2",
  "    content: second step",
  "    status: pending",
  "  - id: 3",
  "    content: third step",
  "    status: in-progress",
  "---",
  "# body",
].join("\n")

function writeBlock(path: string, content: string): ToolCallBlock {
  return { type: "tool-call", id: "w1", name: "write", class: "write", state: "result", args: { path, content } } as ToolCallBlock
}

function check(detect: (b: ToolCallBlock) => PlanData | null, label: string) {
  describe(`detectPlanFile (${label})`, () => {
    it("parses every todo from a well-formed plan", () => {
      const plan = detect(writeBlock("PLAN.md", PLAN))
      assert.ok(plan, "plan must be detected")
      assert.equal(plan!.name, "My Plan")
      assert.equal(plan!.overview, "do the things")
      assert.equal(plan!.todos.length, 3)
      assert.deepEqual(plan!.todos.map((t) => t.status), ["completed", "pending", "in-progress"])
      assert.equal(plan!.todos[1]!.content, "second step")
    })

    it("returns null for non-markdown writes", () => {
      assert.equal(detect(writeBlock("src/x.ts", PLAN)), null)
    })

    it("returns null for markdown without a todos block", () => {
      assert.equal(detect(writeBlock("README.md", "---\nname: x\n---\nhi")), null)
    })

    it("returns null for non-write tools", () => {
      const read = { type: "tool-call", id: "r", name: "read", class: "read", state: "result", args: { path: "PLAN.md", content: PLAN } } as ToolCallBlock
      assert.equal(detect(read), null)
    })

    it("stops at the next top-level key after todos", () => {
      const withTrailingKey = ["---", "todos:", "  - id: 1", "    content: a", "    status: pending", "author: someone", "---"].join("\n")
      const plan = detect(writeBlock("p.md", withTrailingKey))
      assert.ok(plan)
      assert.equal(plan!.todos.length, 1)
    })
  })
}

check(detectStandalone, "planDetector.ts")
check(detectLive, "toolCallRenderer.ts")
