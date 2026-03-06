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
  // Voice + Avatar
  _voiceHead: null,
  _voiceAvatarReady: false,
  _voiceRecording: false,
  _voiceMediaRecorder: null,
  _voiceAudioChunks: [],
  _voiceTimerInterval: null,
  _voiceAvatarVisible: true,
  _voiceSpeaking: false,
  _voiceTtsQueue: [],    // queue of text chunks to speak
  _voiceTtsPlaying: false,
  _voiceSentenceBuffer: '', // accumulates text until sentence boundary

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

    // Raw output handler — only used for terminal fallback mode
    this._outputHandler = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (this._terminalFallback && this._fallbackTerm) {
        this._fallbackTerm.write(msg.data);
      }
    };

    API.on('terminal:exit', this._exitHandler);
    API.on('terminal:output', this._outputHandler);

    API.attachSession(sessionId);

    if (this._streamJson) {
      this._addMessage('system', 'Sessao iniciada. Digite sua mensagem.');
      this._setState('input_wait');
    }

    document.getElementById('terminal-overlay').style.display = 'flex';

    // Init avatar after UI is ready (delayed to let terminal-title be set)
    var self = this;
    setTimeout(function() { self._maybeInitVoiceAvatar(); }, 500);
  },

  _isVoiceAgentSession() {
    var title = (document.getElementById('terminal-title') || {}).textContent || '';
    return title.toLowerCase().indexOf('manager-gestor') !== -1;
  },

  _maybeInitVoiceAvatar() {
    if (this._isVoiceAgentSession()) {
      this._initVoiceAvatar();
      // Show avatar panel and mic
      var panel = document.getElementById('chat-voice-avatar-panel');
      if (panel) panel.classList.remove('hidden');
    } else {
      // Hide avatar panel for non-voice sessions
      var panel = document.getElementById('chat-voice-avatar-panel');
      if (panel) panel.classList.add('hidden');
    }
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

    // Mic button
    const micBtn = document.createElement('button');
    micBtn.className = 'chat-mic-btn';
    micBtn.id = 'chat-mic-btn';
    micBtn.innerHTML = '&#127908;';
    micBtn.title = 'Clique para falar';
    micBtn.addEventListener('click', () => this._toggleVoiceRecording());

    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-primary chat-send-btn';
    sendBtn.id = 'chat-send-btn';
    sendBtn.textContent = 'Enviar';
    sendBtn.addEventListener('click', () => this._sendMessage());

    inputArea.appendChild(micBtn);
    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);

    // Avatar panel (floating, top-right)
    const avatarPanel = document.createElement('div');
    avatarPanel.className = 'chat-voice-avatar-panel' + (this._voiceAvatarVisible ? '' : ' hidden');
    avatarPanel.id = 'chat-voice-avatar-panel';

    const avatarLoading = document.createElement('div');
    avatarLoading.className = 'chat-voice-avatar-loading';
    avatarLoading.id = 'chat-voice-avatar-loading';
    avatarLoading.textContent = 'Carregando avatar...';
    avatarPanel.appendChild(avatarLoading);

    container.appendChild(messageList);
    container.appendChild(actionBar);
    container.appendChild(inputArea);
    container.appendChild(avatarPanel);

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
    const existingAvToggle = document.getElementById('chat-avatar-toggle');
    if (existingAvToggle) existingAvToggle.remove();
    const existingVoiceSel = document.getElementById('chat-voice-select');
    if (existingVoiceSel) existingVoiceSel.remove();

    const header = document.querySelector('.terminal-header');
    const stopBtn = document.getElementById('terminal-stop');
    if (!header || !stopBtn) return;

    // Voice select
    const voiceSelect = document.createElement('select');
    voiceSelect.className = 'chat-voice-select';
    voiceSelect.id = 'chat-voice-select';
    voiceSelect.innerHTML = '<option value="pt-BR-AntonioNeural" selected>Antonio</option><option value="pt-BR-FranciscaNeural">Francisca</option><option value="pt-BR-ThalitaMultilingualNeural">Thalita</option>';
    header.insertBefore(voiceSelect, stopBtn);

    // Avatar toggle
    const avatarToggle = document.createElement('button');
    avatarToggle.className = 'btn btn-sm';
    avatarToggle.id = 'chat-avatar-toggle';
    avatarToggle.textContent = 'Avatar';
    avatarToggle.addEventListener('click', () => {
      this._voiceAvatarVisible = !this._voiceAvatarVisible;
      var panel = document.getElementById('chat-voice-avatar-panel');
      if (panel) panel.classList.toggle('hidden', !this._voiceAvatarVisible);
    });
    header.insertBefore(avatarToggle, stopBtn);

    // Terminal toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-sm';
    toggleBtn.id = 'chat-toggle-btn';
    toggleBtn.textContent = 'Terminal';
    toggleBtn.addEventListener('click', () => this._toggleTerminalFallback());
    header.insertBefore(toggleBtn, stopBtn);
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
            // Stream sentences to avatar TTS
            if (this._isVoiceAgentSession()) {
              this._feedVoiceText(block.text);
            }
          } else if (block.type === 'tool_use') {
            if (block.name === 'AskUserQuestion' && block.input && block.input.questions) {
              // Deduplicate: skip if we already have an active (unsent) ask
              if (this._ask && !this._ask.sent) break;
              this._setState('input_wait');
              this._renderAskUserQuestion(block.id, block.input.questions);
            } else {
              this._setState('tool_exec');
              var toolName = block.name || 'Tool';
              var snippet = '';
              try { snippet = JSON.stringify(block.input || {}).substring(0, 200); } catch (e) {}
              this._addMessage('tool', toolName + '\n' + snippet);
            }
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
        // Flush any remaining buffered text to TTS
        this._flushVoiceBuffer();
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
        if (this._isVoiceAgentSession() && action.text) {
          this._feedVoiceText(action.text);
        }
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

  // ─── AskUserQuestion Renderer ───
  // Paginated single-card: one question at a time, dots to navigate, auto-advance on select.
  // No global IDs — all refs stored on _ask object to avoid conflicts.
  _ask: null,

  _renderAskUserQuestion(toolUseId, questions) {
    var list = document.getElementById('chat-messages');
    if (!list) return;
    var self = this;

    var ask = {
      questions: questions,
      selections: {},
      page: 0,
      sent: false,
      card: null,
      pageSlot: null,
      dotsEl: null,
      skipBtn: null,
      sendBtn: null,
    };
    this._ask = ask;

    // Store for replay
    this._messages.push({
      type: 'question',
      content: JSON.stringify(questions),
      toolUseId: toolUseId,
      timestamp: Date.now()
    });

    // ── Build card ──
    var card = document.createElement('div');
    card.className = 'chat-msg chat-msg-question';
    ask.card = card;

    // Page content slot
    var pageSlot = document.createElement('div');
    pageSlot.className = 'chat-ask-page';
    ask.pageSlot = pageSlot;
    card.appendChild(pageSlot);

    // Footer (only if >1 question)
    if (questions.length > 1) {
      var footer = document.createElement('div');
      footer.className = 'chat-ask-footer';

      var dotsEl = document.createElement('div');
      dotsEl.className = 'chat-ask-dots';
      ask.dotsEl = dotsEl;
      footer.appendChild(dotsEl);

      var btnsRow = document.createElement('div');
      btnsRow.className = 'chat-ask-footer-btns';

      var skipBtn = document.createElement('button');
      skipBtn.className = 'btn btn-sm chat-ask-skip';
      skipBtn.textContent = 'Pular';
      skipBtn.addEventListener('click', function() { self._askGoNext(); });
      ask.skipBtn = skipBtn;
      btnsRow.appendChild(skipBtn);

      var sendBtn = document.createElement('button');
      sendBtn.className = 'btn btn-primary btn-sm chat-ask-send-btn';
      sendBtn.textContent = 'Enviar (0/' + questions.length + ')';
      sendBtn.disabled = true;
      sendBtn.addEventListener('click', function() { self._submitAskAnswers(); });
      ask.sendBtn = sendBtn;
      btnsRow.appendChild(sendBtn);

      footer.appendChild(btnsRow);
      card.appendChild(footer);
    }

    list.appendChild(card);

    // Render first page immediately (no animation)
    this._askBuildPage(0, false);
    this._askUpdateDots();
    list.scrollTop = list.scrollHeight;
  },

  _askBuildPage(idx, animate) {
    var ask = this._ask;
    if (!ask || idx >= ask.questions.length) return;
    ask.page = idx;
    var q = ask.questions[idx];
    var self = this;
    var slot = ask.pageSlot;
    if (!slot) return;

    var render = function() {
      slot.innerHTML = '';

      if (q.header) {
        var hdr = document.createElement('div');
        hdr.className = 'chat-question-header';
        hdr.textContent = q.header;
        slot.appendChild(hdr);
      }

      var qText = document.createElement('div');
      qText.className = 'chat-question-text';
      qText.textContent = q.question;
      slot.appendChild(qText);

      var optDiv = document.createElement('div');
      optDiv.className = 'chat-question-options';
      var sel = ask.selections[idx] || null;

      for (var o = 0; o < q.options.length; o++) {
        var opt = q.options[o];
        var btn = document.createElement('button');
        btn.className = 'btn chat-option-btn';
        if (sel === opt.label) btn.classList.add('chat-option-selected');
        else if (sel) btn.classList.add('chat-option-dimmed');
        btn.setAttribute('data-option-label', opt.label);

        var lbl = document.createElement('span');
        lbl.className = 'chat-option-label';
        lbl.textContent = opt.label;
        btn.appendChild(lbl);

        if (opt.description) {
          var desc = document.createElement('span');
          desc.className = 'chat-option-desc';
          desc.textContent = opt.description;
          btn.appendChild(desc);
        }

        btn.addEventListener('click', (function(label) {
          return function() { self._askSelect(idx, label); };
        })(opt.label));

        optDiv.appendChild(btn);
      }
      slot.appendChild(optDiv);

      if (animate) {
        slot.classList.add('chat-ask-page-enter');
        setTimeout(function() { slot.classList.remove('chat-ask-page-enter'); }, 200);
      }
    };

    if (animate) {
      slot.classList.add('chat-ask-page-exit');
      setTimeout(function() {
        slot.classList.remove('chat-ask-page-exit');
        render();
      }, 120);
    } else {
      render();
    }

    // Update skip visibility
    if (ask.skipBtn) {
      ask.skipBtn.style.display = (idx < ask.questions.length - 1) ? '' : 'none';
    }
  },

  _askUpdateDots() {
    var ask = this._ask;
    if (!ask || !ask.dotsEl) return;
    var dotsEl = ask.dotsEl;
    var self = this;
    dotsEl.innerHTML = '';

    for (var i = 0; i < ask.questions.length; i++) {
      var dot = document.createElement('button');
      dot.className = 'chat-ask-dot';
      if (i === ask.page) dot.classList.add('chat-ask-dot-active');
      if (ask.selections[i]) dot.classList.add('chat-ask-dot-answered');
      dot.setAttribute('title', (i + 1) + '/' + ask.questions.length +
        (ask.selections[i] ? ' — ' + ask.selections[i] : ''));
      dot.addEventListener('click', (function(idx) {
        return function() {
          if (!ask.sent) self._askBuildPage(idx, true);
          self._askUpdateDots();
        };
      })(i));
      dotsEl.appendChild(dot);
    }

    // Update send button
    if (ask.sendBtn) {
      var count = Object.keys(ask.selections).length;
      var total = ask.questions.length;
      ask.sendBtn.disabled = count === 0;
      if (count === total) {
        ask.sendBtn.textContent = 'Enviar Tudo (' + count + ')';
      } else {
        ask.sendBtn.textContent = 'Enviar (' + count + '/' + total + ')';
      }
    }
  },

  _askSelect(qIdx, label) {
    var ask = this._ask;
    if (!ask || ask.sent) return;
    ask.selections[qIdx] = label;

    // Highlight selected, dim others
    var btns = ask.pageSlot.querySelectorAll('.chat-option-btn');
    for (var b = 0; b < btns.length; b++) {
      if (btns[b].getAttribute('data-option-label') === label) {
        btns[b].classList.add('chat-option-selected');
        btns[b].classList.remove('chat-option-dimmed');
      } else {
        btns[b].classList.remove('chat-option-selected');
        btns[b].classList.add('chat-option-dimmed');
      }
    }

    this._askUpdateDots();

    // Auto-advance or auto-submit
    var self = this;
    var total = ask.questions.length;

    if (total === 1) {
      // Single question — submit immediately
      setTimeout(function() { self._submitAskAnswers(); }, 400);
      return;
    }

    var next = null;
    for (var i = qIdx + 1; i < total; i++) {
      if (!ask.selections[i]) { next = i; break; }
    }
    if (next === null) {
      for (var i = 0; i <= qIdx; i++) {
        if (!ask.selections[i]) { next = i; break; }
      }
    }

    if (next !== null) {
      setTimeout(function() {
        self._askBuildPage(next, true);
        self._askUpdateDots();
      }, 400);
    } else {
      // All answered
      setTimeout(function() { self._submitAskAnswers(); }, 600);
    }
  },

  _askGoNext() {
    var ask = this._ask;
    if (!ask) return;
    var next = ask.page + 1;
    if (next >= ask.questions.length) next = 0;
    this._askBuildPage(next, true);
    this._askUpdateDots();
  },

  _submitAskAnswers() {
    var ask = this._ask;
    if (!ask || ask.sent) return;
    var count = Object.keys(ask.selections).length;
    if (count === 0) return;
    ask.sent = true;

    var answers = [];
    for (var q = 0; q < ask.questions.length; q++) {
      if (ask.selections[q]) answers.push(ask.selections[q]);
    }
    var answerText = answers.join('\n');

    this._addMessage('user', answerText);

    // Lock card
    if (ask.card) ask.card.classList.add('chat-ask-card-sent');
    if (ask.sendBtn) { ask.sendBtn.textContent = 'Enviado'; ask.sendBtn.disabled = true; }
    if (ask.skipBtn) ask.skipBtn.style.display = 'none';

    // Send
    if (this._streamJson) {
      API.sendStreamJsonInput(this._currentSessionId, answerText);
    } else {
      var sid = this._currentSessionId;
      var chars = answerText.split('');
      chars.forEach(function(ch, i) {
        setTimeout(function() { API.sendInput(sid, ch); }, i * 10);
      });
      setTimeout(function() { API.sendInput(sid, '\r'); }, chars.length * 10 + 20);
    }

    this._setState('thinking');
    this._updateThinkingIndicator('Processando');
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
    } else if (msg.type === 'question') {
      // Replay saved questions as static summary
      try {
        var questions = JSON.parse(msg.content);
        if (!Array.isArray(questions)) questions = [questions];
        for (var qi = 0; qi < questions.length; qi++) {
          var qData = questions[qi];
          if (qi > 0) {
            var sep = document.createElement('hr');
            sep.className = 'chat-question-sep';
            contentEl.appendChild(sep);
          }
          if (qData.header) {
            var hdr = document.createElement('div');
            hdr.className = 'chat-question-header';
            hdr.textContent = qData.header;
            contentEl.appendChild(hdr);
          }
          var qt = document.createElement('div');
          qt.className = 'chat-question-text';
          qt.textContent = qData.question;
          contentEl.appendChild(qt);
        }
      } catch (e) {
        contentEl.textContent = msg.content;
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

  // ─── Voice + Avatar Methods ───

  _initVoiceAvatar() {
    var self = this;
    if (this._voiceHead) return; // already initialized

    import('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs').then(function(mod) {
      var TalkingHead = mod.TalkingHead;
      var avatarContainer = document.getElementById('chat-voice-avatar-panel');
      var loading = document.getElementById('chat-voice-avatar-loading');
      if (!avatarContainer) return;

      self._voiceHead = new TalkingHead(avatarContainer, {
        lipsyncModules: ['en', 'fi'],
        cameraView: 'head',
        cameraRotateEnable: false,
        cameraPanEnable: false,
        cameraZoomEnable: false,
        avatarIdleEyeContact: 1,
        avatarIdleHeadMove: 0,
        modelFPS: 30
      });

      self._voiceHead.showAvatar({
        url: _url('api/voice/avatars/avatarsdk.glb'),
        body: 'M',
        avatarMood: 'neutral',
        lipsyncLang: 'en',
        retarget: {
          Neck: { z: -0.01, rx: -0.7 }, Neck1: { z: -0.01, rx: -0.7 }, Neck2: { z: -0.01, rx: -0.7 },
          LeftShoulder: { rz: -0.3 }, RightShoulder: { rz: 0.3 },
          scaleToEyesLevel: 1.0, origin: { y: -0.1 }
        },
        baseline: { headRotateX: -0.4, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }
      }, function(ev) {
        if (ev.lengthComputable && loading) {
          loading.textContent = Math.round(ev.loaded / ev.total * 100) + '%';
        }
      }).then(function() {
        if (loading) loading.style.display = 'none';
        self._voiceAvatarReady = true;
        self._voiceHead.setView('head', { cameraDistance: 0.6, cameraX: 0, cameraY: 0, cameraRotateX: 0, cameraRotateY: 0 });
        self._voiceHead.lookAtCamera(100);
        self._voiceLookInterval = setInterval(function() {
          if (self._voiceAvatarReady && self._voiceHead) self._voiceHead.lookAtCamera(500);
        }, 1000);
      }).catch(function(err) {
        console.error('Avatar load error:', err);
        if (loading) loading.textContent = 'Erro: ' + err.message;
      });
    }).catch(function(err) {
      console.error('TalkingHead import error:', err);
    });
  },

  _destroyVoiceAvatar() {
    if (this._voiceLookInterval) {
      clearInterval(this._voiceLookInterval);
      this._voiceLookInterval = null;
    }
    if (this._voiceHead) {
      try { this._voiceHead.close(); } catch(e) {}
      this._voiceHead = null;
    }
    this._voiceAvatarReady = false;
  },

  _toggleVoiceRecording() {
    if (this._voiceRecording) {
      this._stopVoiceRecording();
    } else {
      this._startVoiceRecording();
    }
  },

  _startVoiceRecording() {
    var self = this;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      self._voiceMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      self._voiceAudioChunks = [];
      self._voiceMediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) self._voiceAudioChunks.push(e.data); };
      self._voiceMediaRecorder.onstop = function() {
        stream.getTracks().forEach(function(t) { t.stop(); });
        self._transcribeAndSend();
      };
      self._voiceMediaRecorder.start();
      self._voiceRecording = true;

      var micBtn = document.getElementById('chat-mic-btn');
      if (micBtn) micBtn.classList.add('recording');

      var startTime = Date.now();
      self._voiceTimerInterval = setInterval(function() {
        var s = Math.floor((Date.now() - startTime) / 1000);
        if (micBtn) micBtn.title = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      }, 200);
    }).catch(function(err) {
      console.error('Mic error:', err);
    });
  },

  _stopVoiceRecording() {
    if (this._voiceMediaRecorder && this._voiceMediaRecorder.state !== 'inactive') {
      this._voiceMediaRecorder.stop();
    }
    this._voiceRecording = false;
    var micBtn = document.getElementById('chat-mic-btn');
    if (micBtn) {
      micBtn.classList.remove('recording');
      micBtn.title = 'Clique para falar';
    }
    clearInterval(this._voiceTimerInterval);
  },

  _transcribeAndSend() {
    var self = this;
    var blob = new Blob(this._voiceAudioChunks, { type: 'audio/webm' });
    var fd = new FormData();
    fd.append('audio', blob, 'recording.webm');

    this._addMessage('system', 'Transcrevendo...');

    fetch(_url('api/voice/transcribe'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API._token },
      body: fd
    }).then(function(resp) { return resp.json(); }).then(function(data) {
      // Remove "Transcrevendo..." message
      self._removeLastSystemMessage('Transcrevendo...');

      if (data.error || !data.text || !data.text.trim()) {
        self._addMessage('system', data.error || 'Nada detectado');
        return;
      }

      var text = data.text.trim();
      self._addMessage('user', text);

      // Send to terminal/session
      if (self._streamJson) {
        API.sendStreamJsonInput(self._currentSessionId, text);
      } else {
        var sid = self._currentSessionId;
        var chars = text.split('');
        chars.forEach(function(ch, i) {
          setTimeout(function() { API.sendInput(sid, ch); }, i * 10);
        });
        setTimeout(function() { API.sendInput(sid, '\r'); }, chars.length * 10 + 20);
      }

      self._setState('thinking');
      self._updateThinkingIndicator('Processando');
    }).catch(function(err) {
      self._removeLastSystemMessage('Transcrevendo...');
      self._addMessage('system', 'Erro transcrição: ' + err.message);
    });
  },

  _removeLastSystemMessage(text) {
    for (var i = this._messages.length - 1; i >= 0; i--) {
      if (this._messages[i].type === 'system' && this._messages[i].content === text) {
        this._messages.splice(i, 1);
        break;
      }
    }
    var list = document.getElementById('chat-messages');
    if (!list) return;
    var msgs = list.querySelectorAll('.chat-msg-system');
    for (var j = msgs.length - 1; j >= 0; j--) {
      if (msgs[j].textContent.trim() === text) {
        msgs[j].remove();
        break;
      }
    }
  },

  // Feed text incrementally - split into sentences for fast first-speech
  _feedVoiceText(text) {
    if (!this._isVoiceAgentSession()) return;
    this._voiceSentenceBuffer += text;

    // Split on sentence boundaries (. ! ?) followed by space or end
    var parts = this._voiceSentenceBuffer.split(/(?<=[.!?])\s+/);
    // Keep last part as buffer (may be incomplete)
    this._voiceSentenceBuffer = parts.pop() || '';

    for (var i = 0; i < parts.length; i++) {
      var sentence = parts[i].trim();
      if (sentence.length > 3) {
        this._voiceTtsQueue.push(sentence);
      }
    }
    // Start playing immediately - don't wait for full response
    this._processVoiceQueue();
  },

  // Flush remaining buffer when turn completes
  _flushVoiceBuffer() {
    var remaining = this._voiceSentenceBuffer.trim();
    this._voiceSentenceBuffer = '';
    if (remaining.length > 3 && this._isVoiceAgentSession()) {
      this._voiceTtsQueue.push(remaining);
      this._processVoiceQueue();
    }
  },

  // Process TTS queue sequentially
  _processVoiceQueue() {
    if (this._voiceTtsPlaying) return;
    if (this._voiceTtsQueue.length === 0) return;
    if (!this._voiceAvatarReady || !this._voiceHead) {
      this._voiceTtsQueue = [];
      return;
    }

    var self = this;
    var sentence = this._voiceTtsQueue.shift();
    var voiceSelect = document.getElementById('chat-voice-select');
    var voice = voiceSelect ? voiceSelect.value : 'pt-BR-AntonioNeural';

    this._voiceTtsPlaying = true;
    fetch(_url('api/voice/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API._token },
      body: JSON.stringify({ text: sentence.substring(0, 500), voice: voice, lipsync: true })
    }).then(function(resp) { return resp.json(); }).then(function(data) {
      if (data.error || !data.audio) {
        self._voiceTtsPlaying = false;
        self._processVoiceQueue();
        return;
      }

      var audioBytes = Uint8Array.from(atob(data.audio), function(c) { return c.charCodeAt(0); });
      return self._voiceHead.audioCtx.decodeAudioData(audioBytes.buffer.slice(0)).then(function(audioBuffer) {
        self._voiceHead.speakAudio({
          audio: audioBuffer,
          words: data.words || [],
          wtimes: data.wtimes || [],
          wdurations: data.wdurations || [],
          markers: [function() { self._voiceHead.lookAtCamera(100); }],
          mtimes: [0]
        });
        // Wait for audio to finish, then process next in queue
        var duration = audioBuffer.duration * 1000 + 300;
        setTimeout(function() {
          self._voiceTtsPlaying = false;
          self._processVoiceQueue();
        }, duration);
      });
    }).catch(function(err) {
      console.error('TTS error:', err);
      self._voiceTtsPlaying = false;
      self._processVoiceQueue();
    });
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

    // Destroy voice avatar
    this._destroyVoiceAvatar();
    this._voiceRecording = false;
    this._voiceSpeaking = false;
    this._voiceTtsQueue = [];
    this._voiceTtsPlaying = false;
    this._voiceSentenceBuffer = '';
    clearInterval(this._voiceTimerInterval);

    // Remove header buttons
    var toggleBtn = document.getElementById('chat-toggle-btn');
    if (toggleBtn) toggleBtn.remove();
    var avatarToggle = document.getElementById('chat-avatar-toggle');
    if (avatarToggle) avatarToggle.remove();
    var voiceSelect = document.getElementById('chat-voice-select');
    if (voiceSelect) voiceSelect.remove();

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
// Always returns ChatViewManager with stream-json for a unified chat experience.
// Toggle button allows switching to raw terminal view when needed.
function getViewManager() {
  return ChatViewManager;
}
