const { execSync } = require('child_process');
const path = require('path');

const repoPath = 'C:/Users/PC/claude-launcher-web';

try {
  // Git status
  console.log('=== GIT STATUS ===');
  const status = execSync('git status', { cwd: repoPath, encoding: 'utf8' });
  console.log(status);
  
  // Git diff
  console.log('=== GIT DIFF ===');
  const diff = execSync('git diff', { cwd: repoPath, encoding: 'utf8' });
  console.log(diff);
  
  // Git diff --stat
  console.log('=== GIT DIFF STAT ===');
  const diffStat = execSync('git diff --stat', { cwd: repoPath, encoding: 'utf8' });
  console.log(diffStat);
  
  // Git diff --name-only
  console.log('=== GIT DIFF NAME-ONLY ===');
  const diffNames = execSync('git diff --name-only', { cwd: repoPath, encoding: 'utf8' });
  console.log(diffNames);
  
} catch (error) {
  console.error('Error:', error.message);
  if (error.stdout) console.log('stdout:', error.stdout);
  if (error.stderr) console.error('stderr:', error.stderr);
}
