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

  it("renders an empty-state message when sessions are empty", () => {
    // The current implementation keeps the container visible and shows an
    // informative "No recent sessions" message instead of hiding the panel —
    // hiding it silently was confusing UX.
    assert.ok(source.includes("sessions.length === 0"), "must branch on empty sessions list")
    assert.ok(source.includes("recent-empty-message"), "must render empty-state element")
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

  it("formats session time with a relative-time helper", () => {
    // Implementation uses a relative-time helper (e.g. "5m ago", "2d ago")
    // rather than toLocaleDateString — relative time is the more readable
    // format for a "recent sessions" list.
    assert.ok(source.includes("getRelativeTime"), "must use getRelativeTime helper")
    assert.ok(source.includes("ago"), "must render relative-time suffix")
  })

  it("shows 'No matching sessions' when isFiltered=true and list is empty", () => {
    assert.ok(source.includes("No matching sessions"), "must distinguish filtered-empty from unfiltered-empty")
    assert.ok(source.includes("No recent sessions"), "must show default empty message for unfiltered")
  })

  it("limits unfiltered display to 3 sessions", () => {
    assert.ok(source.includes("isFiltered ? 10 : 3"), "must slice to 3 when not filtering")
  })

  it("shows up to 10 sessions when isFiltered=true", () => {
    assert.ok(source.includes("isFiltered ? 10 : 3"), "must expand limit to 10 when filtering")
  })

  it("uses isFiltered parameter to drive limit and empty message", () => {
    assert.ok(source.includes("isFiltered"), "isFiltered must be used in the function body")
  })

  it("makes rendered session items keyboard selectable", () => {
    assert.ok(source.includes('item.tabIndex = 0'), "session rows must be focusable")
    assert.ok(source.includes('item.dataset.sessionId = session.id'), "session rows must expose their session id")
    assert.ok(source.includes('role", "option"'), "session rows must have option role")
    assert.ok(source.includes('e.key === "Enter"'), "Enter must open a focused session")
    assert.ok(source.includes('e.key === "ArrowDown"'), "ArrowDown must move between sessions")
  })
})
