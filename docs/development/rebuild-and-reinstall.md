# Rebuilding & Reinstalling the Extension (without a stale build)

If you rebuild the extension and **still see the old UI** — old buttons, an
out-of-date voice/STT message, controls you already consolidated — you have hit
the *stale build* trap. This guide explains why it happens and the one command
that avoids it.

This guide applies to **VS Code** and **VS Code-based editors** such as
[VSCodium](https://vscodium.com), VS Code Insiders, and Code - OSS. The extension
format is the same (`.vsix`); only the CLI name and the extension directory on
disk differ.

## TL;DR

```bash
npm run reinstall      # bump version → clean uninstall → build → install → prune
```

The script auto-detects the first available VS Code-compatible CLI in this order:
`code` → `codium` → `code-oss` → `code-insiders`. If you prefer an explicit
editor, pass `--code=<cli>`:

```bash
npm run reinstall -- --code=codium          # VSCodium
npm run reinstall -- --code=code-insiders    # VS Code Insiders
npm run reinstall -- --code=code             # explicit VS Code
```

Then **reload the window**: `Cmd/Ctrl+Shift+P` → **Developer: Reload Window**
(or fully restart the editor). Nothing you do on disk takes effect in the
running window until this reload.

## ⚠️ FIRST: Dev Host or installed VSIX? (they update by DIFFERENT commands)

**This is the #1 reason "my changes don't show up at all."** There can be two
copies of the extension and you may be editing one while looking at the other.
Check the activation log (`OpenCode Harness extension activating…`) — the file
path in its stack frames tells you which one is actually running:

| Log path contains… | You're running… | To see your changes… |
|---|---|---|
| `…/PersonalProjects/opencode-harness/dist/extension.js` | the **Extension Development Host** (F5 / "Run Extension") — it loads the **workspace `dist/`** | **`npm run build`**, then **reload _that_ `[Extension Development Host]` window** (`Ctrl/Cmd+R` in it). A VSIX reinstall does **NOT** change this window. |
| `~/.vscode/extensions/koarthur.opencode-harness-<ver>/dist/extension.js` | the **installed VSIX** | **`npm run reinstall`**, then **Developer: Reload Window**. |

So:
- **Dev Host** (the common case here): your source → `dist/` via **`npm run build`**;
  the window only picks it up on reload. `npm run reinstall` (VSIX) is irrelevant.
- **Installed VSIX**: use `npm run reinstall` (below).
- If both exist and conflict, disable one (the Dev Host wins while its window is
  open). The VSIX path under `~/.vscode/extensions` and the workspace `dist/` are
  completely separate builds.

## Why a plain reinstall ships a stale build

Three independent traps, all of which `npm run reinstall` handles:

1. **The Extension Host caches loaded code by version.**
   Installing a `.vsix` whose `version` matches the one already installed does
   not reliably replace the running code. VS Code reports "successfully
   installed", but the Extension Host keeps executing the previously-loaded code
   until the window reloads — and may not even prompt to reload for a
   same-version install. **Fix: always bump the version** (`npm version patch`).

2. **Uninstall leaves the old versioned directory on disk.**
   `code --uninstall-extension <id>` adds the old `…-<version>` folder to
   `~/.vscode/extensions/.obsolete` but does **not** delete it right away. Both
   `…-0.3.0` and `…-0.3.1` can sit side by side, and the older one can be loaded.
   **Fix: prune every other `<publisher>.<name>-*` dir** after installing.

3. **Old `.vsix` files pile up in the repo.**
   Every `vsce package` leaves an artifact (`opencode-harness-0.2.11.vsix`,
   `…-0.2.12.vsix`, …). It is easy to `--install-extension` the wrong (older)
   file. **Fix: delete all old `.vsix` before packaging the new one.** They are
   gitignored — never commit them.

## What `npm run reinstall` does

Source: [`scripts/reinstall-extension.mjs`](../../scripts/reinstall-extension.mjs).

1. `npm version patch --no-git-tag-version` — bump (skip with `--no-bump`).
2. Delete every `opencode-harness-*.vsix` in the repo.
3. `<cli> --uninstall-extension koarthur.opencode-harness`.
4. `vsce package --no-dependencies` (runs `vscode:prepublish`: **typecheck +
   production build + bundle-size check** — a failing typecheck blocks the package).
5. `<cli> --install-extension <new>.vsix --force`.
6. Prune every other versioned dir under the detected editor’s extension roots
   (`~/.vscode/extensions/`, `~/.vscode-oss/extensions/`,
   `~/.config/VSCodium/extensions/`, etc.).
7. Print the installed version and the reload reminder.

Flags:
- `--no-bump` — keep the current version (not recommended; reintroduces trap #1).
- `--code=<cli>` — target a specific VS Code-compatible CLI (e.g. `codium`,
  `code-insiders`, `code-oss`). When omitted, the script auto-detects the first
  available binary in the order `code → codium → code-oss → code-insiders`.

## Verifying you are running the new build

Use the CLI that matches your editor:

```bash
# VS Code
code --list-extensions --show-versions | grep opencode
ls ~/.vscode/extensions/koarthur.opencode-harness-*

# VSCodium
codium --list-extensions --show-versions | grep opencode
ls ~/.config/VSCodium/extensions/koarthur.opencode-harness-*
# or, on older VSCodium builds:
ls ~/.vscode-oss/extensions/koarthur.opencode-harness-*
```

In the running window, the version also shows in the Extensions view. If it
still looks old after `npm run reinstall`, you have not reloaded the window yet.

## Workspace `dist/extension.js` vs installed VSIX

If the OpenCode Harness output contains a stack path like:

```text
/home/<you>/PersonalProjects/opencode-harness/dist/extension.js
```

that window is running the **workspace build**, not the installed `.vsix`.
This is expected when VS Code is launched with this repo's debug config:

```json
"--extensionDevelopmentPath=${workspaceFolder}"
```

`--extensionDevelopmentPath` starts an Extension Development Host and loads the
extension from the workspace folder. In that mode, `package.json` points VS Code
at `./dist/extension.js`, so rebuilding the workspace changes what that dev host
will run after reload. Installing a VSIX does not affect that dev-host window.

An installed VSIX should instead load from a versioned install directory, for
example:

```text
~/.vscode/extensions/koarthur.opencode-harness-<version>/dist/extension.js
```

The activation log prints the runtime source explicitly:

```text
OpenCode Harness runtime: id=koarthur.opencode-harness version=... mode=Development|Production path=... main=...
```

Use it as the first diagnostic:
- `mode=Development` and `path=/.../opencode-harness` means the window is a dev
  host using workspace `dist/`.
- `mode=Production` and `path=~/.vscode/extensions/...` means the window is using
  the installed extension.

To test the installed VSIX, run `npm run reinstall`, then open/reload a normal VS
Code window that is **not** the "Run Extension" dev host. To test workspace
source, run the debug config or reload the existing Extension Development Host
after `npm run build` / the watch task rebuilds `dist/`.

## Full reset (nuclear option)

If state is badly confused (multiple installs, partial uninstalls), use the CLI
that matches your editor:

```bash
# VS Code
code --uninstall-extension koarthur.opencode-harness
rm -rf ~/.vscode/extensions/koarthur.opencode-harness-*

# VSCodium
codium --uninstall-extension koarthur.opencode-harness
rm -rf ~/.config/VSCodium/extensions/koarthur.opencode-harness-*
rm -rf ~/.vscode-oss/extensions/koarthur.opencode-harness-*

# Common clean-up
rm -f opencode-harness-*.vsix
npm run reinstall
# then: Developer: Reload Window
```

## For end users (Marketplace / VSIX installs)

- After updating, **reload the window** if the UI looks unchanged.
- A normal Marketplace update always changes the version, so trap #1 does not
  apply — but a window reload is still the fastest way to pick it up.
- To install a specific `.vsix`: Extensions view → `…` menu → *Install from
  VSIX…*, then reload. This works in VS Code, VSCodium, and other
  VS Code-compatible editors that accept the same `.vsix` format.

## Common pitfalls (agents & humans)

- ❌ `vsce package && code --install-extension foo.vsix` with the **same version**
  → stale build. ✅ `npm run reinstall`.
- ❌ Forgetting to reload the window → "my change didn't do anything".
- ❌ Committing `.vsix` files → they are build artifacts; keep them gitignored.
- ❌ Editing `dist/` directly → it is generated; edit `src/` and rebuild.
