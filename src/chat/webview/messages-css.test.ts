import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const cssSource = readFileSync(path.join(__dirname, "css", "messages.css"), "utf8")
const blocksSource = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")
const layoutSource = readFileSync(path.join(__dirname, "css", "layout.css"), "utf8")
const componentsSource = readFileSync(path.join(__dirname, "css", "components.css"), "utf8")

describe("messages.css", () => {
  it("keeps markdown rhythm compact for the extension chat viewport", () => {
    assert.match(
      cssSource,
      /\.markdown-content > :first-child\s*{[^}]*margin-top:\s*0;/s,
      "first markdown element should not add extra top whitespace",
    )
    assert.match(
      cssSource,
      /\.markdown-content ul,\s*\.markdown-content ol\s*{[^}]*margin:\s*0\.35em 0 0\.65em;/s,
      "lists should use explicit compact margins instead of browser defaults",
    )
  })

  it("does not use negative letter spacing in markdown headings", () => {
    const headingStart = cssSource.indexOf(".markdown-content h1")
    const headingEnd = cssSource.indexOf(".markdown-content p", headingStart)
    const headingCss = cssSource.slice(headingStart, headingEnd)

    assert.doesNotMatch(headingCss, /letter-spacing:\s*-/)
    assert.match(headingCss, /letter-spacing:\s*0;/)
  })

  it("styles the complete markdown heading range", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      assert.match(
        cssSource,
        new RegExp(`\\.markdown-content h${level}\\s*{`),
        `h${level} should have explicit markdown styling`,
      )
    }
  })

  it("keeps markdown code fences readable and scrollable", () => {
    assert.match(
      cssSource,
      /\.markdown-content pre\s*{[^}]*overflow-x:\s*auto;/s,
      "markdown fenced code should scroll horizontally instead of clipping",
    )
    assert.match(
      cssSource,
      /\.markdown-content pre code\s*{[^}]*background:\s*transparent;/s,
      "code inside fenced blocks should not inherit inline-code pill styling",
    )
  })

  it("keeps markdown tables usable in narrow panes", () => {
    assert.match(
      cssSource,
      /\.markdown-content table\s*{[^}]*overflow-x:\s*auto;/s,
      "markdown tables should allow horizontal scrolling",
    )
    assert.match(
      cssSource,
      /\.markdown-content table\s*{[^}]*min-width:\s*min\(100%,\s*32rem\);/s,
      "markdown tables should keep readable columns without forcing page overflow",
    )
  })

  it("has keyboard-visible link styling", () => {
    assert.match(
      cssSource,
      /\.markdown-content a:focus-visible\s*{[^}]*outline:\s*2px solid var\(--color-accent\);/s,
      "markdown links need visible keyboard focus",
    )
  })

	  it("styles task-list checkboxes and nested markdown lists", () => {
	    assert.match(cssSource, /\.markdown-content \.task-list-item\s*{[^}]*list-style:\s*none;/s)
	    assert.match(cssSource, /\.markdown-content li > ul,/)
	    assert.match(cssSource, /\.markdown-content li > ol\s*{[^}]*margin-top:\s*0\.25em;/s)
	  })

	  it("reserves space for the right-side conversation timeline only when visible", () => {
	    assert.match(cssSource, /\.message-list\.timeline-visible\s*{[^}]*padding-right:\s*152px;/s)
	    assert.match(cssSource, /\.conversation-timeline\.visible\s*{[^}]*display:\s*flex;/s)
	  })

  it("avoids transition all in markdown-adjacent code controls", () => {
    assert.doesNotMatch(blocksSource, /\.code-block-(copy|insert|new-file)[^{]*{[^}]*transition:\s*all\b/s)
  })

  it("styles a compact color-coded quota bar", () => {
    const combined = blocksSource + cssSource + layoutSource
    assert.match(combined, /quota-bar/, "quota bar styles must exist")
    assert.match(combined, /quota-fill/, "quota progress fill must exist")
    assert.match(combined, /quota-bar--warning/, "warning state must be styled")
    assert.match(combined, /quota-bar--critical/, "critical state must be styled")
  })

  // ── Hide-thinking: the body class must fully remove thinking blocks from
  // the rendered layout when the user unchecks "Show thinking". A previous
  // implementation only collapsed the <details> element, which still left
  // the summary chip visible — the source of the user-reported bug.
  it("hide-thinking body class fully removes thinking blocks from layout", () => {
    assert.match(
      componentsSource,
      /body\.hide-thinking\s+\.thinking-block\s*{[^}]*display:\s*none/s,
      "components.css must hide .thinking-block when body has .hide-thinking class",
    )
  })

  // ── Compact tool blocks: tool calls render as ultra-compact single-line
  // rows so a long conversation does not become a wall of large bordered
  // cards. Mirrors the codex-style one-line tool log.
  describe("compact tool blocks (codex-style)", () => {
    it(".tool-call uses a slim left-accent stripe with no heavy card border", () => {
      // Find the .tool-call base rule (the one immediately followed by `{`,
      // not a variant like .tool-call--read).
      const match = blocksSource.match(/\.tool-call\s*{([^}]*)}/s)
      assert.ok(match, ".tool-call base rule must exist")
      const body = match![1]!
      assert.match(body, /border:\s*none/, ".tool-call should drop the heavy 1px border for a flat look")
      assert.match(body, /border-left:/, ".tool-call should keep the left accent stripe for color coding")
    })

    it(".tool-header collapses to a single compact line", () => {
      const match = blocksSource.match(/\.tool-header\s*{([^}]*)}/s)
      assert.ok(match, ".tool-header base rule must exist")
      const body = match![1]!
      // Compact: small min-height (≤ 24px) and tight vertical padding.
      assert.match(
        body,
        /min-height:\s*(?:var\(--size-target-min\)|2[0-4]px)/,
        ".tool-header min-height must be ≤24px (one-line, codex-style)",
      )
    })

    it(".tool-name uses the small (xs) font in compact mode", () => {
      const match = blocksSource.match(/\.tool-name\s*{([^}]*)}/s)
      assert.ok(match, ".tool-name base rule must exist")
      const body = match![1]!
      assert.match(body, /font-size:\s*var\(--text-xs\)/, ".tool-name must use text-xs for tighter rows")
    })
  })
})
