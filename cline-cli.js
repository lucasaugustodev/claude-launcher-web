const { execFile, spawn } = require('child_process');

// ─── Cache (avoids slow re-checks on every tab visit) ───

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

// ─── Check if Cline CLI is installed ───

function checkInstalled() {
  return new Promise((resolve) => {
    execFile('cline', ['--version'], { timeout: 3000, shell: true }, (err, stdout) => {
      if (err) return resolve({ installed: false, version: null });
      const output = (stdout || '').trim();
      const match = output.match(/([\d.]+)/);
      resolve({ installed: true, version: match ? match[1] : output });
    });
  });
}

// ─── Check if Cline is configured (has a provider) ───

function checkAuth() {
  return new Promise((resolve) => {
    execFile('cline', ['config'], { timeout: 3000, shell: true }, (err, stdout, stderr) => {
      const output = ((stdout || '') + (stderr || '')).trim();
      if (err && !output) {
        return resolve({ configured: false, provider: null });
      }
      if (output.includes('provider') || output.includes('model') || output.includes('apiKey') || output.includes('api_key')) {
        const providerMatch = output.match(/provider[:\s]+["']?(\w+)/i);
        resolve({ configured: true, provider: providerMatch ? providerMatch[1] : 'configured' });
      } else if (output.length > 10) {
        resolve({ configured: true, provider: 'configured' });
      } else {
        resolve({ configured: false, provider: null });
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
    _cache = { installed: false, version: null, configured: false, provider: null };
    _cacheTime = Date.now();
    return _cache;
  }
  const auth = await checkAuth();
  _cache = { ...installed, ...auth };
  _cacheTime = Date.now();
  return _cache;
}

// ─── Install Cline CLI via npm ───

function install(onProgress) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npm.cmd' : 'npm';
    const args = ['install', '-g', 'cline'];

    if (onProgress) onProgress('>>> npm install -g cline\n');

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

module.exports = { checkInstalled, checkAuth, getStatus, install, invalidateCache };
