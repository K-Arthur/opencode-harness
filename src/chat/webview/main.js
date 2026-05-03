import hljs from 'highlight.js';

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  const state = {
    messages: [],
    currentMode: "normal",
    isStreaming: false,
    streamingMessageId: null,
    streamingBuffer: "",
    currentSessionId: null,
    mentionQuery: "",
    mentionSelectedIndex: -1,
  };

  const els = {
    messageList: document.getElementById("message-list"),
    promptInput: document.getElementById("prompt-input"),
    sendBtn: document.getElementById("send-btn"),
    abortBtn: document.getElementById("abort-btn"),
    modeButtons: document.querySelectorAll(".mode-btn"),
    mentionDropdown: document.getElementById("mention-dropdown"),
    typingIndicator: document.getElementById("typing-indicator"),
    typingLabel: document.getElementById("typing-label"),
    contextBar: document.getElementById("context-bar"),
    contextChips: document.getElementById("context-chips"),
    contextUsage: document.getElementById("context-usage"),
    contextBarFill: document.getElementById("context-bar-fill"),
    contextLabel: document.getElementById("context-label"),
    historyBtn: document.getElementById("history-btn"),
    newChatBtn: document.getElementById("new-chat-btn"),
    welcomeSugs: document.querySelectorAll(".suggestion-btn"),
    inputArea: document.getElementById("input-area"),
    inputRow: document.getElementById("input-row"),
  };

  /* ─── INIT ─── */

  function init() {
    setupModeSelector();
    setupInput();
    setupButtons();
    setupMentionDropdown();
    setupWelcomeSuggestions();
    setupMessageListener();
    restoreState();
  }

  function restoreState() {
    const saved = vscode.getState();
    if (saved && saved.messages) {
      state.messages = saved.messages;
      state.currentSessionId = saved.currentSessionId || null;
      state.currentMode = saved.currentMode || "normal";
      els.messageList.innerHTML = "";
      state.messages.forEach((msg) => {
        const el = renderMessage(msg);
        els.messageList.appendChild(el);
      });
      scrollToBottom();
      syncModeUI();
    }
  }

  function saveState() {
    vscode.setState({
      messages: state.messages,
      currentSessionId: state.currentSessionId,
      currentMode: state.currentMode,
    });
  }

  /* ─── MODE SELECTOR ─── */

  function setupModeSelector() {
    els.modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("active")) return;
        els.modeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentMode = btn.dataset.mode;
        vscode.postMessage({ type: "change_mode", mode: state.currentMode });
        saveState();
      });
    });
  }

  function syncModeUI() {
    els.modeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === state.currentMode);
    });
  }

  /* ─── INPUT ─── */

  function setupInput() {
    els.promptInput.addEventListener("input", onInputChange);
    els.promptInput.addEventListener("keydown", onInputKeydown);
    els.sendBtn.addEventListener("click", sendMessage);
    els.abortBtn.addEventListener("click", abortStream);
  }

  function onInputChange() {
    autoResizeTextarea();
    handleMentionTrigger();
    updateSendButton();
  }

  function onInputKeydown(e) {
    if (!els.mentionDropdown.classList.contains("hidden")) {
      handleMentionKeydown(e);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResizeTextarea() {
    const el = els.promptInput;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  function updateSendButton() {
    const hasText = els.promptInput.value.trim().length > 0;
    els.sendBtn.disabled = !hasText || state.isStreaming;
  }

  function sendMessage() {
    const text = els.promptInput.value.trim();
    if (!text || state.isStreaming) return;
    els.promptInput.value = "";
    autoResizeTextarea();
    updateSendButton();
    const msgObj = {
      role: "user",
      id: "user-" + Date.now(),
      blocks: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    addMessage(msgObj);
    state.isStreaming = true;
    els.sendBtn.classList.add("hidden");
    els.abortBtn.classList.remove("hidden");
    els.sendBtn.disabled = true;
    showTypingIndicator("Thinking...");
    vscode.postMessage({ type: "send_prompt", text });
  }

  function abortStream() {
    state.isStreaming = false;
    state.streamingMessageId = null;
    state.streamingBuffer = "";
    els.sendBtn.classList.remove("hidden");
    els.abortBtn.classList.add("hidden");
    els.sendBtn.disabled = false;
    hideTypingIndicator();
    vscode.postMessage({ type: "abort" });
  }

  /* ─── BUTTONS ─── */

  function setupButtons() {
    els.historyBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "list_sessions" });
    });
    els.newChatBtn.addEventListener("click", () => {
      clearMessages();
      vscode.postMessage({ type: "new_session" });
    });
  }

  /* ─── WELCOME ─── */

  function setupWelcomeSuggestions() {
    els.welcomeSugs.forEach((btn) => {
      btn.addEventListener("click", () => {
        els.promptInput.value = btn.dataset.prompt;
        autoResizeTextarea();
        updateSendButton();
        els.promptInput.focus();
      });
    });
  }

  /* ─── MESSAGES ─── */

  function addMessage(msg) {
    state.messages.push(msg);
    const el = renderMessage(msg);
    hideWelcome();
    els.messageList.appendChild(el);
    scrollToBottom();
    saveState();
  }

  function hideWelcome() {
    const welcome = els.messageList.querySelector(".welcome-message");
    if (welcome) welcome.remove();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      els.messageList.scrollTop = els.messageList.scrollHeight;
    });
  }

  function renderMessage(msg) {
    const div = document.createElement("div");
    div.className = "message " + (msg.role || "assistant");
    if (msg.id) div.dataset.messageId = msg.id;

    if (msg.role !== "system") {
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      if (msg.role === "user") {
        avatar.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
      } else {
        avatar.innerHTML = '<svg class="oc-logo" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.6043 1.34016C12.9973 2.03016 13.3883 2.72215 13.7783 3.41514C13.7941 3.44286 13.8169 3.46589 13.8445 3.48187C13.8721 3.49786 13.9034 3.50624 13.9353 3.50614H19.4873C19.6612 3.50614 19.8092 3.61614 19.9332 3.83314L21.3872 6.40311C21.5772 6.74011 21.6272 6.88111 21.4112 7.24011C21.1512 7.6701 20.8982 8.1041 20.6512 8.54009L20.2842 9.19809C20.1782 9.39409 20.0612 9.47809 20.2442 9.71008L22.8962 14.347C23.0682 14.648 23.0072 14.841 22.8532 15.117C22.4162 15.902 21.9712 16.681 21.5182 17.457C21.3592 17.729 21.1662 17.832 20.8382 17.827C20.0612 17.811 19.2863 17.817 18.5113 17.843C18.4946 17.8439 18.4785 17.8489 18.4644 17.8576C18.4502 17.8664 18.4385 17.8785 18.4303 17.893C17.5361 19.4773 16.6344 21.0573 15.7253 22.633C15.5563 22.926 15.3453 22.996 15.0003 22.997C14.0033 23 12.9983 23.001 11.9833 22.999C11.8889 22.9987 11.7961 22.9735 11.7145 22.9259C11.6328 22.8783 11.5652 22.8101 11.5184 22.728L10.1834 20.405C10.1756 20.3898 10.1637 20.3771 10.149 20.3684C10.1343 20.3598 10.1174 20.3554 10.1004 20.356H4.98244C4.69744 20.386 4.42944 20.355 4.17745 20.264L2.57447 17.494C2.52706 17.412 2.50193 17.319 2.50158 17.2243C2.50123 17.1296 2.52567 17.0364 2.57247 16.954L3.77945 14.834C3.79665 14.8041 3.80569 14.7701 3.80569 14.7355C3.80569 14.701 3.79665 14.667 3.77945 14.637C3.15073 13.5485 2.52573 12.4579 1.90448 11.3651L1.11449 9.97008C0.954488 9.66008 0.941489 9.47409 1.20949 9.00509C1.67448 8.1921 2.13647 7.38011 2.59647 6.56911C2.72847 6.33512 2.90046 6.23512 3.18046 6.23412C4.04344 6.23048 4.90644 6.23015 5.76943 6.23312C5.79123 6.23295 5.81259 6.22704 5.83138 6.21597C5.85016 6.20491 5.8657 6.1891 5.87643 6.17012L8.68239 1.27516C8.72491 1.2007 8.78631 1.13875 8.86039 1.09556C8.93448 1.05238 9.01863 1.02948 9.10439 1.02917C9.62838 1.02817 10.1574 1.02917 10.6874 1.02317L11.7044 1.00017C12.0453 0.997165 12.4283 1.03217 12.6043 1.34016ZM9.17238 1.74316C9.16185 1.74315 9.15149 1.74592 9.14236 1.75119C9.13323 1.75645 9.12565 1.76403 9.12038 1.77316L6.25442 6.78811C6.24066 6.81174 6.22097 6.83137 6.19729 6.84505C6.17361 6.85873 6.14677 6.86599 6.11942 6.86611H3.25346C3.19746 6.86611 3.18346 6.89111 3.21246 6.94011L9.02239 17.096C9.04739 17.138 9.03539 17.158 8.98839 17.159L6.19342 17.174C6.15256 17.1727 6.11214 17.1828 6.07678 17.2033C6.04141 17.2238 6.01253 17.2539 5.99342 17.29L4.67344 19.6C4.62944 19.678 4.65244 19.718 4.74144 19.718L10.4574 19.726C10.5034 19.726 10.5374 19.746 10.5614 19.787L11.9643 22.241C12.0103 22.322 12.0563 22.323 12.1033 22.241L17.1093 13.481L17.8923 12.0991C17.897 12.0905 17.904 12.0834 17.9125 12.0785C17.9209 12.0735 17.9305 12.0709 17.9403 12.0709C17.9501 12.0709 17.9597 12.0735 17.9681 12.0785C17.9765 12.0834 17.9835 12.0905 17.9883 12.0991L19.4123 14.629C19.4229 14.648 19.4385 14.6637 19.4573 14.6746C19.4761 14.6855 19.4975 14.6912 19.5193 14.691L22.2822 14.671C22.2893 14.6711 22.2963 14.6693 22.3024 14.6658C22.3086 14.6623 22.3137 14.6572 22.3172 14.651C22.3206 14.6449 22.3224 14.638 22.3224 14.631C22.3224 14.624 22.3206 14.6172 22.3172 14.611L19.4173 9.52508C19.4068 9.50809 19.4013 9.48853 19.4013 9.46859C19.4013 9.44864 19.4068 9.42908 19.4173 9.41209L19.7102 8.90509L20.8302 6.92811C20.8542 6.88711 20.8422 6.86611 20.7952 6.86611H9.20038C9.14138 6.86611 9.12738 6.84011 9.15738 6.78911L10.5914 4.28413C10.6021 4.26706 10.6078 4.24731 10.6078 4.22714C10.6078 4.20697 10.6021 4.18721 10.5914 4.17014L9.22538 1.77416C9.22016 1.7647 9.21248 1.75682 9.20315 1.75137C9.19382 1.74591 9.18319 1.74307 9.17238 1.74316ZM15.4623 9.76308C15.5083 9.76308 15.5203 9.78308 15.4963 9.82308L14.6643 11.2881L12.0513 15.873C12.0464 15.8819 12.0392 15.8894 12.0304 15.8945C12.0216 15.8996 12.0115 15.9022 12.0013 15.902C11.9912 15.902 11.9813 15.8993 11.9725 15.8942C11.9637 15.8891 11.9564 15.8818 11.9513 15.873L8.49839 9.84108C8.47839 9.80708 8.48839 9.78908 8.52639 9.78708L8.74239 9.77508L15.4643 9.76308H15.4623Z"/></svg>';
      }
      div.appendChild(avatar);
    }

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "message-content";

    if (msg.role !== "system") {
      const header = document.createElement("div");
      header.className = "message-header";
      const roleSpan = document.createElement("span");
      roleSpan.className = "message-role";
      roleSpan.textContent = msg.role === "user" ? "You" : "OpenCode";
      header.appendChild(roleSpan);
      if (msg.timestamp) {
        const ts = document.createElement("span");
        ts.className = "message-timestamp";
        ts.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        header.appendChild(ts);
      }
      contentWrapper.appendChild(header);
    }

    const bubble = document.createElement("div");
    bubble.className = msg.role === "system" ? "system-bubble" : "message-bubble";

    if (msg.blocks && Array.isArray(msg.blocks)) {
      msg.blocks.forEach((block) => {
        const el = renderBlock(block, msg.id);
        if (el) bubble.appendChild(el);
      });
    }

    if (msg.role === "user" && msg.blocks) {
      const firstText = msg.blocks.find((b) => b.type === "text");
      if (firstText) {
        const p = document.createElement("div");
        p.className = "msg-text";
        p.textContent = firstText.text;
        bubble.appendChild(p);
      }
    }

    contentWrapper.appendChild(bubble);
    div.appendChild(contentWrapper);

    return div;
  }

  function renderBlock(block, messageId) {
    if (!block || !block.type) return null;
    switch (block.type) {
      case "text":
        return renderTextBlock(block);
      case "code":
        return renderCodeBlock(block);
      case "thinking":
        return renderThinkingBlock(block);
      case "skill_badge":
        return renderSkillBadge(block);
      case "tool_call":
        return renderToolCard(block);
      case "diff_block":
        return renderDiffBlock(block, messageId);
      case "permission":
        return renderPermissionBlock(block);
      default:
        return null;
    }
  }

  function renderTextBlock(block) {
    const div = document.createElement("div");
    div.className = "msg-text";
    div.textContent = block.text || "";
    return div;
  }

  /* ─── CODE BLOCK ─── */

  function renderCodeBlock(block) {
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const header = document.createElement("div");
    header.className = "code-block-header";
    const lang = document.createElement("span");
    lang.className = "code-block-lang";
    lang.textContent = block.language || "code";
    header.appendChild(lang);

    const copyBtn = document.createElement("button");
    copyBtn.className = "code-block-copy";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(block.code || "").then(() => {
        copyBtn.classList.add("copied");
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.classList.remove("copied"); copyBtn.textContent = "Copy"; }, 1500);
      });
    });
    header.appendChild(copyBtn);
    wrapper.appendChild(header);

    const content = document.createElement("div");
    content.className = "code-block-content";
    content.innerHTML = highlightSyntax(block.code || "", block.language || "");
    wrapper.appendChild(content);

    return wrapper;
  }

  function highlightSyntax(code, language) {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language }).value;
      } catch (e) {
        console.error(e);
      }
    }
    // Fallback to auto-detect or plain text if language is unknown
    try {
      return hljs.highlightAuto(code).value;
    } catch (e) {
      return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }

  /* ─── THINKING BLOCK ─── */

  function renderThinkingBlock(block) {
    const div = document.createElement("div");
    div.className = "thinking-block";

    const header = document.createElement("div");
    header.className = "thinking-header";
    const toggle = document.createElement("span");
    toggle.className = "thinking-toggle";
    toggle.textContent = "\u25B6";
    header.appendChild(toggle);

    const label = document.createElement("span");
    label.textContent = "Reasoning";
    header.appendChild(label);
    div.appendChild(header);

    const content = document.createElement("div");
    content.className = "thinking-content";
    content.textContent = block.text || "";
    div.appendChild(content);

    div.addEventListener("click", () => {
      div.classList.toggle("expanded");
    });

    return div;
  }

  /* ─── SKILL BADGE ─── */

  function renderSkillBadge(block) {
    const badge = document.createElement("div");
    badge.className = "skill-badge";
    const icon = document.createElement("span");
    icon.className = "skill-badge-icon";
    icon.textContent = "\u2699";
    badge.appendChild(icon);
    const name = document.createElement("span");
    name.textContent = block.skillName || "skill";
    badge.appendChild(name);
    return badge;
  }

  /* ─── TOOL CARD ─── */

  function renderToolCard(block) {
    const card = document.createElement("div");
    const toolType = block.toolType || "read";
    card.className = "tool-card tool-" + toolType;

    const header = document.createElement("div");
    header.className = "tool-header";

    const icon = document.createElement("span");
    icon.className = "tool-icon";
    icon.textContent = toolType === "write" ? "\u270F" : toolType === "exec" ? "\u25B6" : "\uD83D\uDCD6";
    header.appendChild(icon);

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = block.toolName || "";
    header.appendChild(name);

    const args = document.createElement("span");
    args.className = "tool-args";
    args.textContent = block.args || "";
    header.appendChild(args);

    const expand = document.createElement("span");
    expand.className = "tool-expand-icon";
    expand.textContent = "\u25B6";
    header.appendChild(expand);

    card.appendChild(header);

    const result = document.createElement("div");
    result.className = "tool-result";
    result.textContent = block.result || "";
    card.appendChild(result);

    header.addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    return card;
  }

  /* ─── DIFF BLOCK ─── */

  function renderDiffBlock(block, messageId) {
    const wrapper = document.createElement("div");
    wrapper.className = "diff-block";

    const header = document.createElement("div");
    header.className = "diff-header";
    const filePath = document.createElement("span");
    filePath.className = "diff-file-path";
    filePath.textContent = block.filePath || "";
    header.appendChild(filePath);
    wrapper.appendChild(header);

    const content = document.createElement("div");
    content.className = "diff-content";
    content.textContent = block.diffText || "";
    wrapper.appendChild(content);

    const actions = document.createElement("div");
    actions.className = "diff-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "diff-btn diff-btn-accept";
    acceptBtn.textContent = "Accept Changes";
    acceptBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "accept_diff", messageId, blockId: block.id });
      acceptBtn.textContent = "Accepted";
      acceptBtn.disabled = true;
    });
    actions.appendChild(acceptBtn);

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "diff-btn diff-btn-reject";
    rejectBtn.textContent = "Discard";
    rejectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "reject_diff", messageId, blockId: block.id });
      rejectBtn.textContent = "Discarded";
      rejectBtn.disabled = true;
    });
    actions.appendChild(rejectBtn);

    wrapper.appendChild(actions);
    return wrapper;
  }

  /* ─── PERMISSION BLOCK ─── */

  function renderPermissionBlock(block) {
    const wrapper = document.createElement("div");
    wrapper.className = "permission-block";

    const text = document.createElement("div");
    text.className = "permission-text";
    text.textContent = block.text || "Allow OpenCode to perform this action?";
    wrapper.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "permission-actions";

    if (block.permissionId) {
      const allowBtn = document.createElement("button");
      allowBtn.className = "permission-btn permission-btn-allow";
      allowBtn.textContent = "Allow";
      allowBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "accept_permission", permissionId: block.permissionId, response: "allow" });
        wrapper.style.opacity = "0.5";
        actions.innerHTML = '<span style="font-size:12px;color:var(--oc-muted)">Allowed</span>';
      });
      actions.appendChild(allowBtn);

      const alwaysBtn = document.createElement("button");
      alwaysBtn.className = "permission-btn permission-btn-always";
      alwaysBtn.textContent = "Always Allow";
      alwaysBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "accept_permission", permissionId: block.permissionId, response: "always" });
        wrapper.style.opacity = "0.5";
        actions.innerHTML = '<span style="font-size:12px;color:var(--oc-muted)">Always allowed</span>';
      });
      actions.appendChild(alwaysBtn);

      const denyBtn = document.createElement("button");
      denyBtn.className = "permission-btn permission-btn-deny";
      denyBtn.textContent = "Deny";
      denyBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "accept_permission", permissionId: block.permissionId, response: "deny" });
        wrapper.style.opacity = "0.5";
        actions.innerHTML = '<span style="font-size:12px;color:var(--oc-muted)">Denied</span>';
      });
      actions.appendChild(denyBtn);
    }

    wrapper.appendChild(actions);
    return wrapper;
  }

  /* ─── MENTION DROPDOWN ─── */

  function handleMentionTrigger() {
    const val = els.promptInput.value;
    const cursorPos = els.promptInput.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const match = textBefore.match(/@(\S*)$/);
    if (match) {
      state.mentionQuery = match[1];
      els.mentionDropdown.classList.remove("hidden");
      vscode.postMessage({ type: "mention_search", query: state.mentionQuery });
    } else {
      els.mentionDropdown.classList.add("hidden");
    }
  }

  function handleMentionKeydown(e) {
    const items = els.mentionDropdown.querySelectorAll(".dropdown-item:not(.dropdown-empty)");
    if (items.length === 0) {
      if (e.key === "Escape") {
        els.mentionDropdown.classList.add("hidden");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items.forEach((i) => i.classList.remove("selected"));
      state.mentionSelectedIndex = (state.mentionSelectedIndex + 1) % items.length;
      items[state.mentionSelectedIndex].classList.add("selected");
      ensureVisible(items[state.mentionSelectedIndex]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items.forEach((i) => i.classList.remove("selected"));
      state.mentionSelectedIndex = state.mentionSelectedIndex <= 0 ? items.length - 1 : state.mentionSelectedIndex - 1;
      items[state.mentionSelectedIndex].classList.add("selected");
      ensureVisible(items[state.mentionSelectedIndex]);
    } else if (e.key === "Enter" && state.mentionSelectedIndex >= 0) {
      e.preventDefault();
      items[state.mentionSelectedIndex].click();
    } else if (e.key === "Escape") {
      els.mentionDropdown.classList.add("hidden");
    } else {
      return;
    }
  }

  function ensureVisible(el) {
    const parent = els.mentionDropdown;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const scrollTop = parent.scrollTop;
    const scrollBottom = scrollTop + parent.clientHeight;
    if (elTop < scrollTop) parent.scrollTop = elTop - 4;
    if (elBottom > scrollBottom) parent.scrollTop = elBottom - parent.clientHeight + 4;
  }

  function setupMentionDropdown() {
    els.mentionDropdown.addEventListener("mouseleave", () => {
      state.mentionSelectedIndex = -1;
    });
  }

  function renderMentionResults(items) {
    els.mentionDropdown.innerHTML = "";
    if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dropdown-empty";
      empty.textContent = "No matches";
      els.mentionDropdown.appendChild(empty);
      state.mentionSelectedIndex = -1;
      return;
    }
    state.mentionSelectedIndex = 0;
    items.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "dropdown-item" + (i === 0 ? " selected" : "");
      const icon = document.createElement("span");
      icon.className = "dropdown-icon";
      icon.textContent = item.icon || "\uD83D\uDCC4";
      div.appendChild(icon);
      const label = document.createElement("span");
      label.className = "dropdown-label";
      label.textContent = item.display || "";
      div.appendChild(label);
      if (item.description) {
        const desc = document.createElement("span");
        desc.className = "dropdown-desc";
        desc.textContent = "\u2014 " + item.description;
        div.appendChild(desc);
      }
      div.addEventListener("click", () => insertMention(item));
      els.mentionDropdown.appendChild(div);
    });
  }

  function insertMention(item) {
    const val = els.promptInput.value;
    const cursor = els.promptInput.selectionStart;
    const atIdx = val.lastIndexOf("@", cursor);
    const text = (item.prefix || "") + (item.display || "");
    const before = val.slice(0, atIdx);
    const after = val.slice(cursor);
    els.promptInput.value = before + text + " " + after;
    const newCursor = atIdx + text.length + 1;
    els.promptInput.setSelectionRange(newCursor, newCursor);
    els.mentionDropdown.classList.add("hidden");
    els.promptInput.focus();
    autoResizeTextarea();
    updateSendButton();
  }

  /* ─── TYPING INDICATOR ─── */

  function showTypingIndicator(label) {
    els.typingIndicator.classList.remove("hidden");
    els.typingLabel.textContent = label || "Thinking...";
    scrollToBottom();
  }

  function hideTypingIndicator() {
    els.typingIndicator.classList.add("hidden");
  }

  /* ─── CONTEXT BAR ─── */

  function updateContextChips(chips) {
    els.contextChips.innerHTML = "";
    if (!chips || chips.length === 0) {
      els.contextBar.classList.add("hidden");
      return;
    }
    els.contextBar.classList.remove("hidden");
    chips.forEach((chip) => {
      const el = document.createElement("span");
      el.className = "context-chip";
      const label = document.createElement("span");
      label.textContent = chip.label || "";
      el.appendChild(label);
      if (chip.removable !== false) {
        const rem = document.createElement("button");
        rem.className = "context-chip-remove";
        rem.innerHTML = "&times;";
        rem.addEventListener("click", () => {
          el.remove();
          if (els.contextChips.children.length === 0) {
            els.contextBar.classList.add("hidden");
          }
          if (chip.onRemove) chip.onRemove();
        });
        el.appendChild(rem);
      }
      els.contextChips.appendChild(el);
    });
  }

  /* ─── CONTEXT USAGE ─── */

  function updateContextUsage(usage) {
    if (usage && usage.total > 0) {
      els.contextUsage.classList.remove("hidden");
      const pct = Math.min(100, Math.round((usage.tokens / usage.total) * 100));
      els.contextBarFill.style.width = pct + "%";
      els.contextLabel.textContent = usage.percentage != null ? usage.percentage + "%" : pct + "%";
      if (pct > 80) {
        els.contextBarFill.style.background = "var(--oc-warning)";
      } else if (pct > 95) {
        els.contextBarFill.style.background = "var(--oc-error)";
      } else {
        els.contextBarFill.style.background = "var(--oc-accent)";
      }
    } else {
      els.contextUsage.classList.add("hidden");
    }
  }

  /* ─── SESSION PICKER ─── */

  let sessionPickerOpen = false;

  function showSessionPicker(sessions) {
    if (sessionPickerOpen) return;
    sessionPickerOpen = true;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeOverlay();
    });

    const dialog = document.createElement("div");
    dialog.className = "overlay-dialog";

    const titleRow = document.createElement("div");
    titleRow.className = "overlay-title";
    titleRow.innerHTML = "Session History";
    const closeBtn = document.createElement("button");
    closeBtn.className = "overlay-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", closeOverlay);
    titleRow.appendChild(closeBtn);
    dialog.appendChild(titleRow);

    let filterText = "";
    const searchInput = document.createElement("input");
    searchInput.className = "overlay-search";
    searchInput.type = "text";
    searchInput.placeholder = "Search sessions...";
    searchInput.autofocus = true;
    dialog.appendChild(searchInput);

    const list = document.createElement("div");
    list.className = "overlay-list";

    function renderSessionList(filter) {
      list.innerHTML = "";
      const filtered = filter
        ? sessions.filter((s) => (s.title || "").toLowerCase().includes(filter.toLowerCase()))
        : sessions;
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:20px;text-align:center;color:var(--oc-muted);font-size:12px;";
        empty.textContent = "No sessions found";
        list.appendChild(empty);
        return;
      }
      filtered.forEach((s) => {
        const item = document.createElement("div");
        item.className = "session-item";
        const title = document.createElement("div");
        title.className = "session-item-title";
        title.textContent = s.title || "Untitled Session";
        item.appendChild(title);
        const meta = document.createElement("div");
        meta.className = "session-item-meta";
        const date = s.time ? new Date(s.time).toLocaleDateString() : "";
        const count = s.messageCount != null ? s.messageCount + " messages" : "";
        meta.textContent = [date, count].filter(Boolean).join(" \u00B7 ");
        item.appendChild(meta);
        item.addEventListener("click", () => {
          vscode.postMessage({ type: "resume_session", sessionId: s.id });
          closeOverlay();
        });
        list.appendChild(item);
      });
    }

    renderSessionList("");
    dialog.appendChild(list);

    searchInput.addEventListener("input", () => {
      filterText = searchInput.value;
      renderSessionList(filterText);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeOverlay();
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function closeOverlay() {
      sessionPickerOpen = false;
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 150);
    }
  }

  /* ─── MESSAGE LISTENER ─── */

  function setupMessageListener() {
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case "message":
          handleHostMessage(msg);
          break;
        case "stream_start":
          handleStreamStart(msg);
          break;
        case "stream_chunk":
          handleStreamChunk(msg);
          break;
        case "stream_end":
          handleStreamEnd(msg);
          break;
        case "mention_results":
          renderMentionResults(msg.items);
          break;
        case "session_list":
          if (msg.sessions) showSessionPicker(msg.sessions);
          break;
        case "clear_messages":
          clearMessages();
          break;
        case "context_usage":
          updateContextUsage(msg);
          break;
        case "server_status":
          handleServerStatus(msg);
          break;
        case "theme_vars":
          applyThemeVars(msg.vars);
          break;
        case "model_update":
          updateModelIndicator(msg.model);
          break;
        case "rate_limit_exhausted":
          handleRateLimitExhausted(msg);
          break;
      }
    });
  }

  function handleHostMessage(msg) {
    if (msg.message) {
      if (msg.message.role === "assistant") {
        hideTypingIndicator();
      }
      addMessage(msg.message);
      state.currentSessionId = msg.message.sessionId || state.currentSessionId;
      saveState();
    }
  }

  function handleStreamStart(msg) {
    state.streamingMessageId = msg.messageId || "stream-" + Date.now();
    state.streamingBuffer = "";
    hideTypingIndicator();
    const streamMsg = {
      role: "assistant",
      id: state.streamingMessageId,
      blocks: [],
      timestamp: Date.now(),
    };
    state.messages.push(streamMsg);
    
    const el = document.createElement("div");
    el.className = "message assistant";
    el.dataset.messageId = state.streamingMessageId;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.innerHTML = '<svg class="oc-logo" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.6043 1.34016C12.9973 2.03016 13.3883 2.72215 13.7783 3.41514C13.7941 3.44286 13.8169 3.46589 13.8445 3.48187C13.8721 3.49786 13.9034 3.50624 13.9353 3.50614H19.4873C19.6612 3.50614 19.8092 3.61614 19.9332 3.83314L21.3872 6.40311C21.5772 6.74011 21.6272 6.88111 21.4112 7.24011C21.1512 7.6701 20.8982 8.1041 20.6512 8.54009L20.2842 9.19809C20.1782 9.39409 20.0612 9.47809 20.2442 9.71008L22.8962 14.347C23.0682 14.648 23.0072 14.841 22.8532 15.117C22.4162 15.902 21.9712 16.681 21.5182 17.457C21.3592 17.729 21.1662 17.832 20.8382 17.827C20.0612 17.811 19.2863 17.817 18.5113 17.843C18.4946 17.8439 18.4785 17.8489 18.4644 17.8576C18.4502 17.8664 18.4385 17.8785 18.4303 17.893C17.5361 19.4773 16.6344 21.0573 15.7253 22.633C15.5563 22.926 15.3453 22.996 15.0003 22.997C14.0033 23 12.9983 23.001 11.9833 22.999C11.8889 22.9987 11.7961 22.9735 11.7145 22.9259C11.6328 22.8783 11.5652 22.8101 11.5184 22.728L10.1834 20.405C10.1756 20.3898 10.1637 20.3771 10.149 20.3684C10.1343 20.3598 10.1174 20.3554 10.1004 20.356H4.98244C4.69744 20.386 4.42944 20.355 4.17745 20.264L2.57447 17.494C2.52706 17.412 2.50193 17.319 2.50158 17.2243C2.50123 17.1296 2.52567 17.0364 2.57247 16.954L3.77945 14.834C3.79665 14.8041 3.80569 14.7701 3.80569 14.7355C3.80569 14.701 3.79665 14.667 3.77945 14.637C3.15073 13.5485 2.52573 12.4579 1.90448 11.3651L1.11449 9.97008C0.954488 9.66008 0.941489 9.47409 1.20949 9.00509C1.67448 8.1921 2.13647 7.38011 2.59647 6.56911C2.72847 6.33512 2.90046 6.23512 3.18046 6.23412C4.04344 6.23048 4.90644 6.23015 5.76943 6.23312C5.79123 6.23295 5.81259 6.22704 5.83138 6.21597C5.85016 6.20491 5.8657 6.1891 5.87643 6.17012L8.68239 1.27516C8.72491 1.2007 8.78631 1.13875 8.86039 1.09556C8.93448 1.05238 9.01863 1.02948 9.10439 1.02917C9.62838 1.02817 10.1574 1.02917 10.6874 1.02317L11.7044 1.00017C12.0453 0.997165 12.4283 1.03217 12.6043 1.34016ZM9.17238 1.74316C9.16185 1.74315 9.15149 1.74592 9.14236 1.75119C9.13323 1.75645 9.12565 1.76403 9.12038 1.77316L6.25442 6.78811C6.24066 6.81174 6.22097 6.83137 6.19729 6.84505C6.17361 6.85873 6.14677 6.86599 6.11942 6.86611H3.25346C3.19746 6.86611 3.18346 6.89111 3.21246 6.94011L9.02239 17.096C9.04739 17.138 9.03539 17.158 8.98839 17.159L6.19342 17.174C6.15256 17.1727 6.11214 17.1828 6.07678 17.2033C6.04141 17.2238 6.01253 17.2539 5.99342 17.29L4.67344 19.6C4.62944 19.678 4.65244 19.718 4.74144 19.718L10.4574 19.726C10.5034 19.726 10.5374 19.746 10.5614 19.787L11.9643 22.241C12.0103 22.322 12.0563 22.323 12.1033 22.241L17.1093 13.481L17.8923 12.0991C17.897 12.0905 17.904 12.0834 17.9125 12.0785C17.9209 12.0735 17.9305 12.0709 17.9403 12.0709C17.9501 12.0709 17.9597 12.0735 17.9681 12.0785C17.9765 12.0834 17.9835 12.0905 17.9883 12.0991L19.4123 14.629C19.4229 14.648 19.4385 14.6637 19.4573 14.6746C19.4761 14.6855 19.4975 14.6912 19.5193 14.691L22.2822 14.671C22.2893 14.6711 22.2963 14.6693 22.3024 14.6658C22.3086 14.6623 22.3137 14.6572 22.3172 14.651C22.3206 14.6449 22.3224 14.638 22.3224 14.631C22.3224 14.624 22.3206 14.6172 22.3172 14.611L19.4173 9.52508C19.4068 9.50809 19.4013 9.48853 19.4013 9.46859C19.4013 9.44864 19.4068 9.42908 19.4173 9.41209L19.7102 8.90509L20.8302 6.92811C20.8542 6.88711 20.8422 6.86611 20.7952 6.86611H9.20038C9.14138 6.86611 9.12738 6.84011 9.15738 6.78911L10.5914 4.28413C10.6021 4.26706 10.6078 4.24731 10.6078 4.22714C10.6078 4.20697 10.6021 4.18721 10.5914 4.17014L9.22538 1.77416C9.22016 1.7647 9.21248 1.75682 9.20315 1.75137C9.19382 1.74591 9.18319 1.74307 9.17238 1.74316ZM15.4623 9.76308C15.5083 9.76308 15.5203 9.78308 15.4963 9.82308L14.6643 11.2881L12.0513 15.873C12.0464 15.8819 12.0392 15.8894 12.0304 15.8945C12.0216 15.8996 12.0115 15.9022 12.0013 15.902C11.9912 15.902 11.9813 15.8993 11.9725 15.8942C11.9637 15.8891 11.9564 15.8818 11.9513 15.873L8.49839 9.84108C8.47839 9.80708 8.48839 9.78908 8.52639 9.78708L8.74239 9.77508L15.4643 9.76308H15.4623Z" fill="currentColor"/></svg>';
    el.appendChild(avatar);

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "message-content";

    const header = document.createElement("div");
    header.className = "message-header";
    const roleSpan = document.createElement("span");
    roleSpan.className = "message-role";
    roleSpan.textContent = "OpenCode";
    header.appendChild(roleSpan);
    contentWrapper.appendChild(header);

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const textEl = document.createElement("div");
    textEl.className = "msg-text streaming-text";
    textEl.id = "stream-text-" + state.streamingMessageId;
    bubble.appendChild(textEl);

    contentWrapper.appendChild(bubble);
    el.appendChild(contentWrapper);

    hideWelcome();
    els.messageList.appendChild(el);
    scrollToBottom();
  }

  function handleStreamChunk(msg) {
    const id = msg.messageId || state.streamingMessageId;
    if (!id) return;
    state.streamingMessageId = id;
    state.streamingBuffer += msg.text || "";
    const textEl = document.getElementById("stream-text-" + id);
    if (textEl) {
      textEl.textContent = state.streamingBuffer;
      scrollToBottom();
    }
  }

  function handleStreamEnd(msg) {
    state.isStreaming = false;
    els.sendBtn.classList.remove("hidden");
    els.abortBtn.classList.add("hidden");
    els.sendBtn.disabled = false;
    hideTypingIndicator();

    const id = msg.messageId || state.streamingMessageId;
    if (id) {
      const streamingEl = document.getElementById("stream-text-" + id);
      if (streamingEl) {
        streamingEl.classList.remove("streaming-text");
      }
      const msgObj = state.messages.find((m) => m.id === id);
      if (msgObj && msg.blocks) {
        msgObj.blocks = msg.blocks;
        reRenderMessage(id);
      }
    }
    state.streamingMessageId = null;
    state.streamingBuffer = "";
    saveState();
  }

  function reRenderMessage(messageId) {
    const idx = state.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = state.messages[idx];
    const oldEl = els.messageList.querySelector('[data-message-id="' + messageId + '"]');
    if (oldEl) {
      const newEl = renderMessage(msg);
      oldEl.replaceWith(newEl);
      scrollToBottom();
    }
  }

  function handleServerStatus(msg) {
    if (msg.status === "thinking") {
      showTypingIndicator("Thinking...");
    } else if (msg.status === "error") {
      hideTypingIndicator();
      const errMsg = {
        role: "system",
        id: "error-" + Date.now(),
        blocks: [{ type: "text", text: "An error occurred. Please try again." }],
        timestamp: Date.now(),
      };
      addMessage(errMsg);
    } else {
      hideTypingIndicator();
    }
  }

  /* ─── THEME ─── */

  function applyThemeVars(vars) {
    if (!vars || typeof vars !== "object") return;
    const root = document.documentElement;
    for (const [key, val] of Object.entries(vars)) {
      if (typeof val === "string") {
        root.style.setProperty(key, val);
      }
    }
  }

  function updateModelIndicator(model) {
    const indicator = document.getElementById("model-indicator");
    if (!indicator) return;
    if (model) {
      const short = model.split("/").pop() || model;
      indicator.textContent = short;
      indicator.title = "Model: " + model;
    } else {
      indicator.textContent = "";
    }
  }

  /* ─── RATE LIMIT ─── */

  function handleRateLimitExhausted(msg) {
    els.sendBtn.disabled = true;
    const resetMsg = msg.resetAt ? "Reset at " + msg.resetAt : "Please wait for the rate limit to reset.";
    const notification = document.createElement("div");
    notification.className = "rate-limit-notice";
    notification.textContent = "\u26A0 Rate limit exceeded. " + resetMsg;
    els.inputArea.insertBefore(notification, els.inputRow);
    const observer = new MutationObserver(() => {
      const existing = els.inputArea.querySelector(".rate-limit-notice");
      if (existing) existing.remove();
      els.sendBtn.disabled = false;
    });
    if (msg.resetAt) {
      const now = Date.now();
      const resetTime = new Date(msg.resetAt).getTime();
      const delay = Math.max(resetTime - now, 30000);
      setTimeout(() => {
        const existing = els.inputArea.querySelector(".rate-limit-notice");
        if (existing) existing.remove();
        els.sendBtn.disabled = false;
      }, delay);
    }
  }

  /* ─── CLEAR ─── */

  function clearMessages() {
    state.messages = [];
    state.streamingMessageId = null;
    state.streamingBuffer = "";
    state.isStreaming = false;
    els.messageList.innerHTML = "";
    els.sendBtn.classList.remove("hidden");
    els.abortBtn.classList.add("hidden");
    els.sendBtn.disabled = false;
    hideTypingIndicator();
    saveState();
  }

  /* ─── START ─── */

  init();
})();
