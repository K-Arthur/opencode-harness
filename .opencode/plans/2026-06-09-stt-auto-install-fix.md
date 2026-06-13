# STT Auto-Install Fix — Multi-Platform Coverage & Robustness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the STT auto-install flow so "Run Setup" works on Arch/CachyOS and all other platforms where `pip`/`pip3` isn't on PATH but `python3 -m pip` is, and add missing package managers + cache invalidation so setup actually detects newly-installed tools.

**Architecture:** Extend the existing pure-decision module (`voiceSetup.ts`) with `python3 -m pip` and `uv` fallbacks for pip detection, add missing package managers (winget, apk, nix-env, dnf5), add `existsCache` invalidation to `voiceCapture.ts`, and update `ChatProvider.ts` to pass the extended probe. The webview flow is unchanged — we just ensure it gets a non-null `command` field so the "Run Setup" button appears.

**Tech Stack:** TypeScript, Node.js child_process, VS Code extension API

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/chat/voiceSetup.ts` | Add `python3 -m pip` / `uv` fallback, missing package managers, platform-aware manual hints |
| Modify | `src/chat/voiceSetup.test.ts` | Tests for all new paths |
| Modify | `src/chat/voiceCapture.ts` | Export `invalidateExistsCache()` so setup can re-probe after install |
| Modify | `src/chat/ChatProvider.ts` | Pass extended probe including `python3 -m pip` detection, call cache invalidation |

---

## Issue Summary

1. **Primary bug:** On Arch/CachyOS, `pip`/`pip3` aren't on PATH, but `python3 -m pip` works. `pickPipCommand` returns `null`, so `buildVoiceSetupPlan` generates a manual-only step. User sees "Copy Instructions" instead of "Run Setup".
2. **Missing pip fallbacks:** No `python3 -m pip`, no `uv` (increasingly popular Python package manager).
3. **Missing package managers:** `winget` (Windows), `apk` (Alpine), `dnf5` (Fedora 41+), `nix-env` (NixOS).
4. **Stale `existsCache`:** `commandExists()` caches results for the entire VS Code session. After "Run Setup" installs tools, re-probing still returns stale `false`.
5. **Generic Linux manual hint:** The fallback manual hint says `apt-get` regardless of distro.

---

### Task 1: Extend pip detection with `python3 -m pip` and `uv` fallbacks

**Files:**
- Modify: `src/chat/voiceSetup.ts:13-20,37-41`
- Modify: `src/chat/voiceSetup.test.ts:5-13`

The `VoiceToolProbe` interface gets a new optional field `pipViaPython` for `python3 -m pip` detection. The `pickPipCommand` function gets a second parameter accepting this field. The `buildVoiceSetupPlan` function uses the extended probe.

- [ ] **Step 1: Write the failing tests**

Add to `src/chat/voiceSetup.test.ts` after line 13 (inside the `voiceSetup pip detection` describe block):

```typescript
  void it("falls back to python3 -m pip when pip/pip3 are absent", () => {
    assert.equal(pickPipCommand(none, true), "python3 -m pip")
    assert.equal(pickPipCommand(none, false), null)
  })
  void it("prefers pip3 over python3 -m pip", () => {
    assert.equal(pickPipCommand(has("pip3"), true), "pip3")
  })
  void it("prefers pip over python3 -m pip", () => {
    assert.equal(pickPipCommand(has("pip"), true), "pip")
  })
  void it("supports uv as a fallback after python3 -m pip", () => {
    assert.equal(pickPipCommand(none, false, true), "uv pip install --system")
  })
  void it("prefers pip3 over uv", () => {
    assert.equal(pickPipCommand(has("pip3"), true, true), "pip3")
  })
  void it("prefers python3 -m pip over uv", () => {
    assert.equal(pickPipCommand(none, true, true), "python3 -m pip")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/chat/voiceSetup.test.ts`
Expected: FAIL — `pickPipCommand` doesn't accept second/third parameters.

- [ ] **Step 3: Implement the extended `pickPipCommand`**

Replace the `pickPipCommand` function in `src/chat/voiceSetup.ts` (lines 36-41):

```typescript
/**
 * Resolve the best available pip command for installing Python packages.
 * Priority: pip3 > pip > python3 -m pip > uv.
 * Returns null when none is available.
 */
export function pickPipCommand(
  exists: (bin: string) => boolean,
  pipViaPython?: boolean,
  hasUv?: boolean,
): string | null {
  if (exists("pip3")) return "pip3"
  if (exists("pip")) return "pip"
  if (pipViaPython) return "python3 -m pip"
  if (hasUv) return "uv pip install --system"
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/chat/voiceSetup.test.ts`
Expected: All pip detection tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/voiceSetup.ts src/chat/voiceSetup.test.ts
git commit -m "feat(voice): extend pip detection with python3 -m pip and uv fallbacks"
```

---

### Task 2: Add missing package managers for recorder install

**Files:**
- Modify: `src/chat/voiceSetup.ts:48-69`
- Modify: `src/chat/voiceSetup.test.ts:21-30`

- [ ] **Step 1: Write the failing tests**

Replace the Linux test in `src/chat/voiceSetup.test.ts` (lines 21-24) and add new tests:

```typescript
  void it("uses the available Linux package manager", () => {
    assert.equal(recorderInstallCommand("linux", has("apt-get"))?.command, "sudo apt-get install -y sox")
    assert.equal(recorderInstallCommand("linux", has("dnf"))?.command, "sudo dnf install -y sox")
    assert.equal(recorderInstallCommand("linux", has("dnf5"))?.command, "sudo dnf5 install -y sox")
    assert.equal(recorderInstallCommand("linux", has("pacman"))?.command, "sudo pacman -S --noconfirm sox")
    assert.equal(recorderInstallCommand("linux", has("zypper"))?.command, "sudo zypper install -y sox")
    assert.equal(recorderInstallCommand("linux", has("apk"))?.command, "sudo apk add sox")
    assert.equal(recorderInstallCommand("linux", has("nix-env"))?.command, "nix-env -iA nixpkgs.sox")
    assert.equal(recorderInstallCommand("linux", none), null)
  })
  void it("prefers dnf over dnf5 when both exist", () => {
    const hasBoth = has("dnf", "dnf5")
    assert.equal(recorderInstallCommand("linux", hasBoth)?.manager, "dnf")
  })
  void it("uses winget on Windows", () => {
    assert.equal(recorderInstallCommand("win32", has("winget"))?.manager, "winget")
    assert.equal(recorderInstallCommand("win32", has("winget"))?.command, "winget install sox --accept-source-agreements")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/chat/voiceSetup.test.ts`
Expected: FAIL — `dnf5`, `apk`, `nix-env`, `winget` not handled.

- [ ] **Step 3: Implement missing package managers**

Replace `recorderInstallCommand` in `src/chat/voiceSetup.ts` (lines 43-69):

```typescript
/**
 * Choose a recorder (sox) install command for the platform using whatever
 * package manager is available. Returns null when none is detected (the user
 * gets manual guidance instead).
 */
export function recorderInstallCommand(
  platform: NodeJS.Platform | string,
  exists: (bin: string) => boolean,
): { manager: string; command: string } | null {
  if (platform === "darwin") {
    if (exists("brew")) return { manager: "Homebrew", command: "brew install sox" }
    return null
  }
  if (platform === "linux") {
    if (exists("apt-get")) return { manager: "apt", command: "sudo apt-get install -y sox" }
    if (exists("dnf")) return { manager: "dnf", command: "sudo dnf install -y sox" }
    if (exists("dnf5")) return { manager: "dnf5", command: "sudo dnf5 install -y sox" }
    if (exists("pacman")) return { manager: "pacman", command: "sudo pacman -S --noconfirm sox" }
    if (exists("zypper")) return { manager: "zypper", command: "sudo zypper install -y sox" }
    if (exists("apk")) return { manager: "apk", command: "sudo apk add sox" }
    if (exists("nix-env")) return { manager: "Nix", command: "nix-env -iA nixpkgs.sox" }
    return null
  }
  if (platform === "win32") {
    if (exists("winget")) return { manager: "winget", command: "winget install sox --accept-source-agreements" }
    if (exists("choco")) return { manager: "Chocolatey", command: "choco install sox -y" }
    if (exists("scoop")) return { manager: "Scoop", command: "scoop install sox" }
    return null
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/chat/voiceSetup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/voiceSetup.ts src/chat/voiceSetup.test.ts
git commit -m "feat(voice): add winget, apk, dnf5, nix-env package manager support"
```

---

### Task 3: Improve platform-aware manual hints

**Files:**
- Modify: `src/chat/voiceSetup.ts:71-75`
- Modify: `src/chat/voiceSetup.test.ts` (add test for hints)

The manual hint for Linux currently always says `apt-get`. Make it mention the detected package manager or give a more generic fallback.

- [ ] **Step 1: Improve `manualRecorderHint` to be platform-aware**

Replace `manualRecorderHint` in `src/chat/voiceSetup.ts` (lines 71-75):

```typescript
function manualRecorderHint(platform: NodeJS.Platform | string): string {
  if (platform === "darwin") return "Install sox: `brew install sox` (install Homebrew from https://brew.sh first)."
  if (platform === "win32") return "Install sox via winget (`winget install sox`), Chocolatey (`choco install sox`), or download from https://sourceforge.net/projects/sox/."
  if (platform === "linux") return "Install sox with your package manager (e.g. `sudo apt-get install sox`, `sudo pacman -S sox`, or `sudo dnf install sox`)."
  return "Install sox with your system's package manager, or download it from https://sourceforge.net/projects/sox/."
}
```

- [ ] **Step 2: Add tests for manual hints**

Add a new describe block at the end of `src/chat/voiceSetup.test.ts`:

```typescript
void describe("voiceSetup manual hints", () => {
  void it("gives platform-specific linux hint for unknown package manager", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true }),
      "linux",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.match(recorder?.manual || "", /pacman|dnf|apt/)
  })
  void it("gives winget hint on windows without package manager", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true }),
      "win32",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.match(recorder?.manual || "", /winget/)
  })
  void it("gives generic hint for unknown platforms", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasEngine: true }),
      "freebsd",
    )
    const recorder = plan.steps.find((s) => s.kind === "recorder")
    assert.match(recorder?.manual || "", /package manager/)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `node --test src/chat/voiceSetup.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/chat/voiceSetup.ts src/chat/voiceSetup.test.ts
git commit -m "fix(voice): improve manual recorder hints for all platforms"
```

---

### Task 4: Export `invalidateExistsCache` from `voiceCapture.ts`

**Files:**
- Modify: `src/chat/voiceCapture.ts:128`

The `existsCache` is module-level and never cleared. After "Run Setup" installs tools, re-probing returns stale results. Export a cache invalidation function.

- [ ] **Step 1: Add the export**

After the `existsCache` declaration (line 128), add:

```typescript
/** Clear the binary-exists cache so next probe re-checks PATH. */
export function invalidateExistsCache(): void {
  existsCache.clear()
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/chat/voiceCapture.ts
git commit -m "feat(voice): export invalidateExistsCache for post-setup re-probe"
```

---

### Task 5: Wire extended probe into `ChatProvider.setupVoiceInput()`

**Files:**
- Modify: `src/chat/ChatProvider.ts:654-714`

This is the critical integration task. The `setupVoiceInput` method must:
1. Detect `python3 -m pip` availability (run `python3 -m pip --version` synchronously)
2. Detect `uv` availability via `commandExists`
3. Pass both to `pickPipCommand`
4. Call `invalidateExistsCache()` before probing (so it picks up tools installed since last check)
5. Show a post-setup message telling user to reload window

- [ ] **Step 1: Add `invalidateExistsCache` import**

In the import block from `./voiceCapture`, add `invalidateExistsCache` to the named imports.

- [ ] **Step 2: Add a helper to detect `python3 -m pip` availability**

Check if `spawnSync` is already imported at the top of ChatProvider.ts. If not, add it to the `child_process` import. Then add a private helper method to `ChatProvider`:

```typescript
  private detectPipViaPython(): boolean {
    try {
      const result = spawnSync("python3", ["-m", "pip", "--version"], {
        stdio: "ignore",
        timeout: 5000,
      })
      return result.status === 0
    } catch {
      return false
    }
  }
```

- [ ] **Step 3: Rewrite `setupVoiceInput()` to use the extended probe**

Replace the `setupVoiceInput` method body (ChatProvider.ts lines ~654-714):

```typescript
  async setupVoiceInput(): Promise<void> {
    invalidateExistsCache()
    const captureConfig = this.getVoiceCaptureConfig()
    const recorderPlan = selectRecorderPlan(captureConfig, process.platform, commandExists)
    const transcriberPlan = selectTranscriberPlan(captureConfig, commandExists)
    const pipViaPython = this.detectPipViaPython()
    const hasUv = commandExists("uv")
    const setupPlan = buildVoiceSetupPlan({
      hasRecorder: recorderPlan !== null,
      hasEngine: transcriberPlan !== null,
      pip: pickPipCommand(commandExists, pipViaPython, hasUv),
      recorderInstall: recorderInstallCommand(process.platform, commandExists),
    }, process.platform)

    this.voiceInputService.postSettings()

    if (setupPlan.ready) {
      const recorder = recorderPlan ? describeRecorderPlan(recorderPlan) : "recorder"
      const transcriber = transcriberPlan ? describeTranscriberPlan(transcriberPlan) : "speech-to-text engine"
      void vscode.window.showInformationMessage(`Voice input is ready: ${recorder} + ${transcriber}.`)
      return
    }

    const runnable = setupPlan.steps
      .map((step) => step.command)
      .filter((command): command is string => Boolean(command))
    const instructions = setupPlan.steps
      .map((step) => step.command ? `${step.label}\n${step.command}` : `${step.label}\n${step.manual ?? ""}`)
      .join("\n\n")
    const setupActions = runnable.length > 0
      ? ["Run Setup", "Copy Instructions", "Open Voice Settings"]
      : ["Copy Instructions", "Open Voice Settings"]
    const action = await vscode.window.showWarningMessage(
      "Local voice input needs a recorder and speech-to-text engine before the microphone button can transcribe.",
      ...setupActions,
    )

    if (action === "Run Setup" && runnable.length > 0) {
      const terminal = vscode.window.createTerminal("OpenCode Voice Setup")
      terminal.show()
      for (const command of runnable) {
        terminal.sendText(command)
      }
      void vscode.window.showInformationMessage(
        "Voice setup commands sent to the terminal. Once installation completes, reload the window (Developer: Reload Window) to activate voice input.",
      )
      return
    }
    if (action === "Copy Instructions") {
      await vscode.env.clipboard.writeText(instructions)
      void vscode.window.showInformationMessage("Voice setup instructions copied.")
      return
    }
    if (action === "Open Voice Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "opencode.voice")
    }
  }
```

Key changes from the original:
1. `invalidateExistsCache()` at the top — fresh probe
2. `pickPipCommand(commandExists, pipViaPython, hasUv)` — uses extended detection
3. After "Run Setup", shows a message telling user to reload window (so cache is truly fresh)
4. Uses `void` prefix for fire-and-forget message calls (fixes potential unhandled promise warning)

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/chat/ChatProvider.ts
git commit -m "feat(voice): wire python3 -m pip and uv detection into setup flow"
```

---

### Task 6: Fix `uv` command template in `buildVoiceSetupPlan`

**Files:**
- Modify: `src/chat/voiceSetup.ts:84-90`
- Modify: `src/chat/voiceSetup.test.ts`

The issue: `pickPipCommand` returns `"uv pip install --system"` for uv, but `buildVoiceSetupPlan` does `` `${probe.pip} install -U openai-whisper` `` which would produce `"uv pip install --system install -U openai-whisper"`.

- [ ] **Step 1: Fix the engine command template**

Replace lines 84-90 in `src/chat/voiceSetup.ts`:

```typescript
  if (!probe.hasEngine) {
    if (probe.pip) {
      const isUv = probe.pip.startsWith("uv")
      steps.push({
        kind: "engine",
        label: "Install the local speech-to-text engine (openai-whisper)",
        command: isUv
          ? `${probe.pip} openai-whisper`
          : `${probe.pip} install -U openai-whisper`,
      })
    } else {
```

- [ ] **Step 2: Add plan tests for pip fallbacks**

Inside the `voiceSetup plan` describe block, add:

```typescript
  void it("offers a runnable engine install when only python3 -m pip is available", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasRecorder: true, pip: "python3 -m pip" }),
      "linux",
    )
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.command, "python3 -m pip install -U openai-whisper")
  })

  void it("offers a runnable engine install when only uv is available", () => {
    const plan = buildVoiceSetupPlan(
      probe({ hasRecorder: true, pip: "uv pip install --system" }),
      "linux",
    )
    const engine = plan.steps.find((s) => s.kind === "engine")
    assert.equal(engine?.command, "uv pip install --system openai-whisper")
  })
```

- [ ] **Step 3: Run all tests**

Run: `node --test src/chat/voiceSetup.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/chat/voiceSetup.ts src/chat/voiceSetup.test.ts
git commit -m "fix(voice): handle uv command format in engine install template"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run all unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Run ESLint**

Run: `npx eslint src/chat/voiceSetup.ts src/chat/voiceCapture.ts src/chat/ChatProvider.ts`
Expected: PASS (no new warnings).

- [ ] **Step 5: Final commit if any lint fixes needed**

```bash
git add -A
git commit -m "chore: lint fixes from STT auto-install changes"
```

---

## Self-Review

### Spec Coverage
| Issue | Task |
|-------|------|
| `python3 -m pip` not detected (YOUR BUG) | Task 1 + Task 5 |
| `uv` not detected | Task 1 + Task 5 |
| Missing `winget` (Windows) | Task 2 |
| Missing `apk`, `dnf5`, `nix-env` (Linux) | Task 2 |
| Stale `existsCache` after install | Task 4 + Task 5 |
| Generic manual hints | Task 3 |
| `uv` command template produces wrong command | Task 6 |

### Placeholder Scan
No TBDs, TODOs, or "implement later" patterns. Every step has exact code.

### Type Consistency
- `pickPipCommand` returns `string | null` — same as before, new params are optional booleans
- `VoiceToolProbe.pip` is still `string | null` — the caller (`ChatProvider`) sets it from `pickPipCommand`
- `invalidateExistsCache` is `void` — no return type conflicts
- `detectPipViaPython` returns `boolean` — used as `pipViaPython` param to `pickPipCommand`

### Known Limitations (not in scope)
1. **Windows `python -m pip`**: Only `python3` is checked. On Windows, the binary is typically `python.exe`. Could be a follow-up.
2. **Pipx**: Not added — pipx is for isolated app installs. openai-whisper needs regular pip.
3. **`main` binary false positive** in transcriber detection: Low risk, requires explicit `model` setting.
4. **Windows SIGINT** for recorder flush: Separate platform bug requiring architecture changes.
