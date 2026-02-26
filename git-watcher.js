// ─── Git Watcher Module ───
// Watches a repo directory for file changes and uses Cline CLI (headless)
// to auto-commit with intelligent messages and push to GitHub.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const githubSync = require('./github-sync');

// Active watchers: sessionId -> { watcher, repoPath, branch, ... }
const watchers = new Map();

// ─── Ignore Patterns ───

const IGNORE_PATTERNS = [
  '.git', 'node_modules', '.claude', '__pycache__',
  '.next', '.nuxt', 'dist', 'build', '.cache',
];

const IGNORE_EXTENSIONS = [
  '.swp', '.tmp', '.bak', '.log', '.lock',
];

function shouldIgnore(filePath) {
  const parts = filePath.split(/[\\/]/);
  for (const p of parts) {
    if (IGNORE_PATTERNS.includes(p)) return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (IGNORE_EXTENSIONS.includes(ext)) return true;
  if (filePath.endsWith('~')) return true;
  return false;
}

// ─── Check for Git Changes ───

function hasChanges(repoPath) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: repoPath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function getChangedFiles(repoPath) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: repoPath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return status.split('\n').filter(Boolean).map(line => line.slice(3));
  } catch {
    return [];
  }
}

// ─── Cline CLI Commit ───

function runClineCommit(repoPath, branch, onEvent) {
  return new Promise((resolve) => {
    const prompt = [
      'Look at the current git diff and git status.',
      'Stage all meaningful changes with git add.',
      'Create a single commit following conventional commits format (e.g., feat:, fix:, refactor:, docs:, chore:).',
      'Write a clear, concise commit message in English describing what changed.',
      `Then push to origin ${branch}.`,
      'Do NOT create new files or modify any code. Only git operations.',
    ].join(' ');

    const args = ['-y', '--json', '-c', repoPath, prompt];
    let output = '';
    let commitHash = '';
    let commitMessage = '';

    onEvent({ type: 'cline-start' });

    const proc = spawn('cline', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      timeout: 120000,
    });

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;

      // Parse JSON lines from Cline output
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          // Detect commit completion from Cline's tool use output
          if (msg.type === 'say' && msg.say === 'completion_result') {
            commitMessage = msg.text || '';
          }
        } catch {}
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[WATCHER] Cline stderr: ${data}`);
    });

    proc.on('close', (code) => {
      // Try to extract commit hash from git log
      try {
        commitHash = execSync('git rev-parse --short HEAD', {
          cwd: repoPath,
          stdio: 'pipe',
          encoding: 'utf8',
        }).trim();
      } catch {}

      const success = code === 0;
      onEvent({
        type: 'cline-done',
        success,
        commitHash,
        commitMessage: commitMessage || '(unknown)',
      });

      resolve({ success, commitHash, commitMessage });
    });

    proc.on('error', (err) => {
      console.error(`[WATCHER] Cline spawn error: ${err.message}`);
      onEvent({ type: 'cline-done', success: false, error: err.message });
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── Create PR via Cline ───

function runClinePR(repoPath, branch, baseBranch, onEvent) {
  return new Promise((resolve) => {
    const prompt = [
      `You are in a git repo on branch "${branch}".`,
      `Create a Pull Request from "${branch}" to "${baseBranch}" using the gh CLI or git commands.`,
      'Analyze all commits on this branch compared to the base.',
      'Write a clear PR title and detailed description summarizing all changes.',
      'Use: gh pr create --title "..." --body "..." --base ' + baseBranch,
      'If gh is not available, output the PR details so I can create it manually.',
    ].join(' ');

    const args = ['-y', '--json', '-c', repoPath, prompt];
    let prUrl = '';

    onEvent({ type: 'pr-start' });

    const proc = spawn('cline', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      timeout: 180000,
    });

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      // Try to find PR URL in output
      const urlMatch = text.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/);
      if (urlMatch) prUrl = urlMatch[0];
    });

    proc.on('close', (code) => {
      onEvent({ type: 'pr-done', success: code === 0, prUrl });
      resolve({ success: code === 0, prUrl });
    });

    proc.on('error', (err) => {
      onEvent({ type: 'pr-done', success: false, error: err.message });
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── Start / Stop Watcher ───

function startWatching(sessionId, repoPath, branch, config, onEvent) {
  if (watchers.has(sessionId)) return;

  const state = {
    repoPath,
    branch,
    config, // { installationId, owner, repo, syncStrategy }
    commitCount: 0,
    lastCommit: null,
    clineRunning: false,
    pendingChanges: false,
    debounceTimer: null,
    watcher: null,
    active: true,
  };

  const DEBOUNCE_MS = 5000;

  function scheduleCommit() {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.pendingChanges = true;

    state.debounceTimer = setTimeout(async () => {
      if (!state.active) return;
      if (state.clineRunning) {
        // Re-schedule if Cline is still running
        scheduleCommit();
        return;
      }
      if (!hasChanges(repoPath)) {
        state.pendingChanges = false;
        return;
      }

      state.clineRunning = true;
      state.pendingChanges = false;

      // Refresh token before commit
      try {
        await githubSync.setRemoteToken(repoPath, config.installationId, config.owner, config.repo);
      } catch (err) {
        console.error(`[WATCHER] Token refresh failed: ${err.message}`);
      }

      const result = await runClineCommit(repoPath, branch, (evt) => {
        onEvent({ ...evt, sessionId });
      });

      state.clineRunning = false;

      if (result.success) {
        state.commitCount++;
        state.lastCommit = {
          hash: result.commitHash,
          message: result.commitMessage,
          at: new Date().toISOString(),
        };
        onEvent({
          type: 'watcher-commit',
          sessionId,
          commitCount: state.commitCount,
          hash: result.commitHash,
          message: result.commitMessage,
        });
      }

      // If more changes came in while Cline was running, schedule again
      if (state.pendingChanges && state.active) {
        scheduleCommit();
      }
    }, DEBOUNCE_MS);
  }

  // Start fs.watch
  try {
    state.watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
      if (!filename || shouldIgnore(filename)) return;
      if (!state.active) return;
      scheduleCommit();
    });

    state.watcher.on('error', (err) => {
      console.error(`[WATCHER] Watch error for ${sessionId}: ${err.message}`);
    });
  } catch (err) {
    console.error(`[WATCHER] Failed to start watching ${repoPath}: ${err.message}`);
    return;
  }

  watchers.set(sessionId, state);
  console.log(`[WATCHER] Started watching ${repoPath} for session ${sessionId} (branch: ${branch})`);
}

async function stopWatching(sessionId) {
  const state = watchers.get(sessionId);
  if (!state) return null;

  state.active = false;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  if (state.watcher) {
    try { state.watcher.close(); } catch {}
  }

  // Final commit if there are pending changes
  if (hasChanges(state.repoPath) && !state.clineRunning) {
    try {
      await githubSync.setRemoteToken(
        state.repoPath, state.config.installationId,
        state.config.owner, state.config.repo
      );
      await runClineCommit(state.repoPath, state.branch, () => {});
      state.commitCount++;
    } catch (err) {
      console.error(`[WATCHER] Final commit failed: ${err.message}`);
    }
  }

  // Create PR if strategy is 'branch'
  let prResult = null;
  if (state.config.syncStrategy === 'branch' && state.commitCount > 0) {
    try {
      const baseBranch = await githubSync.getDefaultBranch(state.repoPath);
      prResult = await runClinePR(
        state.repoPath, state.branch, baseBranch,
        () => {}
      );

      if (!prResult.prUrl) {
        // Fallback: create PR via GitHub API
        prResult = await githubSync.createPullRequest(
          state.config.installationId,
          state.config.owner,
          state.config.repo,
          state.branch,
          baseBranch,
          `Claude session ${sessionId.slice(0, 8)}`,
          `Auto-generated PR with ${state.commitCount} commit(s) from Claude session.`
        );
      }
    } catch (err) {
      console.error(`[WATCHER] PR creation failed: ${err.message}`);
    }
  }

  const result = {
    commitCount: state.commitCount,
    lastCommit: state.lastCommit,
    prUrl: prResult?.prUrl || null,
  };

  watchers.delete(sessionId);
  console.log(`[WATCHER] Stopped watching for session ${sessionId} (${state.commitCount} commits)`);
  return result;
}

function getStatus(sessionId) {
  const state = watchers.get(sessionId);
  if (!state) return { active: false, commitCount: 0, lastCommit: null, clineRunning: false };

  return {
    active: state.active,
    commitCount: state.commitCount,
    lastCommit: state.lastCommit,
    clineRunning: state.clineRunning,
    pendingChanges: state.pendingChanges,
    branch: state.branch,
  };
}

module.exports = { startWatching, stopWatching, getStatus };
