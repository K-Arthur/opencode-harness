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
    if (e.key === "Enter" && !e.shiftKey) {
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
    if (msg.role !== "user") {
      div.appendChild(header);
    }

    if (msg.blocks && Array.isArray(msg.blocks)) {
      msg.blocks.forEach((block) => {
        const el = renderBlock(block, msg.id);
        if (el) div.appendChild(el);
      });
    }

    if (msg.role === "user" && msg.blocks) {
      const firstText = msg.blocks.find((b) => b.type === "text");
      if (firstText) {
        const p = document.createElement("div");
        p.className = "msg-text";
        p.textContent = firstText.text;
        div.appendChild(p);
      }
    }

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
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const kwMap = {
      js: /\b(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield)\b/g,
      ts: /\b(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|function|if|implements|import|in|instanceof|interface|let|new|of|package|private|protected|public|return|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/g,
      py: /\b(and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None)\b/g,
      rs: /\b(as|async|await|break|const|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|static|struct|super|trait|true|type|unsafe|use|where|while)\b/g,
      go: /\b(break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/g,
      java: /\b(abstract|boolean|break|byte|case|catch|char|class|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while)\b/g,
    };

    const keywords = kwMap[language] || /\b(function|class|import|return|const|let|var|if|else|for|while|try|catch|async|await)\b/g;

    return escaped
      .replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>')
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="hl-string">$1</span>')
      .replace(keywords, '<span class="hl-keyword">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
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

    const header = document.createElement("div");
    header.className = "message-header";
    const roleSpan = document.createElement("span");
    roleSpan.className = "message-role";
    roleSpan.textContent = "OpenCode";
    header.appendChild(roleSpan);
    el.appendChild(header);

    const textEl = document.createElement("div");
    textEl.className = "msg-text streaming-text";
    textEl.id = "stream-text-" + state.streamingMessageId;
    el.appendChild(textEl);

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
