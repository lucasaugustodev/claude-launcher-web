// ─── API Client ───

// Base path for reverse proxy support (e.g. /launcher/ or /)
const _basePath = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1) || '/';
function _url(path) { return _basePath + path; }

const API = {
  _token: null,
  _ws: null,
  _wsListeners: new Map(),
  _reconnectTimer: null,

  setToken(token) {
    this._token = token;
    if (token) {
      localStorage.setItem('cl_token', token);
    } else {
      localStorage.removeItem('cl_token');
    }
  },

  loadToken() {
    this._token = localStorage.getItem('cl_token');
    return !!this._token;
  },

  async fetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this._token) {
      headers['Authorization'] = 'Bearer ' + this._token;
    }

    const res = await fetch(_url(path), { ...options, headers });

    if (res.status === 401) {
      this.setToken(null);
      location.reload();
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    return res.json();
  },

  // ─── Auth ───

  checkAuthStatus() {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;
    return fetch(_url('api/auth/status'), { headers }).then(r => r.json());
  },

  async setup(username, password) {
    const res = await fetch(_url('api/auth/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    this.setToken(data.token);
    return data;
  },

  async login(username, password) {
    const res = await fetch(_url('api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    this.setToken(data.token);
    return data;
  },

  async logout() {
    try {
      await this.fetch('api/auth/logout', { method: 'POST' });
    } catch {}
    this.setToken(null);
  },

  // ─── Profiles ───

  getProfiles() { return this.fetch('api/profiles'); },

  createProfile(data) {
    return this.fetch('api/profiles', { method: 'POST', body: JSON.stringify(data) });
  },

  updateProfile(id, data) {
    return this.fetch(`api/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  deleteProfile(id) {
    return this.fetch(`api/profiles/${id}`, { method: 'DELETE' });
  },

  // ─── Sessions ───

  getActiveSessions() { return this.fetch('api/sessions'); },

  getSessionHistory() { return this.fetch('api/sessions/history'); },

  launchSession(profileId, { streamJson } = {}) {
    return this.fetch('api/sessions/launch', { method: 'POST', body: JSON.stringify({ profileId, streamJson }) });
  },

  stopSession(id) {
    return this.fetch(`api/sessions/${id}/stop`, { method: 'POST' });
  },

  getSessionOutputData(id) {
    return this.fetch(`api/sessions/${id}/output`);
  },

  resumeSession(id, { streamJson } = {}) {
    return this.fetch(`api/sessions/${id}/resume`, { method: 'POST', body: JSON.stringify({ streamJson }) });
  },

  clearHistory() {
    return this.fetch('api/sessions/history', { method: 'DELETE' });
  },

  // ─── GitHub ───

  getGitHubStatus() { return this.fetch('api/github/status'); },

  detectInstallations() {
    return this.fetch('api/github/detect', { method: 'POST' });
  },

  connectGitHub(installationId, owner, accountType) {
    return this.fetch('api/github/connect', { method: 'POST', body: JSON.stringify({ installationId, owner, accountType }) });
  },

  testGitHub() {
    return this.fetch('api/github/test', { method: 'POST' });
  },

  syncSessionToGitHub(id) {
    return this.fetch(`api/github/sync/${id}`, { method: 'POST' });
  },

  disconnectGitHub() {
    return this.fetch('api/github/config', { method: 'DELETE' });
  },

  listGitHubRepos() {
    return this.fetch('api/github/repos');
  },

  cloneGitHubRepo(owner, repo) {
    return this.fetch('api/github/clone', { method: 'POST', body: JSON.stringify({ owner, repo }) });
  },

  createGitHubRepo(name, isPrivate = true) {
    return this.fetch('api/github/create-repo', { method: 'POST', body: JSON.stringify({ name, private: isPrivate }) });
  },

  getWatcherStatus(sessionId) {
    return this.fetch(`api/sessions/${sessionId}/watcher-status`);
  },

  // ─── GitHub CLI ───

  getGitHubCLIStatus() {
    return this.fetch('api/github-cli/status');
  },

  async installGitHubCLI(onProgress) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;

    const res = await fetch(_url('api/github-cli/install'), { method: 'POST', headers });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress' && onProgress) onProgress(data.text);
          if (data.type === 'done') result = data;
          if (data.type === 'error') throw new Error(data.message);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
    return result;
  },

  startGitHubCLIAuth() {
    return this.fetch('api/github-cli/auth', { method: 'POST' });
  },

  listGitHubCLIRepos() {
    return this.fetch('api/github-cli/repos');
  },

  cloneWithGitHubCLI(repo, destDir) {
    return this.fetch('api/github-cli/clone', {
      method: 'POST',
      body: JSON.stringify({ repo, destDir: destDir || undefined }),
    });
  },

  // ─── Cline CLI ───

  getClineCLIStatus() {
    return this.fetch('api/cline-cli/status');
  },

  async installClineCLI(onProgress) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;

    const res = await fetch(_url('api/cline-cli/install'), { method: 'POST', headers });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress' && onProgress) onProgress(data.text);
          if (data.type === 'done') result = data;
          if (data.type === 'error') throw new Error(data.message);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
    return result;
  },

  startClineCLIAuth() {
    return this.fetch('api/cline-cli/auth', { method: 'POST' });
  },

  // ─── Cline Sessions ───

  getActiveClineSessions() {
    return this.fetch('api/cline-sessions');
  },

  getClineSessionHistory() {
    return this.fetch('api/cline-sessions/history');
  },

  launchClineSession(prompt, workingDirectory) {
    return this.fetch('api/cline-sessions/launch', {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt || undefined, workingDirectory: workingDirectory || undefined }),
    });
  },

  stopClineSession(id) {
    return this.fetch(`api/cline-sessions/${id}/stop`, { method: 'POST' });
  },

  getClineSessionOutput(id) {
    return this.fetch(`api/cline-sessions/${id}/output`);
  },

  clearClineHistory() {
    return this.fetch('api/cline-sessions/history', { method: 'DELETE' });
  },

  // ─── Gemini CLI ───

  getGeminiCLIStatus() {
    return this.fetch('api/gemini-cli/status');
  },

  async installGeminiCLI(onProgress) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;

    const res = await fetch(_url('api/gemini-cli/install'), { method: 'POST', headers });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress' && onProgress) onProgress(data.text);
          if (data.type === 'done') result = data;
          if (data.type === 'error') throw new Error(data.message);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
    return result;
  },

  startGeminiCLIAuth() {
    return this.fetch('api/gemini-cli/auth', { method: 'POST' });
  },

  // ─── Claude Code CLI ───

  getClaudeCLIStatus() {
    return this.fetch('api/claude-cli/status');
  },

  async installClaudeCLI(onProgress) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;

    const res = await fetch(_url('api/claude-cli/install'), { method: 'POST', headers });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress' && onProgress) onProgress(data.text);
          if (data.type === 'done') result = data;
          if (data.type === 'error') throw new Error(data.message);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
    return result;
  },

  startClaudeCLIAuth() {
    return this.fetch('api/claude-cli/auth', { method: 'POST' });
  },

  // ─── Gemini Sessions ───

  getActiveGeminiSessions() {
    return this.fetch('api/gemini-sessions');
  },

  getGeminiSessionHistory() {
    return this.fetch('api/gemini-sessions/history');
  },

  launchGeminiSession(prompt, workingDirectory) {
    return this.fetch('api/gemini-sessions/launch', {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt || undefined, workingDirectory: workingDirectory || undefined }),
    });
  },

  stopGeminiSession(id) {
    return this.fetch(`api/gemini-sessions/${id}/stop`, { method: 'POST' });
  },

  getGeminiSessionOutput(id) {
    return this.fetch(`api/gemini-sessions/${id}/output`);
  },

  clearGeminiHistory() {
    return this.fetch('api/gemini-sessions/history', { method: 'DELETE' });
  },

  // ─── GWS CLI ───

  getGwsCLIStatus() {
    return this.fetch('api/gws-cli/status');
  },

  async installGwsCLI(onProgress) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;

    const res = await fetch(_url('api/gws-cli/install'), { method: 'POST', headers });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress' && onProgress) onProgress(data.text);
          if (data.type === 'done') result = data;
          if (data.type === 'error') throw new Error(data.message);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
    return result;
  },

  startGwsCLIAuth() {
    return this.fetch('api/gws-cli/auth', { method: 'POST' });
  },

  // ─── GWS Sessions ───

  getActiveGwsSessions() {
    return this.fetch('api/gws-sessions');
  },

  getGwsSessionHistory() {
    return this.fetch('api/gws-sessions/history');
  },

  launchGwsSession(prompt, workingDirectory) {
    return this.fetch('api/gws-sessions/launch', {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt || undefined, workingDirectory: workingDirectory || undefined }),
    });
  },

  stopGwsSession(id) {
    return this.fetch(`api/gws-sessions/${id}/stop`, { method: 'POST' });
  },

  getGwsSessionOutput(id) {
    return this.fetch(`api/gws-sessions/${id}/output`);
  },

  clearGwsHistory() {
    return this.fetch('api/gws-sessions/history', { method: 'DELETE' });
  },

  // ─── File Manager ───

  listFiles(dirPath) {
    return this.fetch('api/files?path=' + encodeURIComponent(dirPath));
  },

  createDirectory(dirPath) {
    return this.fetch('api/files/mkdir', { method: 'POST', body: JSON.stringify({ path: dirPath }) });
  },

  deleteFile(filePath) {
    return this.fetch('api/files/delete', { method: 'POST', body: JSON.stringify({ path: filePath }) });
  },

  readFile(filePath) {
    return this.fetch('api/files/read?path=' + encodeURIComponent(filePath));
  },

  writeFile(filePath, content) {
    return this.fetch('api/files/write', { method: 'POST', body: JSON.stringify({ path: filePath, content }) });
  },

  getDownloadUrl(filePath) {
    return _url('api/files/download?path=' + encodeURIComponent(filePath) + '&token=' + encodeURIComponent(this._token));
  },

  async uploadFiles(dirPath, files) {
    const formData = new FormData();
    formData.append('path', dirPath);
    for (const file of files) {
      formData.append('files', file);
    }
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;
    const res = await fetch(_url('api/files/upload'), { method: 'POST', headers, body: formData });
    if (res.status === 401) { this.setToken(null); location.reload(); throw new Error('Unauthorized'); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ─── WebSocket ───

  connectWS() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}${_basePath}ws`;

    this._ws = new WebSocket(url);

    this._ws.onopen = () => {
      this._emit('ws:connected');
    };

    this._ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._emit('ws:message', msg);
      if (msg.type === 'output') this._emit('terminal:output', msg);
      if (msg.type === 'exit') this._emit('terminal:exit', msg);
      if (msg.type === 'action') this._emit('terminal:action', msg);
      if (msg.type === 'stream-json') this._emit('terminal:stream-json', msg);
      if (msg.type === 'watcher-commit') this._emit('watcher:commit', msg);
      if (msg.type === 'watcher-pr') this._emit('watcher:pr', msg);
      if (msg.type === 'cline-start') this._emit('watcher:cline-start', msg);
      if (msg.type === 'cline-done') this._emit('watcher:cline-done', msg);
      if (msg.type === 'schedule:started') this._emit('schedule:started', msg);
      if (msg.type === 'schedule:completed') this._emit('schedule:completed', msg);
      if (msg.type === 'schedule:skipped') this._emit('schedule:skipped', msg);
      if (msg.type === 'whatsapp:linked') this._emit('whatsapp:linked', msg);
      if (msg.type === 'whatsapp:message') this._emit('whatsapp:message', msg);
    };

    this._ws.onclose = () => {
      this._emit('ws:disconnected');
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this.connectWS(), 3000);
    };

    this._ws.onerror = () => {};
  },

  wsSend(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  },

  attachSession(sessionId) { this.wsSend({ type: 'attach', sessionId }); },
  detachSession(sessionId) { this.wsSend({ type: 'detach', sessionId }); },
  sendInput(sessionId, data) { this.wsSend({ type: 'input', sessionId, data }); },
  sendStreamJsonInput(sessionId, message) { this.wsSend({ type: 'stream-json-input', sessionId, message }); },
  resizeTerminal(sessionId, cols, rows) { this.wsSend({ type: 'resize', sessionId, cols, rows }); },

  // ─── Event Emitter ───

  on(event, callback) {
    if (!this._wsListeners.has(event)) this._wsListeners.set(event, new Set());
    this._wsListeners.get(event).add(callback);
  },

  off(event, callback) {
    const set = this._wsListeners.get(event);
    if (set) set.delete(callback);
  },

  _emit(event, data) {
    const set = this._wsListeners.get(event);
    if (set) for (const cb of set) cb(data);
  },

  // ─── Claude Code Agents ───

  getClaudeAgents() {
    return this.fetch('api/claude-agents');
  },

  getClaudeAgent(name) {
    return this.fetch(`api/claude-agents/${encodeURIComponent(name)}`);
  },

  launchClaudeAgent(agentName, workingDirectory, mode, nodeMemory, { streamJson } = {}) {
    return this.fetch('api/claude-agents/launch', {
      method: 'POST',
      body: JSON.stringify({ agentName, workingDirectory, mode, nodeMemory, streamJson }),
    });
  },

  // ─── APM (Perfis de Agentes) ───

  getApmStatus() {
    return this.fetch('api/apm/status');
  },

  getApmAgents() {
    return this.fetch('api/apm/agents');
  },

  getApmAgent(id) {
    return this.fetch(`api/apm/agents/${id}`);
  },

  getApmProjects(scanPath) {
    const qs = scanPath ? '?scanPath=' + encodeURIComponent(scanPath) : '';
    return this.fetch('api/apm/projects' + qs);
  },

  installApm(targetDir, overwrite = false) {
    return this.fetch('api/apm/install', {
      method: 'POST',
      body: JSON.stringify({ targetDir, overwrite }),
    });
  },

  launchAgent(agentId, workingDirectory, mode, nodeMemory, { streamJson } = {}) {
    return this.fetch('api/apm/launch-agent', {
      method: 'POST',
      body: JSON.stringify({ agentId, workingDirectory, mode, nodeMemory, streamJson }),
    });
  },

  // ─── WhatsApp ───

  getWhatsAppStatus() {
    return this.fetch('api/whatsapp/status');
  },

  linkWhatsApp() {
    return this.fetch('api/whatsapp/link', { method: 'POST' });
  },

  getWhatsAppLinkStatus(code) {
    return this.fetch('api/whatsapp/link-status?code=' + encodeURIComponent(code));
  },

  unlinkWhatsApp() {
    return this.fetch('api/whatsapp/unlink', { method: 'POST' });
  },

  sendWhatsApp(text, to) {
    return this.fetch('api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({ text, to }),
    });
  },

  // ─── Marketplace ───

  getMarketplaceCatalog() {
    return this.fetch('api/marketplace/catalog');
  },

  installAgents(packId, agentNames = null) {
    return this.fetch('api/marketplace/install-agents', {
      method: 'POST',
      body: JSON.stringify({ packId, agentNames }),
    });
  },

  uninstallAgent(agentName) {
    return this.fetch('api/marketplace/uninstall-agent', {
      method: 'POST',
      body: JSON.stringify({ agentName }),
    });
  },

  installPlugin(pluginId) {
    return this.fetch('api/marketplace/install-plugin', {
      method: 'POST',
      body: JSON.stringify({ pluginId }),
    });
  },

  uninstallPlugin(pluginId) {
    return this.fetch('api/marketplace/uninstall-plugin', {
      method: 'POST',
      body: JSON.stringify({ pluginId }),
    });
  },

  refreshAgentPack(packId) {
    return this.fetch('api/marketplace/refresh-agents', {
      method: 'POST',
      body: JSON.stringify({ packId }),
    });
  },

  // ─── Schedules ───

  getSchedules() {
    return this.fetch('api/schedules');
  },

  createSchedule(data) {
    return this.fetch('api/schedules', { method: 'POST', body: JSON.stringify(data) });
  },

  updateSchedule(id, data) {
    return this.fetch(`api/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  deleteSchedule(id) {
    return this.fetch(`api/schedules/${id}`, { method: 'DELETE' });
  },

  toggleSchedule(id) {
    return this.fetch(`api/schedules/${id}/toggle`, { method: 'POST' });
  },

  runScheduleNow(id) {
    return this.fetch(`api/schedules/${id}/run-now`, { method: 'POST' });
  },

  getScheduleLog(limit) {
    const qs = limit ? '?limit=' + limit : '';
    return this.fetch('api/schedules/log' + qs);
  },

  clearScheduleLog() {
    return this.fetch('api/schedules/log', { method: 'DELETE' });
  },

  // ─── Skills ───

  getSkills() {
    return this.fetch('api/skills');
  },

  getSkillDetail(scope, name) {
    return this.fetch(`api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`);
  },

  createSkill(data) {
    return this.fetch('api/skills', { method: 'POST', body: JSON.stringify(data) });
  },

  updateSkill(name, raw) {
    return this.fetch(`api/skills/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ raw }) });
  },

  deleteSkill(name) {
    return this.fetch(`api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  // ─── Gemini Skills ───

  getGeminiSkills() {
    return this.fetch('api/gemini-skills');
  },

  getGeminiCommand(name) {
    return this.fetch(`api/gemini-skills/command/${encodeURIComponent(name)}`);
  },

  createGeminiCommand(data) {
    return this.fetch('api/gemini-skills/command', { method: 'POST', body: JSON.stringify(data) });
  },

  updateGeminiCommand(name, raw) {
    return this.fetch(`api/gemini-skills/command/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ raw }) });
  },

  deleteGeminiCommand(name) {
    return this.fetch(`api/gemini-skills/command/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  // ─── Workflows (BMAD) ───

  getWorkflows() { return this.fetch('api/workflows'); },
  getWorkflow(id) { return this.fetch(`api/workflows/${id}`); },
  getWorkflowAgents() { return this.fetch('api/workflows/agents'); },
  createWorkflow(data) { return this.fetch('api/workflows', { method: 'POST', body: JSON.stringify(data) }); },
  updateWorkflow(id, data) { return this.fetch(`api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  deleteWorkflow(id) { return this.fetch(`api/workflows/${id}`, { method: 'DELETE' }); },
  advanceWorkflow(id, note) { return this.fetch(`api/workflows/${id}/advance`, { method: 'POST', body: JSON.stringify({ note }) }); },
  addWorkflowArtifact(id, artifact) { return this.fetch(`api/workflows/${id}/artifacts`, { method: 'POST', body: JSON.stringify(artifact) }); },
  launchWorkflowAgent(id, agentOverride) { return this.fetch(`api/workflows/${id}/launch`, { method: 'POST', body: JSON.stringify({ agentOverride }) }); },
};
