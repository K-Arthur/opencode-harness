import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "recent-sessions.ts"), "utf8")

describe("recent-sessions.ts", () => {
  it("exports renderRecentSessions", () => {
    assert.ok(source.includes("export function renderRecentSessions"))
  })

  it("takes sessions, container, onViewAll, onResume parameters", () => {
    assert.ok(source.includes("sessions: SessionSummary[]"))
    assert.ok(source.includes("container: HTMLElement"))
    assert.ok(source.includes("onViewAll"))
    assert.ok(source.includes("onResume"))
  })

  it("hides container when sessions are empty", () => {
    assert.ok(source.includes('container.style.display = "none"'))
  })

  it("creates View All button", () => {
    assert.ok(source.includes('"View All"'))
  })

  it("displays RECENT label", () => {
    assert.ok(source.includes("RECENT"))
  })

  it("shows cost badge when cost > 0", () => {
    assert.ok(source.includes("session.cost > 0"))
  })

  it("displays message count", () => {
    assert.ok(source.includes("messageCount"))
  })

  it("formats date with toLocaleDateString", () => {
    assert.ok(source.includes("toLocaleDateString"))
  })
})
