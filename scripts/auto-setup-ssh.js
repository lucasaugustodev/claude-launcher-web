/**
 * Auto SSH setup - runs when server starts if SSH is not configured
 * Add to server.js: require('./scripts/auto-setup-ssh')
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SSHD_CONFIG = 'C:\\ProgramData\\ssh\\sshd_config';
const MARKER = path.join(__dirname, '..', '.ssh-configured');

if (process.platform !== 'win32') process.exit(0);
if (fs.existsSync(MARKER)) process.exit(0);

console.log('[SSH Setup] Configuring SSH for remote access...');

try {
  // Stop sshd
  try { execSync('net stop sshd', { stdio: 'pipe' }); } catch {}

  // Write clean config
  const config = [
    'Port 22',
    'PasswordAuthentication yes',
    'PubkeyAuthentication yes',
    'PermitRootLogin yes',
    'AllowUsers Administrator',
    'Subsystem sftp sftp-server.exe',
  ].join('\r\n');

  fs.writeFileSync(SSHD_CONFIG, config, 'ascii');
  console.log('[SSH Setup] Wrote sshd_config');

  // Remove admin override file
  const adminKeys = 'C:\\ProgramData\\ssh\\administrators_authorized_keys';
  if (fs.existsSync(adminKeys)) fs.unlinkSync(adminKeys);

  // Start sshd
  execSync('net start sshd', { stdio: 'pipe' });
  console.log('[SSH Setup] sshd started');

  // Mark as done
  fs.writeFileSync(MARKER, new Date().toISOString());
  console.log('[SSH Setup] Done!');
} catch (err) {
  console.error('[SSH Setup] Error:', err.message);
}
