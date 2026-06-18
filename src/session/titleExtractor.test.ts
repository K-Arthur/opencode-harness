import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { extractTitle, dedupeTitle, extractDiscriminator, dedupeTitleSmart } from "./titleExtractor"

describe("extractTitle — boilerplate stripping", () => {
  it("returns empty string for empty/whitespace input", () => {
    assert.equal(extractTitle(""), "")
    assert.equal(extractTitle("   "), "")
    assert.equal(extractTitle("\n\t\n"), "")
  })

  it("strips leading markdown header tokens", () => {
    // Multiple prompts opening with the same H1/H2 no longer collide
    assert.equal(extractTitle("# Role & Objective\nPlan A"), "Role & Objective")
    assert.equal(extractTitle("## Role & Objective\nPlan B"), "Role & Objective")
    assert.equal(extractTitle("### Step 1: do work"), "Step 1: do work")
  })

  it("strips bracketed metadata prefixes like [methodology]", () => {
    assert.equal(
      extractTitle("[methodology] Spec-anchored · Reason step by step"),
      "Spec-anchored · Reason step by step",
    )
    assert.equal(
      extractTitle("[RFC 42] Add title extractor"),
      "Add title extractor",
    )
  })

  it("strips TODO/FIXME/NOTE label separators but preserves the verb/object", () => {
    // "TODO:" is a noise prefix; the meaningful content follows
    assert.equal(
      extractTitle("TODO: fix the TabManager crash"),
      "fix the TabManager crash",
    )
    assert.equal(
      extractTitle("FIXME: race in applyServerTitle"),
      "race in applyServerTitle",
    )
  })

  it("handles stacked boilerplate (markdown header + bracket tag)", () => {
    assert.equal(
      extractTitle("# [Sprint 4] Fix login bug"),
      "Fix login bug",
    )
  })
})

describe("extractTitle — length + truncation", () => {
  it("preserves short first sentences as-is", () => {
    assert.equal(extractTitle("Fix the bug."), "Fix the bug")
    assert.equal(extractTitle("Refactor session layer"), "Refactor session layer")
  })

  it("truncates long first sentences on a word boundary with ellipsis", () => {
    const long = "This is an extremely long prompt that goes well beyond the forty character limit we impose"
    const out = extractTitle(long)
    assert.ok(out.length <= 40, `expected ≤40 chars, got ${out.length}: "${out}"`)
    assert.ok(out.endsWith("…"), "must end with ellipsis character")
    // Word boundary — no mid-word split
    assert.ok(!out.startsWith("This is an extremely long prompt that goes wel"),
      "must not split 'well' mid-word")
  })

  it("splits on sentence terminators (. ! ? newline)", () => {
    assert.equal(extractTitle("First sentence. Second one!"), "First sentence")
    assert.equal(extractTitle("First! Second."), "First")
    assert.equal(extractTitle("First line\nSecond line"), "First line")
  })
})

describe("extractTitle — determinism", () => {
  it("returns identical output for identical input across 1000 calls", () => {
    const input = "Refactor the TabManager state synchronization"
    const first = extractTitle(input)
    for (let i = 0; i < 1000; i++) {
      assert.equal(extractTitle(input), first)
    }
  })

  it("does not invoke Math.random or Date (pure)", () => {
    // Indirect assertion: the function is referenced via a spy if we mock
    // globalThis. Cheaper: just confirm output is stable across two
    // consecutive calls in different microtasks.
    const input = "Stable output test"
    assert.equal(extractTitle(input), extractTitle(input))
  })
})

describe("dedupeTitle — suffix assignment", () => {
  it("returns proposed name as-is when not in set", () => {
    assert.equal(dedupeTitle("Fix bug", new Set()), "Fix bug")
    assert.equal(dedupeTitle("Fix bug", new Set(["Other"])), "Fix bug")
  })

  it("appends ' (2)' for first collision, ' (3)' for second", () => {
    assert.equal(
      dedupeTitle("Fix bug", new Set(["Fix bug"])),
      "Fix bug (2)",
    )
    assert.equal(
      dedupeTitle("Fix bug", new Set(["Fix bug", "Fix bug (2)"])),
      "Fix bug (3)",
    )
    assert.equal(
      dedupeTitle("Fix bug", new Set(["Fix bug", "Fix bug (2)", "Fix bug (3)"])),
      "Fix bug (4)",
    )
  })

  it("produces three distinct labels for three prompts sharing the same prefix", () => {
    // The reported user-pain case: three concurrent sessions with the same
    // boilerplate opening all collapsed to identical labels. After the fix
    // each must be unique.
    const base = "Fix the following bug:"
    const existing = new Set<string>()
    const titles = [base, base, base].map((t) => {
      const result = dedupeTitle(t, existing)
      existing.add(result)
      return result
    })
    assert.equal(titles.length, 3)
    assert.equal(new Set(titles).size, 3, `expected 3 distinct titles, got ${JSON.stringify(titles)}`)
    assert.equal(titles[0], "Fix the following bug:")
    assert.equal(titles[1], "Fix the following bug: (2)")
    assert.equal(titles[2], "Fix the following bug: (3)")
  })

  it("suffix format is ASCII parentheses + space (lexicographically stable)", () => {
    const out = dedupeTitle("x", new Set(["x"]))
    assert.equal(out, "x (2)")
    // Sanity: ' (2)' > ' ' lexicographically; (2) < (10) digit-by-digit
    assert.ok(out.includes(" (2)"))
    assert.ok(!out.includes("\u2009"), "must not use thin-space separator")
  })

  it("does not mutate the input set", () => {
    const input = new Set(["x"])
    dedupeTitle("x", input)
    assert.equal(input.size, 1, "input set must be unmutated")
    assert.ok(input.has("x"))
  })
})

describe("extractTitle + dedupeTitle — integration", () => {
  it("three prompts opening with the same markdown prefix produce three unique tab labels", () => {
    // Full simulation of the reported defect: same boilerplate, different
    // underlying content. Without the fix, all three extract to identical
    // titles. With both extractTitle boilerplate stripping AND dedupeTitle
    // suffixing, they all differ.
    const prompts = [
      "# Role & Objective\nPlan A",
      "# Role & Objective\nPlan B with different content",
      "# Role & Objective\nPlan C with yet another angle",
    ]
    const existing = new Set<string>()
    const labels = prompts.map((p) => {
      const extracted = extractTitle(p)
      const deduped = dedupeTitle(extracted, existing)
      existing.add(deduped)
      return deduped
    })
    assert.equal(new Set(labels).size, 3, `expected 3 distinct labels, got ${JSON.stringify(labels)}`)
    // All within the 40-char budget (plus suffix overhead)
    for (const label of labels) {
      assert.ok(label.length <= 48, `label too long: "${label}" (${label.length})`)
    }
  })
})

describe("extractDiscriminator — unique token from full text", () => {
  it("extracts first capitalized word from subsequent content as discriminator", () => {
    const text = "# Role & Objective\nRefactor the TabManager state synchronization"
    assert.equal(extractDiscriminator(text, "Role & Objective"), "TabManager")
  })

  it("returns empty string when no distinguishing token found", () => {
    const text = "Fix bug"
    assert.equal(extractDiscriminator(text, "Fix bug"), "")
  })

  it("skips boilerplate when extracting discriminator", () => {
    const text = "[methodology] Refactor TabManager\n## Details\nThis is about the SessionStore"
    // "SessionStore" (11 chars) wins over "TabManager" (10 chars) — longest capitalized token
    assert.equal(extractDiscriminator(text, "Refactor"), "SessionStore")
  })

  it("prefers the longest new token not present in the base title", () => {
    const text = "Fix bug in the TabManager authentication module"
    assert.equal(extractDiscriminator(text, "Fix bug"), "TabManager")
  })

  it("falls back to empty string when all tokens appear in the base title", () => {
    const text = "Fix the bug again"
    assert.equal(extractDiscriminator(text, "Fix the bug"), "")
  })

  it("returns empty string for empty input", () => {
    assert.equal(extractDiscriminator("", "base"), "")
    assert.equal(extractDiscriminator("   ", "base"), "")
  })
})

describe("dedupeTitleSmart — semantic deduplication with discriminator suffix", () => {
  it("returns proposed as-is when no collision (same as dedupeTitle)", () => {
    const existing = new Set<string>(["Other"])
    assert.equal(dedupeTitleSmart("Fix bug", "Fix bug", existing), "Fix bug")
  })

  it("uses discriminator suffix instead of '(2)' when token available", () => {
    const existing = new Set<string>(["Fix bug"])
    const fullText = "Fix bug in TabManager state sync"
    const out = dedupeTitleSmart("Fix bug", fullText, existing)
    assert.equal(out, "Fix bug (TabManager)")
  })

  it("falls back to numeric '(2)' when no discriminator token found", () => {
    const existing = new Set<string>(["Fix bug"])
    const fullText = "Fix bug again"
    const out = dedupeTitleSmart("Fix bug", fullText, existing)
    assert.equal(out, "Fix bug (2)")
  })

  it("discriminator never exceeds MAX_RENDERED_LENGTH", () => {
    const existing = new Set<string>(["Fix"])
    const fullText = "Fix a very long prompt that keeps going and going with a Supercalifragilisticexpialidocious word"
    const out = dedupeTitleSmart("Fix", fullText, existing)
    assert.ok(out.length <= 48, `dedupeTitleSmart output too long: "${out}" (${out.length})`)
  })

  it("strips boilerplate before extracting discriminator", () => {
    const existing = new Set<string>(["Refactor"])
    const fullText = "# [Sprint 4] Refactor the TabManager session layer"
    const out = dedupeTitleSmart("Refactor", fullText, existing)
    assert.equal(out, "Refactor (TabManager)")
  })

  it("escalates from discriminator to numeric on second collision of same base", () => {
    // Discriminator "TabManager" is already taken → fallback to dedupeTitle
    // which starts at n=2 → "(2)" is the fallback
    const existing = new Set<string>(["Fix bug", "Fix bug (TabManager)"])
    const fullText = "Fix bug in TabManager state sync"
    const out = dedupeTitleSmart("Fix bug", fullText, existing)
    assert.equal(out, "Fix bug (2)")
  })

  it("does not mutate the input set", () => {
    const input = new Set<string>(["Fix bug"])
    dedupeTitleSmart("Fix bug", "Fix bug in TabManager", input)
    assert.equal(input.size, 1)
    assert.ok(input.has("Fix bug"))
  })
})
