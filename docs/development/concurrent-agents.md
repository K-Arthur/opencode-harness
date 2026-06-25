# Running multiple AI agents on this repo without clashes

You run **Claude, Codex, and OpenCode simultaneously** on different parts of
this codebase. When they all edit **one shared working tree**, they clobber each
other: one tool's `git stash`/`reset` (OpenCode's `oc-ckp-*` checkpoints do
this) or two tools writing the same file silently drops the other's work. This
is the root cause of the "my changes were reverted/wiped" reports.

The industry-standard fix — used by the Claude Code, Codex, and Gemini
communities — is **git worktrees: one isolated working directory per agent**,
plus disciplined commits and sequential merges. Sources at the bottom.

---

## The one rule that always holds

> **Committed work survives; uncommitted work is fair game for the next
> reset/stash.** Whatever else you do, *commit completed work before yielding.*
> This is the safety net even inside a shared tree (see AGENTS.md top).

## Best fix: one git worktree per agent

A worktree is a second checked-out directory backed by the **same `.git`** —
separate files and branch, shared history. Edits, stashes, and resets in one
worktree never touch another. This "solves the file-conflict problem
completely" and is "the single most important technique for parallel AI agent
development."

```bash
# from the main checkout (run once per agent/task)
git worktree add ../oh-claude  -b agent/claude      # Claude works here
git worktree add ../oh-codex   -b agent/codex       # Codex works here
git worktree add ../oh-opencode -b agent/opencode   # OpenCode works here

# point each tool/terminal at its own directory, then work normally.
# when a branch is done:
git worktree remove ../oh-codex            # after merging agent/codex
```

- **Claude Code** has first-class support: ask it to "use a worktree", or set
  `isolation: worktree` in a subagent's frontmatter. The `Agent` tool also takes
  `isolation: "worktree"`.
- **Codex / OpenCode**: launch each in its own worktree directory (separate
  terminal or window). OpenCode's checkpointing then only stashes *its own*
  worktree — it can no longer wipe Claude's or Codex's in-flight edits.
- **Untracked files** (`.env`, local config) are **not** shared across worktrees.
  Copy them in, or use Claude Code's `.worktreeinclude` (`.gitignore` syntax —
  copies matching gitignored files into new worktrees).

### Extension-specific caveat
Each worktree builds independently (`npm run build` writes that worktree's
`dist/`), but **only one VS Code install is active at a time**. So:
- Build/test freely in parallel worktrees.
- **Serialize `npm run reinstall`** — whichever worktree you want to *run* in the
  Extension Dev Host installs last, then reload the window. Two agents must not
  `reinstall` at the same moment.

## Task decomposition (avoid clashes before they happen)

- **Split by domain/feature boundary, not by layer.** "Avoid splitting work that
  touches the same files from different directions." Two agents on the same file
  = merge conflicts and wasted work.
- Examples that parallelize cleanly here: webview rendering (`src/chat/webview/*`)
  vs. extension host (`src/chat/*.ts`, `src/session/*`) vs. docs/tests. Give each
  agent a directory it owns for the task.
- Keep each agent's task **genuinely independent**: different files, different
  concerns.

## Merging back

- **Merge sequentially, never simultaneously.** Merge one agent's branch to
  `master` first, then **rebase the others on the updated `master`** so each
  subsequent merge has full context. Resolve conflicts once, in order.
- Review through **`git diff` / PRs / commits — never by `git checkout`/`reset`
  of a shared tree** (that is itself a clobber).

## If you must share one tree (no worktrees)

This is the fragile mode you have been in. Make it survivable:
1. **Commit small and often**; never leave finished work uncommitted.
2. **Re-check state before and after every edit**: `git status` +
   `git log --oneline -5`; `git diff <file>` to confirm your change is still
   there. A file you just edited showing as clean = someone reset the tree →
   recover from `git stash list`.
3. **Stay in your lane**: don't edit files another agent is mid-change on; never
   `git add -A` while others have in-flight work — stage only your files.
4. **Never** run `git stash` / `git reset --hard` / `git checkout -- .` against
   the shared tree.
5. **Test fixes are the first thing dropped.** If you fix a failing test, commit
   it immediately with the same care as a feature fix. The next agent will
   assume the suite is green; an uncommitted fix is the same as a broken suite.

## Practical limits

No hard git limit, but **3–5 parallel agents** is what most people manage — the
real constraints are API rate limits, **shared local services** (if two agents
hit `localhost:4096`/the same DB you get race conditions — give each its own
port/instance), and your own capacity to review the diffs.

## Recovery cheat-sheet (when work "disappears")

```bash
git stash list                      # your edits are almost always here
git stash show -p "stash@{0}"       # inspect the most recent
git checkout "stash@{0}" -- <files> # restore specific files
git reflog                          # see the reset:/commit history
```

---

## Sources

- [Run parallel sessions with worktrees — Claude Code Docs](https://code.claude.com/docs/en/worktrees)
- [johannesjo/parallel-code — run Claude Code, Codex, and Gemini side by side, each in its own git worktree](https://github.com/johannesjo/parallel-code)
- [Git Worktrees for AI Coding Agents: Full Guide — Nimbalyst](https://nimbalyst.com/blog/git-worktrees-for-ai-coding-agents-complete-guide/)
- [Git Worktrees for AI Coding: How to Run Multiple Agents Without Conflicts — MindStudio](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents)
- [Using Git Worktrees for Parallel AI Development — Steve Kinney](https://stevekinney.com/courses/ai-development/git-worktrees)
- [How to Run a Multi-Agent Coding Workspace (2026) — Augment Code](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)
- [How to Run Claude Code Agents in Parallel — Towards Data Science](https://towardsdatascience.com/how-to-run-claude-code-agents-in-parallel/)
