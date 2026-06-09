#!/usr/bin/env node
/**
 * Build → package → reinstall the extension into VS Code *correctly*, with no
 * lingering stale build.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reinstalling a .vsix that has the SAME version string as the one already
 * installed does NOT reliably swap the running code:
 *   1. VS Code's Extension Host keeps the previously-loaded extension code in
 *      memory until the window is reloaded — so you keep seeing the OLD UI even
 *      after a "successful" install.
 *   2. `code --uninstall-extension` marks the old versioned dir obsolete but
 *      does not delete it immediately, so an older `…-<version>` dir can linger
 *      in ~/.vscode/extensions and get loaded again.
 *   3. Stacks of old `opencode-harness-*.vsix` files in the repo make it easy to
 *      `--install-extension` the wrong (older) artifact by accident.
 *
 * This script removes all three traps:
 *   - bumps the patch version by default (so VS Code sees a genuinely new build),
 *   - deletes every old packaged .vsix in the repo,
 *   - uninstalls the extension, builds + packages the new version,
 *   - installs it, then prunes every other versioned extension dir on disk,
 *   - prints the one manual step that cannot be automated: RELOAD THE WINDOW.
 *
 * USAGE
 *   node scripts/reinstall-extension.mjs            # bump patch, full reinstall
 *   node scripts/reinstall-extension.mjs --no-bump  # keep current version (NOT
 *                                                   # recommended — see traps above)
 *   node scripts/reinstall-extension.mjs --code=code-insiders   # target a CLI
 *
 * Exit codes: 0 success; non-zero on any failed step (fail fast).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const repoRoot = process.cwd()
const args = process.argv.slice(2)
const noBump = args.includes("--no-bump")
const codeArg = args.find((a) => a.startsWith("--code="))
const codeCli = codeArg ? codeArg.split("=")[1] : "code"

function run(cmd, cmdArgs, opts = {}) {
  process.stdout.write(`\n$ ${cmd} ${cmdArgs.join(" ")}\n`)
  return execFileSync(cmd, cmdArgs, { cwd: repoRoot, stdio: "inherit", ...opts })
}
function runQuiet(cmd, cmdArgs) {
  try { return execFileSync(cmd, cmdArgs, { cwd: repoRoot, stdio: "pipe" }).toString() }
  catch { return "" }
}
function step(msg) { process.stdout.write(`\n✨ ${msg}\n`) }

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
const id = `${pkg.publisher}.${pkg.name}`

// 1. Bump patch version so VS Code recognizes the build as new (the #1 cause of
//    "it installed but I still see the old UI"). Skippable with --no-bump.
if (!noBump) {
  step(`Bumping version (was ${pkg.version})`)
  run("npm", ["version", "patch", "--no-git-tag-version"])
} else {
  step(`Keeping version ${pkg.version} (--no-bump) — reload may not pick up changes`)
}
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version

// 2. Delete every old packaged artifact so nobody installs a stale one.
step("Deleting old .vsix artifacts")
for (const f of readdirSync(repoRoot)) {
  if (/^.*\.vsix$/.test(f) && f.startsWith(pkg.name)) {
    rmSync(join(repoRoot, f))
    process.stdout.write(`  removed ${f}\n`)
  }
}

// 3. Uninstall the currently-installed extension (best-effort).
step("Uninstalling current extension")
try { run(codeCli, ["--uninstall-extension", id]) }
catch { process.stdout.write(`  (not installed or ${codeCli} unavailable) — continuing\n`) }

// 4. Build + package (vsce runs vscode:prepublish = typecheck + prod build + bundle check).
step("Packaging .vsix (typecheck + prod build + bundle-size check)")
const vsixPath = join("/tmp", `${pkg.name}-${version}.vsix`)
run("npx", ["@vscode/vsce", "package", "--no-dependencies", "--out", vsixPath])
if (!existsSync(vsixPath)) {
  console.error(`✗ expected ${vsixPath} but it was not produced`)
  process.exit(1)
}

// 5. Install the fresh artifact.
step(`Installing ${vsixPath}`)
run(codeCli, ["--install-extension", vsixPath, "--force"])

// 6. Prune EVERY other versioned dir for this extension so an older build can
//    never be loaded again. Looks in the common VS Code extension roots.
step("Pruning stale extension directories")
const extRoots = [
  join(homedir(), ".vscode", "extensions"),
  join(homedir(), ".vscode-insiders", "extensions"),
  join(homedir(), ".vscode-server", "extensions"),
  join(homedir(), ".vscode-oss", "extensions"),
]
const keepDir = `${id}-${version}`
for (const root of extRoots) {
  if (!existsSync(root)) continue
  for (const d of readdirSync(root)) {
    if (d.startsWith(`${id}-`) && d !== keepDir) {
      rmSync(join(root, d), { recursive: true, force: true })
      process.stdout.write(`  pruned ${join(root, d)}\n`)
    }
  }
}

// 7. The one thing this script cannot do for you.
const installed = runQuiet(codeCli, ["--list-extensions", "--show-versions"])
  .split("\n").find((l) => l.startsWith(id)) || "(verify manually)"
step("Done")
process.stdout.write(
  `\nInstalled: ${installed}\n` +
  `\n⚠  RELOAD REQUIRED: the running Extension Host still holds the old code.\n` +
  `   Run “Developer: Reload Window” (Cmd/Ctrl+Shift+P) or restart VS Code.\n`,
)
