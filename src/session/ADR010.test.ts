import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const processManagerSource = readFileSync(resolve(__dirname, "LocalSessionProcessManager.ts"), "utf8")
const registrySource = readFileSync(resolve(__dirname, "SessionManagerRegistry.ts"), "utf8")
const interfaceSource = readFileSync(resolve(__dirname, "SessionProcessManager.ts"), "utf8")

describe("ADR-010: Horizontal Scaling", () => {
  describe("SessionProcessManager interface", () => {
    it("defines SessionConfig with port, workspaceRoot, cwd, env", () => {
      assert.ok(interfaceSource.includes("export interface SessionConfig"), "SessionConfig must be exported")
      assert.ok(interfaceSource.includes("port?:"), "SessionConfig must have port field")
      assert.ok(interfaceSource.includes("workspaceRoot?:"), "SessionConfig must have workspaceRoot field")
      assert.ok(interfaceSource.includes("cwd?:"), "SessionConfig must have cwd field")
      assert.ok(interfaceSource.includes("env?:"), "SessionConfig must have env field")
    })

    it("defines SessionProcessHandle with id, status, pid, currentPort, start, stop, restart", () => {
      assert.ok(interfaceSource.includes("export interface SessionProcessHandle"), "SessionProcessHandle must be exported")
      assert.ok(interfaceSource.includes("readonly id: string"), "must have id field")
      assert.ok(interfaceSource.includes('readonly status: "running" | "crashed" | "stopped"'), "must have status field")
      assert.ok(interfaceSource.includes("readonly currentPort:"), "must have currentPort field")
      assert.ok(interfaceSource.includes("start(config: SessionConfig): Promise<void>"), "must have start method")
      assert.ok(interfaceSource.includes("stop(): Promise<void>"), "must have stop method")
      assert.ok(interfaceSource.includes("restart(): Promise<void>"), "must have restart method")
    })

    it("defines SessionProcessManager with spawnSession, killSession, listActive", () => {
      assert.ok(interfaceSource.includes("export interface SessionProcessManager"), "SessionProcessManager must be exported")
      assert.ok(interfaceSource.includes("spawnSession(config: SessionConfig): Promise<SessionProcessHandle>"), "must have spawnSession")
      assert.ok(interfaceSource.includes("killSession(id: string): Promise<void>"), "must have killSession")
      assert.ok(interfaceSource.includes("listActive(): SessionProcessHandle[]"), "must have listActive")
    })
  })

  describe("LocalSessionProcessManager", () => {
    it("implements SessionProcessManager", () => {
      assert.ok(
        processManagerSource.includes("class LocalSessionProcessManager implements SessionProcessManager"),
        "must implement SessionProcessManager"
      )
    })

    it("uses PortPool for port allocation", () => {
      assert.ok(processManagerSource.includes("new PortPool("), "must create a PortPool")
      assert.ok(processManagerSource.includes("portPool.reserve()"), "must reserve ports from pool")
      assert.ok(processManagerSource.includes("portPool.release("), "must release ports on stop")
    })

    it("spawns opencode serve with port argument", () => {
      assert.ok(
        processManagerSource.includes('"serve"') || processManagerSource.includes("'serve'"),
        "must spawn opencode serve"
      )
      assert.ok(
        processManagerSource.includes("--port"),
        "must pass --port argument"
      )
    })

    it("tracks process status (running/crashed/stopped)", () => {
      assert.ok(processManagerSource.includes('"running"'), "must track running status")
      assert.ok(processManagerSource.includes('"crashed"'), "must track crashed status")
      assert.ok(processManagerSource.includes('"stopped"'), "must track stopped status")
    })

    it("emits crash events via onSessionCrash", () => {
      assert.ok(processManagerSource.includes("onSessionCrash"), "must have onSessionCrash event")
      assert.ok(processManagerSource.includes("_onSessionCrash"), "must have internal crash emitter")
    })

    it("implements stop with SIGTERM then SIGKILL fallback", () => {
      assert.ok(processManagerSource.includes("SIGTERM"), "must send SIGTERM first")
      assert.ok(processManagerSource.includes("SIGKILL"), "must fall back to SIGKILL")
    })

    it("implements restart as stop + start", () => {
      assert.ok(processManagerSource.includes("async restart()"), "must have restart method")
      assert.ok(processManagerSource.includes("await this.stop()"), "restart must stop first")
    })

    it("implements dispose to clean up all processes", () => {
      assert.ok(processManagerSource.includes("dispose()"), "must have dispose method")
      assert.ok(processManagerSource.includes("processes.clear()"), "must clear processes map")
    })

    it("generates unique process IDs", () => {
      assert.ok(processManagerSource.includes('`proc-'), "must generate proc- prefixed IDs")
    })

    it("releases port on error before start resolves (no port leak)", () => {
      const errBlock = processManagerSource.slice(
        processManagerSource.indexOf('child.on("error"'),
        processManagerSource.indexOf('\n      child.on("exit"')
      )
      assert.ok(
        errBlock.includes("this.portPool.release(this.port)"),
        "error handler must release the reserved port to prevent leaks"
      )
    })

    it("rejects start promise on premature exit before readiness", () => {
      const exitBlock = processManagerSource.slice(
        processManagerSource.indexOf('child.on("exit"'),
        processManagerSource.indexOf("\n    })")
      )
      assert.ok(
        exitBlock.includes("clearTimeout(startupTimeout)"),
        "exit handler must clear the startup timeout"
      )
      assert.ok(
        exitBlock.includes("reject(new Error") && exitBlock.includes("exited prematurely"),
        "exit handler must reject start promise with premature exit error"
      )
    })
  })

  describe("SessionManagerRegistry", () => {
    it("reads processStrategy from config", () => {
      assert.ok(
        registrySource.includes('processStrategy'),
        "must read processStrategy config"
      )
      assert.ok(
        registrySource.includes('"shared"'),
        "must support shared strategy"
      )
      assert.ok(
        registrySource.includes('"per-tab"'),
        "must support per-tab strategy"
      )
    })

    it("returns default manager for shared strategy", () => {
      assert.ok(
        registrySource.includes('strategy === "shared"'),
        "shared strategy must return default manager"
      )
      assert.ok(registrySource.includes("getDefault()"), "must have getDefault method")
    })

    it("routes tabs to processes via assignTab/unassignTab", () => {
      assert.ok(registrySource.includes("async assignTab("), "must have assignTab method")
      assert.ok(registrySource.includes("unassignTab("), "must have unassignTab method")
      assert.ok(registrySource.includes("tabToProcess"), "must track tab→process mapping")
    })

    it("tracks managed processes and tab counts", () => {
      assert.ok(registrySource.includes("managed = new Map"), "must track managed processes")
      assert.ok(registrySource.includes("getProcessForTab("), "must expose process lookup")
      assert.ok(registrySource.includes("getTabCount("), "must expose tab count per process")
    })

    it("registers processes via registerProcess method", () => {
      assert.ok(
        registrySource.includes("registerProcess(processId: string, manager: SessionManager): void"),
        "must have registerProcess method"
      )
      assert.ok(
        registrySource.includes("this.managed.set(processId,"),
        "registerProcess must add to managed map"
      )
      assert.ok(
        registrySource.includes("_onProcessRegistered.fire(processId)"),
        "registerProcess must fire onProcessRegistered event"
      )
    })

    it("implements vscode.Disposable", () => {
      assert.ok(
        registrySource.includes("implements vscode.Disposable") || registrySource.includes("Disposable"),
        "must implement Disposable"
      )
    })

    it("has spawnAndRegisterSession method for per-tab process creation", () => {
      assert.ok(
        registrySource.includes("async spawnAndRegisterSession("),
        "must have spawnAndRegisterSession method"
      )
      assert.ok(
        registrySource.includes("this.processManager.spawnSession(config)"),
        "spawnAndRegisterSession must delegate to processManager.spawnSession"
      )
      assert.ok(
        registrySource.includes("this.registerProcess(processId, sm)"),
        "spawnAndRegisterSession must auto-register the new session manager"
      )
      assert.ok(
        registrySource.includes("sm.serverLifecycle.setStoredPort(handle.currentPort)"),
        "spawnAndRegisterSession must connect to the spawned process via storedPort"
      )
      assert.ok(
        registrySource.includes("await sm.start()"),
        "spawnAndRegisterSession must start the new session manager"
      )
      assert.ok(
        registrySource.includes('strategy !== "per-tab"') || registrySource.includes('strategy === "per-tab"'),
        "spawnAndRegisterSession must guard on per-tab strategy"
      )
    })

    it("spawnAndRegisterSession optionally auto-assigns tabs", () => {
      assert.ok(
        registrySource.includes("if (tabId)"),
        "spawnAndRegisterSession must auto-assign tab when tabId is provided"
      )
      assert.ok(
        registrySource.includes("await this.assignTab(tabId, processId)"),
        "spawnAndRegisterSession must call assignTab when tabId is provided"
      )
    })

    it("imports SessionConfig type for spawnAndRegisterSession signature", () => {
      assert.ok(
        registrySource.includes("SessionConfig") || interfaceSource.includes("SessionConfig"),
        "must reference SessionConfig type"
      )
    })
  })

  describe("package.json configuration", () => {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf8")) as {
      contributes?: { configuration?: { properties?: Record<string, unknown> } }
    }
    const props = packageJson.contributes?.configuration?.properties ?? {}

    it("defines opencode.sessions.processStrategy setting", () => {
      assert.ok("opencode.sessions.processStrategy" in props, "processStrategy setting must exist")
      const setting = props["opencode.sessions.processStrategy"] as { type?: string; default?: string; enum?: string[] }
      assert.equal(setting.type, "string", "must be string type")
      assert.equal(setting.default, "shared", "default must be shared")
      assert.deepStrictEqual(setting.enum, ["shared", "per-tab"], "must have shared and per-tab options")
    })
  })
})
