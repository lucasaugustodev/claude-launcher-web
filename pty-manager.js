const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuid } = require('uuid');
const storage = require('./storage');
const githubSync = require('./github-sync');
const gitWatcher = require('./git-watcher');

// Broadcast function set by server.js
let _broadcast = () => {};

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
  };

  // Capture output, save to file, and broadcast to listeners
  ptyProcess.onData((data) => {
    handle.output += data;
    if (handle.output.length > 500000) {
      handle.output = handle.output.slice(-400000);
    }
    // Persist output to disk
    try { fs.appendFileSync(outputFile, data); } catch {}
    for (const send of handle.listeners) {
      try { send(JSON.stringify({ type: 'output', sessionId, data })); } catch {}
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    handle.exited = true;
    handle.exitCode = exitCode;

    for (const send of handle.listeners) {
      try { send(JSON.stringify({ type: 'exit', sessionId, exitCode })); } catch {}
    }

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

async function launchSession(profileId) {
  const profile = storage.getProfile(profileId);
  if (!profile) throw new Error('Profile not found');

  const sessionId = uuid();
  let cwd = profile.workingDirectory || process.cwd();
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

  const shellAndArgs = buildClaudeCommand(flags, profile.initialPrompt || null);
  const handle = spawnSession(sessionId, shellAndArgs, cwd, env);

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

function resumeSession(sessionId) {
  const oldSession = storage.getSession(sessionId);
  if (!oldSession) throw new Error('Session not found');

  const profile = storage.getProfile(oldSession.profileId);
  const mode = oldSession.mode || (profile ? profile.mode : 'normal');
  const cwd = oldSession.workingDirectory || (profile ? profile.workingDirectory : process.cwd());
  const nodeMemory = profile ? profile.nodeMemory : null;

  const newSessionId = uuid();
  const env = buildClaudeEnv(nodeMemory);

  // Use --continue to resume the most recent conversation in this CWD
  // This avoids workspace trust dialogs and correctly restores Claude's context
  const flags = ['--continue'];
  if (mode === 'bypass') flags.push('--dangerously-skip-permissions');

  const shellAndArgs = buildClaudeCommand(flags, null);
  const displayName = `${oldSession.profileName} (resumed)`;
  const handle = spawnSession(newSessionId, shellAndArgs, cwd, env);

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

  try {
    handle.pty.kill();
  } catch {
    // Force kill on Windows
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /F /T /PID ${handle.pid}`, { stdio: 'ignore' });
    } catch {}
  }

  storage.updateSession(sessionId, {
    status: 'stopped',
    endedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - new Date(handle.startedAt).getTime()) / 1000),
  });

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
  if (!handle || handle.exited) return false;
  handle.pty.write(data);
  return true;
}

function resizePty(sessionId, cols, rows) {
  const handle = handles.get(sessionId);
  if (!handle || handle.exited) return false;
  try { handle.pty.resize(cols, rows); } catch {}
  return true;
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

// Spawn an interactive command in a PTY (for gh auth login, cline auth, etc.)
function spawnInteractive(command, args = [], cwd) {
  const sessionId = uuid();
  const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' };
  const shellAndArgs = { shell: command, args };
  const handle = spawnSession(sessionId, shellAndArgs, cwd || process.cwd(), env);
  return { id: sessionId, pid: handle.pid };
}

function setBroadcast(fn) {
  _broadcast = fn;
}

module.exports = {
  launchSession, resumeSession, stopSession, sendInput, resizePty,
  getActiveSessions, getSessionOutput,
  addListener, removeListener, stopAll, cleanupOrphaned,
  setBroadcast, spawnInteractive,
  launchClineSession, stopClineSession, getActiveClineSessions, cleanupOrphanedCline,
};
