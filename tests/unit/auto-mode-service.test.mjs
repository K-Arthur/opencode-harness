import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// AutoModeService imports `vscode` directly and calls vscode.window.showWarningMessage,
// so it can't be imported under tsx. Mirror the session-client test: bundle it with
// esbuild aliasing `vscode` to a stub whose showWarningMessage return value is
// controllable via a global, then exercise the real logic behaviorally with an
// in-memory globalState injected through the constructor (DI).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "auto-mode-service.cjs")
const vscodeStubPath = path.join(bundleDir, "vscode-stub-auto-mode.js")

function loadAutoModeService() {
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(vscodeStubPath, `
module.exports = {
  window: {
    // Returns whatever the test queued; defaults to undefined (modal dismissed).
    showWarningMessage: async () => globalThis.__AUTO_MODE_WARN_RESULT,
  },
}
`)
  execFileSync("npx", [
    "esbuild",
    "src/chat/AutoModeService.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--alias:vscode=${vscodeStubPath}`,
    `--outfile=${bundlePath}`,
  ], { cwd: repoRoot, stdio: "pipe" })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

/** Minimal fake ExtensionContext whose globalState is an in-memory Map. */
function makeFakeContext(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    context: {
      globalState: {
        get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
        update: async (key, value) => { store.set(key, value) },
      },
    },
    store,
  }
}

const KEY = "opencode.autoModeConfirmed"

test("hasAutoModeConfirmed defaults to false when unset", () => {
  const { AutoModeService } = loadAutoModeService()
  const { context } = makeFakeContext()
  const service = new AutoModeService({ context })
  assert.equal(service.hasAutoModeConfirmed(), false)
})

test("hasAutoModeConfirmed reflects a previously stored true value", () => {
  const { AutoModeService } = loadAutoModeService()
  const { context } = makeFakeContext({ [KEY]: true })
  const service = new AutoModeService({ context })
  assert.equal(service.hasAutoModeConfirmed(), true)
})

test("setAutoModeConfirmed persists the value to globalState", async () => {
  const { AutoModeService } = loadAutoModeService()
  const { context, store } = makeFakeContext()
  const service = new AutoModeService({ context })
  await service.setAutoModeConfirmed(true)
  assert.equal(store.get(KEY), true)
  assert.equal(service.hasAutoModeConfirmed(), true)
})

test("showAutoModeConfirmation returns true when the user clicks Proceed", async () => {
  const { AutoModeService } = loadAutoModeService()
  const { context, store } = makeFakeContext()
  const service = new AutoModeService({ context })
  globalThis.__AUTO_MODE_WARN_RESULT = "Proceed"
  assert.equal(await service.showAutoModeConfirmation("ses_1"), true)
  // Proceed does not persist the "don't ask again" flag.
  assert.equal(store.has(KEY), false)
})

test("showAutoModeConfirmation returns false when the user cancels or dismisses", async () => {
  const { AutoModeService } = loadAutoModeService()
  const { context } = makeFakeContext()
  const service = new AutoModeService({ context })

  globalThis.__AUTO_MODE_WARN_RESULT = "Cancel"
  assert.equal(await service.showAutoModeConfirmation("ses_1"), false)

  globalThis.__AUTO_MODE_WARN_RESULT = undefined // modal dismissed
  assert.equal(await service.showAutoModeConfirmation("ses_1"), false)
})

test("showAutoModeConfirmation returns true and persists the flag on 'Don't show again'", async () => {
  const { AutoModeService } = loadAutoModeService()
  const { context, store } = makeFakeContext()
  const service = new AutoModeService({ context })
  globalThis.__AUTO_MODE_WARN_RESULT = "Don't show again"
  assert.equal(await service.showAutoModeConfirmation("ses_1"), true)
  assert.equal(store.get(KEY), true)
  assert.equal(service.hasAutoModeConfirmed(), true)
})
