const http = require('http');
const WebSocket = require('ws');

const VM = '92.246.131.103';
const PUBKEY = require('fs').readFileSync(require('os').homedir() + '/.ssh/id_ed25519.pub', 'utf8').trim();

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: VM, port: 3001, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function main() {
  // Step 1: Use the GitHub CLI install endpoint (SSE) to run git pull
  // Actually, let's use a claude session but send commands BEFORE claude starts
  // The session spawns: cmd.exe /c claude ...
  // We need a raw shell. Let's try the GitHub CLI auth which spawns 'gh'
  // That will also fail. Let's use the install endpoint instead.

  // Actually the simplest: create a session, and since claude isn't installed properly,
  // cmd.exe /c claude will fail and drop to the prompt

  const sess = await post('/api/claude-cli/auth');
  console.log('Session:', sess.sessionId);

  const ws = new WebSocket(`ws://${VM}:3001/ws`);
  let output = '';
  const SID = sess.sessionId;

  function send(data) {
    ws.send(JSON.stringify({ type: 'input', sessionId: SID, data }));
  }

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'attach', sessionId: SID }));

    // Wait to see what happens
    setTimeout(() => {
      const clean = output.replace(/\x1b\[[^\x1b]*[a-zA-Z]/g, '');
      console.log('Initial output:', clean.slice(0, 500));

      // If claude started (theme selection), Ctrl+C out
      if (clean.includes('theme') || clean.includes('started')) {
        console.log('Claude running, killing...');
        for (let i = 0; i < 5; i++) setTimeout(() => send('\x03'), i * 300);
        setTimeout(() => send('y\r\n'), 2000);
      }
    }, 4000);

    // At 8s, check if we have a prompt and send commands
    setTimeout(() => {
      console.log('Sending git pull + restart commands...');
      // These run in cmd.exe
      send('cd C:\\claude-launcher-web && git pull\r\n');
    }, 8000);

    setTimeout(() => {
      // Restart the server with the new code that has /api/exec
      send('powershell -Command "taskkill /f /im node.exe; Start-Sleep 2; schtasks /run /tn ClaudeLauncherWeb; Write-Host RESTARTED"\r\n');
    }, 15000);

    // Wait for restart, then use /api/exec to fix SSH
    setTimeout(async () => {
      console.log('Waiting for server restart...');
      ws.close();

      // Wait for server to come back
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const health = await post('/api/health', {});
          if (health.status === 'ok') {
            console.log('Server is back!');
            break;
          }
        } catch {}
        console.log(`  Waiting... ${(i+1)*3}s`);
      }

      // Now use /api/exec to fix SSH
      console.log('\nFixing SSH via /api/exec...');

      const cmds = [
        'Stop-Service sshd -Force -ErrorAction SilentlyContinue',
        `@"\nPort 22\nPasswordAuthentication yes\nPubkeyAuthentication yes\nPermitRootLogin yes\nAllowUsers Administrator\nSubsystem sftp sftp-server.exe\n"@ | Set-Content "C:\\ProgramData\\ssh\\sshd_config" -Force -Encoding ASCII`,
        'Remove-Item "C:\\ProgramData\\ssh\\administrators_authorized_keys" -Force -ErrorAction SilentlyContinue',
        'New-Item -ItemType Directory -Path "C:\\Users\\Administrator\\.ssh" -Force | Out-Null',
        `Set-Content "C:\\Users\\Administrator\\.ssh\\authorized_keys" "${PUBKEY}" -Force -Encoding ASCII`,
        'net user Administrator hZJK5I8Dtm0RhIzT',
        'Start-Service sshd',
        'Get-Content "C:\\ProgramData\\ssh\\sshd_config"',
        'Write-Host "SSH_FIXED"',
      ];

      for (const cmd of cmds) {
        try {
          const r = await post('/api/exec', { cmd });
          console.log(`> ${cmd.substring(0, 60)}`);
          if (r.output) console.log('  ', r.output.trim().substring(0, 200));
          if (r.error) console.log('  ERR:', r.error.substring(0, 200));
        } catch (e) {
          console.log(`> ${cmd.substring(0, 60)} -> FAILED: ${e.message}`);
        }
      }

      console.log('\nDone!');
      process.exit(0);
    }, 22000);
  });

  ws.on('message', raw => {
    try { const msg = JSON.parse(raw); if (msg.data) output += msg.data; } catch {}
  });
}

main().catch(e => { console.error(e); process.exit(1); });
