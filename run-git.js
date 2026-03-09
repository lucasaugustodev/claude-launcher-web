const { execSync } = require('child_process');
const path = require('path');

const repoPath = 'C:\\Users\\PC\\claude-launcher-web';

try {
  console.log('=== GIT STATUS ===');
  console.log(execSync('git status', { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }));
} catch (e) {
  console.log('git status error:', e.message);
}

try {
  console.log('=== GIT DIFF STAT ===');
  console.log(execSync('git diff --stat', { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }));
} catch (e) {
  console.log('git diff --stat error:', e.message);
}

try {
  console.log('=== GIT DIFF NAME-ONLY ===');
  console.log(execSync('git diff --name-only', { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }));
} catch (e) {
  console.log('git diff --name-only error:', e.message);
}

try {
  console.log('=== GIT REMOTE -V ===');
  console.log(execSync('git remote -v', { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }));
} catch (e) {
  console.log('git remote -v error:', e.message);
}
