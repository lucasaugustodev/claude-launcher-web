const { execFile, spawn } = require('child_process');

// ─── Check if Cline CLI is installed ───

function checkInstalled() {
  return new Promise((resolve) => {
    execFile('cline', ['--version'], { timeout: 10000, shell: true }, (err, stdout, stderr) => {
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
    execFile('cline', ['config'], { timeout: 10000, shell: true }, (err, stdout, stderr) => {
      const output = ((stdout || '') + (stderr || '')).trim();
      if (err && !output) {
        return resolve({ configured: false, provider: null });
      }
      // cline config outputs current provider info when configured
      if (output.includes('provider') || output.includes('model') || output.includes('apiKey') || output.includes('api_key')) {
        // Try to extract provider name
        const providerMatch = output.match(/provider[:\s]+["']?(\w+)/i);
        resolve({ configured: true, provider: providerMatch ? providerMatch[1] : 'configured' });
      } else if (output.length > 10) {
        // If there's substantial output, likely configured
        resolve({ configured: true, provider: 'configured' });
      } else {
        resolve({ configured: false, provider: null });
      }
    });
  });
}

// ─── Combined status ───

async function getStatus() {
  const installed = await checkInstalled();
  if (!installed.installed) {
    return { installed: false, version: null, configured: false, provider: null };
  }
  const auth = await checkAuth();
  return { ...installed, ...auth };
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

module.exports = { checkInstalled, checkAuth, getStatus, install };
