const pty = require('node-pty');
const { spawn: spawnProcess } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuid } = require('uuid');
const storage = require('./storage');
const githubSync = require('./github-sync');
const gitWatcher = require('./git-watcher');
const { StreamAnalyzer } = require('./stream-analyzer');

// Broadcast function set by server.js
let _broadcast = () => {};

// Ensure workspace is trusted in .claude.json before launching
function ensureWorkspaceTrusted(cwd) {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    let data = {};
    if (fs.existsSync(claudeJsonPath)) {
      data = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
    }
    if (!data.projects) data.projects = {};

    // Normalize path for lookup
    const normalizedCwd = cwd.replace(/\\/g, '/');
    if (!data.projects[normalizedCwd] || !data.projects[normalizedCwd].hasTrustDialogAccepted) {
      if (!data.projects[normalizedCwd]) data.projects[normalizedCwd] = {};
      data.projects[normalizedCwd].hasTrustDialogAccepted = true;
      fs.writeFileSync(claudeJsonPath, JSON.stringify(data, null, 2));
      console.log(`[TRUST] Auto-trusted workspace: ${normalizedCwd}`);
    }
  } catch (err) {
    console.error(`[TRUST] Failed to auto-trust workspace: ${err.message}`);
  }
}

// Active PTY handles: sessionId -> { pty, output, listeners, startedAt, pid }
const handles = new Map();

// Output files directory
const OUTPUTS_DIR = path.join(__dirname, 'data', 'outputs');
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Poll interval for detecting exited processes
let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollSessions, 3000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function pollSessions() {
  for (const [id, handle] of handles) {
    if (handle.exited) continue;
    // node-pty fires 'exit' event, so we rely on that
  }
}


// Resolve the local Claude CLI path (node_modules) and Node.js executable
const LOCAL_CLI = path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
const HAS_LOCAL_CLI = fs.existsSync(LOCAL_CLI);

function findNodeExe() {
  const candidates = [
    process.execPath,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c) && path.basename(c).toLowerCase().startsWith('node')) {
      return c;
    }
  }
  return process.execPath;
}

const NODE_EXE = findNodeExe();

console.log(`[INIT] Node: ${NODE_EXE}, Local CLI: ${HAS_LOCAL_CLI ? LOCAL_CLI : 'NOT FOUND'}`);

// Build clean env for Claude processes
function buildClaudeEnv(nodeMemory) {
  const env = { ...process.env };

  // Remove ALL Claude Code env vars to prevent "nested session" detection
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_TEAMMATE_COMMAND;

  // Set TERM and FORCE_COLOR for proper TUI rendering
  env.TERM = 'xterm-256color';
  env.FORCE_COLOR = '1';

  // Claude Code on Windows requires git-bash - ensure the env var is set
  if (process.platform === 'win32' && !env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (fs.existsSync(gitBashPath)) {
      env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
    }
  }

  if (nodeMemory) {
    env.NODE_OPTIONS = `--max-old-space-size=${nodeMemory}`;
  }

  return env;
}

// Build the shell + args for spawning Claude
// Uses Node.js + local cli.js to avoid Bun crashes (global claude.exe uses Bun which panics)
function buildClaudeCommand(extraFlags, initialPrompt) {
  if (HAS_LOCAL_CLI) {
    // Run via Node.js directly with absolute path to cli.js
    const args = [LOCAL_CLI];
    if (extraFlags) args.push(...extraFlags);
    if (initialPrompt) args.push(initialPrompt);
    return { shell: NODE_EXE, args };
  }

  // Fallback: use cmd.exe /c claude (Bun-based, may crash)
  console.warn('[WARN] Local CLI not found, falling back to global claude (Bun - may crash)');
  let cmd = 'claude';
  if (extraFlags) cmd += ' ' + extraFlags.join(' ');
  if (initialPrompt) cmd += ` "${initialPrompt.replace(/"/g, '\\"')}"`;

  if (process.platform === 'win32') {
    return { shell: 'cmd.exe', args: ['/c', cmd] };
  }
  return { shell: '/bin/bash', args: ['-c', cmd] };
}

// Spawn a PTY process and wire up output/exit handlers
// sessionUpdater: optional function(id, updates) for storage updates on exit (default: storage.updateSession)
function spawnSession(sessionId, shellAndArgs, cwd, env, sessionUpdater) {
  const { shell, args } = shellAndArgs;

  console.log(`[SESSION] Launching: shell=${shell}, args=${JSON.stringify(args)}, cwd=${cwd}`);

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  const outputFile = path.join(OUTPUTS_DIR, `${sessionId}.raw`);

  const handle = {
    pty: ptyProcess,
    output: '',
    listeners: new Set(),
    startedAt: new Date().toISOString(),
    pid: ptyProcess.pid,
    exited: false,
    exitCode: null,
    streamJson: false,
  };

  // TUI mode: stream analyzer for mobile Chat View (emits structured action messages)
  const analyzer = new StreamAnalyzer(sessionId, (action) => {
    const msg = JSON.stringify({ type: 'action', sessionId, action });
    for (const send of handle.listeners) {
      try { send(msg); } catch {}
    }
  });
  handle.analyzer = analyzer;

  ptyProcess.onData((data) => {
    handle.output += data;
    if (handle.output.length > 500000) {
      handle.output = handle.output.slice(-400000);
    }
    try { fs.appendFileSync(outputFile, data); } catch {}
    for (const send of handle.listeners) {
      try { send(JSON.stringify({ type: 'output', sessionId, data })); } catch {}
    }
    analyzer.feed(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (handle.analyzer) handle.analyzer.destroy();

    // Already handled by stopSession() - skip duplicate processing
    if (handle.exited) return;

    handle.exited = true;
    handle.exitCode = exitCode;

    for (const send of handle.listeners) {
      try {
        send(JSON.stringify({ type: 'action', sessionId, action: { kind: 'session_ended', exitCode, timestamp: Date.now() } }));
      } catch {}
    }

    for (const send of handle.listeners) {
      try { send(JSON.stringify({ type: 'exit', sessionId, exitCode })); } catch {}
    }

    _broadcast({ type: 'exit', sessionId, exitCode });

    const endedAt = new Date().toISOString();
    const startMs = new Date(handle.startedAt).getTime();
    const duration = Math.round((Date.now() - startMs) / 1000);

    const updateFn = sessionUpdater || storage.updateSession;
    updateFn(sessionId, {
      status: exitCode === 0 ? 'completed' : 'crashed',
      endedAt,
      durationSeconds: duration,
      exitCode,
    });

    // Git watcher / GitHub sync only for Claude Code sessions (not Cline)
    if (!sessionUpdater) {
      gitWatcher.stopWatching(sessionId).then(result => {
        if (result) {
          console.log(`[WATCHER] Session ${sessionId}: ${result.commitCount} commits`);
          if (result.prUrl) {
            _broadcast({ type: 'watcher-pr', sessionId, prUrl: result.prUrl });
            storage.updateSession(sessionId, { prUrl: result.prUrl });
          }
        }
      }).catch(err => {
        console.error(`[WATCHER] Stop failed for ${sessionId}:`, err.message);
      });

      githubSync.syncSession(sessionId).catch(err => {
        console.error(`[GITHUB] Sync failed for ${sessionId}:`, err.message);
      });
    }

    setTimeout(() => handles.delete(sessionId), 5000);
  });

  handles.set(sessionId, handle);
  startPolling();
  return handle;
}

// ─── Stream-JSON Mode ───
// Persistent interactive session using --output-format stream-json --input-format stream-json
// Uses child_process.spawn (no PTY needed for JSON I/O).
// Process stays alive for the entire session. Input via stdin JSON, output via stdout NDJSON.

function spawnStreamJsonSession(sessionId, cwd, env, extraFlags, initialPrompt) {
  if (!HAS_LOCAL_CLI) throw new Error('Local CLI not found for stream-json mode');

  const args = [LOCAL_CLI, '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
  if (extraFlags) {
    for (const flag of extraFlags) {
      if (flag === '--dangerously-skip-permissions') continue; // already added
      args.push(flag);
    }
  }

  console.log(`[STREAM-JSON] Launching: ${NODE_EXE} ${args.join(' ')}, cwd=${cwd}`);

  const child = spawnProcess(NODE_EXE, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const outputFile = path.join(OUTPUTS_DIR, `${sessionId}.raw`);

  const handle = {
    pty: null,
    childProcess: child,
    output: '',
    listeners: new Set(),
    startedAt: new Date().toISOString(),
    pid: child.pid,
    exited: false,
    exitCode: null,
    streamJson: true,
    outputFile,
  };

  let ndjsonBuffer = '';

  child.stdout.on('data', (data) => {
    const text = data.toString();
    handle.output += text;
    if (handle.output.length > 500000) {
      handle.output = handle.output.slice(-400000);
    }
    try { fs.appendFileSync(outputFile, text); } catch {}

    // Send raw output for terminal toggle fallback
    for (const send of handle.listeners) {
      try { send(JSON.stringify({ type: 'output', sessionId, data: text })); } catch {}
    }

    // Parse NDJSON lines
    ndjsonBuffer += text;
    const lines = ndjsonBuffer.split('\n');
    ndjsonBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        const msg = JSON.stringify({ type: 'stream-json', sessionId, event });
        for (const send of handle.listeners) {
          try { send(msg); } catch {}
        }
      } catch {} // skip non-JSON lines
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    console.log(`[STREAM-JSON] stderr ${sessionId}: ${text.substring(0, 300)}`);
  });

  child.on('close', (code) => {
    // Already handled by stopSession() - skip duplicate processing
    if (handle.exited) return;

    handle.exited = true;
    handle.exitCode = code;

    for (const send of handle.listeners) {
      try { send(JSON.stringify({ type: 'exit', sessionId, exitCode: code })); } catch {}
    }

    _broadcast({ type: 'exit', sessionId, exitCode: code });

    const endedAt = new Date().toISOString();
    const startMs = new Date(handle.startedAt).getTime();
    const duration = Math.round((Date.now() - startMs) / 1000);

    storage.updateSession(sessionId, {
      status: code === 0 ? 'completed' : 'crashed',
      endedAt,
      durationSeconds: duration,
      exitCode: code,
    });

    githubSync.syncSession(sessionId).catch(err => {
      console.error(`[GITHUB] Sync failed for ${sessionId}:`, err.message);
    });

    setTimeout(() => handles.delete(sessionId), 5000);
    console.log(`[STREAM-JSON] Session ${sessionId} exited (code=${code})`);
  });

  // Send initial prompt if provided
  if (initialPrompt) {
    const promptJson = JSON.stringify({ type: 'user', message: { role: 'user', content: initialPrompt } }) + '\n';
    child.stdin.write(promptJson);
  }

  handles.set(sessionId, handle);
  startPolling();
  return handle;
}

async function launchSession(profileId, { streamJson, prompt } = {}) {
  const profile = storage.getProfile(profileId);
  if (!profile) throw new Error('Profile not found');

  const sessionId = uuid();
  let cwd = profile.workingDirectory || process.cwd();
  ensureWorkspaceTrusted(cwd);
  const env = buildClaudeEnv(profile.nodeMemory);

  // If profile has a linked GitHub repo, clone/pull and use as cwd
  let watcherBranch = null;
  if (profile.githubRepo) {
    const [owner, repo] = profile.githubRepo.split('/');
    const ghConfig = githubSync.getConfig();

    if (ghConfig && ghConfig.installationId) {
      try {
        const result = await githubSync.cloneRepo(ghConfig.installationId, owner, repo);
        cwd = result.path;

        // For branch strategy, create a new branch
        if (profile.syncStrategy === 'branch') {
          watcherBranch = `claude/${sessionId.slice(0, 8)}`;
          await githubSync.createBranch(cwd, watcherBranch);
        } else {
          // For main strategy, use current branch
          watcherBranch = await githubSync.getDefaultBranch(cwd);
        }

        console.log(`[SESSION] Repo ready: ${owner}/${repo} (branch: ${watcherBranch})`);
      } catch (err) {
        console.error(`[SESSION] Repo setup failed: ${err.message}`);
        // Continue with original cwd if repo setup fails
        cwd = profile.workingDirectory || process.cwd();
      }
    }
  }

  const flags = [];
  if (profile.mode === 'bypass') flags.push('--dangerously-skip-permissions');

  const initialPrompt = prompt || profile.initialPrompt || null;

  let handle;
  if (streamJson) {
    handle = spawnStreamJsonSession(sessionId, cwd, env, flags, initialPrompt);
  } else {
    const shellAndArgs = buildClaudeCommand(flags, initialPrompt);
    handle = spawnSession(sessionId, shellAndArgs, cwd, env);
  }

  const session = {
    id: sessionId,
    profileId,
    profileName: profile.name,
    mode: profile.mode || 'normal',
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
    githubRepo: profile.githubRepo || null,
    syncStrategy: profile.syncStrategy || null,
    watcherBranch: watcherBranch,
    streamJson: !!streamJson,
  };
  storage.addSession(session);

  // Start git watcher if repo is linked
  if (profile.githubRepo && watcherBranch) {
    const [owner, repo] = profile.githubRepo.split('/');
    const ghConfig = githubSync.getConfig();

    gitWatcher.startWatching(sessionId, cwd, watcherBranch, {
      installationId: ghConfig.installationId,
      owner,
      repo,
      syncStrategy: profile.syncStrategy || 'branch',
    }, (event) => {
      // Broadcast watcher events to all WebSocket clients
      _broadcast({ ...event, sessionId });
    });
  }

  return session;
}

function launchAgent({ agentName, workingDirectory, mode, nodeMemory, streamJson, prompt }) {
  const sessionId = uuid();
  let cwd = workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    cwd = process.cwd();
  }
  ensureWorkspaceTrusted(cwd);
  const env = buildClaudeEnv(nodeMemory);

  const flags = ['--agent', agentName];
  if (mode === 'bypass') flags.push('--dangerously-skip-permissions');

  let handle;
  if (streamJson) {
    handle = spawnStreamJsonSession(sessionId, cwd, env, flags, prompt || null);
  } else {
    const shellAndArgs = buildClaudeCommand(flags, prompt || null);
    handle = spawnSession(sessionId, shellAndArgs, cwd, env);
  }

  const session = {
    id: sessionId,
    profileId: null,
    profileName: `Agent: ${agentName}`,
    mode: mode || 'normal',
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
    githubRepo: null,
    syncStrategy: null,
    watcherBranch: null,
  };
  storage.addSession(session);

  return session;
}

function launchDirect({ prompt, workingDirectory, mode, nodeMemory, name, streamJson }) {
  const sessionId = uuid();
  let cwd = workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    cwd = process.cwd();
  }
  ensureWorkspaceTrusted(cwd);
  const env = buildClaudeEnv(nodeMemory);

  const flags = [];
  if (mode === 'bypass') flags.push('--dangerously-skip-permissions');

  let handle;
  if (streamJson) {
    handle = spawnStreamJsonSession(sessionId, cwd, env, flags, prompt || null);
  } else {
    const shellAndArgs = buildClaudeCommand(flags, prompt || null);
    handle = spawnSession(sessionId, shellAndArgs, cwd, env);
  }

  const session = {
    id: sessionId,
    profileId: null,
    profileName: name || 'APM Direct',
    mode: mode || 'normal',
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
    githubRepo: null,
    syncStrategy: null,
    watcherBranch: null,
  };
  storage.addSession(session);

  return session;
}

function resumeSession(sessionId, { streamJson } = {}) {
  const oldSession = storage.getSession(sessionId);
  if (!oldSession) throw new Error('Session not found');

  const profile = storage.getProfile(oldSession.profileId);
  const mode = oldSession.mode || (profile ? profile.mode : 'normal');
  const cwd = oldSession.workingDirectory || (profile ? profile.workingDirectory : process.cwd());
  const nodeMemory = profile ? profile.nodeMemory : null;

  const newSessionId = uuid();
  const env = buildClaudeEnv(nodeMemory);

  const flags = ['--continue'];
  if (mode === 'bypass') flags.push('--dangerously-skip-permissions');

  const displayName = `${oldSession.profileName} (resumed)`;
  let handle;
  if (streamJson) {
    handle = spawnStreamJsonSession(newSessionId, cwd, env, flags);
  } else {
    const shellAndArgs = buildClaudeCommand(flags, null);
    handle = spawnSession(newSessionId, shellAndArgs, cwd, env);
  }

  const session = {
    id: newSessionId,
    profileId: oldSession.profileId,
    profileName: displayName,
    mode,
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
    resumedFrom: sessionId,
  };
  storage.addSession(session);

  return session;
}

function stopSession(sessionId) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited) return false;

  if (handle.streamJson) {
    // Stream-JSON mode: kill child process
    try {
      handle.childProcess.kill();
    } catch {
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /T /PID ${handle.pid}`, { stdio: 'ignore' });
      } catch {}
    }
  } else {
    // PTY mode
    try {
      handle.pty.kill();
    } catch {
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /T /PID ${handle.pid}`, { stdio: 'ignore' });
      } catch {}
    }
  }

  handle.exited = true;

  storage.updateSession(sessionId, {
    status: 'stopped',
    endedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - new Date(handle.startedAt).getTime()) / 1000),
  });

  // Notify attached clients
  _broadcast({ type: 'exit', sessionId, code: null, reason: 'stopped' });

  // Stop git watcher
  gitWatcher.stopWatching(sessionId).then(result => {
    if (result && result.prUrl) {
      _broadcast({ type: 'watcher-pr', sessionId, prUrl: result.prUrl });
      storage.updateSession(sessionId, { prUrl: result.prUrl });
    }
  }).catch(() => {});

  // GitHub output sync (fire-and-forget)
  githubSync.syncSession(sessionId).catch(err => {
    console.error(`[GITHUB] Sync failed for ${sessionId}:`, err.message);
  });

  return true;
}

function sendInput(sessionId, data) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited) {
    console.log(`[INPUT] REJECTED - session ${sessionId} not found or exited`);
    return false;
  }
  console.log(`[INPUT] Writing to PTY session ${sessionId}: ${JSON.stringify(data).substring(0, 100)}`);
  handle.pty.write(data);
  return true;
}

function resizePty(sessionId, cols, rows) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited) return false;
  try { handle.pty.resize(cols, rows); } catch {}
  return true;
}

function sendStreamJsonInput(sessionId, message) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited || !handle.streamJson) return false;
  // Claude Code stream-json expects: {"type":"user","message":{"role":"user","content":"..."}}
  const json = JSON.stringify({ type: 'user', message: { role: 'user', content: message } }) + '\n';
  handle.childProcess.stdin.write(json);

  // Store a synthetic user_input event in the output buffer so it replays on re-attach
  const userEvent = JSON.stringify({ type: 'user_input', text: message }) + '\n';
  handle.output += userEvent;
  if (handle.output.length > 500000) {
    handle.output = handle.output.slice(-400000);
  }
  // Broadcast to listeners so all attached clients see it
  for (const fn of handle.listeners) {
    fn({ type: 'stream-json', sessionId, event: { type: 'user_input', text: message } });
  }

  return true;
}

function isStreamJson(sessionId) {
  const handle = handles.get(sessionId);
  return handle ? !!handle.streamJson : false;
}

function getActiveSessions() {
  const active = [];
  for (const [id, handle] of handles) {
    if (handle.exited) continue;
    const startMs = new Date(handle.startedAt).getTime();
    active.push({
      id,
      pid: handle.pid,
      startedAt: handle.startedAt,
      elapsedSeconds: Math.round((Date.now() - startMs) / 1000),
    });
  }
  return active;
}

function getSessionOutput(sessionId) {
  const handle = handles.get(sessionId);
  if (handle) return handle.output;

  // Fallback: read from persisted file (for ended sessions)
  const outputFile = path.join(OUTPUTS_DIR, `${sessionId}.raw`);
  try { return fs.readFileSync(outputFile, 'utf8'); } catch { return ''; }
}

function addListener(sessionId, sendFn) {
  const handle = handles.get(sessionId);
  if (!handle) return false;
  handle.listeners.add(sendFn);
  return true;
}

function removeListener(sessionId, sendFn) {
  const handle = handles.get(sessionId);
  if (handle) handle.listeners.delete(sendFn);
}

function stopAll() {
  let count = 0;
  for (const [id, handle] of handles) {
    if (handle.exited) continue;
    if (handle.type === 'cline') {
      if (stopClineSession(id)) count++;
    } else {
      if (stopSession(id)) count++;
    }
  }
  return count;
}

// Cleanup orphaned sessions on startup
function cleanupOrphaned() {
  const sessions = storage.getSessions();
  let cleaned = 0;
  for (const s of sessions) {
    if (s.status === 'running' && !handles.has(s.id)) {
      storage.updateSession(s.id, {
        status: 'stopped',
        endedAt: new Date().toISOString(),
      });
      cleaned++;
    }
  }
  return cleaned;
}

// ─── Cline CLI Sessions ───

function launchClineSession({ prompt, workingDirectory } = {}) {
  const sessionId = uuid();
  let cwd = workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    // Fallback to a known-good directory
    const fallbacks = process.platform === 'win32'
      ? ['C:\\Users\\Administrator', 'C:\\']
      : [os.homedir(), '/tmp'];
    cwd = fallbacks.find(d => fs.existsSync(d)) || process.cwd();
  }
  const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' };

  let shell, args;
  if (process.platform === 'win32') {
    shell = 'cmd.exe';
    args = prompt ? ['/c', 'cline', prompt] : ['/c', 'cline'];
  } else {
    shell = 'cline';
    args = prompt ? [prompt] : [];
  }

  console.log(`[CLINE] Launching session: cwd=${cwd}, prompt=${prompt ? prompt.slice(0, 60) : '(interactive)'}`);

  const handle = spawnSession(sessionId, { shell, args }, cwd, env, storage.updateClineSession.bind(storage));
  handle.type = 'cline';

  const session = {
    id: sessionId,
    prompt: prompt || null,
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
  };

  storage.addClineSession(session);
  return session;
}

function stopClineSession(sessionId) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited) return false;

  try {
    handle.pty.kill();
  } catch {
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /F /T /PID ${handle.pid}`, { stdio: 'ignore' });
    } catch {}
  }

  storage.updateClineSession(sessionId, {
    status: 'stopped',
    endedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - new Date(handle.startedAt).getTime()) / 1000),
  });

  return true;
}

function getActiveClineSessions() {
  const clineSessions = storage.getClineSessions().filter(s => s.status === 'running');
  const active = [];
  for (const s of clineSessions) {
    const handle = handles.get(s.id);
    if (handle && !handle.exited) {
      const startMs = new Date(handle.startedAt).getTime();
      active.push({
        ...s,
        elapsedSeconds: Math.round((Date.now() - startMs) / 1000),
      });
    }
  }
  return active;
}

function cleanupOrphanedCline() {
  const sessions = storage.getClineSessions();
  let cleaned = 0;
  for (const s of sessions) {
    if (s.status === 'running' && !handles.has(s.id)) {
      storage.updateClineSession(s.id, {
        status: 'stopped',
        endedAt: new Date().toISOString(),
      });
      cleaned++;
    }
  }
  return cleaned;
}

// ─── Gemini CLI Sessions ───

function launchGeminiSession({ prompt, workingDirectory } = {}) {
  const sessionId = uuid();
  let cwd = workingDirectory || process.cwd();
  if (!fs.existsSync(cwd)) {
    const fallbacks = process.platform === 'win32'
      ? ['C:\\Users\\Administrator', 'C:\\']
      : [os.homedir(), '/tmp'];
    cwd = fallbacks.find(d => fs.existsSync(d)) || process.cwd();
  }
  const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' };

  let shell, args;
  if (process.platform === 'win32') {
    shell = 'cmd.exe';
    args = prompt ? ['/c', 'gemini', '-p', prompt] : ['/c', 'gemini'];
  } else {
    shell = 'gemini';
    args = prompt ? ['-p', prompt] : [];
  }

  console.log(`[GEMINI] Launching session: cwd=${cwd}, prompt=${prompt ? prompt.slice(0, 60) : '(interactive)'}`);

  const handle = spawnSession(sessionId, { shell, args }, cwd, env, storage.updateGeminiSession.bind(storage));
  handle.type = 'gemini';

  const session = {
    id: sessionId,
    prompt: prompt || null,
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
  };

  storage.addGeminiSession(session);
  return session;
}

function stopGeminiSession(sessionId) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited) return false;

  try {
    handle.pty.kill();
  } catch {
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /F /T /PID ${handle.pid}`, { stdio: 'ignore' });
    } catch {}
  }

  storage.updateGeminiSession(sessionId, {
    status: 'stopped',
    endedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - new Date(handle.startedAt).getTime()) / 1000),
  });

  return true;
}

function getActiveGeminiSessions() {
  const geminiSessions = storage.getGeminiSessions().filter(s => s.status === 'running');
  const active = [];
  for (const s of geminiSessions) {
    const handle = handles.get(s.id);
    if (handle && !handle.exited) {
      const startMs = new Date(handle.startedAt).getTime();
      active.push({
        ...s,
        elapsedSeconds: Math.round((Date.now() - startMs) / 1000),
      });
    }
  }
  return active;
}

function cleanupOrphanedGemini() {
  const sessions = storage.getGeminiSessions();
  let cleaned = 0;
  for (const s of sessions) {
    if (s.status === 'running' && !handles.has(s.id)) {
      storage.updateGeminiSession(s.id, {
        status: 'stopped',
        endedAt: new Date().toISOString(),
      });
      cleaned++;
    }
  }
  return cleaned;
}

// Spawn an interactive command in a PTY (for gh auth login, cline auth, etc.)
function spawnInteractive(command, args = [], cwd) {
  const sessionId = uuid();
  const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' };
  // On Windows, node-pty can't spawn .cmd/.bat files directly - use cmd.exe /c
  let shellAndArgs;
  if (process.platform === 'win32') {
    shellAndArgs = { shell: 'cmd.exe', args: ['/c', command, ...args] };
  } else {
    shellAndArgs = { shell: command, args };
  }
  const handle = spawnSession(sessionId, shellAndArgs, cwd || process.cwd(), env);
  return { id: sessionId, pid: handle.pid };
}

// ─── Planning Session ───
// Launches a streamJson session with process discovery system prompt

function launchPlanningSession(initialMessage) {
  const sessionId = uuid();
  const cwd = process.cwd();
  ensureWorkspaceTrusted(cwd);
  const env = buildClaudeEnv();

  const systemPrompt = `Voce e um agente de process discovery. Conduza uma conversa para mapear processos empresariais.

REGRA OBRIGATORIA: Em TODAS as suas respostas (sem excecao), voce DEVE incluir um bloco JSON entre [PROCESSES] e [/PROCESSES] com os processos descobertos ate o momento. Isso e necessario para o sistema renderizar o mapa visual em tempo real.

Na primeira resposta (antes de saber algo), inclua o bloco vazio: [PROCESSES]{"nodes":[],"edges":[]}[/PROCESSES]

A partir da segunda resposta, inclua TODOS os processos ja identificados.

FORMATO DO BLOCO (obrigatorio em toda resposta):
[PROCESSES]
{"nodes":[{"nome":"Nome","frequencia":"diario|semanal|mensal|sob_demanda","responsavel":"Cargo","sistemas":["Tool"],"esforco":"alto|medio|baixo","impacto":"alto|medio|baixo","friccao":"Ponto de dor"}],"edges":[{"source":0,"target":1,"label":"relacao"}]}
[/PROCESSES]

- indices em edges sao 0-based referentes ao array nodes
- Sempre inclua TODOS os processos acumulados, nao apenas os novos
- Estime valores quando o usuario nao especificar

COMO CONDUZIR:
1. Pergunte sobre a empresa, areas e departamentos
2. Aprofunde cada area: processos, ferramentas, responsaveis, frequencia, dores
3. Identifique dependencias entre processos
4. Mantenha respostas curtas e objetivas (max 3-4 perguntas por vez)

Comece perguntando sobre a empresa.`;

  const fullPrompt = systemPrompt + (initialMessage ? '\n\nMensagem inicial do usuario: ' + initialMessage : '');

  const handle = spawnStreamJsonSession(sessionId, cwd, env, [], fullPrompt);

  const session = {
    id: sessionId,
    profileId: null,
    profileName: 'Planning Agent',
    mode: 'bypass',
    workingDirectory: cwd,
    startedAt: handle.startedAt,
    endedAt: null,
    durationSeconds: null,
    exitCode: null,
    status: 'running',
    pid: handle.pid,
    githubRepo: null,
    syncStrategy: null,
    watcherBranch: null,
    streamJson: true,
    planning: true,
  };
  storage.addSession(session);
  return session;
}

function setBroadcast(fn) {
  _broadcast = fn;
}

module.exports = {
  launchSession, launchDirect, launchAgent, launchPlanningSession, resumeSession, stopSession, sendInput, resizePty,
  sendStreamJsonInput, isStreamJson,
  getActiveSessions, getSessionOutput,
  addListener, removeListener, stopAll, cleanupOrphaned,
  setBroadcast, spawnInteractive,
  launchClineSession, stopClineSession, getActiveClineSessions, cleanupOrphanedCline,
  launchGeminiSession, stopGeminiSession, getActiveGeminiSessions, cleanupOrphanedGemini,
};
