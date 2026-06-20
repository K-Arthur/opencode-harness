/**
 * TDD tests for the terminal panel module (audit §14.1/§14.2).
 *
 * The terminal panel surfaces live PTY sessions from the opencode SDK PTY API.
 * These tests enforce the contract: the module must export setupTerminalPanel,
 * fold PTY lifecycle events + byte chunks via the pure ptyReducer, gate visibility
 * on the terminal_capability message, wire all control messages (connect/cancel/
 * send_input/resize/list), render exit codes + runtime + Cancel, and stay hidden
 * when PTY is unsupported (graceful degradation).
 *
 * Pattern: structural (read source as string) — matches the existing webview
 * module tests (main.test.ts, WebviewEventRouter.questionAnswer.test.ts).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "terminal-panel.ts"), "utf8")
const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const htmlSource = readFileSync(path.join(__dirname, "index.html"), "utf8")
const domSource = readFileSync(path.join(__dirname, "dom.ts"), "utf8")
const routerSource = readFileSync(path.join(__dirname, "..", "WebviewEventRouter.ts"), "utf8")
const providerSource = readFileSync(path.join(__dirname, "..", "ChatProvider.ts"), "utf8")
const sessionTypesSource = readFileSync(path.join(__dirname, "..", "..", "session", "sessionTypes.ts"), "utf8")

describe("terminal-panel.ts — module contract", () => {
  it("exports setupTerminalPanel returning a TerminalPanelApi", () => {
    assert.ok(source.includes("export function setupTerminalPanel("),
      "must export setupTerminalPanel")
    assert.ok(source.includes("export interface TerminalPanelApi"),
      "must declare the TerminalPanelApi interface")
  })

  it("folds PTY state via the pure ptyReducer (no bespoke domain logic)", () => {
    assert.ok(source.includes('from "../../terminal/ptyModel"'),
      "must import ptyReducer from the pure ptyModel module")
    assert.ok(source.includes("ptyReducer(state,"),
      "must fold events through ptyReducer rather than mutating state directly")
  })

  it("API exposes capability gating + lifecycle + output + control", () => {
    const required = [
      "setCapability",
      "setSessions",
      "applyLifecycleEvent",
      "appendOutput",
      "markConnected",
      "markCancelled",
      "showError",
      "open",
      "close",
      "toggle",
      "isOpen",
      "dispose",
    ]
    for (const m of required) {
      assert.ok(source.includes(`${m}:`), `TerminalPanelApi must expose ${m}`)
    }
  })

  it("handles all 4 PTY lifecycle event types", () => {
    assert.ok(source.includes('"pty_created"'), "must handle pty_created")
    assert.ok(source.includes('"pty_updated"'), "must handle pty_updated")
    assert.ok(source.includes('"pty_exited"'), "must handle pty_exited")
    assert.ok(source.includes('"pty_deleted"'), "must handle pty_deleted")
  })

  it("renders exit code, runtime, and a Cancel button for running PTYs", () => {
    assert.ok(source.includes("exitCode"), "must render exit code")
    assert.ok(source.includes("formatRuntime"), "must render runtime")
    assert.ok(source.includes("terminal-card-cancel"), "must render a Cancel button")
    assert.ok(source.includes('type: "pty_cancel"'),
      "Cancel button must post pty_cancel")
  })

  it("caps rendered output to avoid unbounded DOM growth", () => {
    assert.ok(source.includes("slice(-"),
      "must cap output rendering with slice(-N)")
  })

  it("stays hidden when capability is false (graceful degradation)", () => {
    assert.ok(source.includes("ptySupported === false") || source.includes("!supported"),
      "setCapability must hide the panel when PTY is unsupported")
    assert.ok(source.includes('classList.add("hidden")') || source.includes('classList.remove("hidden")'),
      "must toggle the hidden class")
  })
})

describe("PTY vertical — host wiring contract", () => {
  it("sessionTypes.ts declares pty.* event types", () => {
    assert.ok(sessionTypesSource.includes('"pty.created"'), "sessionTypes must declare pty.created")
    assert.ok(sessionTypesSource.includes('"pty.updated"'), "sessionTypes must declare pty.updated")
    assert.ok(sessionTypesSource.includes('"pty.exited"'), "sessionTypes must declare pty.exited")
    assert.ok(sessionTypesSource.includes('"pty.deleted"'), "sessionTypes must declare pty.deleted")
  })

  it("ChatProvider forwards pty.* lifecycle events to the webview", () => {
    assert.ok(providerSource.includes('"pty.created"'),
      "ChatProvider must handle pty.created")
    assert.ok(providerSource.includes('"pty.updated"'),
      "ChatProvider must handle pty.updated")
    assert.ok(providerSource.includes('"pty.exited"'),
      "ChatProvider must handle pty.exited")
    assert.ok(providerSource.includes('"pty.deleted"'),
      "ChatProvider must handle pty.deleted")
    assert.ok(providerSource.includes("type: \"pty_created\""),
      "must post pty_created to the webview")
    assert.ok(providerSource.includes("type: \"pty_updated\""),
      "must post pty_updated to the webview")
    assert.ok(providerSource.includes("type: \"pty_exited\""),
      "must post pty_exited to the webview")
    assert.ok(providerSource.includes("type: \"pty_deleted\""),
      "must post pty_deleted to the webview")
  })

  it("ChatProvider probes PTY capability and advertises it", () => {
    assert.ok(providerSource.includes("pushTerminalCapabilityToWebview"),
      "must have pushTerminalCapabilityToWebview")
    assert.ok(providerSource.includes("ptyService.listSessions"),
      "must probe via ptyService.listSessions")
    assert.ok(providerSource.includes("type: \"terminal_capability\""),
      "must post terminal_capability to the webview")
    assert.ok(providerSource.includes("type: \"pty_sessions\""),
      "must post pty_sessions for hydration")
  })

  it("WebviewEventRouter handles all 5 PTY control messages", () => {
    assert.ok(routerSource.includes('"pty_connect"'), "must handle pty_connect")
    assert.ok(routerSource.includes('"pty_cancel"'), "must handle pty_cancel")
    assert.ok(routerSource.includes('"pty_send_input"'), "must handle pty_send_input")
    assert.ok(routerSource.includes('"pty_resize"'), "must handle pty_resize")
    assert.ok(routerSource.includes('"pty_list"'), "must handle pty_list")
  })

  it("WebviewEventRouter streams pty_output from the WebSocket", () => {
    assert.ok(routerSource.includes("type: \"pty_output\""),
      "pty_connect must post pty_output chunks")
    assert.ok(routerSource.includes("type: \"pty_connected\""),
      "must post pty_connected on WebSocket open")
    assert.ok(routerSource.includes("type: \"pty_error\""),
      "must post pty_error on failure")
  })
})

describe("PTY vertical — webview wiring contract", () => {
  it("wires up the terminal panel via the extracted todoSubagentSetup module", () => {
    // The panel construction was extracted out of main.ts into
    // todoSubagentSetup.ts (setupTodoSubagentPanelsImpl). main.ts still owns the
    // terminalPanelApi handle and feeds it the PTY host messages; the actual
    // setupTerminalPanel() call now lives in the extracted module.
    const setupSource = readFileSync(path.join(__dirname, "todoSubagentSetup.ts"), "utf8")
    assert.ok(setupSource.includes('from "./terminal-panel"'),
      "todoSubagentSetup must import the terminal panel module")
    assert.ok(setupSource.includes("setupTerminalPanel("),
      "todoSubagentSetup must call setupTerminalPanel")
    assert.ok(mainSource.includes("let terminalPanelApi"),
      "main.ts must declare terminalPanelApi")
    assert.ok(mainSource.includes("terminalPanelApi = apis.terminalPanelApi"),
      "main.ts must receive terminalPanelApi from the extracted setup")
  })

  it("main.ts handles all PTY host messages", () => {
    const required = [
      '"terminal_capability"',
      '"pty_sessions"',
      '"pty_created"',
      '"pty_updated"',
      '"pty_exited"',
      '"pty_deleted"',
      '"pty_output"',
      '"pty_connected"',
      '"pty_cancelled"',
      '"pty_error"',
    ]
    for (const t of required) {
      assert.ok(mainSource.includes(t), `main.ts must handle ${t}`)
    }
  })

  it("wires the terminal toggle button in todoSubagentSetup", () => {
    const setupSource = readFileSync(path.join(__dirname, "todoSubagentSetup.ts"), "utf8")
    assert.ok(setupSource.includes("terminalToggleBtn.addEventListener"),
      "todoSubagentSetup must wire the terminal toggle button click")
  })

  it("index.html has the terminal panel + toggle button", () => {
    assert.ok(htmlSource.includes('id="terminal-panel"'),
      "index.html must have the terminal-panel element")
    assert.ok(htmlSource.includes('id="terminal-list"'),
      "index.html must have the terminal-list element")
    assert.ok(htmlSource.includes('id="terminal-close-btn"'),
      "index.html must have the terminal-close-btn element")
    assert.ok(htmlSource.includes('id="terminal-toggle-btn"'),
      "index.html must have the terminal-toggle-btn element")
  })

  it("dom.ts declares the terminal panel element refs", () => {
    assert.ok(domSource.includes("terminalToggleBtn"), "dom.ts must declare terminalToggleBtn")
    assert.ok(domSource.includes("terminalPanel"), "dom.ts must declare terminalPanel")
    assert.ok(domSource.includes("terminalList"), "dom.ts must declare terminalList")
    assert.ok(domSource.includes("terminalCloseBtn"), "dom.ts must declare terminalCloseBtn")
  })
})
