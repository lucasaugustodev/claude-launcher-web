const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Check if gh CLI is installed ───
function checkInstalled() {
  return new Promise((resolve) => {
    execFile('gh', ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ installed: false, version: null });
      const match = stdout.match(/gh version ([\d.]+)/);
      resolve({ installed: true, version: match ? match[1] : stdout.trim() });
    });
  });
}

// ─── Check if gh CLI is authenticated ───
function checkAuth() {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'status'], { timeout: 10000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      // gh auth status outputs to stderr
      if (output.includes('Logged in to')) {
        const userMatch = output.match(/Logged in to [^\s]+ account (\S+)/i)
          || output.match(/account (\S+)/i)
          || output.match(/Logged in to [^\s]+ as (\S+)/i);
        const scopesMatch = output.match(/Token scopes:(.+)/i);
        resolve({
          authenticated: true,
          user: userMatch ? userMatch[1].replace(/\s*\(.*\)/, '') : 'unknown',
          scopes: scopesMatch ? scopesMatch[1].trim() : '',
        });
      } else {
        resolve({ authenticated: false, user: null, scopes: null });
      }
    });
  });
}

// ─── Get full status (installed + auth) ───
async function getStatus() {
  const installed = await checkInstalled();
  if (!installed.installed) {
    return { installed: false, version: null, authenticated: false, user: null };
  }
  const auth = await checkAuth();
  return { ...installed, ...auth };
}

// ─── Install gh CLI ───
function install(onProgress) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;

    if (platform !== 'linux') {
      return reject(new Error('Instalacao automatica disponivel apenas no Linux'));
    }

    // Detect package manager and build install command
    // Uses sudo for package installation (service may run as non-root user)
    const SUDO = process.getuid && process.getuid() !== 0 ? 'sudo' : '';
    const script = `
set -e
echo ">>> Detectando gerenciador de pacotes..."

if command -v apt-get &>/dev/null; then
  echo ">>> Usando apt (Debian/Ubuntu)..."
  export DEBIAN_FRONTEND=noninteractive

  # Add GitHub CLI repository
  if ! command -v gh &>/dev/null; then
    echo ">>> Adicionando repositorio GitHub CLI..."
    (type -p wget >/dev/null || (${SUDO} apt-get update && ${SUDO} apt-get install wget -y))
    ${SUDO} mkdir -p -m 755 /etc/apt/keyrings
    wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | ${SUDO} tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
    ${SUDO} chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | ${SUDO} tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    echo ">>> Instalando gh CLI..."
    ${SUDO} apt-get update
    ${SUDO} apt-get install gh -y
  fi

elif command -v dnf &>/dev/null; then
  echo ">>> Usando dnf (Fedora/RHEL)..."
  ${SUDO} dnf install -y gh

elif command -v yum &>/dev/null; then
  echo ">>> Usando yum (CentOS)..."
  ${SUDO} yum install -y gh

else
  echo ">>> ERRO: Gerenciador de pacotes nao suportado"
  exit 1
fi

echo ">>> Verificando instalacao..."
gh --version
echo ">>> GitHub CLI instalado com sucesso!"
`;

    const proc = spawn('bash', ['-c', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
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
        reject(new Error(`Instalacao falhou (exit code ${code}): ${output.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Falha ao executar: ${err.message}`));
    });
  });
}

// ─── Clone a repo using gh CLI ───
function cloneRepo(repo, destDir) {
  return new Promise((resolve, reject) => {
    // Ensure dest parent dir exists
    const parentDir = path.dirname(destDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // If destDir already exists, pull instead
    if (fs.existsSync(path.join(destDir, '.git'))) {
      execFile('git', ['-C', destDir, 'pull'], { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Git pull falhou: ${(stderr || err.message).slice(-300)}`));
        resolve({ success: true, action: 'pull', path: destDir, output: stdout.trim() });
      });
      return;
    }

    // Remove destDir if exists but isn't a git repo
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    execFile('gh', ['repo', 'clone', repo, destDir], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Clone falhou: ${(stderr || err.message).slice(-300)}`));
      resolve({ success: true, action: 'clone', path: destDir, output: (stdout || stderr || '').trim() });
    });
  });
}

// ─── List repos via gh CLI ───
function listRepos() {
  return new Promise((resolve, reject) => {
    execFile('gh', ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate,updatedAt'],
      { timeout: 15000 }, (err, stdout) => {
        if (err) return reject(new Error('Falha ao listar repos: ' + err.message));
        try {
          const repos = JSON.parse(stdout);
          resolve(repos);
        } catch {
          reject(new Error('Falha ao parsear lista de repos'));
        }
      });
  });
}

module.exports = { checkInstalled, checkAuth, getStatus, install, cloneRepo, listRepos };
