import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: InstanceType<typeof JSDOM>
let document: Document
let promptInput: HTMLTextAreaElement
let sendBtn: HTMLButtonElement
let inputArea: HTMLDivElement
let mentionDropdown: HTMLDivElement
let sentMessages: number
let sentSteers: number
let lastSteerMode: "interrupt" | "queue" | undefined
let savedCount: number

function makeDeps() {
  sentMessages = 0
  sentSteers = 0
  lastSteerMode = undefined
  savedCount = 0
  return {
    els: { promptInput, sendBtn, inputArea, mentionDropdown } as any,
    vscode: { postMessage: () => {}, getState: () => ({}), setState: () => {} },
    stateManager: {
      getState: () => ({ activeSessionId: "s1" } as any),
      getActiveSession: () => ({ id: "s1", isStreaming: false }),
      getAllSessions: () => [{ id: "s1", isStreaming: false }],
      save: () => { savedCount++ },
    },
    attachmentManager: { onPaste: () => {}, getAttachments: () => [], attachImageBlob: () => {} },
    mention: { handleTrigger: () => {}, handleKeydown: () => {} },
    commandsModal: { open: () => {} },
    timers: { setTimeout: (fn: () => void, _ms: number) => fn() },
    sendMessage: () => { sentMessages++ },
    sendSteerPrompt: (mode?: "interrupt" | "queue") => { sentSteers++; lastSteerMode = mode },
    setSteerMode: () => {},
    updateSendButton: () => {},
    createNewTab: () => undefined,
    closeTab: () => {},
    switchTab: () => {},
  } as any
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html>
    <textarea id="prompt-input"></textarea>
    <button id="send-btn"></button>
    <div id="input-area"></div>
    <div id="mention-dropdown" class="hidden"></div>
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
  mentionDropdown = document.getElementById("mention-dropdown") as HTMLDivElement
})

describe("inputHandlers - autoResizeTextarea", () => {
  it("caps height at 160px", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    Object.defineProperty(promptInput, "scrollHeight", { value: 500, configurable: true })
    handlers.autoResizeTextarea()
    assert.equal(promptInput.style.height, "160px")
  })

  it("does nothing when promptInput is missing", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const deps = makeDeps()
    deps.els.promptInput = null as any
    const handlers = createInputHandlers(deps)
    handlers.autoResizeTextarea()
  })
})

describe("inputHandlers - insertTextAtCursor", () => {
  it("advances cursor after inserted text", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    promptInput.value = "hello world"
    promptInput.setSelectionRange(5, 5)
    handlers.insertTextAtCursor("@file:src/main.ts ")
    assert.equal(promptInput.value, "hello@file:src/main.ts  world")
    assert.ok(promptInput.selectionStart !== undefined, "cursor position should be set")
  })

  it("saves state after insertion", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const deps = makeDeps()
    const handlers = createInputHandlers(deps)
    promptInput.value = "test"
    handlers.insertTextAtCursor(" additional")
    assert.ok(savedCount > 0, "stateManager.save should be called")
  })
})

describe("inputHandlers - onInputKeydown", () => {
  it("calls sendMessage on Enter when not streaming", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    handlers.onInputKeydown(event)
    assert.equal(sentMessages, 1, "sendMessage should be called")
    assert.equal(sentSteers, 0, "sendSteerPrompt should NOT be called")
  })

  it("calls sendSteerPrompt on Enter when streaming (no mode override = tab default / Queue)", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const deps = makeDeps()
    deps.stateManager.getActiveSession = () => ({ id: "s1", isStreaming: true })
    const handlers = createInputHandlers(deps)
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    handlers.onInputKeydown(event)
    assert.equal(sentSteers, 1, "sendSteerPrompt should be called")
    assert.equal(sentMessages, 0, "sendMessage should NOT be called")
    assert.equal(lastSteerMode, undefined, "plain Enter must not force a mode (uses the tab's default)")
  })

  it("Cmd/Ctrl+Enter while streaming forces a one-shot Interrupt", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const deps = makeDeps()
    deps.stateManager.getActiveSession = () => ({ id: "s1", isStreaming: true })
    const handlers = createInputHandlers(deps)
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })
    handlers.onInputKeydown(event)
    assert.equal(sentSteers, 1, "sendSteerPrompt should be called")
    assert.equal(lastSteerMode, "interrupt", "Cmd/Ctrl+Enter must force interrupt")
  })

  it("Cmd/Ctrl+Enter when idle just sends (no steer)", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })
    handlers.onInputKeydown(event)
    assert.equal(sentMessages, 1, "idle Cmd/Ctrl+Enter sends")
    assert.equal(sentSteers, 0, "no steer when idle")
  })

  it("no longer treats Ctrl+1/2/3 as steer-mode shortcuts (freed for nothing; modes use Alt+1/2/3)", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    let steerModeSets = 0
    const deps = makeDeps()
    deps.setSteerMode = () => { steerModeSets++ }
    deps.stateManager.getActiveSession = () => ({ id: "s1", isStreaming: true })
    const handlers = createInputHandlers(deps)
    for (const key of ["1", "2", "3"]) {
      handlers.onInputKeydown(new dom.window.KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }))
    }
    assert.equal(steerModeSets, 0, "Ctrl+1/2/3 must not change steer mode anymore")
    assert.equal(sentSteers, 0)
  })

  it("does NOT send on Enter during IME composition (isComposing)", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true })
    handlers.onInputKeydown(event)
    assert.equal(sentMessages, 0, "sendMessage should NOT be called during composition")
    assert.equal(sentSteers, 0, "sendSteerPrompt should NOT be called during composition")
  })

  it("does NOT send on Shift+Enter", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
    handlers.onInputKeydown(event)
    assert.equal(sentMessages, 0, "Shift+Enter should NOT send")
  })

  it("calls sendMessage on Ctrl+Enter", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })
    handlers.onInputKeydown(event)
    assert.equal(sentMessages, 1, "Ctrl+Enter should send")
  })
})

describe("inputHandlers - insertIntoPrompt", () => {
  it("replaces entire input", async () => {
    const { createInputHandlers } = await import("../../src/chat/webview/inputHandlers")
    const handlers = createInputHandlers(makeDeps())
    promptInput.value = "old text"
    handlers.insertIntoPrompt("new text")
    assert.equal(promptInput.value, "new text")
  })
})
