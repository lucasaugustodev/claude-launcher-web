// ─── Floating Chat Widget ───
// Global assistant bubble with 3D avatar, voice, and manager-gestor agent session.
// Persists across page navigation within the SPA.

(function() {
  'use strict';

  var FC = {
    sessionId: null,
    status: 'idle', // idle | connecting | thinking | responding | input_wait | ended
    open: false,
    messages: [],
    voiceHead: null,
    voiceAvatarReady: false,
    voiceRecording: false,
    voiceRecognition: null,
    continuousMode: false,
    continuousRecognition: null,
    ttsQueue: [],
    ttsPlaying: false,
    voiceBuffer: '',
    voiceLookInterval: null,
    unread: 0,
    streamHandler: null,
    exitHandler: null,
    _flushTimer: null,
  };

  // ─── Build DOM ───

  function buildWidget() {
    // Bubble
    var bubble = document.createElement('div');
    bubble.className = 'fchat-bubble';
    bubble.id = 'fchat-bubble';
    bubble.innerHTML = '<span class="fchat-bubble-icon">\uD83E\uDD16</span><span class="fchat-badge" id="fchat-badge"></span>';
    bubble.onclick = togglePanel;

    // Panel
    var panel = document.createElement('div');
    panel.className = 'fchat-panel';
    panel.id = 'fchat-panel';
    panel.innerHTML = [
      '<div class="fchat-header">',
      '  <div class="fchat-header-avatar" id="fchat-header-avatar"></div>',
      '  <div class="fchat-header-info">',
      '    <div class="fchat-header-name">Manager Gestor</div>',
      '    <div class="fchat-header-status" id="fchat-status"><span class="dot offline"></span>Offline</div>',
      '  </div>',
      '  <button class="fchat-close" id="fchat-close">\u2715</button>',
      '</div>',
      '<div class="fchat-avatar-area" id="fchat-avatar-area">',
      '  <div class="fchat-avatar-loading" id="fchat-avatar-loading">Carregando avatar...</div>',
      '</div>',
      '<div class="fchat-messages" id="fchat-messages"></div>',
      '<div class="fchat-input-area">',
      '  <button class="fchat-mic-btn" id="fchat-mic" title="Falar">\uD83C\uDF99</button>',
      '  <button class="fchat-mic-btn" id="fchat-continuous" title="Modo continuo">\u26AA</button>',
      '  <input class="fchat-input" id="fchat-input" placeholder="Digite uma mensagem..." autocomplete="off">',
      '  <button class="fchat-send-btn" id="fchat-send" title="Enviar">\u27A4</button>',
      '</div>',
    ].join('\n');

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    // Events
    document.getElementById('fchat-close').onclick = togglePanel;
    document.getElementById('fchat-send').onclick = sendMessage;
    document.getElementById('fchat-mic').onclick = togglePTT;
    document.getElementById('fchat-continuous').onclick = toggleContinuous;
    document.getElementById('fchat-input').onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
  }

  // ─── Toggle Panel ───

  function togglePanel() {
    FC.open = !FC.open;
    var panel = document.getElementById('fchat-panel');
    var bubble = document.getElementById('fchat-bubble');
    if (FC.open) {
      panel.classList.add('open');
      bubble.classList.add('active');
      FC.unread = 0;
      document.getElementById('fchat-badge').classList.remove('show');
      // Launch or resume session if not started yet
      if (!FC.sessionId && FC.status === 'idle') resumeOrLaunch();
      // Init avatar if not done
      if (!FC.voiceHead) initAvatar();
      // Focus input
      setTimeout(function() { document.getElementById('fchat-input').focus(); }, 200);
      scrollToBottom();
    } else {
      panel.classList.remove('open');
      bubble.classList.remove('active');
    }
  }

  // ─── Session Persistence ───

  var STORAGE_KEY = 'fchat_session_id';
  var MESSAGES_KEY = 'fchat_messages';

  function saveSession(id) {
    FC.sessionId = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch(e) {}
  }

  function clearSession() {
    FC.sessionId = null;
    FC.messages = [];
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(MESSAGES_KEY); } catch(e) {}
  }

  function getSavedSession() {
    try { return localStorage.getItem(STORAGE_KEY); } catch(e) { return null; }
  }

  function saveMessages() {
    try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(FC.messages.slice(-50))); } catch(e) {}
  }

  function loadMessages() {
    try {
      var raw = localStorage.getItem(MESSAGES_KEY);
      if (raw) { FC.messages = JSON.parse(raw); renderMessages(); scrollToBottom(); }
    } catch(e) {}
  }

  function registerHandlers(sessionId) {
    // Clean up old handlers
    if (FC.streamHandler) API.off('terminal:stream-json', FC.streamHandler);
    if (FC.exitHandler) API.off('terminal:exit', FC.exitHandler);

    FC.streamHandler = function(msg) {
      if (msg.sessionId !== sessionId) return;
      handleStreamEvent(msg.event);
    };
    FC.exitHandler = function(msg) {
      if (msg.sessionId !== sessionId) return;
      flushVoiceBuffer();
      FC.status = 'ended';
      updateStatus();
      clearSession();
      addMessage('system', 'Sessao encerrada.');
    };

    API.on('terminal:stream-json', FC.streamHandler);
    API.on('terminal:exit', FC.exitHandler);
  }

  // ─── Resume or Launch Agent Session ───

  function resumeOrLaunch() {
    var saved = getSavedSession();
    if (saved) {
      // Check if session is still alive
      var token = (API && API._token) || '';
      fetch(_url('api/sessions'), {
        headers: { 'Authorization': 'Bearer ' + token },
      }).then(function(r) { return r.json(); }).then(function(sessions) {
        var alive = sessions.some(function(s) { return s.id === saved; });
        if (alive) {
          FC.sessionId = saved;
          loadMessages();
          FC.status = 'input_wait';
          updateStatus();
          registerHandlers(saved);
          API.attachSession(saved);
        } else {
          clearSession();
          launchSession();
        }
      }).catch(function() {
        clearSession();
        launchSession();
      });
    } else {
      launchSession();
    }
  }

  function launchSession() {
    FC.status = 'connecting';
    updateStatus();

    var token = (API && API._token) || '';
    fetch(_url('api/claude-agents/launch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        agentName: 'manager-gestor',
        workingDirectory: null,
        mode: 'bypass',
        nodeMemory: null,
        streamJson: true,
        prompt: 'Ola! Apresente-se brevemente e pergunte como pode ajudar.',
      }),
    }).then(function(resp) {
      if (!resp.ok) throw new Error('Falha ao iniciar agente');
      return resp.json();
    }).then(function(session) {
      saveSession(session.id);
      FC.status = 'thinking';
      updateStatus();

      registerHandlers(session.id);
      API.attachSession(session.id);

    }).catch(function(err) {
      addMessage('system', 'Erro: ' + err.message);
      FC.status = 'idle';
      updateStatus();
    });
  }

  // ─── Handle Stream Events ───

  function handleStreamEvent(event) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          FC.status = 'thinking';
          updateStatus();
        }
        break;

      case 'assistant': {
        var content = event.message && event.message.content;
        if (!Array.isArray(content)) break;

        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === 'text' && block.text) {
            FC.voiceBuffer += block.text;
            FC.status = 'responding';
            updateStatus();
            // Auto-flush after short delay so text appears quickly
            clearTimeout(FC._flushTimer);
            FC._flushTimer = setTimeout(flushVoiceBuffer, 400);
          } else if (block.type === 'tool_use') {
            clearTimeout(FC._flushTimer);
            flushVoiceBuffer();
            FC.status = 'thinking';
            updateStatus();
          }
        }
        break;
      }

      case 'user':
        clearTimeout(FC._flushTimer);
        flushVoiceBuffer();
        FC.status = 'thinking';
        updateStatus();
        break;

      case 'result':
        clearTimeout(FC._flushTimer);
        flushVoiceBuffer();
        FC.status = 'input_wait';
        updateStatus();
        break;

      case 'user_input':
        // Replayed user message from buffer — skip if we just sent it
        if (event.text) {
          if (FC._lastSentText === event.text) {
            FC._lastSentText = null;
          } else {
            addMessage('user', event.text);
          }
        }
        break;
    }
  }

  // ─── Voice Buffer ───

  function flushVoiceBuffer() {
    var text = FC.voiceBuffer;
    FC.voiceBuffer = '';
    if (!text.trim()) return;

    addMessage('assistant', text.trim());
    feedTTS(text);

    if (!FC.open) {
      FC.unread++;
      document.getElementById('fchat-badge').classList.add('show');
    }
  }

  // ─── Messages ───

  function addMessage(role, text) {
    FC.messages.push({ role: role, text: text });
    saveMessages();
    renderMessages();
    scrollToBottom();
  }

  function renderMessages() {
    var container = document.getElementById('fchat-messages');
    if (!container) return;
    container.innerHTML = '';

    for (var i = 0; i < FC.messages.length; i++) {
      var m = FC.messages[i];
      var div = document.createElement('div');
      div.className = 'fchat-msg ' + m.role;
      div.textContent = m.text;
      container.appendChild(div);
    }

    // Typing indicator
    if (FC.status === 'thinking' || FC.status === 'connecting') {
      var typing = document.createElement('div');
      typing.className = 'fchat-typing';
      typing.innerHTML = '<span class="fchat-typing-dot"></span><span class="fchat-typing-dot"></span><span class="fchat-typing-dot"></span>';
      container.appendChild(typing);
    }
  }

  function scrollToBottom() {
    var el = document.getElementById('fchat-messages');
    if (el) setTimeout(function() { el.scrollTop = el.scrollHeight; }, 50);
  }

  // ─── Send Message ───

  function sendMessage() {
    var input = document.getElementById('fchat-input');
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';

    addMessage('user', text);
    FC._lastSentText = text; // Mark to skip duplicate user_input broadcast

    if (!FC.sessionId || FC.status === 'ended') {
      // Relaunch
      FC.status = 'idle';
      clearSession();
      launchSession();
      // Queue the message to send after connect
      var checkInterval = setInterval(function() {
        if (FC.sessionId && FC.status !== 'connecting') {
          clearInterval(checkInterval);
          API.sendStreamJsonInput(FC.sessionId, text);
          FC.status = 'thinking';
          updateStatus();
        }
      }, 500);
      return;
    }

    API.sendStreamJsonInput(FC.sessionId, text);
    FC.status = 'thinking';
    updateStatus();
  }

  // ─── Status ───

  function updateStatus() {
    var el = document.getElementById('fchat-status');
    if (!el) return;
    var labels = {
      idle: ['offline', 'Offline'],
      connecting: ['thinking', 'Conectando...'],
      thinking: ['thinking', 'Pensando...'],
      responding: ['online', 'Respondendo...'],
      input_wait: ['online', 'Online'],
      ended: ['offline', 'Encerrado'],
    };
    var s = labels[FC.status] || labels.idle;
    el.innerHTML = '<span class="dot ' + s[0] + '"></span>' + s[1];
    renderMessages(); // update typing indicator
  }

  // ─── 3D Avatar ───

  function initAvatar() {
    if (FC.voiceHead) return;
    var container = document.getElementById('fchat-header-avatar');
    if (!container) return;

    // Add loading indicator inside header avatar
    var loading = document.createElement('div');
    loading.className = 'fchat-avatar-loading';
    loading.id = 'fchat-avatar-loading';
    loading.textContent = 'Carregando...';
    container.appendChild(loading);

    import('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs').then(function(mod) {
      var TalkingHead = mod.TalkingHead;

      FC.voiceHead = new TalkingHead(container, {
        lipsyncModules: ['en', 'fi'],
        cameraView: 'head',
        cameraRotateEnable: false,
        cameraPanEnable: false,
        cameraZoomEnable: false,
        avatarIdleEyeContact: 1,
        avatarIdleHeadMove: 0,
        modelFPS: 30
      });

      FC.voiceHead.showAvatar({
        url: _url('avatars/avatarsdk.glb'),
        body: 'M',
        avatarMood: 'neutral',
        lipsyncLang: 'en',
        retarget: {
          Neck: { z: -0.01, rx: -0.7 }, Neck1: { z: -0.01, rx: -0.7 }, Neck2: { z: -0.01, rx: -0.7 },
          LeftShoulder: { rz: -0.3 }, RightShoulder: { rz: 0.3 },
          scaleToEyesLevel: 1.0, origin: { y: -0.1 },
        },
        baseline: { headRotateX: -0.4, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 },
      }, function(ev) {
        if (ev.lengthComputable && loading) {
          loading.textContent = Math.round(ev.loaded / ev.total * 100) + '%';
        }
      }).then(function() {
        if (loading) loading.style.display = 'none';
        FC.voiceAvatarReady = true;
        // Tighter framing for 120x120 container — closer to face
        FC.voiceHead.setView('head', { cameraDistance: 0.45, cameraX: 0, cameraY: 0.02, cameraRotateX: 0, cameraRotateY: 0 });
        FC.voiceHead.lookAtCamera(100);
        FC.voiceLookInterval = setInterval(function() {
          if (FC.voiceAvatarReady && FC.voiceHead) FC.voiceHead.lookAtCamera(500);
        }, 1000);
        // Make Three.js canvas background transparent
        if (FC.voiceHead.renderer) {
          FC.voiceHead.renderer.setClearColor(0x000000, 0);
        }
      }).catch(function(err) {
        console.error('FloatingChat avatar error:', err);
        if (loading) loading.textContent = 'Erro';
      });
    }).catch(function(err) {
      console.error('FloatingChat TalkingHead import error:', err);
    });
  }

  // ─── TTS ───

  function feedTTS(text) {
    // Split into sentences
    var sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i].trim();
      if (s.length > 2) {
        FC.ttsQueue.push(fetchTTS(s));
      }
    }
    processTTSQueue();
  }

  function fetchTTS(sentence) {
    var token = (API && API._token) || '';
    return fetch('api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ text: sentence.substring(0, 500), voice: 'pt-BR-AntonioNeural', lipsync: false }),
    }).then(function(r) {
      if (!r.ok) throw new Error('TTS error');
      return r.arrayBuffer();
    }).then(function(arrayBuf) {
      if (!arrayBuf) return null;
      // If avatar ready, decode for speakAudio; otherwise return raw buffer
      if (FC.voiceAvatarReady && FC.voiceHead && FC.voiceHead.audioCtx) {
        return FC.voiceHead.audioCtx.decodeAudioData(arrayBuf).then(function(audioBuffer) {
          var words = sentence.split(/\s+/);
          var avgDuration = (audioBuffer.duration * 1000) / Math.max(words.length, 1);
          var wtimes = [];
          var wdurations = [];
          for (var i = 0; i < words.length; i++) {
            wtimes.push(Math.round(i * avgDuration));
            wdurations.push(Math.round(avgDuration * 0.8));
          }
          return { audioBuffer: audioBuffer, words: words, wtimes: wtimes, wdurations: wdurations };
        });
      }
      return { rawBuffer: arrayBuf };
    }).catch(function(err) {
      console.error('FloatingChat TTS error:', err);
      return null;
    });
  }

  function processTTSQueue() {
    if (FC.ttsPlaying || FC.ttsQueue.length === 0) return;

    // If too many queued, skip old ones
    if (FC.ttsQueue.length > 5) {
      FC.ttsQueue = FC.ttsQueue.slice(-2);
    }

    var promise = FC.ttsQueue.shift();
    FC.ttsPlaying = true;

    promise.then(function(ttsData) {
      if (!ttsData) {
        FC.ttsPlaying = false;
        processTTSQueue();
        return;
      }

      // Play via avatar with lipsync
      if (ttsData.audioBuffer && FC.voiceAvatarReady && FC.voiceHead) {
        try {
          FC.voiceHead.speakAudio({
            audio: ttsData.audioBuffer,
            words: ttsData.words,
            wtimes: ttsData.wtimes,
            wdurations: ttsData.wdurations,
            markers: [function() { FC.voiceHead.lookAtCamera(100); }],
            mtimes: [0]
          });
          var duration = ttsData.audioBuffer.duration * 1000;
          setTimeout(function() {
            FC.ttsPlaying = false;
            processTTSQueue();
          }, duration + 100);
          return;
        } catch (e) {
          console.error('FloatingChat speakAudio error:', e);
        }
      }

      // Fallback: plain audio element
      var buf = ttsData.rawBuffer || ttsData.audioBuffer;
      if (!buf) { FC.ttsPlaying = false; processTTSQueue(); return; }
      var blob = new Blob([buf], { type: 'audio/mpeg' });
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      audio.onended = function() {
        URL.revokeObjectURL(url);
        FC.ttsPlaying = false;
        processTTSQueue();
      };
      audio.onerror = function() {
        URL.revokeObjectURL(url);
        FC.ttsPlaying = false;
        processTTSQueue();
      };
      audio.play().catch(function() {
        FC.ttsPlaying = false;
        processTTSQueue();
      });
    }).catch(function() {
      FC.ttsPlaying = false;
      processTTSQueue();
    });
  }

  // ─── PTT (Push to Talk) ───

  function togglePTT() {
    if (FC.voiceRecording) {
      stopPTT();
    } else {
      startPTT();
    }
  }

  function startPTT() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { addMessage('system', 'Speech API nao suportada'); return; }

    var recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    FC.voiceRecognition = recognition;
    FC.voiceRecording = true;

    var btn = document.getElementById('fchat-mic');
    if (btn) btn.classList.add('recording');

    recognition.onresult = function(e) {
      var text = e.results[0][0].transcript.trim();
      if (text) {
        document.getElementById('fchat-input').value = text;
        sendMessage();
      }
    };
    recognition.onerror = function(e) {
      if (e.error !== 'aborted') addMessage('system', 'Erro: ' + e.error);
      FC.voiceRecording = false;
      if (btn) btn.classList.remove('recording');
    };
    recognition.onend = function() {
      FC.voiceRecording = false;
      if (btn) btn.classList.remove('recording');
    };
    recognition.start();
  }

  function stopPTT() {
    if (FC.voiceRecognition) { FC.voiceRecognition.abort(); FC.voiceRecognition = null; }
    FC.voiceRecording = false;
    var btn = document.getElementById('fchat-mic');
    if (btn) btn.classList.remove('recording');
  }

  // ─── Continuous Listening ───

  function toggleContinuous() {
    if (FC.continuousMode) {
      stopContinuous();
    } else {
      startContinuous();
    }
  }

  function startContinuous() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { addMessage('system', 'Speech API nao suportada'); return; }

    if (FC.voiceRecording) stopPTT();

    var recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    FC.continuousRecognition = recognition;
    FC.continuousMode = true;

    var btn = document.getElementById('fchat-continuous');
    if (btn) { btn.classList.add('continuous-active'); btn.innerHTML = '\uD83D\uDD34'; btn.title = 'Parar escuta continua'; }

    recognition.onresult = function(e) {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          var text = e.results[i][0].transcript.trim();
          if (text) {
            document.getElementById('fchat-input').value = text;
            sendMessage();
          }
        }
      }
    };

    recognition.onerror = function(e) {
      if (e.error === 'no-speech') return;
      if (e.error !== 'aborted') addMessage('system', 'Erro continuo: ' + e.error);
      if (e.error === 'not-allowed') stopContinuous();
    };

    recognition.onend = function() {
      // Auto-restart if still in continuous mode
      if (FC.continuousMode && FC.continuousRecognition) {
        try { recognition.start(); } catch(ex) { stopContinuous(); }
      }
    };

    recognition.start();
    addMessage('system', 'Modo continuo ativado');
  }

  function stopContinuous() {
    FC.continuousMode = false;
    if (FC.continuousRecognition) {
      try { FC.continuousRecognition.abort(); } catch(e) {}
      FC.continuousRecognition = null;
    }
    var btn = document.getElementById('fchat-continuous');
    if (btn) { btn.classList.remove('continuous-active'); btn.innerHTML = '\u26AA'; btn.title = 'Modo continuo (escuta aberta)'; }
    addMessage('system', 'Modo continuo desativado');
  }

  // ─── Init ───

  function init() {
    // Wait for API to be ready
    if (typeof API === 'undefined') {
      setTimeout(init, 200);
      return;
    }
    buildWidget();
    // Watch for auth and pre-launch session when token becomes available
    waitForAuth();
  }

  function waitForAuth() {
    if (!API || !API._token) {
      setTimeout(waitForAuth, 1000);
      return;
    }
    // NOTE: do NOT launch here — wait for user to open the panel
    // This avoids creating orphan sessions on every page load
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
