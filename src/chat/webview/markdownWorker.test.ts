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
})
