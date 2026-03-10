const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Cache (avoids slow re-checks on every tab visit) ───

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

// ─── Check if GWS CLI is installed ───

function checkInstalled() {
  return new Promise((resolve) => {
    execFile('gws', ['--version'], { timeout: 15000, shell: true }, (err, stdout) => {
      if (err) return resolve({ installed: false, version: null });
      const output = (stdout || '').trim();
      const match = output.match(/([\d.]+)/);
      resolve({ installed: true, version: match ? match[1] : output });
    });
  });
}

// ─── Check if GWS is authenticated ───

function checkAuth() {
  // Check env vars
  if (process.env.GOOGLE_WORKSPACE_CLI_TOKEN) {
    return { authenticated: true, user: 'Access Token' };
  }
  if (process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
    const credPath = process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE;
    try {
      if (fs.existsSync(credPath)) {
        return { authenticated: true, user: 'Credentials File' };
      }
    } catch {}
  }

  // Check config directory for stored credentials
  const configDir = process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR ||
    path.join(os.homedir(), '.config', 'gws');
  const credPaths = [
    path.join(configDir, 'credentials.json'),
    path.join(configDir, 'client_secret.json'),
  ];
  for (const p of credPaths) {
    try {
      if (fs.existsSync(p)) {
        return { authenticated: true, user: 'Google OAuth' };
      }
    } catch {}
  }

  return null; // unknown, will be resolved async
}

function checkAuthAsync() {
  return new Promise((resolve) => {
    const sync = checkAuth();
    if (sync) return resolve(sync);
    // Parse gws auth status JSON output
    execFile('gws', ['auth', 'status'], { timeout: 10000, shell: true }, (err, stdout, stderr) => {
      if (err) return resolve({ authenticated: false, user: null });
      const output = ((stdout || '') + (stderr || '')).trim();
      try {
        const status = JSON.parse(output);
        if (status.auth_method && status.auth_method !== 'none' && status.storage !== 'none') {
          resolve({ authenticated: true, user: status.auth_method });
        } else {
          resolve({ authenticated: false, user: null });
        }
      } catch {
        // Fallback: check for obvious unauthenticated indicators
        if (output.includes('"auth_method": "none"') || output.includes('"storage": "none"')) {
          resolve({ authenticated: false, user: null });
        } else if (output.includes('not authenticated') || output.includes('no credentials')) {
          resolve({ authenticated: false, user: null });
        } else {
          resolve({ authenticated: false, user: null });
        }
      }
    });
  });
}

// ─── Combined status (cached) ───

async function getStatus() {
  if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) {
    return _cache;
  }

  const installed = await checkInstalled();
  if (!installed.installed) {
    _cache = { installed: false, version: null, authenticated: false, user: null };
    _cacheTime = Date.now();
    return _cache;
  }
  const auth = await checkAuthAsync();
  _cache = { ...installed, ...auth };
  _cacheTime = Date.now();
  return _cache;
}

// ─── Install GWS CLI via npm ───

function install(onProgress) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const isRoot = !isWin && process.getuid && process.getuid() === 0;
    const needsSudo = !isWin && !isRoot;
    const cmd = needsSudo ? 'sudo' : (isWin ? 'npm.cmd' : 'npm');
    const args = needsSudo
      ? ['npm', 'install', '-g', '@googleworkspace/cli']
      : ['install', '-g', '@googleworkspace/cli'];

    if (onProgress) onProgress(needsSudo ? '>>> sudo npm install -g @googleworkspace/cli\n' : '>>> npm install -g @googleworkspace/cli\n');

    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    });

    let output = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (onProgress) onProgress(text);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (onProgress) onProgress(text);
    });

    proc.on('close', (code) => {
      invalidateCache();
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        reject(new Error(`Installation failed (exit code ${code})`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to execute npm: ${err.message}`));
    });
  });
}

module.exports = { getStatus, install, invalidateCache };
