/**
 * Tests for file status classification (A=added, M=modified, D=deleted).
 *
 * The opencode SDK's file-change events carry paths and line stats but NOT
 * the git status letter. Without classification the changed-files UI defaults
 * every file to "Modified", mislabeling new and deleted files. These tests
 * cover the git-status parsing, the before/after content inference fallback,
 * batch classification, and edge cases.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  classifyFileStatus,
  classifyFileStatuses,
  parsePorcelainStatus,
  type FileStatus,
  type ClassifierDeps,
} from "./fileStatusClassifier"

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build mock deps with scripted git + filesystem responses. */
function mockDeps(opts: {
  gitOutput?: string
  gitThrows?: boolean
  exists?: boolean
  gitHeadContent?: string
  gitHeadThrows?: boolean
}): ClassifierDeps {
  return {
    execSync: ((cmd: string, _opts?: Record<string, unknown>) => {
      if (opts.gitThrows) throw new Error("git not found")
      if (cmd.startsWith("git status")) return opts.gitOutput ?? ""
      if (cmd.startsWith("git show HEAD:")) {
        if (opts.gitHeadThrows) throw new Error("not in git")
        return opts.gitHeadContent ?? ""
      }
      throw new Error(`unexpected command: ${cmd}`)
    }) as unknown as ClassifierDeps["execSync"],
    existsSync: ((_p: string) => opts.exists ?? false) as unknown as ClassifierDeps["existsSync"],
  }
}

const ROOT = "/fake/workspace"

// ─── parsePorcelainStatus ─────────────────────────────────────────────────────

describe("parsePorcelainStatus", () => {
  it("classifies untracked files (??) as Added", () => {
    assert.equal(parsePorcelainStatus("??"), "A")
  })

  it("classifies staged additions (A ) as Added", () => {
    assert.equal(parsePorcelainStatus("A "), "A")
  })

  it("classifies staged + unstaged add (AM) as Added", () => {
    assert.equal(parsePorcelainStatus("AM"), "A")
  })

  it("classifies unstaged modifications ( M) as Modified", () => {
    assert.equal(parsePorcelainStatus(" M"), "M")
  })

  it("classifies staged modifications (M ) as Modified", () => {
    assert.equal(parsePorcelainStatus("M "), "M")
  })

  it("classifies unstaged deletions ( D) as Deleted", () => {
    assert.equal(parsePorcelainStatus(" D"), "D")
  })

  it("classifies staged deletions (D ) as Deleted", () => {
    assert.equal(parsePorcelainStatus("D "), "D")
  })

  it("classifies renames (R ) as Modified", () => {
    assert.equal(parsePorcelainStatus("R "), "M")
  })

  it("classifies copies (C ) as Modified", () => {
    assert.equal(parsePorcelainStatus("C "), "M")
  })

  it("returns null for ignored files (!!)", () => {
    assert.equal(parsePorcelainStatus("!!"), null)
  })

  it("returns null for empty/whitespace status", () => {
    assert.equal(parsePorcelainStatus("  "), null)
    assert.equal(parsePorcelainStatus(""), null)
  })
})

// ─── classifyFileStatus — git status path ────────────────────────────────────

describe("classifyFileStatus — git status --porcelain", () => {
  it("returns A for untracked files", () => {
    const deps = mockDeps({ gitOutput: "?? src/new.ts\n" })
    assert.equal(classifyFileStatus("src/new.ts", { workspaceRoot: ROOT, deps }), "A")
  })

  it("returns M for modified files", () => {
    const deps = mockDeps({ gitOutput: " M src/existing.ts\n" })
    assert.equal(classifyFileStatus("src/existing.ts", { workspaceRoot: ROOT, deps }), "M")
  })

  it("returns D for deleted files", () => {
    const deps = mockDeps({ gitOutput: " D src/gone.ts\n" })
    assert.equal(classifyFileStatus("src/gone.ts", { workspaceRoot: ROOT, deps }), "D")
  })

  it("handles staged deletion (D )", () => {
    const deps = mockDeps({ gitOutput: "D  src/gone.ts\n" })
    assert.equal(classifyFileStatus("src/gone.ts", { workspaceRoot: ROOT, deps }), "D")
  })

  it("normalizes Windows backslash paths before querying git", () => {
    const deps = mockDeps({ gitOutput: "?? new.ts\n" })
    assert.equal(classifyFileStatus("src\\new.ts", { workspaceRoot: ROOT, deps }), "A")
  })

  it("returns null for empty path", () => {
    const deps = mockDeps({ gitOutput: "" })
    assert.equal(classifyFileStatus("", { workspaceRoot: ROOT, deps }), null)
  })

  it("returns null for whitespace-only path", () => {
    const deps = mockDeps({ gitOutput: "" })
    assert.equal(classifyFileStatus("   ", { workspaceRoot: ROOT, deps }), null)
  })
})

// ─── classifyFileStatus — before/after inference fallback ────────────────────

describe("classifyFileStatus — before/after inference fallback", () => {
  it("returns A when file is not in git HEAD but exists on disk", () => {
    const deps = mockDeps({
      gitOutput: "", // git status returned nothing
      gitHeadThrows: true, // git show HEAD: fails (untracked)
      exists: true,
    })
    assert.equal(classifyFileStatus("src/new.ts", { workspaceRoot: ROOT, deps }), "A")
  })

  it("returns D when file is in git HEAD but does NOT exist on disk", () => {
    const deps = mockDeps({
      gitOutput: "", // git status returned nothing
      gitHeadContent: "original content\n",
      exists: false,
    })
    assert.equal(classifyFileStatus("src/gone.ts", { workspaceRoot: ROOT, deps }), "D")
  })

  it("returns M when file is in git HEAD AND exists on disk", () => {
    const deps = mockDeps({
      gitOutput: "", // git status returned nothing (edge: clean file)
      gitHeadContent: "original\n",
      exists: true,
    })
    assert.equal(classifyFileStatus("src/existing.ts", { workspaceRoot: ROOT, deps }), "M")
  })

  it("returns null when git is unavailable and file doesn't exist", () => {
    const deps = mockDeps({
      gitThrows: true,
      gitHeadThrows: true,
      exists: false,
    })
    assert.equal(classifyFileStatus("src/unknown.ts", { workspaceRoot: ROOT, deps }), null)
  })

  it("returns A when git throws entirely and file exists on disk", () => {
    const deps = mockDeps({
      gitThrows: true, // no git repo at all
      exists: true,
    })
    assert.equal(classifyFileStatus("src/new.ts", { workspaceRoot: ROOT, deps }), "A")
  })
})

// ─── classifyFileStatuses — batch ────────────────────────────────────────────

describe("classifyFileStatuses — batch", () => {
  it("classifies multiple files in a single git status call", () => {
    const gitOutput = [
      "?? src/new.ts",
      " M src/existing.ts",
      " D src/gone.ts",
    ].join("\n")
    const deps = mockDeps({ gitOutput })
    const result = classifyFileStatuses(
      ["src/new.ts", "src/existing.ts", "src/gone.ts"],
      { workspaceRoot: ROOT, deps },
    )
    assert.equal(result.get("src/new.ts"), "A")
    assert.equal(result.get("src/existing.ts"), "M")
    assert.equal(result.get("src/gone.ts"), "D")
  })

  it("falls back to per-file inference for files git didn't classify", () => {
    // git status only reports one of the two files
    const gitOutput = "?? src/new.ts\n"
    const deps = mockDeps({
      gitOutput,
      gitHeadContent: "old content\n",
      exists: false,
    })
    const result = classifyFileStatuses(
      ["src/new.ts", "src/deleted.ts"],
      { workspaceRoot: ROOT, deps },
    )
    assert.equal(result.get("src/new.ts"), "A")
    assert.equal(result.get("src/deleted.ts"), "D")
  })

  it("returns empty map for empty input", () => {
    const deps = mockDeps({ gitOutput: "" })
    const result = classifyFileStatuses([], { workspaceRoot: ROOT, deps })
    assert.equal(result.size, 0)
  })

  it("filters out empty/whitespace paths", () => {
    const deps = mockDeps({ gitOutput: "?? real.ts\n" })
    const result = classifyFileStatuses(
      ["", "  ", "real.ts"],
      { workspaceRoot: ROOT, deps },
    )
    assert.equal(result.size, 1)
    assert.equal(result.get("real.ts"), "A")
  })

  it("handles git status with quoted paths (spaces in filename)", () => {
    const gitOutput = '?? "src/my file.ts"\n'
    const deps = mockDeps({ gitOutput })
    const result = classifyFileStatuses(
      ["src/my file.ts"],
      { workspaceRoot: ROOT, deps },
    )
    assert.equal(result.get("src/my file.ts"), "A")
  })

  it("handles git throwing entirely — falls back to inference for all files", () => {
    const deps = mockDeps({
      gitThrows: true,
      exists: true,
    })
    const result = classifyFileStatuses(
      ["src/a.ts", "src/b.ts"],
      { workspaceRoot: ROOT, deps },
    )
    assert.equal(result.get("src/a.ts"), "A")
    assert.equal(result.get("src/b.ts"), "A")
  })

  it("normalizes Windows backslash paths in batch", () => {
    const gitOutput = "?? src/new.ts\n"
    const deps = mockDeps({ gitOutput })
    const result = classifyFileStatuses(
      ["src\\new.ts"],
      { workspaceRoot: ROOT, deps },
    )
    assert.equal(result.get("src/new.ts"), "A")
  })
})

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("classifyFileStatus — edge cases", () => {
  it("handles git status output with trailing whitespace", () => {
    const deps = mockDeps({ gitOutput: " M src/file.ts  \n" })
    assert.equal(classifyFileStatus("src/file.ts", { workspaceRoot: ROOT, deps }), "M")
  })

  it("handles multiple lines in git status (picks first)", () => {
    // Unlikely but defensive: git status should return one line per file
    const deps = mockDeps({ gitOutput: " M src/file.ts\n?? other\n" })
    assert.equal(classifyFileStatus("src/file.ts", { workspaceRoot: ROOT, deps }), "M")
  })

  it("handles file with empty content in git HEAD (tracked but empty)", () => {
    const deps = mockDeps({
      gitOutput: "",
      gitHeadContent: "",
      exists: true,
    })
    // Empty before + exists → M (tracked, possibly just empty)
    assert.equal(classifyFileStatus("src/empty.ts", { workspaceRoot: ROOT, deps }), "M")
  })

  it("handles file deleted and git HEAD content is empty string", () => {
    const deps = mockDeps({
      gitOutput: "",
      gitHeadContent: "",
      exists: false,
    })
    // Empty before + doesn't exist → could be either D or nothing.
    // An empty tracked file that was deleted → D.
    // But gitHeadContent="" could also mean "not in git".
    // The inference logic: if git show succeeded (didn't throw) → tracked → D.
    assert.equal(classifyFileStatus("src/empty.ts", { workspaceRoot: ROOT, deps }), "D")
  })
})
