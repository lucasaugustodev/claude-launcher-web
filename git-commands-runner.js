const { execSync } = require('child_process');
const path = require('path');

const repoPath = 'C:/Users/PC/claude-launcher-web';

try {
  console.log('=== Git Status ===');
  const status = execSync('git status', { cwd: repoPath, encoding: 'utf8' });
  console.log(status);
  
  console.log('\n=== Git Diff (staged) ===');
  try {
    const diffStaged = execSync('git diff --cached', { cwd: repoPath, encoding: 'utf8' });
    console.log(diffStaged || 'No staged changes');
  } catch (e) {
    console.log('No staged changes');
  }
  
  console.log('\n=== Git Diff (unstaged) ===');
  try {
    const diff = execSync('git diff', { cwd: repoPath, encoding: 'utf8' });
    console.log(diff || 'No unstaged changes');
  } catch (e) {
    console.log('No unstaged changes');
  }
  
  console.log('\n=== Git Diff --stat ===');
  try {
    const diffStat = execSync('git diff --stat', { cwd: repoPath, encoding: 'utf8' });
    console.log(diffStat || 'No changes');
  } catch (e) {
    console.log('No changes');
  }
  
} catch (error) {
  console.error('Error:', error.message);
}
