const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const path = require('path');
const storage = require('./storage');
const ptyManager = require('./pty-manager');

const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);

// ─── Token-based Auth ───

// In-memory active tokens: token -> { username, createdAt }
const activeSessions = new Map();

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = hashPassword(password, storedSalt);
  return hash === storedHash;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function checkToken(req, res, next) {
  // Public routes
  if (req.path === '/api/health') return next();
  if (req.path === '/api/auth/status') return next();
  if (req.path === '/api/auth/setup') return next();
  if (req.path === '/api/auth/login') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token required' });
  }

  const token = authHeader.slice(7);
  const session = activeSessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = session.username;
  next();
}

// Cleanup expired tokens (24h)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [token, session] of activeSessions) {
    if (session.createdAt < cutoff) activeSessions.delete(token);
  }
}, 60 * 60 * 1000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth API ───

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeSessions: ptyManager.getActiveSessions().length,
  });
});

app.get('/api/auth/status', (req, res) => {
  const needsSetup = !storage.hasUsers();
  // Check if caller has a valid token
  let loggedIn = false;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    loggedIn = activeSessions.has(authHeader.slice(7));
  }
  res.json({ needsSetup, loggedIn });
});

app.post('/api/auth/setup', (req, res) => {
  if (storage.hasUsers()) {
    return res.status(400).json({ error: 'Setup already completed' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const { hash, salt } = hashPassword(password);
  storage.addUser({ username, hash, salt, createdAt: new Date().toISOString() });

  // Auto-login after setup
  const token = generateToken();
  activeSessions.set(token, { username, createdAt: Date.now() });

  console.log(`[AUTH] User "${username}" created (setup)`);
  res.status(201).json({ token, username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = storage.findUser(username);
  if (!user || !verifyPassword(password, user.hash, user.salt)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken();
  activeSessions.set(token, { username, createdAt: Date.now() });

  console.log(`[AUTH] User "${username}" logged in`);
  res.json({ token, username });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    activeSessions.delete(authHeader.slice(7));
  }
  res.json({ ok: true });
});

// ─── Protected routes below ───
app.use('/api/profiles', checkToken);
app.use('/api/sessions', checkToken);

// ─── Profiles API ───

app.get('/api/profiles', (req, res) => {
  res.json(storage.getProfiles());
});

app.post('/api/profiles', (req, res) => {
  const { name, workingDirectory, mode, initialPrompt, nodeMemory } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const { v4: uuid } = require('uuid');
  const profile = {
    id: uuid(),
    name,
    workingDirectory: workingDirectory || '',
    mode: mode || 'normal',
    initialPrompt: initialPrompt || '',
    nodeMemory: nodeMemory || null,
    createdAt: new Date().toISOString(),
  };

  storage.addProfile(profile);
  res.status(201).json(profile);
});

app.put('/api/profiles/:id', (req, res) => {
  const updated = storage.updateProfile(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Profile not found' });
  res.json(updated);
});

app.delete('/api/profiles/:id', (req, res) => {
  storage.deleteProfile(req.params.id);
  res.json({ ok: true });
});

// ─── Sessions API ───

app.get('/api/sessions', (req, res) => {
  res.json(ptyManager.getActiveSessions());
});

app.get('/api/sessions/history', (req, res) => {
  res.json(storage.getSessions());
});

app.post('/api/sessions/launch', (req, res) => {
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId is required' });

  try {
    const session = ptyManager.launchSession(profileId);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/stop', (req, res) => {
  const stopped = ptyManager.stopSession(req.params.id);
  if (!stopped) return res.status(404).json({ error: 'Session not found or already stopped' });
  res.json({ ok: true });
});

app.get('/api/sessions/:id/output', (req, res) => {
  const output = ptyManager.getSessionOutput(req.params.id);
  res.json({ output });
});

app.post('/api/sessions/:id/resume', (req, res) => {
  try {
    const session = ptyManager.resumeSession(req.params.id);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/sessions/history', (req, res) => {
  storage.clearHistory();
  res.json({ ok: true });
});

// ─── WebSocket Server ───

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Validate auth via token query param
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token || !activeSessions.has(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Track which sessions this WS is attached to
  const attachedSessions = new Map();

  const sendFn = (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'attach': {
        const { sessionId } = msg;
        if (!sessionId) break;

        const output = ptyManager.getSessionOutput(sessionId);
        if (output) {
          ws.send(JSON.stringify({ type: 'output', sessionId, data: output }));
        }

        ptyManager.addListener(sessionId, sendFn);
        attachedSessions.set(sessionId, sendFn);
        break;
      }

      case 'detach': {
        const { sessionId } = msg;
        if (sessionId && attachedSessions.has(sessionId)) {
          ptyManager.removeListener(sessionId, sendFn);
          attachedSessions.delete(sessionId);
        }
        break;
      }

      case 'input': {
        const { sessionId, data } = msg;
        if (sessionId && data) {
          ptyManager.sendInput(sessionId, data);
        }
        break;
      }

      case 'resize': {
        const { sessionId, cols, rows } = msg;
        if (sessionId && cols && rows) {
          ptyManager.resizePty(sessionId, cols, rows);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const [sessionId, fn] of attachedSessions) {
      ptyManager.removeListener(sessionId, fn);
    }
    attachedSessions.clear();
  });
});

// ─── Startup ───

const cleaned = ptyManager.cleanupOrphaned();
if (cleaned > 0) {
  console.log(`Cleaned ${cleaned} orphaned sessions`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Launcher Web running on http://0.0.0.0:${PORT}`);
  console.log(`Setup required: ${!storage.hasUsers()}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  const stopped = ptyManager.stopAll();
  if (stopped > 0) console.log(`Stopped ${stopped} active sessions`);
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  const stopped = ptyManager.stopAll();
  server.close();
  process.exit(0);
});
