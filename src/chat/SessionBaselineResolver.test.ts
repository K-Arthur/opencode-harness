/**
 * Tests for SessionBaselineResolver.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { getBaselineContent } from "./SessionBaselineResolver"

function mockDeps(opts: {
  workspaceRoot?: string
  baselineSha?: string
  gitShowOutput?: string
  gitShowThrows?: boolean
}): import("./SessionBaselineResolver").BaselineResolverDeps {
  return {
    sessionStore: {
      getSessionDirectory: () => opts.workspaceRoot ?? "/fake/workspace",
      getBaselineSha: () => opts.baselineSha,
    } as unknown as import("./SessionBaselineResolver").BaselineResolverDeps["sessionStore"],
    checkpointManager: {
      listCheckpoints: () => Promise.resolve([]),
    } as unknown as import("./SessionBaselineResolver").BaselineResolverDeps["checkpointManager"],
    execSync: ((_cmd: string, _opts: { cwd: string; encoding: string }) => {
      if (opts.gitShowThrows) throw new Error("git failed")
      return opts.gitShowOutput ?? ""
    }) as unknown as import("./SessionBaselineResolver").BaselineResolverDeps["execSync"],
    log: {
      debug: () => {},
      warn: () => {},
      info: () => {},
    },
  }
}

describe("SessionBaselineResolver", () => {
  it("returns empty string when no workspace directory", async () => {
    const deps = mockDeps({ workspaceRoot: undefined })
    const result = await getBaselineContent("session-1", "src/file.ts", deps)
    assert.equal(result, "")
  })

  it("uses baseline SHA when available", async () => {
    const deps = mockDeps({
      workspaceRoot: "/fake/workspace",
      baselineSha: "abc123",
      gitShowOutput: "old content\n",
    })
    const result = await getBaselineContent("session-1", "src/file.ts", deps)
    assert.equal(result, "old content\n")
  })

  it("falls back to HEAD when no baseline SHA", async () => {
    const deps = mockDeps({
      workspaceRoot: "/fake/workspace",
      baselineSha: undefined,
      gitShowOutput: "head content\n",
    })
    const result = await getBaselineContent("session-1", "src/file.ts", deps)
    assert.equal(result, "head content\n")
  })

  it("returns empty string when git fails (untracked file)", async () => {
    const deps = mockDeps({
      workspaceRoot: "/fake/workspace",
      baselineSha: "abc123",
      gitShowThrows: true,
    })
    const result = await getBaselineContent("session-1", "src/file.ts", deps)
    assert.equal(result, "")
  })
})
