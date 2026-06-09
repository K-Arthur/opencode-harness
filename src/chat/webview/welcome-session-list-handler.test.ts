import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const welcomeViewSource = readFileSync(path.join(__dirname, "ui", "welcomeView.ts"), "utf8")

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

  it("session_list handler passes host results into welcome rendering", () => {
    const handlerBlock = mainSource.substring(
      mainSource.indexOf('["session_list"'),
      mainSource.indexOf('["session_list_update"') - 2,
    )
    assert.ok(
      handlerBlock.includes("renderRecentSessionsList(query, sessions)"),
      "welcome search results must render the host-provided sessions, not only cached webview state",
    )
  })

  it("session_list handler ignores stale welcome search responses", () => {
    const handlerBlock = mainSource.substring(
      mainSource.indexOf('["session_list"'),
      mainSource.indexOf('["session_list_update"') - 2,
    )
    assert.ok(
      handlerBlock.includes("welcomeSearchInput") && handlerBlock.includes("currentSearchQuery") && handlerBlock.includes("return"),
      "welcome search must ignore old session_list responses when the user has already typed a newer query",
    )
  })

  it("delete button event listener is registered in the welcome view module", () => {
    const setupBlock = welcomeViewSource.substring(
      welcomeViewSource.indexOf("function setupWelcomeActions("),
      welcomeViewSource.indexOf("function setupWelcomeActions(") + 6000,
    )
    assert.ok(
      setupBlock.includes("recent-session-delete"),
      "setupWelcomeActions must listen for recent-session-delete custom event",
    )
    assert.ok(
      setupBlock.includes("onDeleteRecentSession"),
      "delete handler must delegate through the injected delete callback",
    )
    assert.ok(
      mainSource.includes('vscode.postMessage({ type: "delete_session", targetSessionId: sessionId })'),
      "main.ts must preserve the router's delete_session message contract",
    )
    assert.ok(
      mainSource.includes("targetSessionId"),
      "delete handler must use the router's targetSessionId contract",
    )
  })
})
