import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const checkScript = resolve(repoRoot, "scripts/check-bundle-size.mjs")
const pkgJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"))

void describe("check-bundle-size.mjs", () => {
  void it("exists as a build-time guard", () => {
    assert.ok(existsSync(checkScript), "scripts/check-bundle-size.mjs must exist")
  })

  void it("is wired into npm scripts (bundle:check) and vscode:prepublish", () => {
    assert.equal(
      typeof pkgJson.scripts["bundle:check"],
      "string",
      "package.json must define a `bundle:check` script that runs the size guard",
    )
    assert.ok(
      pkgJson.scripts["vscode:prepublish"].includes("check-bundle-size"),
      "vscode:prepublish must invoke check-bundle-size so a release cannot ship with bundles over the limit",
    )
  })

  void it("enforces the current extension host and webview limits", () => {
    const source = readFileSync(checkScript, "utf8")
    assert.ok(/791\s*\*\s*1024/.test(source), "extension host limit must be 791KB (791*1024)")
    assert.ok(/838\s*\*\s*1024/.test(source), "chat webview limit must be 838KB (838*1024)")
    assert.ok(/500\s*\*\s*1024/.test(source), "markdown worker advisory limit must be 500KB (500*1024)")
  })

  void it("produces a clear pass/fail line for each bundle", () => {
    const source = readFileSync(checkScript, "utf8")
    assert.ok(/\[bundle-size\]/.test(source), "must prefix every line with [bundle-size] tag for grep-ability")
    assert.ok(/process\.exit\(1\)/.test(source), "must exit non-zero when over limit")
  })
})

void describe("dist/ artifacts (post-build)", () => {
  // These assertions only hold after `npm run build` has run; we skip
  // them when the build is missing so this file stays green in isolation.
  const dist = resolve(repoRoot, "dist")

  void it("extension.js exists after build (sanity)", () => {
    if (!existsSync(dist)) return // skip pre-build
    assert.ok(
      existsSync(resolve(dist, "extension.js")),
      "dist/extension.js must be produced by `npm run build`",
    )
  })

  void it("main.js exists after build (sanity)", () => {
    if (!existsSync(dist)) return
    assert.ok(
      existsSync(resolve(dist, "chat/webview/main.js")),
      "dist/chat/webview/main.js must be produced by `npm run build`",
    )
  })
})
