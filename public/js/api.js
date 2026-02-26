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
