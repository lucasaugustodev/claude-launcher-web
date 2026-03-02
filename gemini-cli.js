const { execFile, spawn } = require('child_process');

// ─── Cache (avoids slow re-checks on every tab visit) ───

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

// ─── Check if Gemini CLI is installed ───

function checkInstalled() {
  return new Promise((resolve) => {
    execFile('gemini', ['--version'], { timeout: 15000, shell: true }, (err, stdout) => {
      if (err) return resolve({ installed: false, version: null });
      const output = (stdout || '').trim();
      const match = output.match(/([\d.]+)/);
      resolve({ installed: true, version: match ? match[1] : output });
    });
  });
}

// ─── Combined status (cached) ───

async function getStatus() {
  if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) {
    return _cache;
  }

  const installed = await checkInstalled();
  _cache = { installed: installed.installed, version: installed.version };
  _cacheTime = Date.now();
  return _cache;
}

// ─── Install Gemini CLI via npm ───

function install(onProgress) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const isRoot = !isWin && process.getuid && process.getuid() === 0;
    const needsSudo = !isWin && !isRoot;
    const cmd = needsSudo ? 'sudo' : (isWin ? 'npm.cmd' : 'npm');
    const args = needsSudo
      ? ['npm', 'install', '-g', '@google/gemini-cli']
      : ['install', '-g', '@google/gemini-cli'];

    if (onProgress) onProgress(needsSudo ? '>>> sudo npm install -g @google/gemini-cli\n' : '>>> npm install -g @google/gemini-cli\n');

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
