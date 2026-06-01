# ADR: Auto-Install the opencode CLI on Activation

**Status:** Accepted
**Date:** 2026-05-31
**Authors:** Claude (Opus 4.8)

## Context

The extension is a **client** to the opencode server (ADR-001), which it spawns
locally via `opencode serve` (ADR-005). The `opencode` CLI is therefore a hard
runtime requirement — without it, the server never starts and every feature is
dead. Until now the only handling of a missing binary was:

- `ServerLifecycle.findOpencodeBinary()` looked for `opencode` **only** via the
  configured `opencode.binaryPath` or a `which`/`where` PATH lookup.
- When it returned `null`, `_start()` threw, and the activation auto-start
  swallowed the error into a single `log.warn`. The user saw a silent
  "Not connected" status bar with no actionable next step.

Two problems followed from this:

1. **No install path.** A first-time user who installs the extension from the
   Marketplace has no opencode binary and no in-product way to get one.
2. **False negatives even when installed.** The official installer writes to
   `~/.opencode/bin` and appends that directory to the user's shell rc files.
   The *already-running* extension host does not re-read those rc files, so a
   GUI-launched VS Code (Dock/Start menu) frequently has a perfectly good
   binary at `~/.opencode/bin/opencode` that is invisible to a PATH-only lookup.

VS Code has **no install-time hook** — extension code first runs on
*activation*, not when the user clicks "Install". So "install opencode when the
extension is installed" can only be realized as "detect-and-install on first
activation."

## Decision

Add a first-class install path that runs during activation, gated by a new
`opencode.autoInstall` setting (default **`prompt`**).

### 1. Pure planning core — `src/install/installPlan.ts`

A `vscode`-free module (so it is covered by real behavioral tests, not just
source-string assertions) exposing:

- `buildInstallPlan(platform, hasNpm)` → the per-platform strategy:
  - **macOS / Linux** → `script`: the official bash installer
    (`https://opencode.ai/install`), which lands the binary in `~/.opencode/bin`
    with no sudo.
  - **Windows** → `npm` (`npm i -g opencode-ai`) when npm is present, else
    `manual` (there is no official bash/PowerShell installer for Windows).
- `knownOpencodeBinaryPaths(platform, homedir, env)` → the single source of
  truth for non-PATH locations to probe (chiefly `~/.opencode/bin/opencode`,
  plus common npm-global / Homebrew dirs).

### 2. Orchestrator — `src/install/OpencodeInstaller.ts`

Owns the VS Code surface (notifications, progress, spawning):

- `ensureInstalled(mode)` — activation entry point. Returns early if a binary is
  already locatable. In `prompt` mode it asks **once** (Install / Manual
  Instructions / Not Now); a decline is persisted to `globalState`
  (`opencode-install-declined`) so the user is not nagged on every reload.
  `auto` installs silently; `off` does nothing but log.
- `install()` — runs behind a `withProgress` notification and, on success,
  clears the declined flag.
- `locateBinary()` — probes `knownOpencodeBinaryPaths` **before** PATH.

### 3. Detection fix — `ServerLifecycle.findOpencodeBinary()`

After the existing PATH lookup fails, fall back to `knownOpencodeBinaryPaths`
and return the first path that exists on disk. This fixes the false-negative
case independently of whether auto-install ever runs.

### 4. Activation wiring & escape hatches

- `extension.ts` replaces the bare `sessionManager.start()` with
  `ensureOpencodeAndStart()`, which checks/installs the CLI first (skipped in
  remote-attach mode, which needs no local binary) and only then starts.
- A new `opencode-harness.installCli` command ("OpenCode: Install CLI") lets the
  user trigger the install on demand and starts the server on success.

### Security posture

- The bash installer is **downloaded via `fetch`, written to a `0o700` temp
  file, content-validated, and executed as `bash <file>` with `shell: false`** —
  no `curl | bash` pipe is ever spawned, and curl need not be present.
- Spawned install processes inherit an explicit env **allowlist** (the same one
  `ServerLifecycle` uses), so no unexpected secrets leak to the script or npm.
- `shell: true` is used **only** for npm on Windows (where `npm` resolves to
  `npm.cmd`); its arguments are fully static, so there is no injection surface.

## Alternatives Considered

1. **Silent auto-install by default.** Rejected as the default: silently running
   a remote install script surprises users and can trip antivirus / Marketplace
   trust expectations. It remains available opt-in via `autoInstall: "auto"`.
2. **Bundle per-platform binaries in the `.vsix`.** Rejected: the opencode binary
   is ~145 MB; bundling balloons the package, requires rebuilding on every
   opencode release, and duplicates the official distribution.
3. **npm global install on all platforms.** Rejected for macOS/Linux: it depends
   on a global npm prefix that is often not writable without sudo, whereas the
   official script installs to `~/.opencode/bin` cleanly. npm is used on Windows
   only, where no official script exists.
4. **Only show a docs link / button (no programmatic install).** Rejected as the
   default because it leaves the core requirement unmet for new users; this
   behavior is preserved as `autoInstall: "off"` for conservative environments.

## Consequences

**Positive**

- New users get a working extension with one click; the hard CLI dependency is
  no longer a silent dead end.
- The `~/.opencode/bin` detection fix resolves a class of "installed but not
  detected" reports for GUI-launched editors, regardless of auto-install.
- Planning logic is pure and unit-tested; the platform matrix is explicit.

**Negative / trade-offs**

- The extension now executes a downloaded shell script on consent — mitigated by
  download-validate-run with `shell: false`, an env allowlist, and a one-time
  prompt the user must accept.
- Windows relies on npm; users without npm get manual instructions rather than a
  one-click install.
- A new machine-scoped setting (`opencode.autoInstall`) and a new command widen
  the configuration surface.

## References

- ADR-001 — Client-Server architecture (extension is a client to opencode)
- ADR-005 — Auto-start server on activation with port management
- `src/install/installPlan.ts`, `src/install/OpencodeInstaller.ts`
- `src/session/ServerLifecycle.ts` (`findOpencodeBinary` fallback)
- `src/extension.ts` (`ensureOpencodeAndStart`), `src/commands/misc.ts`
- opencode install script: `https://opencode.ai/install` (→ `~/.opencode/bin`)
