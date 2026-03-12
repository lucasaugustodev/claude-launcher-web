// ─── Chat View Manager ───
// Renders Claude Code sessions as a chat interface in the terminal overlay.
// Uses the same simple event-driven architecture as the floating chat.
// Interface: open, close, openReadOnly, currentSessionId

const ChatViewManager = {
  _currentSessionId: null,
  _streamJsonHandler: null,
  _exitHandler: null,
  _outputHandler: null,
  _messages: [],
  _status: 'idle', // idle | thinking | responding | input_wait | ended
  _lastSentText: null,
  _textBuffer: '',
  _flushTimer: null,
  // Terminal fallback
  _terminalFallback: false,
  _fallbackTerm: null,
  _fallbackFit: null,
  _fallbackResizeHandler: null,

  open(sessionId, { streamJson, previousSessionId } = {}) {
    this._currentSessionId = sessionId;
    this._messages = [];
    this._status = previousSessionId ? 'input_wait' : 'thinking';
    this._textBuffer = '';
    this._terminalFallback = false;
    this._fallbackTerm = null;
    this._lastSentText = null;

    this._buildUI();
    this._registerHandlers(sessionId);
    API.attachSession(sessionId);

    // If resuming, load previous session history first
    if (previousSessionId) {
      var self = this;
      API.getSessionOutputData(previousSessionId).then(function(data) {
        if (data && data.output) {
          self._replayOutput(data.output);
        }
        self._addMessage('system', 'Sessao retomada. Digite sua mensagem.');
        self._renderMessages();
      }).catch(function() {
        self._addMessage('system', 'Sessao retomada. Digite sua mensagem.');
        self._renderMessages();
      });
    }

    this._renderMessages();

    document.getElementById('terminal-overlay').style.display = 'flex';

    // Focus input
    var self = this;
    setTimeout(function() {
      var input = document.getElementById('chat-input');
      if (input) input.focus();
    }, 200);
  },

  _registerHandlers(sessionId) {
    // Clean up old handlers
    if (this._streamJsonHandler) API.off('terminal:stream-json', this._streamJsonHandler);
    if (this._exitHandler) API.off('terminal:exit', this._exitHandler);
    if (this._outputHandler) API.off('terminal:output', this._outputHandler);

    var self = this;

    this._streamJsonHandler = function(msg) {
      if (msg.sessionId !== sessionId) return;
      self._handleStreamEvent(msg.event);
    };

    this._exitHandler = function(msg) {
      if (msg.sessionId !== sessionId) return;
      self._flushTextBuffer();
      self._status = 'ended';
      self._addMessage('system', 'Sessao finalizada (codigo: ' + (msg.exitCode || 0) + ')');
      self._renderMessages();
    };

    this._outputHandler = function(msg) {
      if (msg.sessionId !== sessionId) return;
      if (self._terminalFallback && self._fallbackTerm) {
        self._fallbackTerm.write(msg.data);
      }
    };

    API.on('terminal:stream-json', this._streamJsonHandler);
    API.on('terminal:exit', this._exitHandler);
    API.on('terminal:output', this._outputHandler);
  },

  _handleStreamEvent(event) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this._status = 'thinking';
          this._renderMessages();
        }
        break;

      case 'assistant': {
        var content = event.message && event.message.content;
        if (!Array.isArray(content)) break;

        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (!block) continue;

          if (block.type === 'text' && block.text) {
            this._textBuffer += block.text;
            this._status = 'responding';
            // Auto-flush after short delay
            var self = this;
            clearTimeout(this._flushTimer);
            this._flushTimer = setTimeout(function() { self._flushTextBuffer(); }, 400);
          } else if (block.type === 'tool_use') {
            this._flushTextBuffer();
            var toolName = block.name || 'Tool';
            var snippet = '';
            try { snippet = JSON.stringify(block.input || {}).substring(0, 200); } catch (e) {}
            this._addMessage('tool', toolName + (snippet ? ': ' + snippet : ''));
            this._status = 'thinking';
            this._renderMessages();
          }
        }
        break;
      }

      case 'user':
        // Tool results - Claude is processing
        this._flushTextBuffer();
        this._status = 'thinking';
        this._renderMessages();
        break;

      case 'result':
        this._flushTextBuffer();
        this._status = 'input_wait';
        this._renderMessages();
        // Focus input
        var self = this;
        setTimeout(function() {
          var input = document.getElementById('chat-input');
          if (input) input.focus();
        }, 100);
        break;

      case 'user_input':
        if (event.text) {
          if (this._lastSentText === event.text) {
            this._lastSentText = null;
          } else {
            this._addMessage('user', event.text);
            this._renderMessages();
          }
        }
        break;
    }
  },

  _replayOutput(output) {
    if (!output) return;
    var lines = output.split('\n');
    var textBuf = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var event = JSON.parse(line);
        if (event.type === 'assistant' && event.message && event.message.content) {
          var content = event.message.content;
          for (var j = 0; j < content.length; j++) {
            var block = content[j];
            if (block.type === 'text' && block.text) {
              textBuf += block.text;
            } else if (block.type === 'tool_use') {
              // Flush accumulated text before tool
              if (textBuf.trim()) {
                this._addMessage('assistant', textBuf.trim());
                textBuf = '';
              }
              var toolName = block.name || 'Tool';
              var snippet = '';
              try { snippet = JSON.stringify(block.input || {}).substring(0, 200); } catch (e) {}
              this._addMessage('tool', toolName + (snippet ? ': ' + snippet : ''));
            }
          }
        } else if (event.type === 'user_input' && event.text) {
          // Flush text before user message
          if (textBuf.trim()) {
            this._addMessage('assistant', textBuf.trim());
            textBuf = '';
          }
          this._addMessage('user', event.text);
        } else if (event.type === 'result') {
          // Flush remaining text
          if (textBuf.trim()) {
            this._addMessage('assistant', textBuf.trim());
            textBuf = '';
          }
        }
      } catch (e) {} // skip non-JSON
    }
    // Flush any remaining text
    if (textBuf.trim()) {
      this._addMessage('assistant', textBuf.trim());
    }
  },

  _flushTextBuffer() {
    clearTimeout(this._flushTimer);
    var text = this._textBuffer.trim();
    this._textBuffer = '';
    if (text) {
      this._addMessage('assistant', text);
      this._renderMessages();
    }
  },

  _addMessage(role, text) {
    if (!text) return;
    this._messages.push({ role: role, text: text });
  },

  _renderMessages() {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = '';

    for (var i = 0; i < this._messages.length; i++) {
      var m = this._messages[i];
      var div = document.createElement('div');
      div.className = 'chat-msg chat-msg-' + m.role;

      var contentEl = document.createElement('div');
      contentEl.className = 'chat-msg-content';

      if (m.role === 'tool') {
        var parts = m.text.split(': ');
        var toolLabel = document.createElement('strong');
        toolLabel.textContent = parts[0];
        contentEl.appendChild(toolLabel);
        if (parts.length > 1) {
          var snippetEl = document.createElement('pre');
          snippetEl.style.cssText = 'font-size:11px;opacity:0.7;margin:4px 0 0;white-space:pre-wrap;word-break:break-all';
          snippetEl.textContent = parts.slice(1).join(': ');
          contentEl.appendChild(snippetEl);
        }
      } else {
        // Render text with line breaks
        var lines = m.text.split('\n');
        for (var j = 0; j < lines.length; j++) {
          if (j > 0) contentEl.appendChild(document.createElement('br'));
          contentEl.appendChild(document.createTextNode(lines[j]));
        }
      }

      div.appendChild(contentEl);
      container.appendChild(div);
    }

    // Typing indicator
    if (this._status === 'thinking') {
      var typing = document.createElement('div');
      typing.className = 'chat-msg chat-msg-thinking';
      typing.innerHTML = '<div class="chat-thinking-dots"><span></span><span></span><span></span></div>';
      container.appendChild(typing);
    }

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  },

  _buildUI() {
    var container = document.getElementById('terminal-container');
    container.innerHTML = '';
    container.className = 'chat-view-container';

    // Message list
    var messageList = document.createElement('div');
    messageList.className = 'chat-messages';
    messageList.id = 'chat-messages';

    // Input area
    var inputArea = document.createElement('div');
    inputArea.className = 'chat-input-area';
    inputArea.id = 'chat-input-area';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-input';
    input.id = 'chat-input';
    input.placeholder = 'Digite uma mensagem...';
    input.autocomplete = 'off';

    var sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-primary chat-send-btn';
    sendBtn.id = 'chat-send-btn';
    sendBtn.textContent = 'Enviar';

    var self = this;
    sendBtn.addEventListener('click', function() { self._sendMessage(); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        self._sendMessage();
      }
    });

    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);

    container.appendChild(messageList);
    container.appendChild(inputArea);

    // Add terminal toggle button to header
    this._addToggleButton();
  },

  _addToggleButton() {
    var existing = document.getElementById('chat-toggle-btn');
    if (existing) existing.remove();

    var header = document.querySelector('.terminal-header');
    var stopBtn = document.getElementById('terminal-stop');
    if (!header || !stopBtn) return;

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-sm';
    toggleBtn.id = 'chat-toggle-btn';
    toggleBtn.textContent = 'Terminal';

    var self = this;
    toggleBtn.addEventListener('click', function() { self._toggleTerminalFallback(); });
    header.insertBefore(toggleBtn, stopBtn);
  },

  _sendMessage() {
    var input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;

    var text = input.value.trim();
    input.value = '';

    this._addMessage('user', text);
    this._lastSentText = text;

    API.sendStreamJsonInput(this._currentSessionId, text);
    this._status = 'thinking';
    this._renderMessages();
  },

  // ─── Terminal Fallback ───

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

    this._fallbackTerm.write('\x1b[33m[Terminal raw]\x1b[0m\r\n');

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
    this._renderMessages();
  },

  // ─── Public Interface ───

  close() {
    if (this._currentSessionId) {
      API.detachSession(this._currentSessionId);
    }
    if (this._streamJsonHandler) {
      API.off('terminal:stream-json', this._streamJsonHandler);
      this._streamJsonHandler = null;
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

    var toggleBtn = document.getElementById('chat-toggle-btn');
    if (toggleBtn) toggleBtn.remove();

    var container = document.getElementById('terminal-container');
    if (container) {
      container.className = '';
      container.innerHTML = '';
    }

    this._currentSessionId = null;
    this._messages = [];
    this._status = 'idle';

    document.getElementById('terminal-overlay').style.display = 'none';
    document.getElementById('terminal-stop').style.display = '';
  },

  openReadOnly(title, output) {
    TerminalManager.openReadOnly(title, output);
  },

  get currentSessionId() {
    return this._currentSessionId;
  },
};

function getViewManager() {
  return ChatViewManager;
}
