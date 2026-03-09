const { execSync } = require('child_process');
const path = require('path');

const repoPath = 'C:/Users/PC/claude-launcher-web';

try {
  console.log('=== GIT PUSH ===');
  const result = execSync('git push', { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' });
  console.log(result);
  console.log('SUCCESS: Push completed!');
} catch (error) {
  console.error('Error:', error.message);
  if (error.stdout) console.log('stdout:', error.stdout);
  if (error.stderr) console.error('stderr:', error.stderr);
  process.exit(1);
}
