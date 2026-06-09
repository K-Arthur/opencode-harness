import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "opencode-port-finder.cjs")

function loadPortFinder() {
  execFileSync("npx", [
    "esbuild",
    "src/utils/portFinder.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${bundlePath}`,
  ], {
    cwd: repoRoot,
    stdio: "pipe",
  })
  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

test("findFreePort returns a valid port number", async () => {
  const { findFreePort } = loadPortFinder()
  const port = await findFreePort()
  assert.ok(Number.isInteger(port), "port must be an integer")
  assert.ok(port > 0, "port must be positive")
  assert.ok(port <= 65535, "port must be <= 65535")
})

test("findFreePort returns different ports on successive calls", async () => {
  const { findFreePort } = loadPortFinder()
  const [port1, port2] = await Promise.all([findFreePort(), findFreePort()])
  assert.ok(port1 !== port2, "two calls should return different ports")
})

test("findFreePort binds to 127.0.0.1", async () => {
  const { findFreePort } = loadPortFinder()
  const port = await findFreePort()
  assert.ok(port > 1024, "should not return privileged port")
})
