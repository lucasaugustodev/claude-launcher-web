const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const path = require('path');
const storage = require('./storage');
const ptyManager = require('./pty-manager');
const githubSync = require('./github-sync');
const gitWatcher = require('./git-watcher');
const githubCli = require('./github-cli');
const clineCli = require('./cline-cli');
const geminiCli = require('./gemini-cli');
const scheduler = require('./scheduler');
const multer = require('multer');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');

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

app.use(express.json({ limit: '5mb' }));
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
  res.json({
    needsSetup,
    loggedIn,
    env: {
      platform: process.platform,
      homeDir: (() => {
        const home = os.homedir();
        if (process.platform !== 'win32') return home;
        // SYSTEM user has unusable homedir; find a real user dir
        if (fs.existsSync(path.join(home, 'Desktop'))) return home;
        const candidates = ['C:\\Users\\Administrator', 'C:\\Users\\Public'];
        for (const c of candidates) { if (fs.existsSync(c)) return c; }
        return 'C:\\';
      })(),
      sep: path.sep,
    },
  });
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

// ─── APM Agent Profiles (authenticated) ───

const APM_TEMPLATES_DIR = path.join(__dirname, 'apm-templates');

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.replace(/\r$/, '').match(/^(\w+):\s*(.+)$/);
    if (m) {
      const val = m[2].trim();
      yaml[m[1]] = isNaN(val) ? val : Number(val);
    }
  }
  return yaml;
}

function deriveCategory(commandName) {
  if (!commandName) return 'other';
  if (commandName.startsWith('initiate')) return 'initiate';
  if (commandName.startsWith('handover')) return 'handover';
  if (commandName.startsWith('delegate')) return 'delegate';
  return 'other';
}

function deriveAgentType(id) {
  const map = {
    'apm-1': 'Setup Agent',
    'apm-2': 'Manager Agent',
    'apm-3': 'Implementation Agent',
    'apm-4': 'Ad-Hoc Agent',
    'apm-5': 'Manager Handover',
    'apm-6': 'Implementation Handover',
    'apm-7': 'Research Delegate',
    'apm-8': 'Debug Delegate',
  };
  return map[id] || id;
}

function parseAgentFile(filename, commandsDir) {
  const filePath = path.join(commandsDir, filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const frontmatter = parseYamlFrontmatter(raw);
  const idMatch = filename.match(/^apm-(\d+)/);
  const id = idMatch ? `apm-${idMatch[1]}` : filename.replace('.md', '');
  return {
    id,
    filename,
    commandName: frontmatter.command_name || '',
    priority: frontmatter.priority || 0,
    description: frontmatter.description || '',
    category: deriveCategory(frontmatter.command_name),
    agentType: deriveAgentType(id),
    fileSize: stat.size,
  };
}

// GET /api/apm/status - APM templates status
app.get('/api/apm/status', checkToken, (req, res) => {
  const commandsDir = path.join(APM_TEMPLATES_DIR, 'commands');
  const guidesDir = path.join(APM_TEMPLATES_DIR, 'guides');
  const commandsExist = fs.existsSync(commandsDir);
  const guidesExist = fs.existsSync(guidesDir);
  let commandsCount = 0;
  let guidesCount = 0;
  if (commandsExist) {
    try { commandsCount = fs.readdirSync(commandsDir).filter(f => f.startsWith('apm-') && f.endsWith('.md')).length; } catch {}
  }
  if (guidesExist) {
    try { guidesCount = fs.readdirSync(guidesDir).filter(f => f.endsWith('.md')).length; } catch {}
  }
  res.json({
    installed: commandsExist && guidesExist && commandsCount > 0,
    templatesDir: APM_TEMPLATES_DIR,
    commandsCount,
    guidesCount,
  });
});

// GET /api/apm/agents - List agent profiles
app.get('/api/apm/agents', checkToken, (req, res) => {
  const commandsDir = path.join(APM_TEMPLATES_DIR, 'commands');
  if (!fs.existsSync(commandsDir)) {
    return res.json({ agents: [] });
  }
  try {
    const files = fs.readdirSync(commandsDir)
      .filter(f => f.startsWith('apm-') && f.endsWith('.md'))
      .sort();
    const agents = files.map(f => parseAgentFile(f, commandsDir));
    agents.sort((a, b) => a.priority - b.priority);
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apm/agents/:id - Agent detail with full content
app.get('/api/apm/agents/:id', checkToken, (req, res) => {
  const commandsDir = path.join(APM_TEMPLATES_DIR, 'commands');
  if (!fs.existsSync(commandsDir)) {
    return res.status(404).json({ error: 'Templates not found' });
  }
  const files = fs.readdirSync(commandsDir).filter(f => f.startsWith('apm-') && f.endsWith('.md'));
  const agentFile = files.find(f => {
    const m = f.match(/^apm-(\d+)/);
    return m && `apm-${m[1]}` === req.params.id;
  });
  if (!agentFile) return res.status(404).json({ error: 'Agent not found' });
  const agent = parseAgentFile(agentFile, commandsDir);
  agent.content = fs.readFileSync(path.join(commandsDir, agentFile), 'utf8');
  res.json(agent);
});

// GET /api/apm/projects - Projects with APM installation status
app.get('/api/apm/projects', checkToken, (req, res) => {
  const results = [];
  const profiles = storage.getProfiles();
  const dirsChecked = new Set();
  for (const p of profiles) {
    const dir = p.workingDirectory;
    if (!dir || dirsChecked.has(dir)) continue;
    dirsChecked.add(dir);
    if (!fs.existsSync(dir)) continue;
    const apmDir = path.join(dir, '.apm');
    const cmdDir = path.join(dir, '.claude', 'commands');
    const hasApm = fs.existsSync(apmDir);
    const hasCommands = fs.existsSync(cmdDir);
    let metadata = null;
    if (hasApm) {
      try { metadata = JSON.parse(fs.readFileSync(path.join(apmDir, 'metadata.json'), 'utf8')); } catch {}
    }
    let guidesCount = 0;
    if (hasApm) {
      try { guidesCount = fs.readdirSync(path.join(apmDir, 'guides')).filter(f => f.endsWith('.md')).length; } catch {}
    }
    let commandsCount = 0;
    if (hasCommands) {
      try { commandsCount = fs.readdirSync(cmdDir).filter(f => f.startsWith('apm-') && f.endsWith('.md')).length; } catch {}
    }
    results.push({
      path: dir,
      profileName: p.name,
      profileId: p.id,
      apmInstalled: hasApm,
      commandsInstalled: hasCommands && commandsCount > 0,
      metadata,
      guidesCount,
      commandsCount,
    });
  }
  // Optional: check additional path
  if (req.query.scanPath) {
    const dir = req.query.scanPath;
    if (!dirsChecked.has(dir) && fs.existsSync(dir)) {
      const apmDir = path.join(dir, '.apm');
      const cmdDir = path.join(dir, '.claude', 'commands');
      const hasApm = fs.existsSync(apmDir);
      const hasCommands = fs.existsSync(cmdDir);
      let metadata = null;
      if (hasApm) {
        try { metadata = JSON.parse(fs.readFileSync(path.join(apmDir, 'metadata.json'), 'utf8')); } catch {}
      }
      results.push({
        path: dir,
        profileName: path.basename(dir),
        profileId: null,
        apmInstalled: hasApm,
        commandsInstalled: hasCommands,
        metadata,
        guidesCount: 0,
        commandsCount: 0,
      });
    }
  }
  res.json({ projects: results });
});

// POST /api/apm/install - Install APM in a project
app.post('/api/apm/install', checkToken, (req, res) => {
  const { targetDir, overwrite } = req.body;
  if (!targetDir) return res.status(400).json({ error: 'targetDir is required' });
  if (!fs.existsSync(targetDir)) return res.status(400).json({ error: 'Target directory does not exist' });

  const srcCommandsDir = path.join(APM_TEMPLATES_DIR, 'commands');
  const srcGuidesDir = path.join(APM_TEMPLATES_DIR, 'guides');
  if (!fs.existsSync(srcCommandsDir) || !fs.existsSync(srcGuidesDir)) {
    return res.status(400).json({ error: 'APM templates not found in launcher' });
  }

  const targetApmDir = path.join(targetDir, '.apm');
  const targetCommandsDir = path.join(targetDir, '.claude', 'commands');

  if (fs.existsSync(targetApmDir) && !overwrite) {
    return res.status(409).json({ error: 'APM already installed. Use overwrite to update.', alreadyInstalled: true });
  }

  try {
    // Create structure
    fs.mkdirSync(path.join(targetApmDir, 'guides'), { recursive: true });
    fs.mkdirSync(path.join(targetApmDir, 'Memory'), { recursive: true });
    fs.mkdirSync(path.join(targetApmDir, 'tmp'), { recursive: true });
    fs.mkdirSync(targetCommandsDir, { recursive: true });

    // Copy guides
    for (const f of fs.readdirSync(srcGuidesDir).filter(f => f.endsWith('.md'))) {
      fs.copyFileSync(path.join(srcGuidesDir, f), path.join(targetApmDir, 'guides', f));
    }

    // Copy commands
    for (const f of fs.readdirSync(srcCommandsDir).filter(f => f.startsWith('apm-') && f.endsWith('.md'))) {
      fs.copyFileSync(path.join(srcCommandsDir, f), path.join(targetCommandsDir, f));
    }

    // Create metadata
    const metadata = {
      cliVersion: '0.5.4',
      templateVersion: 'v0.5.4+templates.1',
      assistants: ['Claude Code'],
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      installedFrom: 'claude-launcher-web',
    };
    fs.writeFileSync(path.join(targetApmDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    // Create Implementation_Plan.md template (only if not exists or overwrite)
    const planFile = path.join(targetApmDir, 'Implementation_Plan.md');
    if (!fs.existsSync(planFile) || overwrite) {
      fs.writeFileSync(planFile, '# Project \u2013 APM Implementation Plan\n**Memory Strategy:** Dynamic-MD\n**Last Modification:** [To be filled]\n**Project Overview:** [To be filled by Setup Agent]\n');
    }

    // Create Memory_Root.md template
    const memFile = path.join(targetApmDir, 'Memory', 'Memory_Root.md');
    if (!fs.existsSync(memFile) || overwrite) {
      fs.writeFileSync(memFile, '# Memory Root\n**Project Overview:** [To be filled by Manager Agent]\n**Current Phase:** [To be updated]\n**Active Tasks:** [To be updated]\n');
    }

    const guidesCount = fs.readdirSync(path.join(targetApmDir, 'guides')).filter(f => f.endsWith('.md')).length;
    const commandsCount = fs.readdirSync(targetCommandsDir).filter(f => f.startsWith('apm-') && f.endsWith('.md')).length;

    console.log(`[APM] Installed in ${targetDir}: ${guidesCount} guides, ${commandsCount} commands`);
    res.json({ ok: true, targetDir, guidesCount, commandsCount, metadata });
  } catch (err) {
    res.status(500).json({ error: `Installation failed: ${err.message}` });
  }
});

// POST /api/apm/launch-agent - Launch session with agent profile
app.post('/api/apm/launch-agent', checkToken, (req, res) => {
  const { agentId, workingDirectory, mode, nodeMemory, streamJson } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });

  const commandsDir = path.join(APM_TEMPLATES_DIR, 'commands');
  if (!fs.existsSync(commandsDir)) {
    return res.status(400).json({ error: 'APM templates not found' });
  }

  const files = fs.readdirSync(commandsDir).filter(f => f.startsWith('apm-') && f.endsWith('.md'));
  const agentFile = files.find(f => {
    const m = f.match(/^apm-(\d+)/);
    return m && `apm-${m[1]}` === agentId;
  });
  if (!agentFile) return res.status(404).json({ error: 'Agent profile not found' });

  let prompt = fs.readFileSync(path.join(commandsDir, agentFile), 'utf8');
  // Remove YAML frontmatter
  prompt = prompt.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');

  const cwd = workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    return res.status(400).json({ error: 'Working directory does not exist' });
  }

  try {
    const agentType = deriveAgentType(agentId);
    const session = ptyManager.launchDirect({
      prompt: prompt.trim(),
      workingDirectory: cwd,
      mode: mode || 'bypass',
      nodeMemory: nodeMemory || null,
      name: `APM ${agentType}`,
      streamJson: !!streamJson,
    });
    console.log(`[APM] Agent ${agentId} (${agentType}) launched in ${cwd}, session ${session.id}`);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Claude Code Agents (authenticated) ───

const CLAUDE_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');

function parseClaudeAgentFile(filename) {
  const filePath = path.join(CLAUDE_AGENTS_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const frontmatter = parseYamlFrontmatter(raw);
  const name = frontmatter.name || filename.replace('.md', '');

  // Extract first sentence of description for short display
  let shortDescription = '';
  if (frontmatter.description) {
    let desc = String(frontmatter.description);
    // Strip surrounding quotes from YAML
    if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
      desc = desc.slice(1, -1);
    }
    const firstSentence = desc.split(/(?<=[.!?])\s/)[0];
    shortDescription = firstSentence.length > 200 ? firstSentence.slice(0, 200) + '...' : firstSentence;
  }

  return {
    name,
    filename,
    model: frontmatter.model || 'sonnet',
    color: frontmatter.color || 'blue',
    memory: frontmatter.memory || 'none',
    description: frontmatter.description || '',
    shortDescription,
    fileSize: stat.size,
  };
}

// GET /api/claude-agents - List all Claude Code agents
app.get('/api/claude-agents', checkToken, (req, res) => {
  if (!fs.existsSync(CLAUDE_AGENTS_DIR)) {
    return res.json({ agents: [], agentsDir: CLAUDE_AGENTS_DIR });
  }
  try {
    const files = fs.readdirSync(CLAUDE_AGENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort();
    const agents = files.map(f => parseClaudeAgentFile(f));
    res.json({ agents, agentsDir: CLAUDE_AGENTS_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/claude-agents/:name - Agent detail with full content
app.get('/api/claude-agents/:name', checkToken, (req, res) => {
  if (!fs.existsSync(CLAUDE_AGENTS_DIR)) {
    return res.status(404).json({ error: 'Agents directory not found' });
  }
  const filename = req.params.name.endsWith('.md') ? req.params.name : req.params.name + '.md';
  const filePath = path.join(CLAUDE_AGENTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  const agent = parseClaudeAgentFile(filename);
  agent.content = fs.readFileSync(filePath, 'utf8');
  res.json(agent);
});

// POST /api/claude-agents/launch - Launch a Claude Code agent
app.post('/api/claude-agents/launch', checkToken, (req, res) => {
  const { agentName, workingDirectory, mode, nodeMemory, streamJson } = req.body;
  if (!agentName) return res.status(400).json({ error: 'agentName is required' });

  // Verify agent exists
  if (fs.existsSync(CLAUDE_AGENTS_DIR)) {
    const filename = agentName.endsWith('.md') ? agentName : agentName + '.md';
    if (!fs.existsSync(path.join(CLAUDE_AGENTS_DIR, filename))) {
      return res.status(404).json({ error: `Agent "${agentName}" not found in ${CLAUDE_AGENTS_DIR}` });
    }
  }

  const cwd = workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    return res.status(400).json({ error: 'Working directory does not exist' });
  }

  try {
    const session = ptyManager.launchAgent({
      agentName,
      workingDirectory: cwd,
      mode: mode || 'normal',
      nodeMemory: nodeMemory || null,
      streamJson: !!streamJson,
    });
    console.log(`[AGENT] Claude agent "${agentName}" launched in ${cwd}, session ${session.id}`);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── APM Direct Launch API (no auth, localhost only) ───

app.post('/api/apm/launch', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!allowed.includes(ip)) {
    return res.status(403).json({ error: 'APM launch only available from localhost' });
  }

  let { prompt, promptFile, workingDirectory, mode, nodeMemory, name } = req.body;

  if (promptFile) {
    try {
      prompt = fs.readFileSync(promptFile, 'utf8');
    } catch (err) {
      return res.status(400).json({ error: `Cannot read prompt file: ${err.message}` });
    }
  }

  if (!prompt) return res.status(400).json({ error: 'prompt or promptFile is required' });

  try {
    const session = ptyManager.launchDirect({ prompt, workingDirectory, mode, nodeMemory, name });
    console.log(`[APM] Launched session ${session.id} (${name || 'direct'})`);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/apm/sessions', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!allowed.includes(ip)) {
    return res.status(403).json({ error: 'APM endpoint only available from localhost' });
  }

  const all = storage.getSessions();
  const apmSessions = all.filter(s => s.profileName && s.profileName.startsWith('APM'));
  res.json(apmSessions);
});

// ─── Marketplace API (authenticated) ───

const MARKETPLACE_CATALOG = {
  agentPacks: [
    {
      id: 'lucasaugustodev-agents',
      name: 'Lucas Augusto Agent Pack',
      repo: 'lucasaugustodev/claude-agents',
      description: '8 agentes especializados para Claude Code (documentador, CI/CD, file guardian, live-node, playwright, PM, windows automation, cline executor)',
    },
  ],
  plugins: [
    {
      id: 'claude-mem',
      name: 'Claude Memory (claude-mem)',
      repo: 'thedotmack/claude-mem',
      marketplace: 'thedotmack',
      description: 'Sistema de memoria persistente entre sessoes - preserva contexto automaticamente',
    },
  ],
};

// Helper: detect installed agents
function getInstalledAgents() {
  if (!fs.existsSync(CLAUDE_AGENTS_DIR)) return [];
  return fs.readdirSync(CLAUDE_AGENTS_DIR).filter(f => f.endsWith('.md'));
}

// Helper: detect installed plugins
function getInstalledPlugins() {
  const regPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(regPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(regPath, 'utf8')).plugins || {};
  } catch { return {}; }
}

// GET /api/marketplace/catalog - Catalog with install status
app.get('/api/marketplace/catalog', checkToken, async (req, res) => {
  try {
    const installedAgentFiles = getInstalledAgents();
    const installedPlugins = getInstalledPlugins();

    // Build agent packs with agent list from GitHub (cached for 5min)
    const packs = [];
    for (const pack of MARKETPLACE_CATALOG.agentPacks) {
      const agents = [];
      // Try to read from local clone cache first
      const cacheDir = path.join(os.tmpdir(), 'cl-marketplace', pack.id);
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.md') && f !== 'README.md');
        for (const f of files) {
          try {
            const raw = fs.readFileSync(path.join(cacheDir, f), 'utf8');
            const fm = parseYamlFrontmatter(raw);
            agents.push({
              filename: f,
              name: fm.name || f.replace('.md', ''),
              model: fm.model || 'sonnet',
              color: fm.color || 'blue',
              description: fm.description ? String(fm.description).replace(/^["']|["']$/g, '').split(/(?<=[.!?])\s/)[0].slice(0, 150) : '',
              installed: installedAgentFiles.includes(f),
            });
          } catch {}
        }
      }
      packs.push({ ...pack, agents, cached: agents.length > 0 });
    }

    // Build plugins with install status
    const plugins = MARKETPLACE_CATALOG.plugins.map(p => {
      const key = `${p.id}@${p.marketplace}`;
      const entry = installedPlugins[key];
      return {
        ...p,
        installed: !!entry,
        version: entry ? entry[0]?.version : null,
      };
    });

    res.json({ agentPacks: packs, plugins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/marketplace/install-agents - Install agents from a pack
app.post('/api/marketplace/install-agents', checkToken, async (req, res) => {
  const { packId, agentNames } = req.body;
  if (!packId) return res.status(400).json({ error: 'packId is required' });

  const pack = MARKETPLACE_CATALOG.agentPacks.find(p => p.id === packId);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  const cacheDir = path.join(os.tmpdir(), 'cl-marketplace', packId);

  try {
    // Clone or pull the repo
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      await new Promise((resolve, reject) => {
        const proc = require('child_process').spawn('git', ['clone', '--depth', '1', `https://github.com/${pack.repo}.git`, cacheDir], { stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)));
        proc.on('error', reject);
      });
    } else {
      // Pull latest
      await new Promise((resolve, reject) => {
        const proc = require('child_process').spawn('git', ['pull'], { cwd: cacheDir, stdio: 'pipe' });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve()); // ignore pull errors
      });
    }

    // Ensure agents dir exists
    if (!fs.existsSync(CLAUDE_AGENTS_DIR)) {
      fs.mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true });
    }

    // Get available .md files (excluding README, .gitignore etc)
    const allFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    const filesToInstall = agentNames ? allFiles.filter(f => agentNames.includes(f) || agentNames.includes(f.replace('.md', ''))) : allFiles;

    const installed = [];
    for (const f of filesToInstall) {
      const src = path.join(cacheDir, f);
      const dest = path.join(CLAUDE_AGENTS_DIR, f);
      fs.copyFileSync(src, dest);
      installed.push(f);
    }

    console.log(`[MARKETPLACE] Installed ${installed.length} agents from ${pack.repo}`);
    res.json({ installed, total: allFiles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/marketplace/uninstall-agent - Remove an agent file
app.post('/api/marketplace/uninstall-agent', checkToken, (req, res) => {
  const { agentName } = req.body;
  if (!agentName) return res.status(400).json({ error: 'agentName is required' });

  const filename = agentName.endsWith('.md') ? agentName : agentName + '.md';
  const filePath = path.join(CLAUDE_AGENTS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  fs.unlinkSync(filePath);
  console.log(`[MARKETPLACE] Uninstalled agent: ${filename}`);
  res.json({ ok: true, removed: filename });
});

// POST /api/marketplace/install-plugin - Install a plugin
app.post('/api/marketplace/install-plugin', checkToken, async (req, res) => {
  const { pluginId } = req.body;
  if (!pluginId) return res.status(400).json({ error: 'pluginId is required' });

  const plugin = MARKETPLACE_CATALOG.plugins.find(p => p.id === pluginId);
  if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

  const claudeDir = path.join(os.homedir(), '.claude');
  const pluginsDir = path.join(claudeDir, 'plugins');
  const marketplaceDir = path.join(pluginsDir, 'marketplaces', plugin.marketplace);

  try {
    // Step 1: Clone marketplace source
    if (!fs.existsSync(marketplaceDir)) {
      fs.mkdirSync(marketplaceDir, { recursive: true });
      await new Promise((resolve, reject) => {
        const proc = require('child_process').spawn('git', ['clone', '--depth', '1', `https://github.com/${plugin.repo}.git`, marketplaceDir], { stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)));
        proc.on('error', reject);
      });
    }

    // Step 2: Find plugin.json in the cloned repo
    let pluginJsonPath = null;
    let pluginSrcDir = null;
    const searchDirs = [marketplaceDir, path.join(marketplaceDir, 'plugin')];
    for (const dir of searchDirs) {
      const candidate = path.join(dir, '.claude-plugin', 'plugin.json');
      if (fs.existsSync(candidate)) {
        pluginJsonPath = candidate;
        pluginSrcDir = dir;
        break;
      }
    }
    if (!pluginJsonPath) {
      return res.status(500).json({ error: 'Could not find .claude-plugin/plugin.json in repo' });
    }

    const pluginMeta = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    const version = pluginMeta.version || '0.0.0';

    // Step 3: Copy to cache
    const cacheDir = path.join(pluginsDir, 'cache', plugin.marketplace, plugin.id, version);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      // Copy all plugin files
      const copyRecursive = (src, dest) => {
        if (fs.statSync(src).isDirectory()) {
          if (path.basename(src) === '.git' || path.basename(src) === 'node_modules') return;
          fs.mkdirSync(dest, { recursive: true });
          for (const f of fs.readdirSync(src)) {
            copyRecursive(path.join(src, f), path.join(dest, f));
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      };
      copyRecursive(pluginSrcDir, cacheDir);
    }

    // Step 4: Install dependencies
    const pkgJson = path.join(cacheDir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      await new Promise((resolve, reject) => {
        // Try bun first, fall back to npm
        const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const proc = require('child_process').spawn(cmd, ['install', '--production'], { cwd: cacheDir, stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`npm install failed (${code})`)));
        proc.on('error', reject);
      });
    }

    // Step 5: Create metadata files
    const installVersion = { version, bun: null, uv: null, installedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(cacheDir, '.install-version'), JSON.stringify(installVersion, null, 2));
    fs.writeFileSync(path.join(cacheDir, '.cli-installed'), new Date().toISOString());

    // Step 6: Update installed_plugins.json
    const regPath = path.join(pluginsDir, 'installed_plugins.json');
    let registry = { version: 2, plugins: {} };
    if (fs.existsSync(regPath)) {
      try { registry = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch {}
    }
    const pluginKey = `${plugin.id}@${plugin.marketplace}`;
    registry.plugins[pluginKey] = [{
      scope: 'user',
      installPath: cacheDir,
      version,
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    }];
    fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));

    // Step 7: Update known_marketplaces.json
    const mkPath = path.join(pluginsDir, 'known_marketplaces.json');
    let marketplaces = {};
    if (fs.existsSync(mkPath)) {
      try { marketplaces = JSON.parse(fs.readFileSync(mkPath, 'utf8')); } catch {}
    }
    marketplaces[plugin.marketplace] = {
      source: { source: 'github', repo: plugin.repo },
      installLocation: marketplaceDir,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(mkPath, JSON.stringify(marketplaces, null, 2));

    // Step 8: Update settings.json enabledPlugins
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
    }
    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    settings.enabledPlugins[pluginKey] = true;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    console.log(`[MARKETPLACE] Installed plugin: ${plugin.id} v${version}`);
    res.json({ ok: true, version, installPath: cacheDir });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/marketplace/uninstall-plugin - Remove a plugin
app.post('/api/marketplace/uninstall-plugin', checkToken, (req, res) => {
  const { pluginId } = req.body;
  if (!pluginId) return res.status(400).json({ error: 'pluginId is required' });

  const plugin = MARKETPLACE_CATALOG.plugins.find(p => p.id === pluginId);
  if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

  const claudeDir = path.join(os.homedir(), '.claude');
  const pluginsDir = path.join(claudeDir, 'plugins');
  const pluginKey = `${plugin.id}@${plugin.marketplace}`;

  try {
    // Remove from installed_plugins.json
    const regPath = path.join(pluginsDir, 'installed_plugins.json');
    if (fs.existsSync(regPath)) {
      const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      delete registry.plugins[pluginKey];
      fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
    }

    // Disable in settings.json
    const settingsPath = path.join(claudeDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.enabledPlugins) {
        delete settings.enabledPlugins[pluginKey];
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    }

    // Remove cache dir
    const cacheBase = path.join(pluginsDir, 'cache', plugin.marketplace, plugin.id);
    if (fs.existsSync(cacheBase)) {
      fs.rmSync(cacheBase, { recursive: true, force: true });
    }

    console.log(`[MARKETPLACE] Uninstalled plugin: ${plugin.id}`);
    res.json({ ok: true, removed: pluginKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/marketplace/refresh-agents - Force refresh agent pack cache
app.post('/api/marketplace/refresh-agents', checkToken, async (req, res) => {
  const { packId } = req.body;
  if (!packId) return res.status(400).json({ error: 'packId is required' });

  const pack = MARKETPLACE_CATALOG.agentPacks.find(p => p.id === packId);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  const cacheDir = path.join(os.tmpdir(), 'cl-marketplace', packId);

  try {
    // Remove old cache and re-clone
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const proc = require('child_process').spawn('git', ['clone', '--depth', '1', `https://github.com/${pack.repo}.git`, cacheDir], { stdio: 'pipe' });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)));
      proc.on('error', reject);
    });

    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    console.log(`[MARKETPLACE] Refreshed pack ${packId}: ${files.length} agents`);
    res.json({ ok: true, agentCount: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Protected routes below ───
app.use('/api/profiles', checkToken);
app.use('/api/sessions', checkToken);
app.use('/api/github', checkToken);
app.use('/api/github-cli', checkToken);
app.use('/api/cline-cli', checkToken);
app.use('/api/cline-sessions', checkToken);

// ─── File Manager Security ───

function sanitizePath(requestedPath) {
  return path.resolve('/', requestedPath || '/');
}

// ─── File Manager API ───

app.get('/api/files', checkToken, async (req, res) => {
  const defaultDir = process.platform === 'win32' ? os.homedir() : '/home';
  const dirPath = sanitizePath(req.query.path || defaultDir);

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(dirPath, entry.name);
        const stat = await fs.promises.stat(fullPath);
        items.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stat.size,
          modified: stat.mtime.toISOString(),
          permissions: '0' + (stat.mode & 0o777).toString(8),
        });
      } catch {
        items.push({
          name: entry.name,
          path: path.join(dirPath, entry.name),
          isDirectory: entry.isDirectory(),
          size: 0,
          modified: null,
          permissions: '???',
        });
      }
    }

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      path: dirPath,
      parent: dirPath === '/' ? null : path.dirname(dirPath),
      items,
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Directory not found' });
    if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/download', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  checkToken(req, res, next);
}, async (req, res) => {
  const filePath = sanitizePath(req.query.path);

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });

    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
      '.js': 'application/javascript', '.json': 'application/json',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.bmp': 'image/bmp', '.ico': 'image/x-icon',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
      '.pdf': 'application/pdf', '.zip': 'application/zip',
      '.tar': 'application/x-tar', '.gz': 'application/gzip',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);

    // Inline for previewable types, attachment for downloads
    const inlineTypes = ['image/', 'video/', 'audio/', 'application/pdf', 'text/'];
    const isInline = inlineTypes.some(t => contentType.startsWith(t));
    res.setHeader('Content-Disposition', isInline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: err.message });
  }
});

const uploadTmpDir = path.join(os.tmpdir(), 'claude-fm-uploads');
if (!fs.existsSync(uploadTmpDir)) fs.mkdirSync(uploadTmpDir, { recursive: true });

const upload = multer({
  dest: uploadTmpDir,
  limits: { fileSize: 100 * 1024 * 1024 },
});

app.post('/api/files/upload', checkToken, upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const destDir = sanitizePath(req.body.path || '/home');
  const results = [];
  let pending = req.files.length;

  for (const file of req.files) {
    const destPath = path.join(destDir, file.originalname);
    // sudo mv from temp to destination, then fix permissions
    execFile('sudo', ['mv', file.path, destPath], (err) => {
      if (err) {
        results.push({ name: file.originalname, error: err.message });
      } else {
        results.push({ name: file.originalname, size: file.size, path: destPath });
      }
      pending--;
      if (pending === 0) {
        res.json({ uploaded: results });
      }
    });
  }
});

app.post('/api/files/mkdir', checkToken, (req, res) => {
  const dirPath = sanitizePath(req.body.path);

  execFile('sudo', ['mkdir', '-p', dirPath], (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true, path: dirPath });
  });
});

app.post('/api/files/delete', checkToken, (req, res) => {
  const targetPath = sanitizePath(req.body.path);

  const protectedDirs = ['/', '/bin', '/sbin', '/usr', '/etc', '/boot', '/dev', '/proc', '/sys', '/var', '/lib', '/lib64'];
  if (protectedDirs.includes(targetPath)) {
    return res.status(403).json({ error: 'Cannot delete protected system directory' });
  }

  execFile('sudo', ['rm', '-rf', targetPath], (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
});

app.get('/api/files/read', checkToken, (req, res) => {
  const filePath = sanitizePath(req.query.path);

  execFile('sudo', ['cat', filePath], { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      if (stderr && stderr.includes('No such file')) return res.status(404).json({ error: 'File not found' });
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ path: filePath, content: stdout, name: path.basename(filePath) });
  });
});

app.post('/api/files/write', checkToken, (req, res) => {
  const filePath = sanitizePath(req.body.path);
  const content = req.body.content;

  if (content === undefined || content === null) {
    return res.status(400).json({ error: 'content is required' });
  }

  const { spawn } = require('child_process');
  const proc = spawn('sudo', ['tee', filePath], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('close', (code) => {
    if (code !== 0) return res.status(500).json({ error: stderr || 'Write failed' });
    res.json({ ok: true, path: filePath });
  });

  proc.stdin.write(content);
  proc.stdin.end();
});

// ─── Profiles API ───

app.get('/api/profiles', (req, res) => {
  res.json(storage.getProfiles());
});

app.post('/api/profiles', (req, res) => {
  const { name, workingDirectory, mode, initialPrompt, nodeMemory, githubRepo, syncStrategy } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const { v4: uuid } = require('uuid');
  const profile = {
    id: uuid(),
    name,
    workingDirectory: workingDirectory || '',
    mode: mode || 'normal',
    initialPrompt: initialPrompt || '',
    nodeMemory: nodeMemory || null,
    githubRepo: githubRepo || null,
    syncStrategy: syncStrategy || 'branch',
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

app.post('/api/sessions/launch', async (req, res) => {
  const { profileId, streamJson } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId is required' });

  try {
    const session = await ptyManager.launchSession(profileId, { streamJson: !!streamJson });
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
  const { streamJson } = req.body || {};
  try {
    const session = ptyManager.resumeSession(req.params.id, { streamJson: !!streamJson });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/sessions/history', (req, res) => {
  storage.clearHistory();
  res.json({ ok: true });
});

// ─── GitHub Sync API ───

app.get('/api/github/status', (req, res) => {
  const config = githubSync.getConfig();
  if (!config || !config.installationId) {
    return res.json({ connected: false, enabled: false });
  }
  res.json({
    connected: true,
    enabled: !!config.enabled,
    owner: config.owner,
    repo: config.repo,
  });
});

app.post('/api/github/detect', async (req, res) => {
  try {
    const installations = await githubSync.listInstallations();
    res.json({ installations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/connect', async (req, res) => {
  const { installationId, owner, accountType } = req.body;
  if (!installationId || !owner) {
    return res.status(400).json({ error: 'installationId and owner required' });
  }

  try {
    const token = await githubSync.getInstallationToken(installationId);
    const repoName = 'claude-sessions';

    const repoCheck = await githubSync.checkRepo(token, owner, repoName);

    if (!repoCheck.exists) {
      // For organizations, try to create automatically
      if (accountType === 'Organization') {
        try {
          await githubSync.createOrgRepo(token, owner, repoName);
          console.log(`[GITHUB] Created repo: ${owner}/${repoName}`);
        } catch (createErr) {
          return res.json({
            ok: false,
            needsRepo: true,
            createUrl: `https://github.com/organizations/${owner}/repositories/new?name=${repoName}&visibility=private`,
            error: createErr.message,
          });
        }
      } else {
        // User accounts — can't create via API, show link
        return res.json({
          ok: false,
          needsRepo: true,
          createUrl: `https://github.com/new?name=${repoName}&private=true&description=Claude+sessions+auto-sync`,
        });
      }
    }

    // Repo exists (or just created) — save config and connect
    githubSync.saveConfig({
      installationId: String(installationId),
      owner,
      repo: repoName,
      enabled: true,
    });

    console.log(`[GITHUB] Connected: ${owner}/${repoName}`);
    res.json({ ok: true, repo: `${owner}/${repoName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/test', async (req, res) => {
  try {
    const result = await githubSync.testConnection();
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/github/sync/:id', async (req, res) => {
  try {
    const result = await githubSync.syncSession(req.params.id);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.delete('/api/github/config', (req, res) => {
  githubSync.saveConfig(null);
  console.log('[GITHUB] Config deleted');
  res.json({ ok: true });
});

// ─── GitHub Repos API (for profile linking) ───

app.get('/api/github/repos', async (req, res) => {
  try {
    const config = githubSync.getConfig();
    if (!config || !config.installationId) {
      return res.status(400).json({ error: 'GitHub not connected. Connect first in GitHub settings.' });
    }
    const repos = await githubSync.listRepos(config.installationId);
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/create-repo', async (req, res) => {
  const { name } = req.body;
  const isPrivate = req.body.private !== false;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const config = githubSync.getConfig();
    if (!config || !config.installationId) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const result = await githubSync.createRepo(config.installationId, config.owner, name, isPrivate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/clone', async (req, res) => {
  const { owner, repo } = req.body;
  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner and repo required' });
  }
  try {
    const config = githubSync.getConfig();
    if (!config || !config.installationId) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const result = await githubSync.cloneRepo(config.installationId, owner, repo);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/watcher-status', (req, res) => {
  const status = gitWatcher.getStatus(req.params.id);
  res.json(status);
});

// ─── GitHub CLI API ───

app.get('/api/github-cli/status', async (req, res) => {
  try {
    const status = await githubCli.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github-cli/install', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await githubCli.install((text) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', text })}\n\n`);
    });
    const status = await githubCli.getStatus();
    res.write(`data: ${JSON.stringify({ type: 'done', ...status })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
  res.end();
});

app.post('/api/github-cli/auth', (req, res) => {
  try {
    const session = ptyManager.spawnInteractive('gh', ['auth', 'login'], process.cwd());
    res.json({ sessionId: session.id, pid: session.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github-cli/repos', async (req, res) => {
  try {
    const repos = await githubCli.listRepos();
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github-cli/clone', async (req, res) => {
  const { repo, destDir } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo is required (e.g. owner/repo-name)' });

  const repoName = repo.split('/').pop().replace(/\.git$/, '') || repo;
  const dest = destDir || path.join(os.homedir(), repoName);

  try {
    const result = await githubCli.cloneRepo(repo, dest);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cline CLI API ───

app.get('/api/cline-cli/status', async (req, res) => {
  try {
    const status = await clineCli.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cline-cli/install', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await clineCli.install((text) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', text })}\n\n`);
    });
    const status = await clineCli.getStatus();
    res.write(`data: ${JSON.stringify({ type: 'done', ...status })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
  res.end();
});

app.post('/api/cline-cli/auth', (req, res) => {
  try {
    clineCli.invalidateCache();
    const session = ptyManager.spawnInteractive('cline', ['auth'], process.cwd());
    res.json({ sessionId: session.id, pid: session.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cline Sessions API ───

app.get('/api/cline-sessions', (req, res) => {
  res.json(ptyManager.getActiveClineSessions());
});

app.get('/api/cline-sessions/history', (req, res) => {
  res.json(storage.getClineSessions());
});

app.post('/api/cline-sessions/launch', (req, res) => {
  const { prompt, workingDirectory } = req.body;

  try {
    const session = ptyManager.launchClineSession({ prompt, workingDirectory });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/cline-sessions/:id/stop', (req, res) => {
  const stopped = ptyManager.stopClineSession(req.params.id);
  if (!stopped) return res.status(404).json({ error: 'Session not found or already stopped' });
  res.json({ ok: true });
});

app.get('/api/cline-sessions/:id/output', (req, res) => {
  const output = ptyManager.getSessionOutput(req.params.id);
  res.json({ output });
});

app.delete('/api/cline-sessions/history', (req, res) => {
  storage.clearClineHistory();
  res.json({ ok: true });
});

// ─── Gemini CLI API ───

app.get('/api/gemini-cli/status', checkToken, async (req, res) => {
  try {
    const status = await geminiCli.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gemini-cli/install', checkToken, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await geminiCli.install((text) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', text })}\n\n`);
    });
    const status = await geminiCli.getStatus();
    res.write(`data: ${JSON.stringify({ type: 'done', ...status })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
  res.end();
});

// Gemini Sessions

app.get('/api/gemini-sessions', checkToken, (req, res) => {
  res.json(ptyManager.getActiveGeminiSessions());
});

app.get('/api/gemini-sessions/history', checkToken, (req, res) => {
  res.json(storage.getGeminiSessions());
});

app.post('/api/gemini-sessions/launch', checkToken, (req, res) => {
  const { prompt, workingDirectory } = req.body;

  try {
    const session = ptyManager.launchGeminiSession({ prompt, workingDirectory });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/gemini-sessions/:id/stop', checkToken, (req, res) => {
  const stopped = ptyManager.stopGeminiSession(req.params.id);
  if (!stopped) return res.status(404).json({ error: 'Session not found or already stopped' });
  res.json({ ok: true });
});

app.get('/api/gemini-sessions/:id/output', checkToken, (req, res) => {
  const output = ptyManager.getSessionOutput(req.params.id);
  res.json({ output });
});

app.delete('/api/gemini-sessions/history', checkToken, (req, res) => {
  storage.clearGeminiHistory();
  res.json({ ok: true });
});

// ─── Schedules API (authenticated) ───

app.get('/api/schedules', checkToken, (req, res) => {
  const schedules = storage.getSchedules();
  const status = scheduler.getStatus();
  // Enrich with running status
  const enriched = schedules.map(s => ({
    ...s,
    isRunning: status.jobs.some(j => j.scheduleId === s.id && j.running),
  }));
  res.json(enriched);
});

app.post('/api/schedules', checkToken, (req, res) => {
  const { name, type, cron: cronExpr, intervalMinutes, runAt, targetType, targetId, targetConfig, prompt } = req.body;

  if (!name || !type || !targetType || !targetId) {
    return res.status(400).json({ error: 'name, type, targetType and targetId are required' });
  }

  if (type === 'cron' && !cronExpr) {
    return res.status(400).json({ error: 'cron expression is required for cron type' });
  }

  if (type === 'interval' && !intervalMinutes) {
    return res.status(400).json({ error: 'intervalMinutes is required for interval type' });
  }

  if (type === 'once' && !runAt) {
    return res.status(400).json({ error: 'runAt is required for once type' });
  }

  const { v4: uuidv4 } = require('uuid');
  const schedule = {
    id: uuidv4(),
    name,
    enabled: true,
    type,
    cron: cronExpr || null,
    intervalMinutes: intervalMinutes || null,
    runAt: runAt || null,
    targetType,
    targetId,
    targetConfig: targetConfig || {},
    prompt: prompt || null,
    lastRun: null,
    nextRun: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  storage.addSchedule(schedule);
  scheduler.registerJob(schedule);

  res.json(schedule);
});

// Log routes MUST come before :id routes to avoid "log" being matched as :id
app.get('/api/schedules/log', checkToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const log = storage.getScheduleLog(limit);
  res.json(log);
});

app.delete('/api/schedules/log', checkToken, (req, res) => {
  storage.clearScheduleLog();
  res.json({ ok: true });
});

app.put('/api/schedules/:id', checkToken, (req, res) => {
  const existing = storage.getSchedule(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  const updates = { ...req.body, updatedAt: new Date().toISOString() };
  delete updates.id;
  delete updates.createdAt;

  const updated = storage.updateSchedule(req.params.id, updates);

  // Re-register job with new config
  scheduler.unregisterJob(req.params.id);
  if (updated.enabled) {
    scheduler.registerJob(updated);
  }

  res.json(updated);
});

app.delete('/api/schedules/:id', checkToken, (req, res) => {
  const existing = storage.getSchedule(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  scheduler.unregisterJob(req.params.id);
  storage.deleteSchedule(req.params.id);

  res.json({ ok: true });
});

app.post('/api/schedules/:id/toggle', checkToken, (req, res) => {
  const toggled = storage.toggleSchedule(req.params.id);
  if (!toggled) return res.status(404).json({ error: 'Schedule not found' });

  if (toggled.enabled) {
    scheduler.registerJob(toggled);
  } else {
    scheduler.unregisterJob(req.params.id);
  }

  res.json(toggled);
});

app.post('/api/schedules/:id/run-now', checkToken, async (req, res) => {
  const existing = storage.getSchedule(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  try {
    await scheduler.executeSchedule(req.params.id);
    res.json({ ok: true, message: `Schedule "${existing.name}" triggered` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

      case 'stream-json-input': {
        const { sessionId, message } = msg;
        if (sessionId && message) {
          ptyManager.sendStreamJsonInput(sessionId, message);
        }
        break;
      }

      case 'resize': {
        const { sessionId, cols, rows } = msg;
        if (sessionId && cols && rows && !ptyManager.isStreamJson(sessionId)) {
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

// ─── Broadcast Helper (for watcher events) ───

function broadcastToAll(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      try { client.send(msg); } catch {}
    }
  }
}

// Expose broadcast for pty-manager
ptyManager.setBroadcast(broadcastToAll);

// ─── Startup ───

const cleaned = ptyManager.cleanupOrphaned();
if (cleaned > 0) {
  console.log(`Cleaned ${cleaned} orphaned sessions`);
}

const cleanedCline = ptyManager.cleanupOrphanedCline();
if (cleanedCline > 0) {
  console.log(`Cleaned ${cleanedCline} orphaned Cline sessions`);
}

// Initialize scheduler
scheduler.init(storage, ptyManager, broadcastToAll);

// Pre-warm CLI status caches so first tab visit is instant
clineCli.getStatus().then(s => {
  console.log(`[CLINE] Status cached: installed=${s.installed}, v=${s.version}, configured=${s.configured}`);
}).catch(() => {});

const cleanedGemini = ptyManager.cleanupOrphanedGemini();
if (cleanedGemini > 0) {
  console.log(`Cleaned ${cleanedGemini} orphaned Gemini sessions`);
}

geminiCli.getStatus().then(s => {
  console.log(`[GEMINI] Status cached: installed=${s.installed}, v=${s.version}`);
}).catch(() => {});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Launcher Web running on http://0.0.0.0:${PORT}`);
  console.log(`Setup required: ${!storage.hasUsers()}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  scheduler.shutdown();
  const stopped = ptyManager.stopAll();
  if (stopped > 0) console.log(`Stopped ${stopped} active sessions`);
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  scheduler.shutdown();
  const stopped = ptyManager.stopAll();
  server.close();
  process.exit(0);
});
