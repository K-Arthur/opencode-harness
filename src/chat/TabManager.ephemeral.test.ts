import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "TabManager.ts"), "utf8")

describe("TabManager ephemeral tab persistence", () => {
  it("TabState has an optional ephemeral flag", () => {
    assert.ok(source.includes("ephemeral?: boolean"), "TabState must carry an ephemeral flag")
  })

  it("createTab accepts options.ephemeral", () => {
    const block = source.slice(source.indexOf("createTab("), source.indexOf("closeTab(", source.indexOf("createTab(")))
    assert.ok(block.includes("ephemeral?: boolean"), "createTab options must accept ephemeral")
    assert.ok(block.includes("ephemeral: options?.ephemeral === true"), "createTab must store options.ephemeral")
  })

  it("persist skips ephemeral tabs and avoids persisting an ephemeral active tab", () => {
    const block = source.slice(source.indexOf("private persist("), source.indexOf("private persistRestorationState("))
    assert.ok(block.includes("!tab.ephemeral"), "persist must filter ephemeral tabs from openTabs")
    assert.ok(block.includes("persistedActiveTabId"), "persist must compute a non-ephemeral active id")
  })
})
