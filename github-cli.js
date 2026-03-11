const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// GitHub CLI installs to these locations on Windows (MSI installer)
const GH_PATHS_WIN = [
  'C:\\Program Files\\GitHub CLI',
  'C:\\Program Files (x86)\\GitHub CLI',
];

// Ensure GitHub CLI dir is in PATH for detection
function getEnvWithGhPath() {
  if (process.platform !== 'win32') return process.env;
  const currentPath = process.env.PATH || process.env.Path || '';
  const missing = GH_PATHS_WIN.filter(p => {
    try { return fs.existsSync(p) && !currentPath.toLowerCase().includes(p.toLowerCase()); } catch { return false; }
  });
  if (missing.length === 0) return process.env;
  return { ...process.env, PATH: missing.join(';') + ';' + currentPath };
}

// ─── Check if gh CLI is installed (with retry for cold-start delays) ───
function checkInstalled() {
  return new Promise((resolve) => {
    const attempt = (retries) => {
      execFile('gh', ['--version'], { timeout: 15000, shell: true, env: getEnvWithGhPath() }, (err, stdout) => {
        if (err) {
          if (retries > 0) return setTimeout(() => attempt(retries - 1), 1000);
          // Last resort: check if gh.exe exists on disk
          const ghExists = GH_PATHS_WIN.some(p => {
            try { return fs.existsSync(path.join(p, 'gh.exe')); } catch { return false; }
          });
          return resolve({ installed: ghExists, version: null });
        }
        const match = stdout.match(/gh version ([\d.]+)/);
        resolve({ installed: true, version: match ? match[1] : stdout.trim() });
      });
    };
    attempt(2);
  });
}

// ─── Check if gh CLI is authenticated ───
function checkAuth() {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'status'], { timeout: 10000, shell: true, env: getEnvWithGhPath() }, (err, stdout, stderr) => {
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

    if (platform === 'win32') {
      return installWindows(onProgress).then(resolve).catch(reject);
    }

    if (platform !== 'linux') {
      return reject(new Error('Instalacao automatica disponivel apenas no Linux e Windows'));
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

// ─── Install gh CLI on Windows (MSI download) ───
function installWindows(onProgress) {
  return new Promise((resolve, reject) => {
    const script = `
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Output '>>> Verificando se gh ja esta instalado...'
$existing = Get-Command gh -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output ">>> gh ja instalado: $(gh --version 2>&1 | Select-Object -First 1)"
  exit 0
}

# Try winget first (fastest)
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
  Write-Output '>>> Instalando via winget...'
  winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements 2>&1 | ForEach-Object { Write-Output $_ }
  # Refresh PATH
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  $check = Get-Command gh -ErrorAction SilentlyContinue
  if ($check) {
    Write-Output ">>> $(gh --version 2>&1 | Select-Object -First 1)"
    Write-Output '>>> GitHub CLI instalado com sucesso via winget!'
    exit 0
  }
  Write-Output '>>> winget instalou mas gh nao encontrado no PATH, tentando MSI...'
}

# Fallback: download MSI from GitHub releases
Write-Output '>>> Baixando GitHub CLI MSI...'
$apiUrl = 'https://api.github.com/repos/cli/cli/releases/latest'
try {
  $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing
  $msiAsset = $release.assets | Where-Object { $_.name -match 'gh_.*_windows_amd64\\.msi$' } | Select-Object -First 1
  if (-not $msiAsset) { throw 'MSI asset nao encontrado na release' }
  $msiUrl = $msiAsset.browser_download_url
  $msiName = $msiAsset.name
} catch {
  # Hardcoded fallback URL
  Write-Output ">>> API falhou ($_), usando URL de fallback..."
  $msiUrl = 'https://github.com/cli/cli/releases/latest/download/gh_2.67.0_windows_amd64.msi'
  $msiName = 'gh_windows_amd64.msi'
}

$msiPath = Join-Path $env:TEMP $msiName
Write-Output ">>> Baixando $msiName..."
Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
$size = [math]::Round((Get-Item $msiPath).Length / 1MB, 1)
Write-Output ">>> Download completo: $size MB"

Write-Output '>>> Instalando MSI...'
$msiArgs = '/i "' + $msiPath + '" /qn /norestart'
$proc = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
  throw ('msiexec falhou com exit code ' + $proc.ExitCode)
}
Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

# Add to PATH if not already there
$ghDir = 'C:\\Program Files\\GitHub CLI'
if (Test-Path $ghDir) {
  $machinePath = [System.Environment]::GetEnvironmentVariable('Path','Machine')
  if ($machinePath -notlike "*GitHub CLI*") {
    [System.Environment]::SetEnvironmentVariable('Path', "$ghDir;$machinePath", 'Machine')
    Write-Output '>>> PATH atualizado'
  }
  $env:Path = "$ghDir;" + $env:Path
}

# Also check common install location
$ghDir2 = Join-Path $env:ProgramFiles 'GitHub CLI'
if ((Test-Path "$ghDir2\\gh.exe") -and ($env:Path -notlike "*$ghDir2*")) {
  $env:Path = "$ghDir2;" + $env:Path
}

Write-Output '>>> Verificando instalacao...'
$ghExe = Get-Command gh -ErrorAction SilentlyContinue
if ($ghExe) {
  $ver = & gh --version 2>&1 | Select-Object -First 1
  Write-Output ">>> $ver"
  Write-Output '>>> GitHub CLI instalado com sucesso!'
} else {
  Write-Output '>>> AVISO: gh instalado mas nao encontrado no PATH. Reinicie o terminal.'
  Write-Output '>>> Diretorio de instalacao: C:\\Program Files\\GitHub CLI'
}
`;

    const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
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
      reject(new Error(`Falha ao executar PowerShell: ${err.message}`));
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

    // Use parent dir as cwd to avoid "Unable to read current working directory" errors
    const execOpts = { timeout: 120000, cwd: parentDir };

    // If destDir already exists, pull instead
    if (fs.existsSync(path.join(destDir, '.git'))) {
      execFile('git', ['-C', destDir, 'pull'], execOpts, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Git pull falhou: ${(stderr || err.message).slice(-300)}`));
        resolve({ success: true, action: 'pull', path: destDir, output: stdout.trim() });
      });
      return;
    }

    // Remove destDir if exists but isn't a git repo
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    execFile('gh', ['repo', 'clone', repo, destDir], execOpts, (err, stdout, stderr) => {
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
