import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")

describe("Welcome page session_list fix (main.ts)", () => {
  it("session_list handler checks if welcome view is visible before deciding modal vs inline", () => {
    assert.ok(
      mainSource.includes("isWelcomeVisible") && mainSource.includes("welcomeView.classList.contains"),
      "session_list handler must check welcome view visibility",
    )
  })

  it("session_list handler calls renderRecentSessionsList when welcome is visible and modal is closed", () => {
    const handlerBlock = mainSource.substring(
      mainSource.indexOf('["session_list"'),
      mainSource.indexOf('["session_list_update"') - 2,
    )
    assert.ok(
      handlerBlock.includes("renderRecentSessionsList"),
      "session_list handler must call renderRecentSessionsList for welcome page",
    )
    assert.ok(
      handlerBlock.includes("openSessionModal"),
      "session_list handler must still support modal path",
    )
  })

  it("delete button event listener is registered in setupWelcomeActions", () => {
    const setupBlock = mainSource.substring(
      mainSource.indexOf("function setupWelcomeActions()"),
      mainSource.indexOf("function setupWelcomeActions()") + 1500,
    )
    assert.ok(
      setupBlock.includes("recent-session-delete"),
      "setupWelcomeActions must listen for recent-session-delete custom event",
    )
    assert.ok(
      setupBlock.includes("delete_session"),
      "delete handler must post delete_session message to extension host",
    )
    assert.ok(
      setupBlock.includes("targetSessionId"),
      "delete handler must use the router's targetSessionId contract",
    )
  })
})
