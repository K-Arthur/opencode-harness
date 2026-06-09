/**
 * CSS-convention tests for the new panels (Activity, Tasks) and plan-card
 * progress bar. Mirrors the repo's source-grep CSS lint style.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const read = (f: string) => readFileSync(path.join(__dirname, "css", f), "utf8")
const activity = read("activity.css")
const tasks = read("tasks.css")
const blocks = read("blocks.css")
const styles = read("styles.css")

describe("new-panel CSS conventions", () => {
  it("activity + tasks CSS are registered in the components layer", () => {
    assert.match(styles, /activity\.css.*layer\(components\)/)
    assert.match(styles, /tasks\.css.*layer\(components\)/)
  })

  it("panels are themed via design tokens / --vscode-* (not hardcoded brand colors)", () => {
    assert.ok(activity.includes("var(--"), "activity.css must use CSS variables")
    assert.ok(tasks.includes("var(--vscode"), "tasks.css must use --vscode-* fallbacks")
  })

  it("the live indicator respects prefers-reduced-motion", () => {
    assert.match(activity, /prefers-reduced-motion/)
    assert.match(activity, /\.activity-live::before\s*\{\s*animation:\s*none/)
  })

  it("plan-card progress fill animates transform: scaleX (never width)", () => {
    assert.match(blocks, /\.plan-card-progress-fill[\s\S]*?transform:\s*scaleX\(var\(--p/)
    const block = blocks.slice(blocks.indexOf(".plan-card-progress-fill"), blocks.indexOf(".plan-card-progress-fill") + 260)
    assert.ok(!/transition:\s*width/.test(block), "must not transition width")
  })

  it("status cues are not color-only — task status classes pair with text labels", () => {
    // The status text is rendered into .task-card-status; the rail color is decorative.
    assert.ok(tasks.includes(".task-card--failed"), "failed rail styling present")
    assert.ok(tasks.includes(".task-card-status--failed"), "failed badge styling present")
  })
})
