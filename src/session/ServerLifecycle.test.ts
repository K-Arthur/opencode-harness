import { describe, it } from "node:test"
import assert from "node:assert"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "ServerLifecycle.ts"), "utf8")

void describe("ServerLifecycle", () => {
  void describe("start() guards", () => {
    void it("guards concurrent calls via startPromise", () => {
      assert.ok(source.includes("if (this.startPromise) return this.startPromise"), "start() returns existing startPromise")
    })

    void it("returns early if port > 0", () => {
      assert.ok(source.includes("if (this.port > 0) return"), "start() returns early when already running")
    })

    void it("throws if disposed", () => {
      assert.ok(source.includes('if (this.disposed) throw new Error("ServerLifecycle has been disposed")'), "start() throws when disposed")
    })
  })

  void describe("_start() internals", () => {
    void it("calls auth.generatePassword() if no server password", () => {
      assert.ok(source.includes("if (!this.auth.serverPassword)"), "checks serverPassword")
      assert.ok(source.includes("this.auth.generatePassword()"), "calls generatePassword()")
    })

    void it("reuses stored port via health check before spawning new process", () => {
      assert.ok(source.includes("if (this.storedPort)"), "checks storedPort")
      assert.ok(source.includes("http://127.0.0.1:${this.storedPort}/global/health"), "health checks stored port")
    })

    void it("finds free port via findFreePort()", () => {
      assert.ok(source.includes("this.port = await findFreePort()"), "calls findFreePort()")
    })

    void it("finds opencode binary via findOpencodeBinary()", () => {
      assert.ok(source.includes("const opencodePath = await this.findOpencodeBinary()"), "calls findOpencodeBinary()")
    })
  })

  void describe("findOpencodeBinary() known-location fallback", () => {
    void it("falls back to known install dirs when PATH lookup fails", () => {
      assert.ok(source.includes("if (fromPath) return fromPath"), "returns PATH hit first")
      assert.ok(
        source.includes("knownOpencodeBinaryPaths(process.platform, os.homedir(), process.env)"),
        "probes the shared known-locations list",
      )
      assert.ok(source.includes("if (existsSync(candidate))"), "checks candidate existence on disk")
    })

    void it("returns null when neither PATH nor known dirs contain the binary", () => {
      assert.ok(source.includes("return null"), "returns null when nothing is found")
    })

    void it("uses preferExeOnWindows to filter `where` output on Windows", () => {
      assert.ok(source.includes("preferExeOnWindows"), "must use preferExeOnWindows to filter PATH output")
    })

    void it("rejects .cmd/.ps1 custom binary paths on Windows", () => {
      assert.ok(
        source.includes("/\\.(cmd|ps1)$/i.test(customPath)"),
        "must check for .cmd/.ps1 wrapper extensions in custom binaryPath",
      )
    })
  })

  void describe("spawn()", () => {
    void it("uses shell: false", () => {
      assert.ok(source.includes("shell: false"), "spawn disables shell")
    })

    void it("uses allowedEnvVars allowlist", () => {
      assert.ok(source.includes('"PATH", "HOME", "USERPROFILE", "APPDATA"'), "allowedEnvVars includes PATH, HOME, etc.")
    })

    void it("passes OPENCODE_SERVER_PASSWORD in child env", () => {
      assert.ok(source.includes('childEnv["OPENCODE_SERVER_PASSWORD"] = this.auth.serverPassword'), "sets OPENCODE_SERVER_PASSWORD")
    })

    void it("uses --hostname 127.0.0.1 flag", () => {
      assert.ok(source.includes('"--hostname", "127.0.0.1"'), "spawn passes --hostname 127.0.0.1")
    })
  })

  void describe("waitForHealth()", () => {
    void it("polls with AbortController timeout of 2s per attempt, 10s total", () => {
      assert.ok(source.includes("setTimeout(() => controller.abort(), 2_000)"), "2s per-attempt abort timeout")
      assert.ok(source.includes("while (Date.now() - start < timeoutMs)"), "polls within total timeout")
      assert.ok(source.includes("waitForHealth(timeoutMs = 10_000)"), "default 10s total timeout")
    })
  })

  void describe("stop()", () => {
    void it("kills with SIGTERM then SIGKILL after 3s", () => {
      assert.ok(source.includes('proc.kill("SIGTERM")'), "sends SIGTERM first")
      assert.ok(source.includes("setTimeout(() => resolve(false), 3_000)"), "waits 3s")
      assert.ok(source.includes('proc.kill("SIGKILL")'), "sends SIGKILL after timeout")
    })

    void it("clears reconnect timer", () => {
      assert.ok(source.includes("if (this.reconnectTimer)"), "checks reconnectTimer")
      assert.ok(source.includes("clearTimeout(this.reconnectTimer)"), "clears the timer")
      assert.ok(source.includes("this.reconnectTimer = null"), "nulls the timer")
    })

    void it("resets port and reconnectAttempts", () => {
      assert.ok(source.includes("this.port = 0"), "resets port to 0")
      assert.ok(source.includes("this.reconnectAttempts = 0"), "resets reconnectAttempts")
    })
  })

  void describe("dispose()", () => {
    void it("sets disposed flag, disposes event emitters, calls stop()", () => {
      assert.ok(source.includes("if (this.disposed) return"), "guards against double dispose")
      assert.ok(source.includes("this.disposed = true"), "sets disposed flag")
      assert.ok(source.includes("this._onConnected.dispose()"), "disposes onConnected emitter")
      assert.ok(source.includes("this._onDisconnected.dispose()"), "disposes onDisconnected emitter")
      assert.ok(source.includes("this.stop()"), "calls stop()")
    })
  })

  void describe("stored-port zombie detection", () => {
    void it("logs a zombie warning when health check returns healthy=false", () => {
      assert.ok(source.includes("Zombie server detected"), "must log zombie detection warning")
      assert.ok(source.includes("healthy=false"), "must mention healthy=false in the warning")
    })

    void it("logs a zombie warning when health check returns non-200 HTTP status", () => {
      assert.ok(source.includes("health check HTTP"), "must log HTTP status in zombie warning")
    })

    void it("falls through to findFreePort after zombie detection", () => {
      const zombieIdx = source.indexOf("Zombie server detected")
      const freePortIdx = source.indexOf("this.port = await findFreePort()")
      assert.ok(zombieIdx >= 0 && freePortIdx > zombieIdx, "findFreePort must come after zombie detection")
    })
  })

  void describe("scheduleReconnect()", () => {
    void it("does not schedule reconnect after disposal", () => {
      assert.ok(source.includes("if (this.disposed) return"), "bails out when disposed")
    })

    void it("caps at 5 attempts", () => {
      assert.ok(source.includes("this.reconnectAttempts >= 5"), "checks max attempts")
    })

    void it("uses exponential backoff with Math.min(1000 * Math.pow(2, ...), 16000)", () => {
      assert.ok(source.includes("Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16_000)"), "exponential backoff capped at 16s")
    })
  })

  void describe("port management", () => {
    void it("resetPort() sets port to 0", () => {
      assert.ok(source.includes("resetPort()"), "resetPort method exists")
    })

    void it("setStoredPort() stores the port", () => {
      assert.ok(source.includes("setStoredPort(port?: number)"), "setStoredPort method exists")
      assert.ok(source.includes("this.storedPort = port"), "stores the port value")
    })
  })

  void describe("events", () => {
    void it("defines onConnected and onDisconnected events", () => {
      assert.ok(source.includes("readonly onConnected = this._onConnected.event"), "onConnected event")
      assert.ok(source.includes("readonly onDisconnected = this._onDisconnected.event"), "onDisconnected event")
    })

    void it("fires _onDisconnected on process exit", () => {
      assert.ok(source.includes('proc.on("exit"'), "listens for exit event")
      assert.ok(source.includes("this._onDisconnected.fire({ code, signal })"), "fires onDisconnected with code and signal")
    })

    void it("clears stale process and port before reconnecting after an unexpected exit", () => {
      assert.ok(source.includes("const intentional = this.serverProcess !== proc || this.disposed"), "detects intentional stops")
      assert.ok(source.includes("if (this.serverProcess === proc) this.serverProcess = null"), "clears the exited process")
      assert.ok(source.includes("this.port = 0"), "clears stale port so reconnect start does not no-op")
      assert.ok(source.includes("if (!intentional) this.scheduleReconnect(onReady)"), "only reconnects unexpected exits")
    })

    void it("fires _onConnected on successful connection", () => {
      assert.ok(source.includes("this._onConnected.fire({ port: this.port, remote: false })"), "fires onConnected after health check")
    })
  })
})
