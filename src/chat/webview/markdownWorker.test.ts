import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "markdownWorker.ts"), "utf8")
const buildSource = readFileSync(resolve(__dirname, "../../..", "esbuild.js"), "utf8")

void describe("markdownWorker.ts", () => {
  void it("renders markdown inside a dedicated worker without dynamic imports", () => {
    assert.ok(source.includes("new MarkdownIt"), "worker must create its own markdown renderer")
    assert.ok(source.includes("self.onmessage"), "worker must listen for render requests")
    assert.ok(source.includes("self.postMessage"), "worker must return render results")
    assert.ok(!source.includes("importScripts"), "worker must not use importScripts in VS Code webviews")
    assert.ok(!source.includes("import("), "worker must not use dynamic import in VS Code webviews")
  })

  void it("is bundled as a single browser worker asset", () => {
    assert.ok(buildSource.includes("markdownWorkerConfig"), "build must include a markdown worker config")
    assert.ok(buildSource.includes("src/chat/webview/markdownWorker.ts"), "build must bundle markdownWorker.ts")
    assert.ok(buildSource.includes('out: "chat/webview/markdownWorker"'), "worker output must live next to webview assets")
  })

  // ── Lazy language registration (F3 fix) ─────────────────────────────────
  // Worker startup used to run 15 `hljs.registerLanguage()` calls at module
  // top-level. Each call builds the language grammar (regex compilation +
  // mode setup), which is real CPU cost on the worker thread. For chat
  // sessions that never render a fenced code block, this is pure waste.
  // The fix: defer the registrations to the first onmessage invocation.
  // The existing constraint is preserved: no dynamic import() (workers in
  // VS Code webviews don't have a URL scheme that allows it).

  void it("defers hljs.registerLanguage calls out of module top-level", () => {
    // A call at module top-level is one that appears on a line that starts
    // at column 0 (no leading whitespace). Lines inside the
    // ensureLanguagesRegistered function are indented and therefore OK.
    const lines = source.split("\n")
    const topLevelRegisterLines = lines.filter((l) => /^[^\s]/.test(l) && /hljs\.registerLanguage\s*\(/.test(l))
    assert.equal(
      topLevelRegisterLines.length,
      0,
      `hljs.registerLanguage must not run at column 0 (module top-level) — found ${topLevelRegisterLines.length} such lines`
    )
    // The registration code itself must still exist somewhere in the file.
    assert.ok(/hljs\.registerLanguage\s*\(/.test(source), "registerLanguage calls must still exist (just deferred)")
  })

  void it("defers new MarkdownIt(...) instantiation out of module top-level", () => {
    // Same heuristic: a top-level `new MarkdownIt` would be unindented.
    // Inside `getMarkdown()` it's indented, which is what we want.
    const lines = source.split("\n")
    const topLevelMdLines = lines.filter((l) => /^[^\s]/.test(l) && /new\s+MarkdownIt\s*\(/.test(l))
    assert.equal(
      topLevelMdLines.length,
      0,
      `new MarkdownIt(...) must not run at column 0 (module top-level) — found ${topLevelMdLines.length} such lines`
    )
  })

  void it("registers languages lazily on first message via ensureLanguagesRegistered", () => {
    assert.ok(
      /function\s+ensureLanguagesRegistered/.test(source),
      "worker must expose a function called ensureLanguagesRegistered"
    )
    const onMessageIdx = source.indexOf("self.onmessage")
    const onMessageBody = source.slice(onMessageIdx, onMessageIdx + 600)
    assert.ok(
      /ensureLanguagesRegistered\s*\(/.test(onMessageBody),
      "self.onmessage must call ensureLanguagesRegistered() before rendering"
    )
  })

  void it("registers each language at most once (idempotent guard)", () => {
    const helperMatch = source.match(/function\s+ensureLanguagesRegistered\s*\([\s\S]*?\n\}/m)
    assert.ok(helperMatch, "ensureLanguagesRegistered function must exist")
    const body = helperMatch[0]
    assert.ok(
      /\bregistered\b/.test(body),
      "ensureLanguagesRegistered must be guarded by a `registered` flag so it runs exactly once"
    )
  })
})
