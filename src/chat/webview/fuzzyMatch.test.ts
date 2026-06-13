import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { fuzzyScore, scoreCommandMatch, rankByFuzzy } from "./fuzzyMatch"

describe("fuzzyScore", () => {
  it("returns 0 for an empty query (matches everything, no ranking signal)", () => {
    assert.equal(fuzzyScore("", "anything"), 0)
  })

  it("matches a contiguous prefix", () => {
    assert.ok(fuzzyScore("co", "code-review") !== null)
  })

  it("matches a substring that does NOT start the text (the core complaint)", () => {
    // /review must find code-review even though it doesn't start with "review".
    assert.ok(fuzzyScore("review", "code-review") !== null)
  })

  it("matches a non-contiguous subsequence (true fuzzy)", () => {
    // "cr" -> [c]ode-[r]eview
    assert.ok(fuzzyScore("cr", "code-review") !== null)
    // "crv" -> [c]ode-[r]e[v]iew
    assert.ok(fuzzyScore("crv", "code-review") !== null)
  })

  it("returns null when the query is not a subsequence of the text", () => {
    assert.equal(fuzzyScore("xyz", "code-review"), null)
    // characters present but out of order
    assert.equal(fuzzyScore("rc", "code-review"), null)
  })

  it("is case-insensitive", () => {
    assert.ok(fuzzyScore("REVIEW", "code-review") !== null)
    assert.ok(fuzzyScore("review", "CODE-REVIEW") !== null)
  })

  it("ranks an exact match highest", () => {
    const exact = fuzzyScore("clear", "clear")!
    const prefix = fuzzyScore("clear", "clear-cache")!
    const scattered = fuzzyScore("clear", "c-l-e-a-r")!
    assert.ok(exact > prefix, "exact should beat prefix")
    assert.ok(prefix > scattered, "prefix should beat scattered")
  })

  it("ranks a prefix match above a mid-string match", () => {
    const prefix = fuzzyScore("re", "review")!
    const mid = fuzzyScore("re", "code-review")!
    assert.ok(prefix > mid, "prefix match should outrank a mid-string match")
  })

  it("ranks a word-boundary match above a mid-word match", () => {
    // "review" at a '-' boundary in code-review should beat the same letters
    // buried mid-word in a contrived string.
    const boundary = fuzzyScore("rev", "code-review")!
    const midWord = fuzzyScore("rev", "foreverview")!
    assert.ok(boundary > midWord, "boundary-anchored match should rank higher")
  })

  it("rewards contiguous runs over scattered matches of the same length", () => {
    const contiguous = fuzzyScore("abc", "abcxyz")!
    const scattered = fuzzyScore("abc", "axbxc")!
    assert.ok(contiguous > scattered)
  })
})

describe("scoreCommandMatch", () => {
  it("returns 0 for an empty query", () => {
    assert.equal(scoreCommandMatch("", "model", "Switch the active model"), 0)
  })

  it("matches against the command name", () => {
    assert.ok(scoreCommandMatch("mod", "model", "Switch the active model") !== null)
  })

  it("matches against the description when the name does not match", () => {
    // "switch" is not in the name but is in the description.
    assert.ok(scoreCommandMatch("switch", "model", "Switch the active model") !== null)
  })

  it("ranks a name match above a description-only match", () => {
    // Query "model" matches the name of one command and only the description
    // of another; the name match must win.
    const nameHit = scoreCommandMatch("model", "model", "Switch the active model")!
    const descHit = scoreCommandMatch("model", "cost", "Show the model cost for this session")!
    assert.ok(nameHit > descHit, "a name match must outrank a description-only match")
  })

  it("returns null when neither name nor description matches", () => {
    assert.equal(scoreCommandMatch("zzzz", "model", "Switch the active model"), null)
  })

  it("finds a custom command by a non-prefix term (regression for hidden custom commands)", () => {
    // /code-review must surface when the user types 'review'.
    assert.ok(scoreCommandMatch("review", "code-review", "Review the code changes") !== null)
  })
})

describe("rankByFuzzy", () => {
  type Cmd = { name: string; description: string }
  const cmds: Cmd[] = [
    { name: "clear", description: "Clear conversation" },
    { name: "model", description: "Switch the active model" },
    { name: "code-review", description: "Review the code changes" },
    { name: "compact", description: "Compact session context" },
    { name: "cost", description: "Show session cost" },
  ]
  const getName = (c: Cmd) => c.name
  const getDesc = (c: Cmd) => c.description

  it("returns every item (original order) for an empty query", () => {
    const out = rankByFuzzy(cmds, "", getName, getDesc)
    assert.deepEqual(out.map((c) => c.name), cmds.map((c) => c.name))
  })

  it("filters out non-matching items", () => {
    const out = rankByFuzzy(cmds, "co", getName, getDesc)
    const names = out.map((c) => c.name)
    assert.ok(names.includes("compact"))
    assert.ok(names.includes("cost"))
    assert.ok(names.includes("code-review"))
    assert.ok(!names.includes("model"), "model has no 'co' subsequence in name and shouldn't rank by name")
  })

  it("surfaces a custom command searched by a mid-name term", () => {
    const out = rankByFuzzy(cmds, "review", getName, getDesc)
    assert.ok(out.some((c) => c.name === "code-review"), "code-review must appear for query 'review'")
  })

  it("orders better matches first (exact/prefix before scattered)", () => {
    const out = rankByFuzzy(cmds, "co", getName, getDesc)
    // "cost"/"compact"/"code-review" all start with "co"; whichever, the top
    // result must be a prefix match, never a scattered/description-only one.
    assert.ok(["cost", "compact", "code-review"].includes(out[0]!.name))
  })

  it("is a stable sort for equal scores (preserves original order on ties)", () => {
    // Two synthetic items with identical match characteristics keep input order.
    const items = [
      { name: "alpha", description: "x" },
      { name: "alphb", description: "x" },
    ]
    const out = rankByFuzzy(items, "alph", (c) => c.name, (c) => c.description)
    assert.deepEqual(out.map((c) => c.name), ["alpha", "alphb"])
  })
})

// Hand-rolled property checks (fast-check is intentionally not a project dep).
describe("fuzzyMatch — properties", () => {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz-:_"
  function rngString(seed: number, len: number): string {
    let s = ""
    let x = seed
    for (let i = 0; i < len; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      s += ALPHABET[x % ALPHABET.length]
    }
    return s
  }

  it("any subsequence of a text scores non-null; a superset string never does", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const text = rngString(seed, 6 + (seed % 6))
      // Build a genuine subsequence by sampling characters in order.
      let sub = ""
      for (let i = 0; i < text.length; i++) {
        if (((seed >> i) & 1) === 1) sub += text[i]
      }
      assert.notEqual(fuzzyScore(sub, text), null, `"${sub}" should match "${text}"`)
      // A string strictly longer than the text can never be a subsequence.
      const tooLong = text + "q"
      assert.equal(fuzzyScore(tooLong, text), null, `"${tooLong}" must not match "${text}"`)
    }
  })

  it("scores are finite numbers whenever a match is reported", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const text = rngString(seed, 8)
      const query = rngString(seed * 7 + 1, 3)
      const score = fuzzyScore(query, text)
      if (score !== null) {
        assert.ok(Number.isFinite(score), `score for ("${query}","${text}") must be finite`)
      }
    }
  })
})
