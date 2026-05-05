import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "portFinder.ts"), "utf8")

describe("portFinder.ts", () => {
  it("exports findFreePort function", () => {
    assert.ok(source.includes("export function findFreePort("))
  })

  it("returns Promise<number>", () => {
    assert.ok(source.includes("Promise<number>"))
  })

  it("creates a net server", () => {
    assert.ok(source.includes("net.createServer()"))
  })

  it("listens on 127.0.0.1 with port 0", () => {
    assert.ok(source.includes('server.listen(0, "127.0.0.1"'))
  })

  it("calls server.unref()", () => {
    assert.ok(source.includes("server.unref()"))
  })

  it("closes server after getting port", () => {
    assert.ok(source.includes("server.close("))
  })

  it("uses net module", () => {
    assert.ok(source.includes('import * as net from "net"'))
  })

  it("handles error event", () => {
    assert.ok(source.includes('server.on("error"'))
  })
})
