// ─── GitHub App Sync Module ───
// Syncs Claude sessions to the user's GitHub repo via the ia-hub-project GitHub App.
// Uses only Node.js built-in modules (crypto, fs, https, path).

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const storage = require('./storage');

// ─── Fixed App Config ───
const PEM_PATH = path.join(__dirname, 'data', 'github-app.pem');
const APP_ID = '2958660';

// ─── Token Cache ───
let _cachedToken = null;
let _cachedInstallationId = null;
let _tokenExpiresAt = 0;

// ─── Helpers ───

function base64url(buf) {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateJWT() {
  const pemKey = fs.readFileSync(PEM_PATH, 'utf8');
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iss: APP_ID, iat: now - 60, exp: now + 600 }));
  const signingInput = header + '.' + payload;
  const signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), pemKey));
  return signingInput + '.' + signature;
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function githubAPI(method, apiPath, token, body) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'claude-launcher-web',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';
  const bodyStr = body ? JSON.stringify(body) : null;
  if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

  return httpsRequest({
    hostname: 'api.github.com',
    path: apiPath,
    method,
    headers,
  }, bodyStr);
}

// ─── Config ───

function getConfig() {
  return storage.getGitHubConfig();
}

function saveConfig(config) {
  storage.saveGitHubConfig(config);
}

function isConfigured() {
  const config = getConfig();
  return !!(config && config.enabled && config.installationId && config.owner && config.repo);
}

// ─── Auth ───

async function getInstallationToken(installationId) {
  // Use cache if valid (55 min margin)
  if (_cachedToken && _cachedInstallationId === installationId && Date.now() < _tokenExpiresAt) {
    return _cachedToken;
  }

  const jwt = generateJWT();
  const res = await githubAPI('POST', `/app/installations/${installationId}/access_tokens`, jwt, {});

  if (res.statusCode !== 201) {
    throw new Error(`Failed to get installation token: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }

  _cachedToken = res.body.token;
  _cachedInstallationId = installationId;
  _tokenExpiresAt = Date.now() + 55 * 60 * 1000; // 55 minutes
  return _cachedToken;
}

async function listInstallations() {
  const jwt = generateJWT();
  const res = await githubAPI('GET', '/app/installations', jwt);

  if (res.statusCode !== 200) {
    throw new Error(`Failed to list installations: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }

  return res.body.map(inst => ({
    id: String(inst.id),
    account: inst.account.login,
    accountType: inst.account.type,
    avatarUrl: inst.account.avatar_url,
  }));
}

// ─── Repo Management ───

async function checkRepo(token, owner, repoName) {
  const check = await githubAPI('GET', `/repos/${owner}/${repoName}`, token);
  if (check.statusCode === 200) {
    return { exists: true, fullName: check.body.full_name };
  }
  return { exists: false };
}

async function createOrgRepo(token, org, repoName) {
  const res = await githubAPI('POST', `/orgs/${org}/repos`, token, {
    name: repoName,
    description: 'Claude sessions auto-sync',
    private: true,
    auto_init: true,
  });
  if (res.statusCode === 201) {
    return { created: true, fullName: res.body.full_name };
  }
  throw new Error(`Failed to create repo: ${res.statusCode} ${JSON.stringify(res.body)}`);
}

// ─── ANSI Stripping ───

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x3f]*[A-Za-z]/g, '') // CSI sequences (includes ?!> prefixes)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')              // OSC sequences (both BEL and ST terminators)
    .replace(/\x1b[()][A-Z0-9]/g, '')                                // Charset sequences
    .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '')                    // Other ESC sequences (Fp, Fe, Fs)
    .replace(/\r\n/g, '\n')                                          // Normalize CRLF
    .replace(/\r/g, '')                                              // Remaining carriage returns
    .replace(/\x00/g, '')                                            // Null bytes
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '')                  // Other control chars (keep \t and \n)
    .replace(/\n{3,}/g, '\n\n');                                     // Collapse excessive blank lines
}

// ─── Session Formatting ───

function formatDuration(seconds) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSessionMarkdown(session, cleanOutput) {
  const statusEmoji = { completed: 'ok', crashed: 'erro', stopped: 'parado' };
  const lines = [
    `# ${session.profileName} - ${session.id.slice(0, 8)}`,
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| Status | ${statusEmoji[session.status] || session.status} |`,
    `| Modo | ${session.mode || 'normal'} |`,
    `| Inicio | ${session.startedAt || '-'} |`,
    `| Fim | ${session.endedAt || '-'} |`,
    `| Duracao | ${formatDuration(session.durationSeconds)} |`,
    `| Exit Code | ${session.exitCode ?? '-'} |`,
    `| Diretorio | ${session.workingDirectory || '-'} |`,
    `| PID | ${session.pid || '-'} |`,
  ];

  if (session.resumedFrom) {
    lines.push(`| Resumido de | ${session.resumedFrom.slice(0, 8)} |`);
  }

  lines.push('', '## Output', '', '```');

  // Truncate output to ~300KB for GitHub API limits
  const maxLen = 300 * 1024;
  if (cleanOutput.length > maxLen) {
    lines.push('[... output truncado - inicio omitido ...]');
    lines.push(cleanOutput.slice(-maxLen));
  } else {
    lines.push(cleanOutput || '(sem output)');
  }

  lines.push('```', '');
  return lines.join('\n');
}

// ─── Push File ───

async function pushFile(filePath, content, commitMessage) {
  const config = getConfig();
  if (!config) throw new Error('GitHub not configured');

  const token = await getInstallationToken(config.installationId);

  // Check if file exists (to get SHA for update)
  let sha = null;
  const check = await githubAPI('GET', `/repos/${config.owner}/${config.repo}/contents/${filePath}`, token);
  if (check.statusCode === 200) {
    sha = check.body.sha;
  }

  const body = {
    message: commitMessage,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;

  const res = await githubAPI('PUT', `/repos/${config.owner}/${config.repo}/contents/${filePath}`, token, body);

  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`Push failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }

  return { success: true, url: res.body.content?.html_url || '' };
}

// ─── Main Sync ───

async function syncSession(sessionId) {
  if (!isConfigured()) return { success: false, error: 'GitHub not configured' };

  const session = storage.getSession(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.status === 'running') return { success: false, error: 'Session still running' };

  // Read raw output
  const outputFile = path.join(__dirname, 'data', 'outputs', `${sessionId}.raw`);
  let rawOutput = '';
  try { rawOutput = fs.readFileSync(outputFile, 'utf8'); } catch {}

  const cleanOutput = stripAnsi(rawOutput);
  const markdown = formatSessionMarkdown(session, cleanOutput);

  // Build file path: sessions/YYYY-MM-DD/shortId.md
  const date = (session.startedAt || new Date().toISOString()).slice(0, 10);
  const shortId = sessionId.slice(0, 8);
  const filePath = `sessions/${date}/${shortId}.md`;
  const commitMessage = `session: ${session.profileName} (${session.status}) - ${shortId}`;

  const result = await pushFile(filePath, markdown, commitMessage);
  console.log(`[GITHUB] Synced ${shortId}: ${result.url || 'ok'}`);
  return result;
}

// ─── Test Connection ───

async function testConnection() {
  const config = getConfig();
  if (!config || !config.installationId) {
    throw new Error('GitHub not configured');
  }

  const token = await getInstallationToken(config.installationId);
  const res = await githubAPI('GET', `/repos/${config.owner}/${config.repo}`, token);

  if (res.statusCode === 200) {
    return { success: true, repoName: res.body.full_name, private: res.body.private };
  }

  throw new Error(`Cannot access repo: ${res.statusCode}`);
}

module.exports = {
  getConfig, saveConfig, isConfigured,
  listInstallations, getInstallationToken,
  checkRepo, createOrgRepo, syncSession, testConnection,
};
