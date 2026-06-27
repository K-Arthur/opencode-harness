# CSS Regression Prevention

## Why CSS regressions happen in this repo

The workspace runs an **ephemeral working-tree process** (opencode `oc-ckp-*`
checkpoints and other agent harnesses) that periodically does
`git stash` / `git reset → HEAD`. This discards every uncommitted change in
the working tree. See [`AGENTS.md`](../../AGENTS.md) §"READ FIRST" for the
full rules.

CSS changes are the **most vulnerable** to this loss because:

1. **Visual tests don't catch missing CSS rules.** The Playwright visual tests
   assert DOM structure and text content, not computed styles. A renderer can
   emit a class that has no CSS rule, and every test passes — the regression is
   only visible to a human looking at the UI.
2. **CSS is often written in a separate session** from the renderer code, and
   if either side is uncommitted when the checkpoint fires, the link between
   renderer class and CSS rule is broken.
3. **Multiple agents** editing concurrently can clobber each other's CSS via
   `git stash`/`reset`, even when following the coordination protocol.

## Recovery path

If styling "reverted" or CSS classes are missing:

```bash
# 1. Check if work was stashed by the checkpoint process
git stash list

# 2. See what files were in the most recent stash
git stash show --name-only "stash@{0}"

# 3. See the full diff of the stash
git stash show -p "stash@{0}" | head -100

# 4. Restore specific CSS files from the stash
git checkout "stash@{0}" -- src/chat/webview/css/components.css src/chat/webview/css/blocks.css

# 5. Or apply the entire stash (creates uncommitted changes in working tree)
git stash apply
```

## Prevention path

### 1. Commit CSS changes immediately

**Never leave CSS changes uncommitted.** Write the CSS, verify it, commit it —
in the same commit as the renderer changes that use it. The ephemeral tree can
fire at any time between your edits.

### 2. Run the CSS coverage test before committing

```bash
npx tsx --test src/chat/webview/css/cssCoverage.test.ts
```

This structural test reads all CSS files and asserts that every class emitted
by `subagentCard.ts`, `fileEditCard.ts`, and the subagent panel renderer has
at least one matching CSS rule. It catches the exact failure mode that caused
the subagent tool card regression.

### 3. Use the automated guards

- **`scripts/detect-wiped-work.mjs`** — Detects if uncommitted work was wiped
  by the checkpoint process. Outputs JSON with stash contents and recovery
  commands. Run after any unexpected "revert."

- **`scripts/check-workspace-state.mjs`** — Session-start check that combines
  wipe detection + CSS coverage. Run at the start of any session to catch
  regressions before you start working.

- **`.opencode/hooks/pre-commit-css-coverage.sh`** — Pre-commit hook that
  blocks commits introducing renderer classes without CSS rules. Only runs
  when CSS or renderer files are staged.

### 4. Strengthen visual tests with computed-style assertions

When adding or restoring CSS for a component, add a computed-style assertion
to the corresponding visual test. For example:

```typescript
test('running item has accent left border', async ({ page }) => {
  const item = page.locator('.subagent-item--running')
  const borderLeft = await item.evaluate(el => window.getComputedStyle(el).borderLeftWidth)
  expect(parseFloat(borderLeft)).toBeGreaterThan(0)
})
```

This ensures future CSS losses are caught by the visual test suite, not just
the structural CSS coverage test.

## Cross-references

- [`AGENTS.md`](../../AGENTS.md) — §"READ FIRST" (ephemeral tree rules),
  §"Multiple agents editing at once" (coordination protocol)
- [`docs/development/concurrent-agents.md`](concurrent-agents.md) — Worktree
  recipes for isolated agent work
- [`docs/development/rebuild-and-reinstall.md`](rebuild-and-reinstall.md) —
  Correct rebuild/reinstall flow (`npm run reinstall`)
