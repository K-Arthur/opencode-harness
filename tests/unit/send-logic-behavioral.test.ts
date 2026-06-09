import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: InstanceType<typeof JSDOM>
let document: Document
let promptInput: HTMLTextAreaElement
let sendBtn: HTMLButtonElement
let inputArea: HTMLDivElement
let tabPanels: HTMLDivElement
let posted: Array<Record<string, unknown>>
let messagesAdded: Array<{ sessionId: string; msg: any }>
let errorsReported: Array<{ sessionId: string; msg: string }>
let agentStatus: string

function makeEls() {
  return { promptInput, sendBtn, inputArea, tabPanels } as any
}

function makeState(overrides?: {
  activeSession?: { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string } | null
  sessions?: Array<{ id: string; isStreaming: boolean; name?: string; model?: string }>
}) {
  const active = overrides?.activeSession ?? { id: "s1", isStreaming: false, name: "Test Session" }
  const sessions = overrides?.sessions ?? [active]
  const sessionsMap: Record<string, any> = {}
  for (const s of sessions) { sessionsMap[s.id] = s }
  return {
    getState: () => ({ activeSessionId: active?.id, globalModel: "claude-3", sessions: sessionsMap, globalVariant: undefined } as any),
    getActiveSession: () => active,
    getSession: (id: string) => sessions.find((s) => s.id === id) as any,
    getAllSessions: () => sessions,
    setStreaming: () => {},
  }
}

function makeDeps(overrides?: { state?: ReturnType<typeof makeState> }) {
  const state = overrides?.state ?? makeState()
  posted = []
  messagesAdded = []
  errorsReported = []
  agentStatus = ""
  return {
    els: makeEls(),
    stateManager: state,
    vscode: { postMessage: (msg: Record<string, unknown>) => { posted.push(msg) } },
    attachmentManager: { getAttachments: () => [], clearAttachments: () => {} },
    streamHandlers: { get: () => ({ showTypingIndicator: () => {} }) },
    modelDropdown: { getCurrentModel: () => "claude-3" },
    hideWelcomeView: () => {},
    handleRequestError: (sessionId: string, msg: string) => { errorsReported.push({ sessionId, msg }) },
    addMessage: (sessionId: string, msg: any) => { messagesAdded.push({ sessionId, msg }) },
    updateTabBar: () => {},
    switchTab: () => {},
    switchToTab: () => {},
    createTabUI: () => {},
    createNewTab: (name?: string) => ({ id: "new-tab", name: name || "New Chat" }),
    updateAgentStatus: (status: string) => { agentStatus = status },
    updateModeSelectorState: () => {},
    renderAttachmentChips: () => {},
    autoResizeTextarea: () => {},
    runSlashCommandText: () => {},
    openModelManager: () => {},
    STREAM_LIMIT_TOOLTIP: "Stream limit reached",
  } as any
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html>
    <textarea id="prompt-input"></textarea>
    <button id="send-btn"></button>
    <div id="input-area"></div>
    <div id="tab-panels"></div>
  `)
  document = dom.window.document
  ;(globalThis as any).document = document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement
  ;(globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement
  ;(globalThis as any).requestAnimationFrame = (fn: Function) => { fn(); return 0 }
  ;(globalThis as any).cancelAnimationFrame = () => {}
  promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement
  sendBtn = document.getElementById("send-btn") as HTMLButtonElement
  inputArea = document.getElementById("input-area") as HTMLDivElement
  tabPanels = document.getElementById("tab-panels") as HTMLDivElement
})

describe("sendLogic - basic send", () => {
  it("clears input, adds message, and posts send_prompt", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const deps = makeDeps()
    const logic = createSendLogic(deps)
    promptInput.value = "Hello world"
    logic.sendMessage()
    assert.equal(promptInput.value, "")
    assert.equal(messagesAdded.length, 1)
    assert.equal(messagesAdded[0]!.msg.role, "user")
    assert.equal(messagesAdded[0]!.msg.blocks[0]!.text, "Hello world")
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "send_prompt")
    assert.equal(posted[0]!.text, "Hello world")
  })

  it("does nothing when input is empty", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps())
    promptInput.value = ""
    logic.sendMessage()
    assert.equal(messagesAdded.length, 0)
    assert.equal(posted.length, 0)
  })

  it("creates a new tab when no active session", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const state = makeState({ activeSession: null, sessions: [] })
    const logic = createSendLogic(makeDeps({ state }))
    promptInput.value = "Start conversation"
    logic.sendMessage()
    assert.equal(messagesAdded.length, 1)
  })
})

describe("sendLogic - streaming", () => {
  it("sends steer prompt when streaming", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const active = { id: "s1", isStreaming: true, name: "Test" }
    const logic = createSendLogic(makeDeps({ state: makeState({ activeSession: active, sessions: [active] }) }))
    promptInput.value = "Steer this"
    logic.sendMessage()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "send_steer_prompt")
    assert.equal(posted[0]!.text, "Steer this")
  })

  it("aborts stream when streaming and no text", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const active = { id: "s1", isStreaming: true, name: "Test" }
    const logic = createSendLogic(makeDeps({ state: makeState({ activeSession: active, sessions: [active] }) }))
    promptInput.value = ""
    logic.sendMessage()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "abort")
    assert.equal(agentStatus, "idle")
  })
})

describe("sendLogic - stream capacity", () => {
  it("blocks send when capacity is full", async () => {
    const { createSendLogic, setMaxConcurrentStreams } = await import("../../src/chat/webview/sendLogic")
    setMaxConcurrentStreams(2) // 3 streaming sessions will exceed this
    const sessions = [
      { id: "s1", isStreaming: true, name: "S1" },
      { id: "s2", isStreaming: true, name: "S2" },
      { id: "s3", isStreaming: true, name: "S3" },
    ]
    const active = { id: "s4", isStreaming: false, name: "New" }
    const logic = createSendLogic(makeDeps({ state: makeState({ activeSession: active, sessions: [...sessions, active] }) }))
    promptInput.value = "Should not send"
    logic.sendMessage()
    assert.equal(messagesAdded.length, 0)
    assert.equal(errorsReported.length, 1)
    assert.match(errorsReported[0]!.msg, /Concurrent stream limit|Stream limit/)
  })
})

describe("sendLogic - model validation", () => {
  it("blocks send when no model and has active session", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    let modelManagerOpened = 0
    const deps = makeDeps()
    deps.modelDropdown.getCurrentModel = () => undefined
    deps.stateManager.getState = () => ({ activeSessionId: "s1", globalModel: undefined }) as any
    deps.openModelManager = () => { modelManagerOpened++ }
    const logic = createSendLogic(deps)
    promptInput.value = "No model"
    logic.sendMessage()
    assert.equal(messagesAdded.length, 0, "should not add message when no model")
    assert.equal(modelManagerOpened, 1, "should open model manager")
    assert.equal(promptInput.value, "No model", "must preserve prompt text when no model")
  })

  it("opens model picker when no model and no active session (welcome screen)", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    let modelManagerOpened = 0
    const deps = makeDeps({ state: makeState({ activeSession: null, sessions: [] }) })
    deps.modelDropdown.getCurrentModel = () => undefined
    deps.stateManager.getState = () => ({ activeSessionId: undefined, globalModel: undefined }) as any
    deps.openModelManager = () => { modelManagerOpened++ }
    const logic = createSendLogic(deps)
    promptInput.value = "No model on welcome"
    logic.sendMessage()
    // Must NOT add message or clear textarea
    assert.equal(messagesAdded.length, 0, "should not add message when no model")
    assert.equal(modelManagerOpened, 1, "should open model manager")
    assert.equal(promptInput.value, "No model on welcome", "must preserve prompt text")
  })
})

describe("sendLogic - sendSteerPrompt", () => {
  it("sends send_steer_prompt and clears input", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const active = { id: "s1", isStreaming: true, name: "Test" }
    const logic = createSendLogic(makeDeps({ state: makeState({ activeSession: active, sessions: [active] }) }))
    promptInput.value = "Steer direction"
    logic.sendSteerPrompt()
    assert.equal(promptInput.value, "")
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "send_steer_prompt")
  })

  it("does nothing when no active session", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps({ state: makeState({ activeSession: null, sessions: [] }) }))
    
    logic.sendSteerPrompt()
    assert.equal(posted.length, 0, "no message when no active session")
  })
})

describe("sendLogic - setSteerMode", () => {
  it("updates CSS classes", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps())
    logic.setSteerMode("append")
    assert.ok(inputArea.classList.contains("steer-append"))
  })
})

describe("sendLogic - updateSendButton", () => {
  it("disables when empty", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps())
    promptInput.value = ""
    logic.updateSendButton()
    assert.equal(sendBtn.disabled, true)
  })

  it("enables when has text", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps())
    promptInput.value = "Some text"
    logic.updateSendButton()
    assert.equal(sendBtn.disabled, false)
  })

  it("enables when streaming for abort", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const active = { id: "s1", isStreaming: true, name: "Test" }
    const logic = createSendLogic(makeDeps({ state: makeState({ activeSession: active, sessions: [active] }) }))
    promptInput.value = ""
    logic.updateSendButton()
    assert.equal(sendBtn.disabled, false)
  })
})

describe("sendLogic - generateTitle", () => {
  it("truncates long text", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps())
    const title = logic.generateTitle("This is a long sentence that should be truncated at forty characters.")
    assert.ok(title.length <= 40)
    assert.ok(title.endsWith("..."))
  })

  it("returns empty for blank", async () => {
    const { createSendLogic } = await import("../../src/chat/webview/sendLogic")
    const logic = createSendLogic(makeDeps())
    assert.equal(logic.generateTitle(""), "")
    assert.equal(logic.generateTitle("   "), "")
  })
})
