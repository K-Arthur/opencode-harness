import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "session-client-list-commands.cjs")
const vscodeStubPath = path.join(bundleDir, "vscode-stub.js")

function loadSessionClient() {
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(vscodeStubPath, `
module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      append: () => {},
      show: () => {},
      dispose: () => {},
    }),
  },
  workspace: {
    getConfiguration: () => ({ get: () => false }),
  },
}
`)
  execFileSync("npx", [
    "esbuild",
    "src/session/SessionClient.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--alias:vscode=${vscodeStubPath}`,
    `--outfile=${bundlePath}`,
  ], {
    cwd: repoRoot,
    stdio: "pipe",
  })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

function makeClient(listResponse) {
  const { SessionClient } = loadSessionClient()
  const v2Client = {
    command: {
      list: async () => listResponse,
    },
  }
  return new SessionClient(undefined, () => false, () => v2Client)
}

test("listCommands preserves the server-reported source for MCP commands (bare-array response)", async () => {
  // Regression: every command used to be tagged source:"server", so MCP
  // commands never matched the MCP filter chip in the commands modal.
  const client = makeClient({
    data: [
      { name: "clear", template: "", source: "command" },
      { name: "triage", template: "", source: "mcp", agent: "jcodemunch" },
      { name: "review", template: "", source: "skill" },
    ],
  })

  const commands = await client.listCommands()

  assert.equal(commands.length, 3)
  const byName = Object.fromEntries(commands.map((c) => [c.name, c]))
  assert.equal(byName.clear.source, "command")
  assert.equal(byName.triage.source, "mcp", "MCP command keeps its mcp source")
  assert.equal(byName.triage.agent, "jcodemunch", "MCP server name preserved as agent/origin")
  assert.equal(byName.review.source, "skill")
  // No command should be silently re-labeled as a plain server command.
  assert.ok(!commands.some((c) => c.name === "triage" && c.source === "server"))
})

test("listCommands reads the legacy { location, data } wrapped shape too", async () => {
  // Older SDK builds nested the array under resp.data.data. The fix must keep
  // accepting that so a downgrade doesn't silently empty the command list.
  const client = makeClient({
    data: { location: "/command", data: [
      { name: "triage", template: "", source: "mcp", agent: "jcodemunch" },
    ] },
  })

  const commands = await client.listCommands()

  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, "triage")
  assert.equal(commands[0].source, "mcp")
})

test("listCommands defaults a missing source to 'server' (older servers)", async () => {
  const client = makeClient({ data: [{ name: "legacy", template: "" }] })

  const commands = await client.listCommands()

  assert.equal(commands[0].source, "server")
})
