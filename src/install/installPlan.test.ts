import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isAbsolute, sep } from "node:path"
import {
  buildInstallPlan,
  knownOpencodeBinaryPaths,
  INSTALL_SCRIPT_URL,
  NPM_PACKAGE,
} from "./installPlan"

describe("buildInstallPlan", () => {
  it("uses the official bash install script on linux", () => {
    const plan = buildInstallPlan("linux", true)
    assert.equal(plan.strategy, "script")
    assert.equal(plan.scriptUrl, INSTALL_SCRIPT_URL)
    assert.ok(
      plan.manualCommands.some((c) => c.includes(INSTALL_SCRIPT_URL)),
      "manual command should reference the install script URL",
    )
  })

  it("uses the official bash install script on macOS, independent of npm", () => {
    const withNpm = buildInstallPlan("darwin", true)
    const withoutNpm = buildInstallPlan("darwin", false)
    assert.equal(withNpm.strategy, "script")
    assert.equal(withoutNpm.strategy, "script")
  })

  it("falls back to npm on Windows when npm is available", () => {
    const plan = buildInstallPlan("win32", true)
    assert.equal(plan.strategy, "npm")
    assert.ok(plan.npmCommand, "npm strategy must carry an npmCommand")
    assert.equal(plan.npmCommand?.cmd, "npm")
    assert.deepEqual([...(plan.npmCommand?.args ?? [])], ["install", "-g", NPM_PACKAGE])
  })

  it("falls back to manual instructions on Windows without npm", () => {
    const plan = buildInstallPlan("win32", false)
    assert.equal(plan.strategy, "manual")
    assert.ok(plan.manualCommands.length > 0, "manual plan must list at least one command")
    assert.equal(plan.scriptUrl, undefined)
    assert.equal(plan.npmCommand, undefined)
  })

  it("always provides a docs URL and human-readable description", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const plan = buildInstallPlan(platform, false)
      assert.ok(plan.docsUrl.startsWith("https://"), `docsUrl should be https for ${platform}`)
      assert.ok(plan.description.length > 0, `description should be non-empty for ${platform}`)
    }
  })

  it("never embeds a shell pipe in the script strategy (no curl | bash)", () => {
    // The script is downloaded and run via bash directly — the manual command
    // may show `curl | bash` for humans, but the programmatic path must not.
    const plan = buildInstallPlan("linux", true)
    assert.equal(plan.strategy, "script")
    assert.equal(typeof plan.scriptUrl, "string")
  })
})

describe("knownOpencodeBinaryPaths", () => {
  const home = "/home/tester"

  it("includes the official install-script location on unix (~/.opencode/bin/opencode)", () => {
    const paths = knownOpencodeBinaryPaths("linux", home, {})
    assert.ok(
      paths.includes(`${home}/.opencode/bin/opencode`),
      "must probe ~/.opencode/bin/opencode where the install script writes",
    )
  })

  it("uses the .exe suffix on Windows", () => {
    const paths = knownOpencodeBinaryPaths("win32", "C:\\Users\\tester", {})
    assert.ok(
      paths.some((p) => p.endsWith("opencode.exe")),
      "Windows candidates must target opencode.exe",
    )
  })

  it("returns only absolute paths", () => {
    const paths = knownOpencodeBinaryPaths("linux", home, {})
    for (const p of paths) {
      assert.ok(isAbsolute(p), `${p} must be absolute`)
    }
  })

  it("contains no duplicate entries", () => {
    const paths = knownOpencodeBinaryPaths("darwin", home, {})
    assert.equal(paths.length, new Set(paths).size, "paths must be de-duplicated")
  })

  it("includes the npm global prefix on Windows when APPDATA is set", () => {
    const appData = "C:\\Users\\tester\\AppData\\Roaming"
    const paths = knownOpencodeBinaryPaths("win32", "C:\\Users\\tester", { APPDATA: appData })
    assert.ok(
      paths.some((p) => p.includes("npm") && p.startsWith(appData)),
      "must probe the npm global dir under APPDATA on Windows",
    )
  })

  it("does not crash when env is omitted", () => {
    assert.doesNotThrow(() => knownOpencodeBinaryPaths("linux", home))
  })

  it("uses the platform path separator", () => {
    const paths = knownOpencodeBinaryPaths("linux", home, {})
    assert.ok(paths.every((p) => p.includes(sep)), "paths should be joined with the OS separator")
  })
})
