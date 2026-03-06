
// ─── Voice Manager Page ───

async function renderVoiceManagerPage(container) {
  container.innerHTML = `
    <div class="page-title"><span>Voice Manager</span></div>
    <div id="vm-root" style="display:flex;gap:20px;width:100%;flex-wrap:wrap">
      <div id="vm-left" style="flex:1;min-width:300px">
        <div style="background:var(--bg-secondary);border-radius:8px;padding:16px;border:1px solid var(--border);margin-bottom:16px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
            <select id="vm-agent" style="flex:1;padding:8px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px"></select>
            <button id="vm-launch-btn" class="btn btn-primary" style="white-space:nowrap">Iniciar Agente</button>
          </div>
          <div id="vm-agent-status" style="font-size:13px;color:var(--text-muted)">Selecione um agente e clique Iniciar</div>
        </div>
        <div style="background:var(--bg-secondary);border-radius:8px;padding:16px;border:1px solid var(--border);margin-bottom:16px">
          <div style="display:flex;gap:8px;align-items:center">
            <button id="vm-mic-btn" style="width:60px;height:60px;border-radius:50%;border:2px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:24px;cursor:pointer;transition:all 0.3s">&#127908;</button>
            <div style="flex:1">
              <div id="vm-mic-status" style="font-size:13px;color:var(--text-muted)">Clique para falar</div>
              <div id="vm-timer" style="font-family:monospace;font-size:18px;color:var(--accent);min-height:22px"></div>
            </div>
            <select id="vm-voice" style="padding:6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;font-size:12px">
              <option value="pt-BR-FranciscaNeural">Francisca</option>
              <option value="pt-BR-AntonioNeural" selected>Antonio</option>
              <option value="pt-BR-ThalitaMultilingualNeural">Thalita</option>
            </select>
          </div>
        </div>
        <div id="vm-conversation" style="display:flex;flex-direction:column;gap:8px;max-height:500px;overflow-y:auto"></div>
      </div>
      <div id="vm-right" style="width:350px;flex-shrink:0">
        <div id="vm-avatar-container" style="width:350px;height:420px;background:#111;border-radius:12px;border:1px solid var(--border);overflow:hidden;position:relative">
          <div id="vm-avatar-loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#666;font-size:14px">Carregando avatar...</div>
        </div>
      </div>
    </div>
  `;

  // Load agents into select
  try {
    var agents = await API.getClaudeAgents();
    var select = document.getElementById('vm-agent');
    var manager = agents.find(function(a) { return a.name === 'manager-agent'; });
    if (manager) {
      var opt = document.createElement('option');
      opt.value = manager.name;
      opt.textContent = manager.name;
      opt.selected = true;
      select.appendChild(opt);
    }
    agents.filter(function(a) { return a.name !== 'manager-agent'; }).forEach(function(a) {
      var opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      select.appendChild(opt);
    });
  } catch (e) {
    document.getElementById('vm-agent-status').textContent = 'Erro ao carregar agentes: ' + e.message;
  }

  // State
  var sessionId = null;
  var recording = false;
  var mediaRecorder = null;
  var audioChunks = [];
  var timerInterval = null;
  var head = null;
  var avatarReady = false;

  // Avatar init
  async function initAvatar() {
    var mod = await import('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs');
    var TalkingHead = mod.TalkingHead;

    var avatarContainer = document.getElementById('vm-avatar-container');
    var loading = document.getElementById('vm-avatar-loading');

    head = new TalkingHead(avatarContainer, {
      lipsyncModules: ['en', 'fi'],
      cameraView: 'head',
      cameraRotateEnable: false,
      cameraPanEnable: false,
      cameraZoomEnable: false,
      avatarIdleEyeContact: 1,
      avatarIdleHeadMove: 0,
      modelFPS: 30
    });

    await head.showAvatar({
      url: '/api/voice/avatars/avatarsdk.glb',
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
      if (ev.lengthComputable) {
        loading.textContent = 'Carregando avatar ' + Math.round(ev.loaded / ev.total * 100) + '%';
      }
    });

    loading.style.display = 'none';
    avatarReady = true;
    head.setView('head', { cameraDistance: 0.6, cameraX: 0, cameraY: 0, cameraRotateX: 0, cameraRotateY: 0 });
    head.lookAtCamera(100);
    setInterval(function() { if (avatarReady && head) head.lookAtCamera(500); }, 1000);
  }

  initAvatar().catch(function(err) {
    console.error('Avatar init error:', err);
    var el = document.getElementById('vm-avatar-loading');
    if (el) el.textContent = 'Erro avatar: ' + err.message;
  });

  // Launch agent
  document.getElementById('vm-launch-btn').addEventListener('click', async function() {
    var agentName = document.getElementById('vm-agent').value;
    if (!agentName) return;
    var statusEl = document.getElementById('vm-agent-status');
    var btn = document.getElementById('vm-launch-btn');

    if (sessionId) {
      try { await API.stopSession(sessionId); } catch(e) {}
      API.off('output', handleAgentOutput);
      sessionId = null;
      btn.textContent = 'Iniciar Agente';
      statusEl.textContent = 'Agente parado';
      statusEl.style.color = 'var(--text-muted)';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Iniciando ' + agentName + '...';
    try {
      var result = await API.launchClaudeAgent(agentName, 'C:\\Users\\PC', 'bypassPermissions', 8192);
      sessionId = result.sessionId;
      btn.textContent = 'Parar Agente';
      statusEl.textContent = agentName + ' ativo';
      statusEl.style.color = 'var(--accent)';
      API.attachSession(sessionId);
      API.on('output', handleAgentOutput);
    } catch (e) {
      statusEl.textContent = 'Erro: ' + e.message;
      statusEl.style.color = '#ef5350';
    }
    btn.disabled = false;
  });

  // Agent output
  var outputBuffer = '';
  var outputTimeout = null;

  function handleAgentOutput(data) {
    if (data.sessionId !== sessionId) return;
    outputBuffer += data.data;
    clearTimeout(outputTimeout);
    outputTimeout = setTimeout(function() {
      var clean = outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
      outputBuffer = '';
      if (clean.length > 10) {
        addMessage('agent', clean);
        if (avatarReady && clean.length < 2000) {
          speakWithAvatar(clean);
        }
      }
    }, 2000);
  }

  // TTS with avatar
  async function speakWithAvatar(text) {
    var voice = document.getElementById('vm-voice').value;
    try {
      var resp = await fetch(API.base + '/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API.token },
        body: JSON.stringify({ text: text.substring(0, 500), voice: voice, lipsync: true })
      });
      if (!resp.ok) return;
      var data = await resp.json();
      if (data.error) return;

      var audioBytes = Uint8Array.from(atob(data.audio), function(c) { return c.charCodeAt(0); });
      var audioBuffer = await head.audioCtx.decodeAudioData(audioBytes.buffer.slice(0));

      head.speakAudio({
        audio: audioBuffer,
        words: data.words || [],
        wtimes: data.wtimes || [],
        wdurations: data.wdurations || [],
        markers: [function() { head.lookAtCamera(100); }],
        mtimes: [0]
      });
    } catch (e) {
      console.error('TTS error:', e);
    }
  }

  // Mic
  document.getElementById('vm-mic-btn').addEventListener('click', async function() {
    recording ? stopRec() : await startRec();
  });

  async function startRec() {
    if (!sessionId) {
      document.getElementById('vm-mic-status').textContent = 'Inicie o agente primeiro!';
      return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunks = [];
      mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = function() { stream.getTracks().forEach(function(t) { t.stop(); }); transcribeAndSend(); };
      mediaRecorder.start();
      recording = true;
      var micBtn = document.getElementById('vm-mic-btn');
      micBtn.style.borderColor = '#ef5350';
      micBtn.style.background = '#2a1515';
      document.getElementById('vm-mic-status').textContent = 'Gravando...';
      var start = Date.now();
      timerInterval = setInterval(function() {
        var s = Math.floor((Date.now() - start) / 1000);
        document.getElementById('vm-timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      }, 200);
    } catch (e) {
      document.getElementById('vm-mic-status').textContent = 'Erro microfone: ' + e.message;
    }
  }

  function stopRec() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    recording = false;
    var micBtn = document.getElementById('vm-mic-btn');
    micBtn.style.borderColor = 'var(--border)';
    micBtn.style.background = 'var(--bg-primary)';
    clearInterval(timerInterval);
    document.getElementById('vm-timer').textContent = '';
  }

  async function transcribeAndSend() {
    document.getElementById('vm-mic-status').textContent = 'Transcrevendo...';
    var blob = new Blob(audioChunks, { type: 'audio/webm' });
    var fd = new FormData();
    fd.append('audio', blob, 'recording.webm');

    try {
      var resp = await fetch(API.base + '/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.token },
        body: fd
      });
      var data = await resp.json();
      if (data.error) {
        document.getElementById('vm-mic-status').textContent = 'Erro: ' + data.error;
        return;
      }

      var text = data.text;
      if (!text || text.trim().length === 0) {
        document.getElementById('vm-mic-status').textContent = 'Nada detectado. Tente novamente.';
        return;
      }

      document.getElementById('vm-mic-status').textContent = 'Clique para falar';
      addMessage('user', text);
      API.sendInput(sessionId, text + '\n');
    } catch (e) {
      document.getElementById('vm-mic-status').textContent = 'Erro: ' + e.message;
    }
  }

  function addMessage(role, text) {
    var conv = document.getElementById('vm-conversation');
    if (!conv) return;
    var div = document.createElement('div');
    div.style.cssText = 'padding:10px 14px;border-radius:8px;font-size:14px;line-height:1.5;max-width:100%;word-wrap:break-word;white-space:pre-wrap;';
    if (role === 'user') {
      div.style.background = 'var(--accent)';
      div.style.color = '#000';
      div.style.alignSelf = 'flex-end';
      div.style.borderBottomRightRadius = '2px';
    } else {
      div.style.background = 'var(--bg-primary)';
      div.style.color = 'var(--text-primary)';
      div.style.border = '1px solid var(--border)';
      div.style.borderBottomLeftRadius = '2px';
    }
    div.textContent = text.substring(0, 2000);
    conv.appendChild(div);
    conv.scrollTop = conv.scrollHeight;
  }
}
