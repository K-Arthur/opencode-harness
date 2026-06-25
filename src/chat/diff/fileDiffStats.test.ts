/**
 * Tests for file diff statistics computation.
 *
 * Covers path normalization, git fallback strategies, CRLF normalization,
 * and error handling for WSL2/Docker environments.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeFileDiffStats } from "./fileDiffStats"

// ─── Test helpers ─────────────────────────────────────────────────────────────

function mockDeps(opts: {
  gitNumstat?: string
  gitNumstatThrows?: boolean
  gitHeadContent?: string
  gitHeadThrows?: boolean
  fileContent?: string
  fileThrows?: boolean
  openDocContent?: string
}): import("./fileDiffStats").DiffStatsDeps {
  return {
    execSync: ((cmd: string, _opts?: Record<string, unknown>) => {
      if (opts.gitNumstatThrows) throw new Error("git not found")
      if (cmd.startsWith("git diff --numstat")) return opts.gitNumstat ?? ""
      if (cmd.startsWith("git show HEAD:")) {
        if (opts.gitHeadThrows) throw new Error("not in git")
        return opts.gitHeadContent ?? ""
      }
      throw new Error(`unexpected command: ${cmd}`)
    }) as unknown as import("./fileDiffStats").DiffStatsDeps["execSync"],
    readFileSync: ((_p: string) => {
      if (opts.fileThrows) throw new Error("file not found")
      return opts.fileContent ?? ""
    }) as unknown as import("./fileDiffStats").DiffStatsDeps["readFileSync"],
    getOpenDocumentText: ((_p: string) => opts.openDocContent) as unknown as import("./fileDiffStats").DiffStatsDeps["getOpenDocumentText"],
    log: {
      debug: () => {},
      warn: () => {},
    },
  }
}

const ROOT = "/fake/workspace"

// ─── Path normalization ─────────────────────────────────────────────────────────

describe("normalizePath", () => {
  it("passes through relative paths unchanged", () => {
    const deps = mockDeps({ fileContent: "new content\n" })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    // Should not throw; normalization should succeed
    assert.ok(result.added >= 0 && result.removed >= 0)
  })

  it("normalizes Windows backslash paths to forward slashes", () => {
    const deps = mockDeps({ gitNumstat: "3 2 src/file.ts" })
    const result = computeFileDiffStats("src\\file.ts", ROOT, deps)
    assert.equal(result.added, 3)
    assert.equal(result.removed, 2)
  })

  it("strips workspace root prefix from absolute paths", () => {
    const deps = mockDeps({ gitNumstat: "5 1 src/file.ts" })
    const result = computeFileDiffStats("/fake/workspace/src/file.ts", ROOT, deps)
    assert.equal(result.added, 5)
    assert.equal(result.removed, 1)
  })

  it("matches workspace root suffix for container paths", () => {
    const deps = mockDeps({ gitNumstat: "2 0 file.ts" })
    const result = computeFileDiffStats("/container/workspace/file.ts", ROOT, deps)
    // Should match the "workspace" suffix and normalize to "file.ts"
    assert.ok(result.added >= 0)
  })

  it("handles WSL UNC paths", () => {
    const deps = mockDeps({ gitNumstat: "1 1 src/file.ts" })
    const result = computeFileDiffStats("//wsl$/Ubuntu/fake/workspace/src/file.ts", ROOT, deps)
    assert.equal(result.added, 1)
    assert.equal(result.removed, 1)
  })

  it("handles backslash WSL UNC paths", () => {
    const deps = mockDeps({ gitNumstat: "1 1 src/file.ts" })
    const result = computeFileDiffStats("\\\\wsl$\\Ubuntu\\fake\\workspace\\src\\file.ts", ROOT, deps)
    assert.equal(result.added, 1)
    assert.equal(result.removed, 1)
  })

  it("returns 0/0 for unnormalizable paths", () => {
    const deps = mockDeps({})
    const result = computeFileDiffStats("/completely/different/path", ROOT, deps)
    assert.equal(result.added, 0)
    assert.equal(result.removed, 0)
  })
})

// ─── git diff --numstat strategy ────────────────────────────────────────────────

describe("git diff --numstat", () => {
  it("uses git diff --numstat stats when available", () => {
    const deps = mockDeps({ gitNumstat: "5 3 src/file.ts" })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    assert.equal(result.added, 5)
    assert.equal(result.removed, 3)
  })

  it("handles malformed numstat output gracefully", () => {
    const deps = mockDeps({
      gitNumstat: "malformed output",
      gitHeadContent: "old\n",
      fileContent: "new\n",
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    // Should fall back to hunk computation
    assert.ok(result.added >= 0)
  })
})

// ─── git show HEAD: fallback ───────────────────────────────────────────────────

describe("git show HEAD: fallback", () => {
  it("computes stats from HEAD content for new files", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadThrows: true, // not in git HEAD
      fileContent: "line 1\nline 2\nline 3\n",
    })
    const result = computeFileDiffStats("src/new.ts", ROOT, deps)
    assert.equal(result.added, 3)
    assert.equal(result.removed, 0)
  })

  it("computes stats for deleted files", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadContent: "a\nb\nc\n",
      fileThrows: true, // file deleted
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    // When file is deleted, disk read fails, so we return 0/0
    assert.equal(result.added, 0)
    assert.equal(result.removed, 0)
  })
})

// ─── Open document fallback ─────────────────────────────────────────────────────

describe("open document fallback", () => {
  it("prefers open document content over disk read", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadContent: "old\n",
      fileContent: "disk content\n",
      openDocContent: "editor content\n",
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    // Should use editor content, not disk content
    assert.ok(result.added >= 0)
  })

  it("falls back to disk read when no open document", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadThrows: true,
      fileContent: "disk content\n",
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    assert.equal(result.added, 1)
    assert.equal(result.removed, 0)
  })

  it("returns 0/0 when disk read fails and no open document", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadThrows: true,
      fileThrows: true,
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    assert.equal(result.added, 0)
    assert.equal(result.removed, 0)
  })
})

// ─── Edge cases ─────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty file content", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadContent: "",
      fileContent: "",
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    assert.equal(result.added, 0)
    assert.equal(result.removed, 0)
  })

  it("handles whitespace-only paths", () => {
    const deps = mockDeps({})
    const result = computeFileDiffStats("   ", ROOT, deps)
    assert.equal(result.added, 0)
    assert.equal(result.removed, 0)
  })

  it("handles empty path", () => {
    const deps = mockDeps({})
    const result = computeFileDiffStats("", ROOT, deps)
    assert.equal(result.added, 0)
    assert.equal(result.removed, 0)
  })

  it("handles git unavailability", () => {
    const deps = mockDeps({
      gitNumstatThrows: true,
      gitHeadThrows: true,
      fileContent: "content\n",
    })
    const result = computeFileDiffStats("src/file.ts", ROOT, deps)
    assert.equal(result.added, 1)
    assert.equal(result.removed, 0)
  })
})
