import { describe, it } from "node:test"
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "OpencodeInstaller.ts"), "utf8")

void describe("OpencodeInstaller", () => {
  void describe("public surface", () => {
    void it("exports the OpencodeInstaller class", () => {
      assert.ok(source.includes("export class OpencodeInstaller"))
    })

    void it("supports the three autoInstall modes", () => {
      assert.ok(source.includes('"prompt"'), "prompt mode")
      assert.ok(source.includes('"auto"'), "auto mode")
      assert.ok(source.includes('"off"'), "off mode")
    })

    void it("exposes isInstalled, locateBinary, ensureInstalled and install", () => {
      assert.ok(source.includes("async isInstalled("), "isInstalled")
      assert.ok(source.includes("async locateBinary("), "locateBinary")
      assert.ok(source.includes("async ensureInstalled("), "ensureInstalled")
      assert.ok(source.includes("async install("), "install")
    })

    void it("imports the pure planning helpers", () => {
      assert.ok(source.includes('from "./installPlan"'), "imports installPlan")
      assert.ok(source.includes("buildInstallPlan"), "uses buildInstallPlan")
      assert.ok(source.includes("knownOpencodeBinaryPaths"), "uses knownOpencodeBinaryPaths")
    })
  })

  void describe("detection", () => {
    void it("probes known install dirs before PATH", () => {
      assert.ok(source.includes("knownOpencodeBinaryPaths(process.platform"), "uses known paths")
      assert.ok(source.includes("existsSync(candidate)"), "checks existence on disk")
    })
  })

  void describe("ensureInstalled — prompt-once semantics", () => {
    void it("returns early when already installed", () => {
      assert.ok(source.includes("if (await this.isInstalled()) return true"))
    })

    void it("does nothing destructive in 'off' mode", () => {
      assert.ok(source.includes('if (mode === "off")'))
    })

    void it("installs without prompting in 'auto' mode", () => {
      assert.ok(source.includes('if (mode === "auto")'))
      assert.ok(source.includes("return await this.install()"))
    })

    void it("remembers a decline so the user is not nagged each reload", () => {
      assert.ok(source.includes('"opencode-install-declined"'), "declined key constant")
      assert.ok(source.includes("this.globalState.get<boolean>(DECLINED_KEY)"), "reads declined flag")
      assert.ok(source.includes("this.globalState.update(DECLINED_KEY, true)"), "persists decline")
    })

    void it("prompts with Install / Manual / Not Now", () => {
      assert.ok(source.includes("showInformationMessage"), "prompts")
      assert.ok(source.includes('"Install"'), "Install action")
      assert.ok(source.includes('"Manual Instructions"'), "Manual action")
      assert.ok(source.includes('"Not Now"'), "Not Now action")
    })
  })

  void describe("install — progress + security", () => {
    void it("runs behind a progress notification", () => {
      assert.ok(source.includes("vscode.window.withProgress"), "uses withProgress")
      assert.ok(source.includes("ProgressLocation.Notification"), "notification progress")
    })

    void it("downloads the bash script and runs it via bash, not curl | bash", () => {
      assert.ok(source.includes("await fetch("), "downloads via fetch")
      assert.ok(source.includes("writeFile(scriptPath"), "writes script to a temp file")
      assert.ok(source.includes('spawnToCompletion("bash"'), "runs bash on the file")
      assert.ok(!source.includes("| bash"), "must not spawn a curl | bash pipe programmatically")
      assert.ok(!source.includes('"-c"'), "must not run bash -c with a constructed command string")
      assert.ok(!source.includes('spawn("curl'), "must not shell out to curl")
    })

    void it("validates the downloaded script before executing it", () => {
      assert.ok(source.includes('script.toLowerCase().includes("opencode")'), "sanity-checks content")
    })

    void it("removes the temp script afterwards", () => {
      assert.ok(source.includes("unlink(scriptPath)"), "cleans up the temp file")
    })

    void it("writes the temp script with owner-only permissions", () => {
      assert.ok(source.includes("mode: 0o700"), "restrictive file mode")
    })

    void it("restricts the child env to an allowlist (no secret leakage)", () => {
      assert.ok(source.includes("INSTALL_ENV_ALLOWLIST"), "uses an env allowlist")
      assert.ok(source.includes('"PATH"') && source.includes('"HOME"'), "allowlist includes PATH and HOME")
    })

    void it("spawns the bash script with shell:false (no shell injection)", () => {
      assert.ok(source.includes('spawnToCompletion("bash", [scriptPath], false)'), "bash runs with shell:false")
    })

    void it("uses shell:true only for npm on Windows (static args, justified)", () => {
      assert.ok(source.includes('process.platform === "win32"'), "windows-only shell")
    })

    void it("clears the declined flag on a successful install", () => {
      assert.ok(source.includes("this.globalState.update(DECLINED_KEY, false)"))
    })

    void it("surfaces an actionable error with logs + manual fallback on failure", () => {
      assert.ok(source.includes("showErrorMessage"), "shows an error")
      assert.ok(source.includes('"Show Logs"'), "offers logs")
    })
  })

  void describe("manual instructions", () => {
    void it("offers to copy the command and open docs", () => {
      assert.ok(source.includes("clipboard.writeText"), "copies command")
      assert.ok(source.includes("openExternal"), "opens docs")
    })
  })
})
