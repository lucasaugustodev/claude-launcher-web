// ─── API Client ───

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

    const res = await fetch(path, { ...options, headers });

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
    return fetch('/api/auth/status', { headers }).then(r => r.json());
  },

  async setup(username, password) {
    const res = await fetch('/api/auth/setup', {
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
    const res = await fetch('/api/auth/login', {
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
      await this.fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    this.setToken(null);
  },

  // ─── Profiles ───

  getProfiles() { return this.fetch('/api/profiles'); },

  createProfile(data) {
    return this.fetch('/api/profiles', { method: 'POST', body: JSON.stringify(data) });
  },

  updateProfile(id, data) {
    return this.fetch(`/api/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  deleteProfile(id) {
    return this.fetch(`/api/profiles/${id}`, { method: 'DELETE' });
  },

  // ─── Sessions ───

  getActiveSessions() { return this.fetch('/api/sessions'); },

  getSessionHistory() { return this.fetch('/api/sessions/history'); },

  launchSession(profileId) {
    return this.fetch('/api/sessions/launch', { method: 'POST', body: JSON.stringify({ profileId }) });
  },

  stopSession(id) {
    return this.fetch(`/api/sessions/${id}/stop`, { method: 'POST' });
  },

  getSessionOutputData(id) {
    return this.fetch(`/api/sessions/${id}/output`);
  },

  resumeSession(id) {
    return this.fetch(`/api/sessions/${id}/resume`, { method: 'POST' });
  },

  clearHistory() {
    return this.fetch('/api/sessions/history', { method: 'DELETE' });
  },

  // ─── GitHub ───

  getGitHubStatus() { return this.fetch('/api/github/status'); },

  detectInstallations() {
    return this.fetch('/api/github/detect', { method: 'POST' });
  },

  connectGitHub(installationId, owner, accountType) {
    return this.fetch('/api/github/connect', { method: 'POST', body: JSON.stringify({ installationId, owner, accountType }) });
  },

  testGitHub() {
    return this.fetch('/api/github/test', { method: 'POST' });
  },

  syncSessionToGitHub(id) {
    return this.fetch(`/api/github/sync/${id}`, { method: 'POST' });
  },

  disconnectGitHub() {
    return this.fetch('/api/github/config', { method: 'DELETE' });
  },

  listGitHubRepos() {
    return this.fetch('/api/github/repos');
  },

  cloneGitHubRepo(owner, repo) {
    return this.fetch('/api/github/clone', { method: 'POST', body: JSON.stringify({ owner, repo }) });
  },

  createGitHubRepo(name, isPrivate = true) {
    return this.fetch('/api/github/create-repo', { method: 'POST', body: JSON.stringify({ name, private: isPrivate }) });
  },

  getWatcherStatus(sessionId) {
    return this.fetch(`/api/sessions/${sessionId}/watcher-status`);
  },

  // ─── GitHub CLI ───

  getGitHubCLIStatus() {
    return this.fetch('/api/github-cli/status');
  },

  async installGitHubCLI(onProgress) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;

    const res = await fetch('/api/github-cli/install', { method: 'POST', headers });
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
          if (e.message !== data?.message) { /* ignore parse errors */ }
        }
      }
    }
    return result;
  },

  startGitHubCLIAuth() {
    return this.fetch('/api/github-cli/auth', { method: 'POST' });
  },

  listGitHubCLIRepos() {
    return this.fetch('/api/github-cli/repos');
  },

  cloneWithGitHubCLI(repo, destDir) {
    return this.fetch('/api/github-cli/clone', {
      method: 'POST',
      body: JSON.stringify({ repo, destDir: destDir || undefined }),
    });
  },

  // ─── File Manager ───

  listFiles(dirPath) {
    return this.fetch('/api/files?path=' + encodeURIComponent(dirPath));
  },

  createDirectory(dirPath) {
    return this.fetch('/api/files/mkdir', { method: 'POST', body: JSON.stringify({ path: dirPath }) });
  },

  deleteFile(filePath) {
    return this.fetch('/api/files/delete', { method: 'POST', body: JSON.stringify({ path: filePath }) });
  },

  readFile(filePath) {
    return this.fetch('/api/files/read?path=' + encodeURIComponent(filePath));
  },

  writeFile(filePath, content) {
    return this.fetch('/api/files/write', { method: 'POST', body: JSON.stringify({ path: filePath, content }) });
  },

  getDownloadUrl(filePath) {
    return '/api/files/download?path=' + encodeURIComponent(filePath) + '&token=' + encodeURIComponent(this._token);
  },

  async uploadFiles(dirPath, files) {
    const formData = new FormData();
    formData.append('path', dirPath);
    for (const file of files) {
      formData.append('files', file);
    }
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;
    const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
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
    if (!this._token) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws?token=${encodeURIComponent(this._token)}`;

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
      if (msg.type === 'watcher-commit') this._emit('watcher:commit', msg);
      if (msg.type === 'watcher-pr') this._emit('watcher:pr', msg);
      if (msg.type === 'cline-start') this._emit('watcher:cline-start', msg);
      if (msg.type === 'cline-done') this._emit('watcher:cline-done', msg);
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
};
