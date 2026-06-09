import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const layoutSource = readFileSync(path.join(__dirname, "css", "layout.css"), "utf8")
const accessibilitySource = readFileSync(path.join(__dirname, "css", "accessibility.css"), "utf8")

describe("composer input focus ring", () => {
  it("shows a single ring — the composer textarea has no inner outline of its own", () => {
    // The #input-area container draws the focus affordance. accessibility.css's
    // generic `textarea:focus-visible { outline: 2px … }` would otherwise paint a
    // SECOND ring inside the textarea on keyboard focus (the reported double ring).
    // Because accessibility is the last cascade layer, the suppression MUST live
    // here (ID specificity beats the type selector within the same layer).
    assert.match(
      accessibilitySource,
      /#prompt-input:focus-visible\s*{[^}]*outline:\s*none;?[^}]*}/s,
      "accessibility.css must suppress #prompt-input's own focus-visible outline so the composer shows one ring, not two",
    )
  })

  it("scopes the composer 'active' ring to the textarea, not every toolbar button", () => {
    // :has(#prompt-input:focus) means the big container ring only appears while
    // the prompt textarea is focused. Tabbing to the mode/model/send buttons then
    // shows just that button's own ring — never the container ring AND a button
    // ring at the same time.
    assert.match(
      layoutSource,
      /#input-area:has\(#prompt-input:focus\)\s*{[^}]*box-shadow:/s,
      "#input-area focus ring should be scoped via :has(#prompt-input:focus)",
    )
    assert.doesNotMatch(
      layoutSource,
      /#input-area:focus-within\s*{/,
      "bare #input-area:focus-within lights up the container for any descendant focus (toolbar buttons) — should be scoped to the textarea",
    )
  })

  it("keeps exactly one definition of the mode-dropdown focus ring", () => {
    const matches = layoutSource.match(/\.mode-dropdown-btn:focus-visible\s*{/g) ?? []
    assert.equal(
      matches.length,
      1,
      "duplicate/conflicting .mode-dropdown-btn:focus-visible rules cause an inconsistent ring vs sibling toolbar buttons",
    )
  })
})
