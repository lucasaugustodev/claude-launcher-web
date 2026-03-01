// ─── Chat View Manager (Mobile Terminal Alternative) ───
// Renders Claude Code sessions as a chat-style interface with action buttons.
// Same external interface as TerminalManager: open, close, openReadOnly, currentSessionId.
// Supports two modes:
//   - streamJson: true  → NDJSON from Claude Code -p --output-format stream-json --input-format stream-json (clean JSON I/O)
//   - streamJson: false → Legacy StreamAnalyzer actions from raw ANSI PTY parsing

const ChatViewManager = {
  _currentSessionId: null,
  _streamJson: false,
  _streamJsonHandler: null,
  _outputHandler: null,
  _actionHandler: null,
  _exitHandler: null,
  _messages: [],
  _state: 'idle', // idle | thinking | responding | tool_exec | tool_approval | input_wait
  _terminalFallback: false,
  _fallbackTerm: null,
  _fallbackFit: null,

  open(sessionId, { streamJson } = {}) {
    this._currentSessionId = sessionId;
    this._streamJson = !!streamJson;
    this._messages = [];
    this._state = 'idle';
    this._terminalFallback = false;
    this._fallbackTerm = null;

    this._buildUI();

    if (this._streamJson) {
      // Stream JSON mode: listen for structured NDJSON events
      this._streamJsonHandler = (msg) => {
        if (msg.sessionId !== sessionId) return;
        this._handleStreamJsonEvent(msg.event);
      };
      API.on('terminal:stream-json', this._streamJsonHandler);
    } else {
      // Legacy TUI mode: listen for StreamAnalyzer actions
      this._actionHandler = (msg) => {
        if (msg.sessionId !== sessionId) return;
        this._handleAction(msg.action);
      };
      API.on('terminal:action', this._actionHandler);
    }

    // Register exit handler
    this._exitHandler = (msg) => {
      if (msg.sessionId !== sessionId) return;
      this._addMessage('system', 'Sessao finalizada (codigo: ' + msg.exitCode + ')');
      this._setState('idle');
    };

    // Raw output handler for terminal toggle mode
    this._outputHandler = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (this._terminalFallback && this._fallbackTerm) {
        this._fallbackTerm.write(msg.data);
      }
    };

    API.on('terminal:exit', this._exitHandler);
    API.on('terminal:output', this._outputHandler);

    API.attachSession(sessionId);

    // In stream-json mode, process waits for user input before responding.
    // Show input ready state so user can type their first message.
    if (this._streamJson) {
      this._addMessage('system', 'Sessao iniciada. Digite sua mensagem.');
      this._setState('input_wait');
    }

    document.getElementById('terminal-overlay').style.display = 'flex';
  },

  _buildUI() {
    const container = document.getElementById('terminal-container');
    container.innerHTML = '';
    container.className = 'chat-view-container';

    // Message list
    const messageList = document.createElement('div');
    messageList.className = 'chat-messages';
    messageList.id = 'chat-messages';

    // Action bar (contextual buttons)
    const actionBar = document.createElement('div');
    actionBar.className = 'chat-action-bar';
    actionBar.id = 'chat-action-bar';

    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'chat-input-area';
    inputArea.id = 'chat-input-area';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-input';
    input.id = 'chat-input';
    input.placeholder = 'Digite uma mensagem...';
    input.autocomplete = 'off';
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');

    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-primary chat-send-btn';
    sendBtn.id = 'chat-send-btn';
    sendBtn.textContent = 'Enviar';
    sendBtn.addEventListener('click', () => this._sendMessage());

    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);

    container.appendChild(messageList);
    container.appendChild(actionBar);
    container.appendChild(inputArea);

    // Enter key sends message
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    // Add toggle button to terminal header
    this._addToggleButton();
    this._updateActionBar();
  },

  _addToggleButton() {
    const existing = document.getElementById('chat-toggle-btn');
    if (existing) existing.remove();

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-sm';
    toggleBtn.id = 'chat-toggle-btn';
    toggleBtn.textContent = 'Terminal';
    toggleBtn.addEventListener('click', () => this._toggleTerminalFallback());

    const header = document.querySelector('.terminal-header');
    const stopBtn = document.getElementById('terminal-stop');
    if (header && stopBtn) {
      header.insertBefore(toggleBtn, stopBtn);
    }
  },

  // ─── Stream JSON event handler (NDJSON from -p --output-format stream-json) ───
  // Event format from Claude Code:
  //   system: {type:"system", subtype:"init"|"hook_started"|"hook_response", ...}
  //   assistant: {type:"assistant", message:{content:[{type:"text",text:"..."} | {type:"tool_use",name:"...",input:{...}}]}}
  //   user: {type:"user", message:{content:[{type:"tool_result",...}]}} (tool results echoed back)
  //   result: {type:"result", subtype:"success", result:"...", total_cost_usd:...}
  _handleStreamJsonEvent(event) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this._removeThinkingIndicator();
          this._setState('thinking');
          this._updateThinkingIndicator('Pensando');
        }
        break;

      case 'assistant': {
        var content = event.message && event.message.content;
        if (!Array.isArray(content)) break;
        this._removeThinkingIndicator();

        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (!block) continue;

          if (block.type === 'text' && block.text) {
            this._setState('responding');
            this._addMessage('assistant', block.text);
          } else if (block.type === 'tool_use') {
            this._setState('tool_exec');
            var toolName = block.name || 'Tool';
            var snippet = '';
            try { snippet = JSON.stringify(block.input || {}).substring(0, 200); } catch (e) {}
            this._addMessage('tool', toolName + '\n' + snippet);
          }
        }
        break;
      }

      case 'user':
        // Tool results echoed back - show thinking for next step
        this._setState('thinking');
        this._updateThinkingIndicator('Processando');
        break;

      case 'result':
        // Turn complete, waiting for next input.
        // Never show result.result text - it always duplicates the last assistant event text.
        this._removeThinkingIndicator();
        this._setState('input_wait');
        break;
    }
  },

  // ─── Legacy StreamAnalyzer action handler (raw ANSI PTY parsing) ───
  _handleAction(action) {
    switch (action.kind) {
      case 'session_info': {
        var parts = [];
        if (action.version) parts.push('Claude Code v' + action.version);
        if (action.model) parts.push(action.model);
        if (action.workingDirectory) parts.push(action.workingDirectory);
        if (action.bypassMode) parts.push('Bypass mode: ON');
        if (parts.length > 0) this._addMessage('system', parts.join(' \u00B7 '));
        break;
      }

      case 'thinking':
        this._setState('thinking');
        this._updateThinkingIndicator(action.status || 'Pensando');
        break;

      case 'response_text':
        this._setState('responding');
        this._addMessage('assistant', action.text);
        break;

      case 'tool_execution':
        this._setState('tool_exec');
        this._addMessage('tool', action.toolName + '\n' + (action.snippet || ''));
        break;

      case 'tool_approval':
        this._setState('tool_approval');
        this._addMessage('approval', 'Permitir ' + action.toolName + '?');
        break;

      case 'input_prompt':
        this._setState('input_wait');
        break;

      case 'agent_activity':
        this._addMessage('system', 'Executando ' + action.count + ' agente(s) ' + action.agentType);
        break;

      case 'session_ended':
        this._addMessage('system', 'Sessao finalizada (codigo: ' + action.exitCode + ')');
        this._setState('idle');
        break;
    }
  },

  _addMessage(type, content) {
    if (!content || !content.trim()) return;

    // For assistant messages, merge with last assistant message if recent (within 2s)
    var lastMsg = this._messages[this._messages.length - 1];
    if (type === 'assistant' && lastMsg && lastMsg.type === 'assistant' &&
        (Date.now() - lastMsg.timestamp) < 2000) {
      lastMsg.content += '\n' + content;
      lastMsg.timestamp = Date.now();
      var list = document.getElementById('chat-messages');
      if (list && list.lastElementChild) {
        var msgEl = list.lastElementChild;
        if (msgEl.classList.contains('chat-msg-assistant')) {
          var contentEl = msgEl.querySelector('.chat-msg-content');
          if (contentEl) {
            contentEl.innerHTML = '';
            lastMsg.content.split('\n').forEach(function(line, i) {
              if (i > 0) contentEl.appendChild(document.createElement('br'));
              contentEl.appendChild(document.createTextNode(line));
            });
          }
          list.scrollTop = list.scrollHeight;
          return;
        }
      }
    }

    var msg = { type: type, content: content, timestamp: Date.now() };
    this._messages.push(msg);

    var list = document.getElementById('chat-messages');
    if (!list) return;

    this._renderMessage(list, msg);
    list.scrollTop = list.scrollHeight;
  },

  _renderMessage(list, msg) {
    var msgEl = document.createElement('div');
    msgEl.className = 'chat-msg chat-msg-' + msg.type;

    var contentEl = document.createElement('div');
    contentEl.className = 'chat-msg-content';

    if (msg.type === 'tool') {
      var lines = msg.content.split('\n');
      var toolName = document.createElement('div');
      toolName.className = 'chat-tool-name';
      toolName.textContent = lines[0] || '';
      contentEl.appendChild(toolName);

      var rest = lines.slice(1).join('\n').trim();
      if (rest) {
        var snippet = document.createElement('pre');
        snippet.className = 'chat-tool-snippet';
        snippet.textContent = rest;
        contentEl.appendChild(snippet);
      }
    } else {
      var lines = msg.content.split('\n');
      lines.forEach(function(line, i) {
        if (i > 0) contentEl.appendChild(document.createElement('br'));
        contentEl.appendChild(document.createTextNode(line));
      });
    }

    msgEl.appendChild(contentEl);
    list.appendChild(msgEl);
  },

  _updateThinkingIndicator(status) {
    var indicator = document.getElementById('chat-thinking-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'chat-msg chat-msg-thinking';
      indicator.id = 'chat-thinking-indicator';

      var dots = document.createElement('div');
      dots.className = 'chat-thinking-dots';
      dots.innerHTML = '<span></span><span></span><span></span>';

      var textSpan = document.createElement('span');
      textSpan.className = 'chat-thinking-text';

      indicator.appendChild(dots);
      indicator.appendChild(textSpan);

      var list = document.getElementById('chat-messages');
      if (list) list.appendChild(indicator);
    }

    var textEl = indicator.querySelector('.chat-thinking-text');
    if (textEl) textEl.textContent = status + '...';

    var list = document.getElementById('chat-messages');
    if (list) list.scrollTop = list.scrollHeight;
  },

  _removeThinkingIndicator() {
    var indicator = document.getElementById('chat-thinking-indicator');
    if (indicator) indicator.remove();
  },

  _setState(newState) {
    var prevState = this._state;
    this._state = newState;

    if (prevState === 'thinking' && newState !== 'thinking') {
      this._removeThinkingIndicator();
    }

    this._updateActionBar();
  },

  _updateActionBar() {
    var bar = document.getElementById('chat-action-bar');
    var inputArea = document.getElementById('chat-input-area');
    if (!bar) return;

    bar.innerHTML = '';

    // Input is ALWAYS visible
    if (inputArea) inputArea.style.display = 'flex';

    switch (this._state) {
      case 'tool_approval': {
        // Only in legacy TUI mode (stream-json uses bypass)
        var approveBtn = document.createElement('button');
        approveBtn.className = 'btn btn-success chat-action-btn';
        approveBtn.textContent = 'Aprovar (Y)';
        approveBtn.addEventListener('click', () => this._sendRaw('y'));

        var rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn-danger chat-action-btn';
        rejectBtn.textContent = 'Rejeitar (N)';
        rejectBtn.addEventListener('click', () => this._sendRaw('n'));

        bar.appendChild(approveBtn);
        bar.appendChild(rejectBtn);
        break;
      }

      case 'thinking':
      case 'tool_exec':
      case 'responding': {
        var interruptBtn = document.createElement('button');
        interruptBtn.className = 'btn btn-danger chat-action-btn';
        interruptBtn.textContent = 'Interromper (Esc)';
        interruptBtn.addEventListener('click', () => this._sendRaw('\x1b'));

        bar.appendChild(interruptBtn);
        break;
      }

      case 'input_wait': {
        setTimeout(function() {
          var input = document.getElementById('chat-input');
          if (input) input.focus();
        }, 50);
        break;
      }

      default: {
        var ctrlCBtn = document.createElement('button');
        ctrlCBtn.className = 'btn btn-sm btn-danger';
        ctrlCBtn.textContent = 'Ctrl+C';
        ctrlCBtn.addEventListener('click', () => this._sendRaw('\x03'));
        bar.appendChild(ctrlCBtn);
        break;
      }
    }
  },

  _sendMessage() {
    var input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;

    var text = input.value;
    input.value = '';

    this._addMessage('user', text);

    if (this._streamJson) {
      // Stream JSON: send structured message via stdin JSON
      API.sendStreamJsonInput(this._currentSessionId, text);
    } else {
      // Legacy TUI: send characters one by one like a real terminal, then Enter
      var sid = this._currentSessionId;
      var chars = text.split('');
      chars.forEach(function(ch, i) {
        setTimeout(function() { API.sendInput(sid, ch); }, i * 10);
      });
      setTimeout(function() { API.sendInput(sid, '\r'); }, chars.length * 10 + 20);
    }

    this._setState('thinking');
    this._updateThinkingIndicator('Processando');
  },

  _sendRaw(data) {
    if (!this._currentSessionId) return;

    if (this._streamJson) {
      // Stream-JSON mode has no PTY - use stop API for interrupts
      API.stopSession(this._currentSessionId);
      return;
    }

    API.sendInput(this._currentSessionId, data);

    if (this._state === 'tool_approval') {
      this._addMessage('user', data === 'y' ? 'Aprovado' : 'Rejeitado');
      this._setState('idle');
    }
  },

  _toggleTerminalFallback() {
    this._terminalFallback = !this._terminalFallback;
    var btn = document.getElementById('chat-toggle-btn');

    if (this._terminalFallback) {
      if (btn) btn.textContent = 'Chat';
      this._showFallbackTerminal();
    } else {
      if (btn) btn.textContent = 'Terminal';
      this._hideFallbackTerminal();
    }
  },

  _showFallbackTerminal() {
    var container = document.getElementById('terminal-container');
    container.className = '';
    container.innerHTML = '';

    this._fallbackTerm = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
      },
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      allowProposedApi: true,
    });

    this._fallbackFit = new FitAddon.FitAddon();
    this._fallbackTerm.loadAddon(this._fallbackFit);
    this._fallbackTerm.open(container);

    var self = this;
    setTimeout(function() {
      if (self._fallbackFit) {
        self._fallbackFit.fit();
        if (self._currentSessionId) {
          API.resizeTerminal(self._currentSessionId, self._fallbackTerm.cols, self._fallbackTerm.rows);
        }
      }
    }, 100);

    this._fallbackTerm.onData(function(data) {
      if (self._currentSessionId) {
        API.sendInput(self._currentSessionId, data);
      }
    });

    // Intercept Ctrl+C for copy, Ctrl+V for paste
    this._fallbackTerm.attachCustomKeyEventHandler(function(e) {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c') {
        var selection = self._fallbackTerm.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(function() {});
          self._fallbackTerm.clearSelection();
          return false;
        }
      }
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then(function(text) {
          if (text && self._currentSessionId) API.sendInput(self._currentSessionId, text);
        }).catch(function() {});
        return false;
      }
      return true;
    });

    this._fallbackTerm.write('\x1b[33m[Terminal raw - mostrando output ao vivo]\x1b[0m\r\n');

    this._fallbackResizeHandler = function() {
      if (self._fallbackFit) {
        self._fallbackFit.fit();
        if (self._currentSessionId && self._fallbackTerm) {
          API.resizeTerminal(self._currentSessionId, self._fallbackTerm.cols, self._fallbackTerm.rows);
        }
      }
    };
    window.addEventListener('resize', this._fallbackResizeHandler);
  },

  _hideFallbackTerminal() {
    if (this._fallbackResizeHandler) {
      window.removeEventListener('resize', this._fallbackResizeHandler);
      this._fallbackResizeHandler = null;
    }
    if (this._fallbackTerm) {
      this._fallbackTerm.dispose();
      this._fallbackTerm = null;
      this._fallbackFit = null;
    }

    // Rebuild chat UI and replay messages
    this._buildUI();
    var list = document.getElementById('chat-messages');
    if (list) {
      for (var i = 0; i < this._messages.length; i++) {
        this._renderMessage(list, this._messages[i]);
      }
      list.scrollTop = list.scrollHeight;
    }
  },

  close() {
    if (this._currentSessionId) {
      API.detachSession(this._currentSessionId);
    }

    if (this._streamJsonHandler) {
      API.off('terminal:stream-json', this._streamJsonHandler);
      this._streamJsonHandler = null;
    }
    if (this._actionHandler) {
      API.off('terminal:action', this._actionHandler);
      this._actionHandler = null;
    }
    if (this._exitHandler) {
      API.off('terminal:exit', this._exitHandler);
      this._exitHandler = null;
    }
    if (this._outputHandler) {
      API.off('terminal:output', this._outputHandler);
      this._outputHandler = null;
    }

    if (this._fallbackResizeHandler) {
      window.removeEventListener('resize', this._fallbackResizeHandler);
      this._fallbackResizeHandler = null;
    }
    if (this._fallbackTerm) {
      this._fallbackTerm.dispose();
      this._fallbackTerm = null;
      this._fallbackFit = null;
    }

    // Remove toggle button
    var toggleBtn = document.getElementById('chat-toggle-btn');
    if (toggleBtn) toggleBtn.remove();

    // Reset container
    var container = document.getElementById('terminal-container');
    if (container) {
      container.className = '';
      container.innerHTML = '';
    }

    this._currentSessionId = null;
    this._streamJson = false;
    this._messages = [];
    this._state = 'idle';

    document.getElementById('terminal-overlay').style.display = 'none';
    document.getElementById('terminal-stop').style.display = '';
  },

  // For read-only history, fall back to TerminalManager (no action stream for historical data)
  openReadOnly(title, output) {
    TerminalManager.openReadOnly(title, output);
  },

  get currentSessionId() {
    return this._currentSessionId;
  },
};

// ─── View Manager Router ───
// Returns ChatViewManager on mobile (<= 768px), TerminalManager on desktop.
function getViewManager() {
  if (window.innerWidth <= 768) return ChatViewManager;
  return TerminalManager;
}
