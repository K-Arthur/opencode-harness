import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as vscode from "vscode"
import { OpenCodeConfigService } from "./OpenCodeConfigService"
import type { WorkspaceConfig } from "./types"

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "ofh-cfg-"))
}

function fakeUri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri
}

interface MockWatcher {
  onDidCreate: (cb: () => void) => void
  onDidChange: (cb: () => void) => void
  onDidDelete: (cb: () => void) => void
  dispose: () => void
}

function makeMockVscode(workspaceFolders: { uri: vscode.Uri }[], watchers: MockWatcher[]) {
  const watcherCallbacks: { create?: () => void; change?: () => void; delete?: () => void } = {}
  const createFileSystemWatcher = (pattern: vscode.RelativePattern): MockWatcher => {
    const watcher: MockWatcher = {
      onDidCreate: (cb: () => void) => { watcherCallbacks.create = cb },
      onDidChange: (cb: () => void) => { watcherCallbacks.change = cb },
      onDidDelete: (cb: () => void) => { watcherCallbacks.delete = cb },
      dispose: () => {},
    }
    watchers.push(watcher)
    return watcher
  }
  class FakeEventEmitter<T> {
    private listeners: Array<(e: T) => void> = []
    readonly event = (listener: (e: T) => void): vscode.Disposable => {
      this.listeners.push(listener)
      return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener) } }
    }
    fire(e: T): void { this.listeners.forEach((l) => l(e)) }
    dispose(): void { this.listeners = [] }
  }
  class FakeRelativePattern {
    constructor(public base: { uri: vscode.Uri } | string, public pattern: string) {}
  }
  return {
    vscode: {
      workspace: {
        workspaceFolders,
        findFiles: async (pattern: string) => {
          const results: vscode.Uri[] = []
          for (const folder of workspaceFolders) {
            const root = folder.uri.fsPath
            const fileName = pattern.replace("**/", "").replace(/^\.\//, "")
            const candidate = join(root, fileName)
            if (existsSync(candidate)) {
              results.push(fakeUri(candidate))
            }
          }
          return results
        },
        createFileSystemWatcher,
      },
      EventEmitter: FakeEventEmitter,
      RelativePattern: FakeRelativePattern,
    } as unknown as typeof vscode,
    watcherCallbacks,
  }
}

describe("OpenCodeConfigService", () => {
  let root: string
  let service: OpenCodeConfigService
  let watchers: MockWatcher[]
  let mockResult: ReturnType<typeof makeMockVscode>

  beforeEach(() => {
    root = makeWorkspace()
    watchers = []
    mockResult = makeMockVscode([{ uri: fakeUri(root) }], watchers)
  })

  afterEach(() => {
    service?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it("discovers opencode.jsonc in workspace root", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "anthropic/claude-sonnet-4" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.equal(config.model, "anthropic/claude-sonnet-4")
    assert.equal(service.getStatus(), "ok")
  })

  it("falls back to opencode.json if .jsonc absent", async () => {
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ model: "openai/gpt-4o" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.equal(config.model, "openai/gpt-4o")
    assert.equal(service.getStatus(), "ok")
  })

  it("falls back to .opencode/opencode.jsonc then .opencode/opencode.json", async () => {
    mkdirSync(join(root, ".opencode"), { recursive: true })
    writeFileSync(join(root, ".opencode", "opencode.jsonc"), JSON.stringify({ instructions: "test" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.equal(config.instructions, "test")
  })

  it("returns empty config when no file found (no crash)", async () => {
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.deepEqual(service.getConfig(), {})
    assert.equal(service.getStatus(), "not_found")
  })

  it("returns empty config when file is empty", async () => {
    writeFileSync(join(root, "opencode.jsonc"), "")
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.deepEqual(service.getConfig(), {})
  })

  it("returns empty config when file is comments-only", async () => {
    writeFileSync(join(root, "opencode.jsonc"), "// just a comment\n/* block */")
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.deepEqual(service.getConfig(), {})
  })

  it("logs warning + returns empty config on parse error", async () => {
    writeFileSync(join(root, "opencode.jsonc"), '{ "key": }')
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.deepEqual(service.getConfig(), {})
    assert.equal(service.getStatus(), "parse_error")
  })

  it("parses JSONC with comments and trailing commas", async () => {
    writeFileSync(join(root, "opencode.jsonc"), `{
      // comment
      "model": "anthropic/claude",
      "rules": ["rule1", "rule2",],
    }`)
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.equal(config.model, "anthropic/claude")
    assert.deepEqual(config.rules, ["rule1", "rule2"])
  })

  it("both .jsonc and .json exist: .jsonc wins", async () => {
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ model: "from-json" }))
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "from-jsonc" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.equal(service.getConfig().model, "from-jsonc")
  })

  it("getConfig returns cached config without re-reading disk", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "initial" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "changed" }))
    assert.equal(service.getConfig().model, "initial")
  })

  it("refresh re-reads disk and updates cache", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "initial" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "changed" }))
    await service.refresh()
    assert.equal(service.getConfig().model, "changed")
  })

  it("fires onConfigChanged when file is saved (debounced)", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "initial" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    let fired = 0
    service.onConfigChanged(() => { fired++ })
    service.watch()
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "changed" }))
    mockResult.watcherCallbacks.change?.()
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.ok(fired >= 1, "onConfigChanged must fire after save")
    assert.equal(service.getConfig().model, "changed")
  })

  it("does NOT fire on rapid double-save (debounce)", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "initial" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    let fired = 0
    service.onConfigChanged(() => { fired++ })
    service.watch()
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "v1" }))
    mockResult.watcherCallbacks.change?.()
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "v2" }))
    mockResult.watcherCallbacks.change?.()
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(fired, 1, "debounce should coalesce rapid saves into 1 event")
  })

  it("fires on file creation (was missing, now created)", async () => {
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.equal(service.getStatus(), "not_found")
    let fired = 0
    service.onConfigChanged(() => { fired++ })
    service.watch()
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "new" }))
    mockResult.watcherCallbacks.create?.()
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.ok(fired >= 1, "must fire on file creation")
    assert.equal(service.getConfig().model, "new")
  })

  it("fires on file deletion (reverts to empty config)", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "existing" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    let fired = 0
    service.onConfigChanged(() => { fired++ })
    service.watch()
    rmSync(join(root, "opencode.jsonc"))
    mockResult.watcherCallbacks.delete?.()
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.ok(fired >= 1, "must fire on file deletion")
    assert.deepEqual(service.getConfig(), {})
  })

  it("multi-root workspace: scans all folders, later overlay earlier", async () => {
    const root2 = mkdtempSync(join(tmpdir(), "ofh-cfg2-"))
    try {
      writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "from-root1", rules: ["r1"] }))
      writeFileSync(join(root2, "opencode.jsonc"), JSON.stringify({ model: "from-root2" }))
      const multiMock = makeMockVscode(
        [{ uri: fakeUri(root) }, { uri: fakeUri(root2) }],
        watchers,
      )
      service = new OpenCodeConfigService(multiMock.vscode)
      await service.refresh()
      const config = service.getConfig()
      assert.equal(config.model, "from-root2", "later folder overlays earlier")
      assert.deepEqual(config.rules, ["r1"], "non-overlapping keys merge")
    } finally {
      rmSync(root2, { recursive: true, force: true })
    }
  })

  it("honors OPENCODE_CONFIG env var (highest precedence)", async () => {
    const envConfigPath = join(root, "custom-config.jsonc")
    writeFileSync(envConfigPath, JSON.stringify({ model: "from-env" }))
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "from-workspace" }))
    const originalEnv = process.env.OPENCODE_CONFIG
    process.env.OPENCODE_CONFIG = envConfigPath
    try {
      service = new OpenCodeConfigService(mockResult.vscode)
      await service.refresh()
      assert.equal(service.getConfig().model, "from-env")
    } finally {
      if (originalEnv !== undefined) {
        process.env.OPENCODE_CONFIG = originalEnv
      } else {
        delete process.env.OPENCODE_CONFIG
      }
    }
  })

  it("getConfigPath returns the path of the loaded config file", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "test" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const configPath = service.getConfigPath()
    assert.ok(configPath, "config path must be set")
    assert.ok(configPath!.endsWith("opencode.jsonc"))
  })

  it("getConfigPath returns undefined when no config found", async () => {
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    assert.equal(service.getConfigPath(), undefined)
  })

  it("disposes watcher cleanly", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ model: "test" }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    service.watch()
    service.dispose()
  })

  it("preserves unknown keys for forward compatibility", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({
      model: "test",
      futureKey: { nested: true },
      anotherUnknown: 42,
    }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.equal(config.model, "test")
    assert.deepEqual(config.futureKey, { nested: true })
    assert.equal(config.anotherUnknown, 42)
  })

  it("handles ignore and exclude patterns", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({
      ignore: ["*.log"],
      exclude: ["dist/**"],
    }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.deepEqual(config.ignore, ["*.log"])
    assert.deepEqual(config.exclude, ["dist/**"])
  })

  it("handles modelOverrides", async () => {
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({
      modelOverrides: { plan: "anthropic/claude-opus", build: "openai/gpt-4o" },
    }))
    service = new OpenCodeConfigService(mockResult.vscode)
    await service.refresh()
    const config = service.getConfig()
    assert.deepEqual(config.modelOverrides, { plan: "anthropic/claude-opus", build: "openai/gpt-4o" })
  })

  it("handles empty workspace folders gracefully", async () => {
    const emptyMock = makeMockVscode([], watchers)
    service = new OpenCodeConfigService(emptyMock.vscode)
    await service.refresh()
    assert.deepEqual(service.getConfig(), {})
    assert.equal(service.getStatus(), "not_found")
  })
})
