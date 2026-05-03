const vscode = acquireVsCodeApi()

const state = {
  messages: [],
  currentMode: "normal",
  isStreaming: false,
  streamBuffer: "",
  streamMessageId: null,
}

const messageList = document.getElementById("message-list")
const promptInput = document.getElementById("prompt-input")
const sendBtn = document.getElementById("send-btn")
const abortBtn = document.getElementById("abort-btn")
const modeButtons = document.querySelectorAll(".mode-btn")
const mentionDropdown = document.getElementById("mention-dropdown")

// Mode selector
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach((b) => b.classList.remove("active"))
    btn.classList.add("active")
    state.currentMode = btn.dataset.mode
    vscode.postMessage({ type: "change_mode", mode: state.currentMode })
  })
})

// Send on Enter (Shift+Enter for newline)
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

sendBtn.addEventListener("click", sendMessage)
abortBtn.addEventListener("click", () => vscode.postMessage({ type: "abort" }))

document.getElementById("new-session-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "new_session" })
})

document.getElementById("session-history-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "list_sessions" })
})

// @-mention autocomplete
promptInput.addEventListener("input", () => {
  const val = promptInput.value
  const cursorPos = promptInput.selectionStart
  const textBeforeCursor = val.slice(0, cursorPos)
  const atMatch = textBeforeCursor.match(/@(\S*)$/)
  if (atMatch) {
    mentionDropdown.classList.remove("hidden")
    vscode.postMessage({ type: "mention_search", query: atMatch[1] })
  } else {
    mentionDropdown.classList.add("hidden")
  }
})

promptInput.addEventListener("keydown", (e) => {
  if (mentionDropdown.classList.contains("hidden")) return
  const items = mentionDropdown.querySelectorAll(".dropdown-item")
  let selectedIdx = -1
  items.forEach((item, i) => { if (item.classList.contains("selected")) selectedIdx = i })
  if (e.key === "ArrowDown") {
    e.preventDefault()
    items.forEach((i) => i.classList.remove("selected"))
    items[(selectedIdx + 1) % items.length]?.classList.add("selected")
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    items.forEach((i) => i.classList.remove("selected"))
    const prev = selectedIdx <= 0 ? items.length - 1 : selectedIdx - 1
    items[prev]?.classList.add("selected")
  } else if (e.key === "Enter" && selectedIdx >= 0) {
    e.preventDefault()
    items[selectedIdx]?.click()
  } else if (e.key === "Escape") {
    mentionDropdown.classList.add("hidden")
  }
})

function sendMessage() {
  const text = promptInput.value.trim()
  if (!text || state.isStreaming) return
  promptInput.value = ""
  addMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
  state.isStreaming = true
  sendBtn.classList.add("hidden")
  abortBtn.classList.remove("hidden")
  vscode.postMessage({ type: "send_prompt", text })
}

function addMessage(msg) {
  state.messages.push(msg)
  const el = renderMessage(msg)
  messageList.appendChild(el)
  messageList.scrollTop = messageList.scrollHeight
}

function renderMessage(msg) {
  const div = document.createElement("div")
  div.className = `message ${msg.role}`
  if (msg.id) div.dataset.messageId = msg.id

  const ts = document.createElement("div")
  ts.className = "timestamp"
  ts.textContent = new Date(msg.timestamp).toLocaleTimeString()
  div.appendChild(ts)

  const content = msg.content
  if (typeof content === "string") {
    const p = document.createElement("div")
    p.textContent = content
    div.appendChild(p)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      const child = renderBlock(block)
      if (child) div.appendChild(child)
    }
  }
  return div
}

function renderBlock(block) {
  if (!block || !block.type) return null
  switch (block.type) {
    case "text": {
      const p = document.createElement("div")
      p.textContent = block.text || ""
      return p
    }
    case "tool_card": {
      const card = document.createElement("div")
      card.className = `tool-card tool-${block.toolType || "read"}`
      card.innerHTML = `
        <div class="tool-header">
          <span class="tool-icon">${block.toolType === "write" ? "\u270F" : block.toolType === "exec" ? "\u25B6" : "\uD83D\uDCD6"}</span>
          <span class="tool-name">${block.toolName || ""}</span>
          <span class="tool-args">${block.args || ""}</span>
        </div>
        <div class="tool-result">${block.result || ""}</div>`
      card.querySelector(".tool-header").addEventListener("click", () => card.classList.toggle("expanded"))
      return card
    }
    case "skill_card": {
      const card = document.createElement("div")
      card.className = "skill-card"
      card.textContent = `\u2699 skill:${block.skillName || ""} ${block.description || ""}`
      return card
    }
    case "diff_block": {
      const wrapper = document.createElement("div")
      wrapper.className = "diff-block"
      wrapper.innerHTML = `
        <div class="diff-header">${block.filePath || ""}</div>
        <div class="diff-content">${block.diffText || ""}</div>
        <div class="diff-actions">
          <button onclick="window.handleAccept('${block.messageId || ""}','${block.id || ""}')">Accept All</button>
          <button onclick="window.handleReject('${block.messageId || ""}','${block.id || ""}')">Reject</button>
        </div>`
      return wrapper
    }
    case "thinking": {
      const div = document.createElement("div")
      div.className = "thinking-block"
      const text = block.text || ""
      div.textContent = text.length > 200 ? text.slice(0, 200) + "..." : text
      div.addEventListener("click", () => {
        div.classList.toggle("expanded")
        div.textContent = div.classList.contains("expanded") ? text : text.slice(0, 200) + "..."
      })
      return div
    }
    default:
      return null
  }
}

window.handleAccept = (messageId, blockId) => {
  vscode.postMessage({ type: "accept_diff", messageId, blockId })
}

window.handleReject = (messageId, blockId) => {
  vscode.postMessage({ type: "reject_diff", messageId, blockId })
}

// Handle messages from extension host
window.addEventListener("message", (event) => {
  const msg = event.data
  switch (msg.type) {
    case "message":
      addMessage(msg.message)
      break
    case "stream_chunk":
      handleStreamChunk(msg)
      break
    case "stream_end":
      state.isStreaming = false
      state.streamBuffer = ""
      state.streamMessageId = null
      sendBtn.classList.remove("hidden")
      abortBtn.classList.add("hidden")
      break
    case "mention_results":
      renderMentionResults(msg.items || [])
      break
    case "session_list":
      if (msg.sessions) showSessionPicker(msg.sessions)
      break
  }
})

function handleStreamChunk(msg) {
  if (!state.streamMessageId) {
    state.streamMessageId = msg.messageId
    addMessage({ role: "assistant", id: msg.messageId, content: [], timestamp: Date.now() })
  }
  const el = messageList.querySelector(`[data-message-id="${msg.messageId}"]`)
  if (el) el.textContent = state.streamBuffer += (msg.text || "")
  messageList.scrollTop = messageList.scrollHeight
}

function renderMentionResults(items) {
  mentionDropdown.innerHTML = ""
  if (items.length === 0) { mentionDropdown.classList.add("hidden"); return }
  items.forEach((item, i) => {
    const div = document.createElement("div")
    div.className = `dropdown-item${i === 0 ? " selected" : ""}`
    div.textContent = `${item.prefix || ""}${item.display || ""}`
    div.addEventListener("click", () => {
      const val = promptInput.value
      const cursor = promptInput.selectionStart
      const atIdx = val.lastIndexOf("@", cursor)
      promptInput.value = val.slice(0, atIdx) + item.prefix + item.display + " " + val.slice(cursor)
      const nc = atIdx + item.prefix.length + item.display.length + 1
      promptInput.setSelectionRange(nc, nc)
      mentionDropdown.classList.add("hidden")
      promptInput.focus()
    })
    mentionDropdown.appendChild(div)
  })
  mentionDropdown.classList.remove("hidden")
}

function showSessionPicker(sessions) {
  const overlay = document.createElement("div")
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;"
  const dialog = document.createElement("div")
  dialog.style.cssText = "background:var(--oc-bg);border:1px solid var(--oc-border);border-radius:8px;padding:16px;max-width:400px;width:90%;max-height:60vh;overflow-y:auto;"
  dialog.innerHTML = "<h3 style='margin-top:0'>Session History</h3>"
  for (const s of sessions) {
    const item = document.createElement("div")
    item.style.cssText = "padding:8px;cursor:pointer;border-radius:4px;margin-bottom:4px;"
    item.textContent = (s.title || "Untitled") + " - " + new Date(s.time || Date.now()).toLocaleDateString()
    item.addEventListener("click", () => {
      vscode.postMessage({ type: "resume_session", sessionId: s.id })
      overlay.remove()
    })
    dialog.appendChild(item)
  }
  const close = document.createElement("button")
  close.textContent = "Close"
  close.style.cssText = "margin-top:8px;"
  close.addEventListener("click", () => overlay.remove())
  dialog.appendChild(close)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
}
