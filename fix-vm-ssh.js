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
      let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function main() {
  const sess = await post('/api/claude-cli/auth');
  console.log('Session:', sess.sessionId);

  const ws = new WebSocket(`ws://${VM}:3001/ws`);
  let output = '';
  const SID = sess.sessionId;

  function send(data) {
    ws.send(JSON.stringify({ type: 'input', sessionId: SID, data }));
  }

  ws.on('open', () => {
    console.log('WS connected');
    ws.send(JSON.stringify({ type: 'attach', sessionId: SID }));

    // Barrage of Ctrl+C to kill claude
    for (let i = 1; i <= 8; i++) {
      setTimeout(() => send('\x03'), i * 500);
    }
    // Send 'y' to confirm exit
    setTimeout(() => send('y\r\n'), 5000);
    // More Ctrl+C just in case
    setTimeout(() => send('\x03'), 5500);
    setTimeout(() => send('\x03'), 6000);

    // By now we should be at cmd.exe prompt
    // Send commands at 8s mark
    setTimeout(() => {
      console.log('Sending SSH fix commands...');
      const cmds = [
        'powershell -Command "Stop-Service sshd -Force -ErrorAction SilentlyContinue"',
        'echo Port 22> C:\\ProgramData\\ssh\\sshd_config',
        'echo PasswordAuthentication yes>> C:\\ProgramData\\ssh\\sshd_config',
        'echo PubkeyAuthentication yes>> C:\\ProgramData\\ssh\\sshd_config',
        'echo PermitRootLogin yes>> C:\\ProgramData\\ssh\\sshd_config',
        'echo AllowUsers Administrator>> C:\\ProgramData\\ssh\\sshd_config',
        'echo Subsystem sftp sftp-server.exe>> C:\\ProgramData\\ssh\\sshd_config',
        'del "C:\\ProgramData\\ssh\\administrators_authorized_keys" 2>nul',
        'mkdir "C:\\Users\\Administrator\\.ssh" 2>nul',
        'echo ' + PUBKEY + '> "C:\\Users\\Administrator\\.ssh\\authorized_keys"',
        'powershell -Command "net user Administrator hZJK5I8Dtm0RhIzT; Start-Service sshd; Write-Host SSH_FIXED"',
        'type C:\\ProgramData\\ssh\\sshd_config',
      ];

      let i = 0;
      const sendNext = () => {
        if (i < cmds.length) {
          send(cmds[i] + '\r\n');
          console.log('>', cmds[i].substring(0, 80));
          i++;
          setTimeout(sendNext, 2000);
        }
      };
      sendNext();
    }, 8000);

    setTimeout(() => {
      const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '');
      console.log('\n--- OUTPUT (last 2000 chars) ---');
      console.log(clean.slice(-2000));
      if (clean.includes('SSH_FIXED')) console.log('\nSSH FIXED SUCCESSFULLY!');
      else console.log('\nSSH_FIXED not found in output');
      ws.close();
      process.exit(0);
    }, 40000);
  });

  ws.on('message', raw => {
    try { const msg = JSON.parse(raw); if (msg.data) output += msg.data; } catch {}
  });
}

main().catch(e => { console.error(e); process.exit(1); });
