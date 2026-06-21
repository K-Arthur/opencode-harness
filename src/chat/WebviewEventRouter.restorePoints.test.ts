/**
 * Structural tests for restore-point handlers in WebviewEventRouter.
 *
 * Verifies that the restore-point host message contract is wired:
 * - `list_restore_points` is a recognized webview message type
 * - `list_restore_points` imports the pure collector and posts `restore_points`
 * - `restore_point` is a recognized webview message type
 * - `restore_point` calls `sessionManager.revert(messageID, partID)` and posts
 *   `restore_point_result`
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")

function blockBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist in WebviewEventRouter.ts`)
  const end = source.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return source.slice(start, end)
}

describe("WebviewEventRouter — restore points", () => {
  it("registers list_restore_points and restore_point in VALID_WEBVIEW_TYPES", () => {
    const block = blockBetween("VALID_WEBVIEW_TYPES = new Set([", "])")
    assert.ok(block.includes(`"list_restore_points"`), "list_restore_points must be recognized")
    assert.ok(block.includes(`"restore_point"`), "restore_point must be recognized")
  })

  it("registers list_restore_points and restore_point handlers in webviewHandlers", () => {
    assert.ok(source.includes(`["list_restore_points",`), "list_restore_points handler must be registered")
    assert.ok(source.includes(`["restore_point",`), "restore_point handler must be registered")
  })

  it("list_restore_points handler imports the restore-point collector", () => {
    const handler = blockBetween(`["list_restore_points",`, `["request_more_messages",`)
    assert.ok(handler.includes("import(\"../checkpoint/restorePoints\")"), "must lazily import the pure collector")
    assert.ok(handler.includes("collectRestorePoints"), "must call collectRestorePoints")
    assert.ok(handler.includes("type: \"restore_points\""), "must post restore_points response")
  })

  it("restore_point handler calls sessionManager.revert with messageID and partID", () => {
    const handler = blockBetween(`["restore_point",`, `["request_more_messages",`)
    assert.ok(handler.includes("this.opts.sessionManager.revert(sessionId, messageID, partID)"),
      "must call sessionManager.revert with the restore coordinates")
    assert.ok(handler.includes("type: \"restore_point_result\""), "must post restore_point_result")
  })
})
