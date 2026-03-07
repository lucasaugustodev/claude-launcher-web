const { spawn } = require('child_process');

const repoPath = 'C:/Users/PC/claude-launcher-web';

// Use shell: true
const git = spawn('git', ['status'], { 
  cwd: repoPath, 
  shell: true,
  env: { ...process.env, PATH: process.env.PATH + ';C:\\Program Files\\Git\\cmd' }
});

git.stdout.on('data', (data) => {
  console.log('stdout:', data.toString());
});

git.stderr.on('data', (data) => {
  console.log('stderr:', data.toString());
});

git.on('close', (code) => {
  console.log('Exit code:', code);
});
