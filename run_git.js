const { execSync } = require('child_process');
const path = require('path');

const repoPath = 'C:/Users/PC/claude-launcher-web';

try {
  console.log('=== git status ===');
  const status = execSync('git status', { cwd: repoPath, encoding: 'utf8' });
  console.log(status);
} catch (err) {
  console.log('git status error:', err.message);
}

try {
  console.log('\n=== git diff server.js ===');
  const diff = execSync('git diff server.js', { cwd: repoPath, encoding: 'utf8' });
  console.log(diff);
} catch (err) {
  console.log('git diff error:', err.message);
}
