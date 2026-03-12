// Prevent uncaught exceptions from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (server kept alive):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection (server kept alive):', err && err.message || err);
});

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
const gwsCli = require('./gws-cli');
const claudeCli = require('./claude-cli');
const whatsappKapso = require('./whatsapp-kapso');
const scheduler = require('./scheduler');
const multer = require('multer');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');

const PORT = process.env.PORT || 3002;

const app = express();
const server = http.createServer(app);

// ─── No auth required (handled by hiveclip) ───

// Onboarding flag file
const ONBOARDING_FILE = path.join(__dirname, '.onboarding-done');

// No-op auth middleware (kept as checkToken so all routes still work)
function checkToken(req, res, next) { next(); }

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ───

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeSessions: ptyManager.getActiveSessions().length,
  });
});

// Onboarding status (replaces auth status)
// If Claude Code is not authenticated, force onboarding even if it was completed before
app.get('/api/auth/status', async (req, res) => {
  const flagExists = fs.existsSync(ONBOARDING_FILE);
  let claudeAuthed = false;
  try {
    const st = await claudeCli.getStatus();
    claudeAuthed = st.installed && (st.authenticated || st.configured);
  } catch {}
  // Only consider onboarding done if flag exists AND Claude Code is authenticated
  const onboardingDone = flagExists && claudeAuthed;
  res.json({
    needsSetup: false,
    loggedIn: true,
    onboardingDone,
    env: {
      platform: process.platform,
      homeDir: (() => {
        const home = os.homedir();
        if (process.platform !== 'win32') return home;
        if (fs.existsSync(path.join(home, 'Desktop'))) return home;
        const candidates = ['C:\\Users\\Administrator', 'C:\\Users\\Public'];
        for (const c of candidates) { if (fs.existsSync(c)) return c; }
        return 'C:\\';
      })(),
      sep: path.sep,
    },
  });
});

app.post('/api/onboarding/complete', (req, res) => {
  fs.writeFileSync(ONBOARDING_FILE, new Date().toISOString());
  console.log('[ONBOARDING] Completed');
  res.json({ ok: true });
});

app.post('/api/onboarding/reset', (req, res) => {
  try { fs.unlinkSync(ONBOARDING_FILE); } catch {}
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
  const { agentName, workingDirectory, mode, nodeMemory, streamJson, prompt } = req.body;
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
      prompt: prompt || null,
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
      // Try to read from local clone cache first, then pre-installed dir
      const cacheDir = path.join(os.tmpdir(), 'cl-marketplace', pack.id);
      const preInstalledPackDir = path.join('C:\\', pack.id);
      const sourceDir = fs.existsSync(cacheDir) ? cacheDir : (fs.existsSync(preInstalledPackDir) ? preInstalledPackDir : null);
      if (sourceDir) {
        const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md') && f !== 'README.md');
        for (const f of files) {
          try {
            const raw = fs.readFileSync(path.join(sourceDir, f), 'utf8');
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
  const preInstalledPackDir = path.join('C:\\', packId);

  try {
    // Use pre-installed source if available, otherwise clone from GitHub
    if (!fs.existsSync(cacheDir)) {
      if (fs.existsSync(preInstalledPackDir)) {
        // Copy from pre-installed dir instead of git clone
        console.log(`[MARKETPLACE] Using pre-installed agent pack at ${preInstalledPackDir}`);
        fs.mkdirSync(cacheDir, { recursive: true });
        for (const f of fs.readdirSync(preInstalledPackDir)) {
          if (f === '.git' || f === 'node_modules') continue;
          const src = path.join(preInstalledPackDir, f);
          const dest = path.join(cacheDir, f);
          if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
        }
      } else {
        fs.mkdirSync(cacheDir, { recursive: true });
        await new Promise((resolve, reject) => {
          const proc = require('child_process').spawn('git', ['clone', '--depth', '1', `https://github.com/${pack.repo}.git`, cacheDir], { stdio: 'pipe', shell: true });
          const timeout = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('git clone timed out')); }, 60000);
          proc.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)); });
          proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
        });
      }
    } else {
      // Cache already exists, skip git pull (pre-installed copies are not git repos)
      console.log(`[MARKETPLACE] Using existing cache at ${cacheDir}`);
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

  // Pre-installed plugin detection (e.g. provisioned by hiveclip at C:\<plugin-id>)
  const preInstalledDir = path.join('C:\\', pluginId);
  const usePreInstalled = fs.existsSync(path.join(preInstalledDir, 'package.json'));

  try {
    // Step 1: Clone marketplace source (or use pre-installed location)
    if (usePreInstalled) {
      console.log(`[MARKETPLACE] Using pre-installed plugin at ${preInstalledDir}`);
      if (!fs.existsSync(marketplaceDir)) {
        fs.mkdirSync(marketplaceDir, { recursive: true });
        // Copy from pre-installed instead of git clone
        const copyRecursivePreinstall = (src, dest) => {
          if (fs.statSync(src).isDirectory()) {
            if (['.git', 'node_modules', '.cache'].includes(path.basename(src))) return;
            fs.mkdirSync(dest, { recursive: true });
            for (const f of fs.readdirSync(src)) {
              copyRecursivePreinstall(path.join(src, f), path.join(dest, f));
            }
          } else {
            fs.copyFileSync(src, dest);
          }
        };
        copyRecursivePreinstall(preInstalledDir, marketplaceDir);
      }
    } else if (!fs.existsSync(marketplaceDir)) {
      fs.mkdirSync(marketplaceDir, { recursive: true });
      await new Promise((resolve, reject) => {
        const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git';
        const proc = require('child_process').spawn(gitCmd, ['clone', '--depth', '1', `https://github.com/${plugin.repo}.git`, marketplaceDir], { stdio: 'pipe', shell: true });
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

    // Step 4: Install dependencies (skip if pre-installed with deps already present)
    const pkgJson = path.join(cacheDir, 'package.json');
    const depsExist = fs.existsSync(path.join(cacheDir, 'node_modules')) || fs.existsSync(path.join(cacheDir, 'bun.lockb'));
    if (fs.existsSync(pkgJson) && !depsExist) {
      await new Promise((resolve, reject) => {
        const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const proc = require('child_process').spawn(cmd, ['install', '--production'], { cwd: cacheDir, stdio: 'pipe', shell: true });
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
    // Remove old cache and re-clone (or copy from pre-installed)
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    fs.mkdirSync(cacheDir, { recursive: true });

    const preInstalledPackDir = path.join('C:\\', packId);
    if (fs.existsSync(preInstalledPackDir)) {
      console.log(`[MARKETPLACE] Refreshing from pre-installed at ${preInstalledPackDir}`);
      for (const f of fs.readdirSync(preInstalledPackDir)) {
        if (f === '.git' || f === 'node_modules') continue;
        const src = path.join(preInstalledPackDir, f);
        const dest = path.join(cacheDir, f);
        if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
      }
    } else {
      await new Promise((resolve, reject) => {
        const proc = require('child_process').spawn('git', ['clone', '--depth', '1', `https://github.com/${pack.repo}.git`, cacheDir], { stdio: 'pipe', shell: true });
        const timeout = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('git clone timed out')); }, 60000);
        proc.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)); });
        proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
    }

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

app.post('/api/gemini-cli/auth', checkToken, (req, res) => {
  try {
    geminiCli.invalidateCache();
    const session = ptyManager.spawnInteractive('gemini', [], process.cwd());
    res.json({ sessionId: session.id, pid: session.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ─── Google Workspace CLI ───

app.get('/api/gws-cli/status', checkToken, async (req, res) => {
  try {
    const status = await gwsCli.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gws-cli/install', checkToken, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await gwsCli.install((text) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', text })}\n\n`);
    });
    const status = await gwsCli.getStatus();
    res.write(`data: ${JSON.stringify({ type: 'done', ...status })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
  res.end();
});

app.post('/api/gws-cli/auth', checkToken, (req, res) => {
  try {
    gwsCli.invalidateCache();
    const session = ptyManager.spawnInteractive('gws', ['auth', 'login'], process.cwd());
    res.json({ sessionId: session.id, pid: session.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GWS Sessions

app.get('/api/gws-sessions', checkToken, (req, res) => {
  res.json(ptyManager.getActiveGwsSessions());
});

app.get('/api/gws-sessions/history', checkToken, (req, res) => {
  res.json(storage.getGwsSessions());
});

app.post('/api/gws-sessions/launch', checkToken, (req, res) => {
  const { prompt, workingDirectory } = req.body;
  try {
    const session = ptyManager.launchGwsSession({ prompt, workingDirectory });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/gws-sessions/:id/stop', checkToken, (req, res) => {
  const stopped = ptyManager.stopGwsSession(req.params.id);
  if (!stopped) return res.status(404).json({ error: 'Session not found or already stopped' });
  res.json({ ok: true });
});

app.get('/api/gws-sessions/:id/output', checkToken, (req, res) => {
  const output = ptyManager.getSessionOutput(req.params.id);
  res.json({ output });
});

app.delete('/api/gws-sessions/history', checkToken, (req, res) => {
  storage.clearGwsHistory();
  res.json({ ok: true });
});

// ─── WhatsApp (Kapso) API ───

app.get('/api/whatsapp/status', checkToken, (req, res) => {
  res.json(whatsappKapso.getStatus());
});

app.post('/api/whatsapp/link', checkToken, (req, res) => {
  const code = whatsappKapso.generateCode();
  res.json({ code, message: `Envie "${code}" para +56 9 2040 3095 no WhatsApp` });

  // Poll in background
  whatsappKapso.pollForCode(code).then(result => {
    if (result.success) {
      console.log(`[WhatsApp] Linked to ${result.phoneNumber}`);
      startWhatsappBridge();
      // Notify via WebSocket
      wss.clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'whatsapp:linked', phoneNumber: result.phoneNumber }));
        }
      });
    }
  }).catch(err => {
    console.error('[WhatsApp] Link poll error:', err.message);
  });
});

// Kapso automated setup: create account, sandbox session, API key
let kapsoSetupRunning = false;
app.post('/api/whatsapp/setup', checkToken, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (kapsoSetupRunning) return res.status(409).json({ error: 'Setup already running' });

  kapsoSetupRunning = true;
  console.log(`[WhatsApp Setup] Starting for ${phone}`);

  // Notify progress via WS
  const notifyProgress = (step, message) => {
    wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'whatsapp:setup-progress', step, message }));
      }
    });
  };

  // Run setup in background, respond immediately
  res.json({ status: 'started', message: 'Kapso setup iniciado...' });

  try {
    const kapsoSetup = require('./scripts/kapso-setup');
    const credentials = await kapsoSetup.run(phone);

    kapsoSetupRunning = false;

    if (credentials && credentials.activationCode === '__DUPLICATE__') {
      // Phone number already in use in another Kapso project
      wss.clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'whatsapp:setup-error',
            error: 'Esse numero ja esta vinculado em outro projeto Kapso. Use outro numero.',
          }));
        }
      });
    } else if (credentials && credentials.activationCode) {
      if (credentials.apiKey) {
        console.log(`[WhatsApp Setup] Got API key: ${credentials.apiKey.slice(0, 8)}...`);
      }

      wss.clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'whatsapp:setup-complete',
            activationCode: credentials.activationCode,
            sandboxNumber: credentials.sandboxNumber || '+56920403095',
            apiKey: credentials.apiKey,
            projectId: credentials.projectId,
            email: credentials.email,
          }));
        }
      });
      console.log(`[WhatsApp Setup] Complete! Code: ${credentials.activationCode}`);
    } else {
      wss.clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'whatsapp:setup-error',
            error: 'Setup completou mas nao obteve codigo de ativacao',
          }));
        }
      });
    }
  } catch (err) {
    kapsoSetupRunning = false;
    console.error('[WhatsApp Setup] Error:', err.message);
    wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'whatsapp:setup-error', error: err.message }));
      }
    });
  }
});

app.get('/api/whatsapp/link-status', checkToken, (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });
  res.json(whatsappKapso.getLinkStatus(code));
});

app.post('/api/whatsapp/unlink', checkToken, (req, res) => {
  res.json(whatsappKapso.unlink());
});

app.post('/api/whatsapp/send', checkToken, async (req, res) => {
  const { to, text } = req.body;
  try {
    const status = whatsappKapso.getStatus();
    const phone = to || status.phoneNumber;
    if (!phone) return res.status(400).json({ error: 'No linked phone' });
    const result = await whatsappKapso.sendMessage(phone, text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Claude Code CLI API ───

app.get('/api/claude-cli/status', checkToken, async (req, res) => {
  try {
    const status = await claudeCli.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/claude-cli/install', checkToken, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await claudeCli.install((text) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', text })}\n\n`);
    });
    const status = await claudeCli.getStatus();
    res.write(`data: ${JSON.stringify({ type: 'done', ...status })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
  res.end();
});

app.post('/api/claude-cli/auth', checkToken, (req, res) => {
  try {
    claudeCli.invalidateCache();
    const session = ptyManager.spawnInteractive('claude', [], process.cwd());
    res.json({ sessionId: session.id, pid: session.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
          // Always send raw output (for terminal fallback)
          ws.send(JSON.stringify({ type: 'output', sessionId, data: output }));

          // For stream-json sessions, re-emit buffer as parsed events for chat replay
          if (ptyManager.isStreamJson(sessionId)) {
            const lines = output.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const event = JSON.parse(trimmed);
                ws.send(JSON.stringify({ type: 'stream-json', sessionId, event }));
              } catch {}
            }
          }
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

// ─── Workflows API (BMAD Method) ───

const BMAD_PHASES = ['analysis', 'planning', 'solutioning', 'implementation', 'completed'];

const BMAD_AGENTS = [
  { name: 'bmad-analyst', persona: 'Mary', title: 'Analyst', phase: 'analysis', icon: '\u{1F4CA}', color: '#89b4fa' },
  { name: 'bmad-pm', persona: 'John', title: 'Product Manager', phase: 'planning', icon: '\u{1F4CB}', color: '#f9e2af' },
  { name: 'bmad-ux-designer', persona: 'Sally', title: 'UX Designer', phase: 'planning', icon: '\u{1F3A8}', color: '#f9e2af' },
  { name: 'bmad-architect', persona: 'Winston', title: 'Architect', phase: 'solutioning', icon: '\u{1F3D7}', color: '#cba6f7' },
  { name: 'bmad-scrum-master', persona: 'Bob', title: 'Scrum Master', phase: 'implementation', icon: '\u{1F3C3}', color: '#a6e3a1' },
  { name: 'bmad-dev', persona: 'Amelia', title: 'Developer', phase: 'implementation', icon: '\u{1F4BB}', color: '#a6e3a1' },
  { name: 'bmad-qa', persona: 'Quinn', title: 'QA Engineer', phase: 'implementation', icon: '\u{1F9EA}', color: '#a6e3a1' },
];

const PHASE_DEFAULT_AGENT = {
  analysis: 'bmad-analyst',
  planning: 'bmad-pm',
  solutioning: 'bmad-architect',
  implementation: 'bmad-scrum-master',
};

app.get('/api/workflows/agents', checkToken, (req, res) => {
  res.json(BMAD_AGENTS);
});

app.get('/api/workflows', checkToken, (req, res) => {
  res.json(storage.getWorkflows());
});

app.post('/api/workflows', checkToken, (req, res) => {
  const { name, description, workingDirectory, phase } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!workingDirectory) return res.status(400).json({ error: 'Working directory is required' });
  const { v4: uuid } = require('uuid');
  const now = new Date().toISOString();
  const startPhase = BMAD_PHASES.includes(phase) ? phase : 'analysis';
  const workflow = {
    id: uuid(),
    name,
    description: description || '',
    workingDirectory,
    phase: startPhase,
    status: 'active',
    artifacts: [],
    history: [{ action: 'created', at: now }],
    createdAt: now,
    updatedAt: now,
  };
  storage.addWorkflow(workflow);
  console.log(`[WORKFLOW] Created: ${name} (phase: ${startPhase})`);
  res.status(201).json(workflow);
});

app.get('/api/workflows/:id', checkToken, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json(workflow);
});

app.put('/api/workflows/:id', checkToken, (req, res) => {
  const { name, description, workingDirectory } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (workingDirectory !== undefined) updates.workingDirectory = workingDirectory;
  updates.updatedAt = new Date().toISOString();
  const updated = storage.updateWorkflow(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Workflow not found' });
  res.json(updated);
});

app.delete('/api/workflows/:id', checkToken, (req, res) => {
  storage.deleteWorkflow(req.params.id);
  res.json({ ok: true });
});

app.post('/api/workflows/:id/advance', checkToken, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  const currentIdx = BMAD_PHASES.indexOf(workflow.phase);
  if (currentIdx === -1 || currentIdx >= BMAD_PHASES.length - 1) {
    return res.status(400).json({ error: 'Cannot advance from current phase' });
  }
  const nextPhase = BMAD_PHASES[currentIdx + 1];
  const now = new Date().toISOString();
  const history = [...(workflow.history || []), {
    action: 'phase-advanced',
    from: workflow.phase,
    to: nextPhase,
    note: req.body.note || '',
    at: now,
  }];
  const updated = storage.updateWorkflow(req.params.id, { phase: nextPhase, history, updatedAt: now });
  console.log(`[WORKFLOW] ${workflow.name}: ${workflow.phase} -> ${nextPhase}`);
  res.json(updated);
});

app.post('/api/workflows/:id/artifacts', checkToken, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  const { type, name } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type and name are required' });
  const now = new Date().toISOString();
  const artifacts = [...(workflow.artifacts || []), {
    type, name, createdAt: now, createdBy: req.body.createdBy || '',
  }];
  const updated = storage.updateWorkflow(req.params.id, { artifacts, updatedAt: now });
  res.json(updated);
});

app.post('/api/workflows/:id/launch', checkToken, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  // Default: launch orchestrator with full workflow context
  const agentName = req.body.agentOverride || 'bmad-orchestrator';

  const cwd = workflow.workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    return res.status(400).json({ error: 'Working directory does not exist: ' + cwd });
  }

  // Build context prompt for orchestrator
  let contextPrompt = req.body.prompt || '';
  if (agentName === 'bmad-orchestrator') {
    const phaseLabel = { analysis: 'Analysis', planning: 'Planning', solutioning: 'Solutioning', implementation: 'Implementation', completed: 'Completed' };
    const artifactList = workflow.artifacts.length > 0
      ? workflow.artifacts.map(a => `  - ${a.type}: ${a.name} (by ${a.createdBy || 'unknown'}, ${a.createdAt})`).join('\n')
      : '  (none)';
    contextPrompt = `## Workflow Context

**Workflow ID:** ${workflow.id}
**Project:** ${workflow.name}
**Description:** ${workflow.description || 'N/A'}
**Working Directory:** ${cwd}
**Current Phase:** ${phaseLabel[workflow.phase] || workflow.phase}
**Status:** ${workflow.status}

### Existing Artifacts
${artifactList}

### History
${(workflow.history || []).slice(-10).map(h => `  - [${h.at}] ${h.action}${h.agent ? ': ' + h.agent : ''}${h.from ? ': ' + h.from + ' → ' + h.to : ''}`).join('\n')}

---

Use this context to guide the user. Check the _bmad-output/ directory for produced artifacts. Use the localhost API at http://localhost:3002 with the workflow ID above to advance phases and register artifacts.${contextPrompt ? '\n\nUser message: ' + contextPrompt : ''}`;
  }

  try {
    const session = ptyManager.launchAgent({
      agentName,
      workingDirectory: cwd,
      mode: 'bypass',
      prompt: contextPrompt || null,
      streamJson: true,
    });
    const now = new Date().toISOString();
    const history = [...(workflow.history || []), {
      action: 'agent-launched',
      agent: agentName,
      sessionId: session.id,
      at: now,
    }];
    storage.updateWorkflow(req.params.id, { history, updatedAt: now });
    console.log(`[WORKFLOW] Launched ${agentName} for "${workflow.name}", session ${session.id}`);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Workflows Local API (no auth, localhost only — for orchestrator agent) ───

function checkLocalhost(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!allowed.includes(ip)) return res.status(403).json({ error: 'Only available from localhost' });
  next();
}

app.get('/api/workflows/local/:id', checkLocalhost, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json(workflow);
});

app.post('/api/workflows/local/:id/advance', checkLocalhost, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  const currentIdx = BMAD_PHASES.indexOf(workflow.phase);
  if (currentIdx === -1 || currentIdx >= BMAD_PHASES.length - 1) {
    return res.status(400).json({ error: 'Cannot advance from current phase' });
  }
  const nextPhase = BMAD_PHASES[currentIdx + 1];
  const now = new Date().toISOString();
  const history = [...(workflow.history || []), {
    action: 'phase-advanced', from: workflow.phase, to: nextPhase, note: req.body.note || '', at: now,
  }];
  const updated = storage.updateWorkflow(req.params.id, { phase: nextPhase, history, updatedAt: now });
  console.log(`[WORKFLOW] ${workflow.name}: ${workflow.phase} -> ${nextPhase} (via orchestrator)`);
  res.json(updated);
});

app.post('/api/workflows/local/:id/artifacts', checkLocalhost, (req, res) => {
  const workflow = storage.getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  const { type, name } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type and name are required' });
  const now = new Date().toISOString();
  const artifacts = [...(workflow.artifacts || []), { type, name, createdAt: now, createdBy: req.body.createdBy || '' }];
  const updated = storage.updateWorkflow(req.params.id, { artifacts, updatedAt: now });
  res.json(updated);
});

// ─── Skills API (authenticated) ───

const SKILLS_DIRS = {
  personal: path.join(os.homedir(), '.claude', 'skills'),
};

const GEMINI_DIRS = {
  commands: path.join(os.homedir(), '.gemini', 'commands'),
  extensions: path.join(os.homedir(), '.gemini', 'extensions'),
  settings: path.join(os.homedir(), '.gemini'),
};

function parseSkillFrontmatter(content) {
  const fm = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return { frontmatter: fm, body: content };
  const lines = match[1].split('\n');
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    fm[key] = val;
  }
  return { frontmatter: fm, body: content.slice(match[0].length) };
}

function scanSkillsDir(dirPath, scope) {
  const skills = [];
  if (!fs.existsSync(dirPath)) return skills;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      try {
        const raw = fs.readFileSync(skillMd, 'utf8');
        const stat = fs.statSync(skillMd);
        const { frontmatter, body } = parseSkillFrontmatter(raw);
        const supportFiles = [];
        const skillDir = path.join(dirPath, entry.name);
        const allFiles = fs.readdirSync(skillDir, { recursive: true });
        for (const f of allFiles) {
          const fStr = typeof f === 'string' ? f : f.toString();
          if (fStr !== 'SKILL.md') supportFiles.push(fStr);
        }
        skills.push({
          id: scope + ':' + entry.name,
          dirName: entry.name,
          scope,
          path: skillDir,
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          model: frontmatter.model || null,
          context: frontmatter.context || 'inline',
          userInvocable: frontmatter['user-invocable'] !== false,
          disableModelInvocation: frontmatter['disable-model-invocation'] === true,
          argumentHint: frontmatter['argument-hint'] || '',
          allowedTools: frontmatter['allowed-tools'] || '',
          body: body.trim().substring(0, 500) + (body.trim().length > 500 ? '...' : ''),
          supportFiles,
          fileSize: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {}
    }
  } catch {}
  return skills;
}

// ─── Gemini Skills/Commands Scanner ───

function parseToml(content) {
  const result = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    result[key] = val;
  }
  return result;
}

function scanGeminiCommands() {
  const commands = [];
  const cmdDir = GEMINI_DIRS.commands;
  if (!fs.existsSync(cmdDir)) return commands;
  try {
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.toml'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(cmdDir, file), 'utf8');
        const stat = fs.statSync(path.join(cmdDir, file));
        const parsed = parseToml(raw);
        commands.push({
          id: 'gemini-cmd:' + file.replace('.toml', ''),
          filename: file,
          name: parsed.name || file.replace('.toml', ''),
          description: parsed.description || '',
          command: parsed.command || '',
          args: parsed.args || '',
          type: 'command',
          raw,
          fileSize: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          path: path.join(cmdDir, file),
        });
      } catch {}
    }
  } catch {}
  return commands;
}

function scanGeminiExtensions() {
  const extensions = [];
  const extDir = GEMINI_DIRS.extensions;
  if (!fs.existsSync(extDir)) return extensions;
  try {
    const entries = fs.readdirSync(extDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extPath = path.join(extDir, entry.name);
      // Check for extension manifest
      const manifestFiles = ['extension.json', 'package.json', 'manifest.json'];
      let manifest = null;
      let manifestFile = null;
      for (const mf of manifestFiles) {
        const fp = path.join(extPath, mf);
        if (fs.existsSync(fp)) {
          try { manifest = JSON.parse(fs.readFileSync(fp, 'utf8')); manifestFile = mf; } catch {}
          break;
        }
      }
      // Also check for SKILL.md inside extension
      const skillFiles = [];
      try {
        const walk = (dir) => {
          const items = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of items) {
            if (item.isFile() && item.name === 'SKILL.md') skillFiles.push(path.join(dir, item.name));
            if (item.isDirectory() && item.name !== 'node_modules') walk(path.join(dir, item.name));
          }
        };
        walk(extPath);
      } catch {}

      extensions.push({
        id: 'gemini-ext:' + entry.name,
        dirName: entry.name,
        name: (manifest && manifest.name) || entry.name,
        description: (manifest && manifest.description) || '',
        version: (manifest && manifest.version) || '',
        type: 'extension',
        manifestFile,
        skillCount: skillFiles.length,
        path: extPath,
      });
    }
  } catch {}
  return extensions;
}

// Also scan GEMINI.md project files
function scanGeminiProjectFile() {
  const geminiMd = path.join(os.homedir(), '.gemini', 'GEMINI.md');
  if (!fs.existsSync(geminiMd)) return null;
  try {
    const raw = fs.readFileSync(geminiMd, 'utf8');
    const stat = fs.statSync(geminiMd);
    return { raw, fileSize: stat.size, modifiedAt: stat.mtime.toISOString(), path: geminiMd };
  } catch { return null; }
}

// GET /api/gemini-skills - List Gemini commands, extensions, and GEMINI.md
app.get('/api/gemini-skills', checkToken, (req, res) => {
  const commands = scanGeminiCommands();
  const extensions = scanGeminiExtensions();
  const geminiMd = scanGeminiProjectFile();
  res.json({
    commands,
    extensions,
    geminiMd,
    commandsDir: GEMINI_DIRS.commands,
    extensionsDir: GEMINI_DIRS.extensions,
  });
});

// GET /api/gemini-skills/command/:name - Full command content
app.get('/api/gemini-skills/command/:name', checkToken, (req, res) => {
  const file = req.params.name.endsWith('.toml') ? req.params.name : req.params.name + '.toml';
  const fp = path.join(GEMINI_DIRS.commands, file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Comando nao encontrado' });
  res.json({ raw: fs.readFileSync(fp, 'utf8'), path: fp });
});

// POST /api/gemini-skills/command - Create Gemini command
app.post('/api/gemini-skills/command', checkToken, (req, res) => {
  const { name, description, command, args } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome e obrigatorio' });
  const filename = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '.toml';
  const fp = path.join(GEMINI_DIRS.commands, filename);
  if (fs.existsSync(fp)) return res.status(409).json({ error: 'Comando ja existe' });
  fs.mkdirSync(GEMINI_DIRS.commands, { recursive: true });
  let content = `name = "${name}"\n`;
  if (description) content += `description = "${description}"\n`;
  if (command) content += `command = "${command}"\n`;
  if (args) content += `args = "${args}"\n`;
  fs.writeFileSync(fp, content, 'utf8');
  res.json({ ok: true, path: fp });
});

// PUT /api/gemini-skills/command/:name - Update Gemini command
app.put('/api/gemini-skills/command/:name', checkToken, (req, res) => {
  const file = req.params.name.endsWith('.toml') ? req.params.name : req.params.name + '.toml';
  const fp = path.join(GEMINI_DIRS.commands, file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Comando nao encontrado' });
  const { raw } = req.body;
  if (!raw) return res.status(400).json({ error: 'Conteudo e obrigatorio' });
  fs.writeFileSync(fp, raw, 'utf8');
  res.json({ ok: true });
});

// DELETE /api/gemini-skills/command/:name
app.delete('/api/gemini-skills/command/:name', checkToken, (req, res) => {
  const file = req.params.name.endsWith('.toml') ? req.params.name : req.params.name + '.toml';
  const fp = path.join(GEMINI_DIRS.commands, file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Comando nao encontrado' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

// GET /api/skills - List all skills from all scopes
app.get('/api/skills', checkToken, (req, res) => {
  const personal = scanSkillsDir(SKILLS_DIRS.personal, 'personal');
  // Scan project-level skills for all known profile working directories
  const projectSkills = [];
  const profiles = storage.getProfiles();
  const scannedDirs = new Set();
  for (const p of profiles) {
    if (p.workingDirectory) {
      const projSkillsDir = path.join(p.workingDirectory, '.claude', 'skills');
      if (!scannedDirs.has(projSkillsDir)) {
        scannedDirs.add(projSkillsDir);
        projectSkills.push(...scanSkillsDir(projSkillsDir, 'project:' + p.name));
      }
    }
  }
  res.json({
    skills: [...personal, ...projectSkills],
    personalDir: SKILLS_DIRS.personal,
  });
});

// GET /api/skills/:scope/:name - Get full skill content
app.get('/api/skills/:scope/:name', checkToken, (req, res) => {
  const { scope, name } = req.params;
  let dirPath;
  if (scope === 'personal') {
    dirPath = path.join(SKILLS_DIRS.personal, name);
  } else {
    return res.status(400).json({ error: 'Scope invalido' });
  }
  const skillMd = path.join(dirPath, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return res.status(404).json({ error: 'Skill nao encontrada' });
  const raw = fs.readFileSync(skillMd, 'utf8');
  const { frontmatter, body } = parseSkillFrontmatter(raw);
  res.json({ name: frontmatter.name || name, frontmatter, body, raw, path: dirPath });
});

// POST /api/skills - Create a new skill
app.post('/api/skills', checkToken, (req, res) => {
  const { name, description, content, model, context, argumentHint, disableModelInvocation, userInvocable } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome e obrigatorio' });
  if (!/^[a-z0-9-]+$/.test(name)) return res.status(400).json({ error: 'Nome deve conter apenas letras minusculas, numeros e hifens' });

  const skillDir = path.join(SKILLS_DIRS.personal, name);
  if (fs.existsSync(skillDir)) return res.status(409).json({ error: 'Skill ja existe' });

  fs.mkdirSync(skillDir, { recursive: true });

  let fm = `---\nname: ${name}\n`;
  if (description) fm += `description: "${description}"\n`;
  if (model) fm += `model: ${model}\n`;
  if (context && context !== 'inline') fm += `context: ${context}\n`;
  if (argumentHint) fm += `argument-hint: "${argumentHint}"\n`;
  if (disableModelInvocation) fm += `disable-model-invocation: true\n`;
  if (userInvocable === false) fm += `user-invocable: false\n`;
  fm += `---\n\n`;

  const body = content || `# ${name}\n\nDescreva as instrucoes da skill aqui.\n`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), fm + body, 'utf8');

  res.json({ ok: true, path: skillDir });
});

// PUT /api/skills/:name - Update skill content
app.put('/api/skills/:name', checkToken, (req, res) => {
  const { name } = req.params;
  const skillDir = path.join(SKILLS_DIRS.personal, name);
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return res.status(404).json({ error: 'Skill nao encontrada' });

  const { raw } = req.body;
  if (!raw) return res.status(400).json({ error: 'Conteudo e obrigatorio' });
  fs.writeFileSync(skillMd, raw, 'utf8');
  res.json({ ok: true });
});

// DELETE /api/skills/:name - Delete a personal skill
app.delete('/api/skills/:name', checkToken, (req, res) => {
  const { name } = req.params;
  const skillDir = path.join(SKILLS_DIRS.personal, name);
  if (!fs.existsSync(skillDir)) return res.status(404).json({ error: 'Skill nao encontrada' });
  fs.rmSync(skillDir, { recursive: true, force: true });
  res.json({ ok: true });
});

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

const cleanedGws = ptyManager.cleanupOrphanedGws();
if (cleanedGws > 0) {
  console.log(`Cleaned ${cleanedGws} orphaned GWS sessions`);
}

gwsCli.getStatus().then(s => {
  console.log(`[GWS] Status cached: installed=${s.installed}, v=${s.version}`);
}).catch(() => {});

// --- Voice TTS (Edge TTS via msedge-tts, no GPU/Python needed) ---
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

app.post('/api/voice/tts', checkToken, async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Texto vazio' });

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice || 'pt-BR-AntonioNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text.trim());

    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.set('Content-Type', 'audio/mpeg');
      res.send(buffer);
    });
    audioStream.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Avatars served from public/avatars/ via express.static (no extra route needed)

// --- Planning: Process Discovery Agent Session ---
app.post('/api/planning/launch', checkToken, (req, res) => {
  const { message } = req.body || {};
  try {
    const session = ptyManager.launchPlanningSession(message || null);
    res.status(201).json(session);
  } catch (err) {
    console.error('[PLANNING] Launch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WhatsApp ↔ Agent Bridge (fully server-side) ───

let whatsappBridgeInterval = null;
const processedWhatsappMsgIds = new Set();
let whatsappAgentSession = null;

async function startWhatsappBridge() {
  if (whatsappBridgeInterval) return;

  // Mark all existing messages as processed so we don't replay history on startup
  try {
    const existing = await whatsappKapso.getLinkedMessages();
    for (const msg of existing) {
      const id = msg.id || msg.message_id;
      if (id) processedWhatsappMsgIds.add(id);
    }
    console.log(`[WhatsApp] Bridge started, skipping ${processedWhatsappMsgIds.size} existing messages`);
  } catch {
    console.log('[WhatsApp] Bridge started (could not pre-load messages)');
  }

  whatsappBridgeInterval = setInterval(async () => {
    try {
      const status = whatsappKapso.getStatus();
      if (!status.linked) return;

      const messages = await whatsappKapso.getLinkedMessages();
      if (!messages || messages.length === 0) return;

      for (const msg of messages) {
        const msgId = msg.id || msg.message_id;
        if (!msgId || processedWhatsappMsgIds.has(msgId)) continue;

        const rawText = msg.text;
        const body = (typeof rawText === 'string' ? rawText : (rawText && rawText.body) || msg.body || '').trim();
        if (!body || body.startsWith('HIVE-')) continue;

        processedWhatsappMsgIds.add(msgId);
        // Keep set from growing forever
        if (processedWhatsappMsgIds.size > 500) {
          const first = processedWhatsappMsgIds.values().next().value;
          processedWhatsappMsgIds.delete(first);
        }
        console.log(`[WhatsApp] Incoming: ${body.slice(0, 80)}`);

        // Broadcast to browser clients
        const payload = JSON.stringify({
          type: 'whatsapp:message',
          from: msg.from || msg.sender,
          text: body,
          messageId: msgId,
        });
        wss.clients.forEach(ws => {
          if (ws.readyState === ws.OPEN) ws.send(payload);
        });

        // Inject into agent session (or launch one)
        await handleWhatsAppInput(body);
        break;
      }
    } catch (err) {
      // Silent
    }
  }, 3000);
}

async function handleWhatsAppInput(text) {
  // Check if existing session is alive
  if (whatsappAgentSession) {
    const sent = ptyManager.sendStreamJsonInput(whatsappAgentSession, text);
    if (sent) {
      console.log(`[WhatsApp] Injected into session ${whatsappAgentSession.slice(0, 8)}`);
      return;
    }
    // Session dead, clear it
    whatsappAgentSession = null;
  }

  // Launch new agent session
  try {
    const session = ptyManager.launchAgent({
      agentName: 'manager-gestor',
      workingDirectory: null,
      mode: 'bypass',
      nodeMemory: null,
      streamJson: true,
      prompt: text,
    });
    whatsappAgentSession = session.id;
    console.log(`[WhatsApp] Launched agent session ${session.id.slice(0, 8)}`);

    // Register a listener to capture agent responses and send via WhatsApp
    registerWhatsAppResponseListener(session.id);
  } catch (err) {
    console.error('[WhatsApp] Failed to launch agent:', err.message);
    const status = whatsappKapso.getStatus();
    if (status.linked) {
      whatsappKapso.sendMessage(status.phoneNumber, 'Erro ao iniciar agente: ' + err.message).catch(() => {});
    }
  }
}

function registerWhatsAppResponseListener(sessionId) {
  let responseBuffer = '';
  let flushTimer = null;

  function flushWhatsAppResponse() {
    const text = responseBuffer.trim();
    responseBuffer = '';
    if (!text) return;

    const status = whatsappKapso.getStatus();
    if (status.linked) {
      // WhatsApp has 4096 char limit per message
      const chunks = [];
      for (let i = 0; i < text.length; i += 4000) {
        chunks.push(text.slice(i, i + 4000));
      }
      chunks.reduce((p, chunk) => p.then(() =>
        whatsappKapso.sendMessage(status.phoneNumber, chunk)
      ), Promise.resolve()).then(() => {
        console.log(`[WhatsApp] Sent response (${text.length} chars)`);
      }).catch(err => {
        console.error('[WhatsApp] Send error:', err.message);
      });
    }
  }

  const listener = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type !== 'stream-json' || parsed.sessionId !== sessionId) return;

      const event = parsed.event;
      if (!event) return;

      if (event.type === 'assistant') {
        const content = event.message && event.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              responseBuffer += block.text;
              clearTimeout(flushTimer);
              flushTimer = setTimeout(() => flushWhatsAppResponse(), 800);
            }
          }
        }
      }

      if (event.type === 'result') {
        clearTimeout(flushTimer);
        flushWhatsAppResponse();
      }
    } catch {}
  };

  const added = ptyManager.addListener(sessionId, listener);
  console.log(`[WhatsApp] Listener registered for ${sessionId.slice(0, 8)}: ${added}`);
}

// Start bridge if already linked
if (whatsappKapso.getStatus().linked) {
  startWhatsappBridge();
}

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

