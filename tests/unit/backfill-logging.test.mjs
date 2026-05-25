import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const providerSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "ChatProvider.ts"), "utf8")

describe("T1.4 — Backfill logging levels", () => {
  it("uses log.debug for empty backfill response in sessions_recovered", () => {
    const line = providerSource.match(/log\.(info|debug)\(`\[sessions_recovered\] Empty response for/)
    assert.ok(line, "must find empty response log line")
    assert.equal(line[1], "debug", "must use debug level for sessions_recovered empty response")
  })

  it("uses log.debug for empty backfill response in tab_created", () => {
    const line = providerSource.match(/log\.(info|debug)\(`\[tab_created\] Empty response for/)
    assert.ok(line, "must find tab_created empty response log line")
    assert.equal(line[1], "debug", "must use debug level for tab_created empty response")
  })

  it("emits backfill summary INFO at end of backfillRecoveredSessions", () => {
    assert.ok(providerSource.includes("Backfill summary:"), "must emit backfill summary")
    assert.ok(providerSource.includes("succeeded"), "summary must include succeeded count")
    assert.ok(providerSource.includes("pending"), "summary must include pending count")
  })
})
