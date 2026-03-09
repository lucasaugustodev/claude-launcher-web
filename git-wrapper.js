const { spawn } = require('child_process');
const path = require('path');

const repoPath = 'C:/Users/PC/claude-launcher-web';

function runGitCommand(args) {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, { 
      cwd: repoPath,
      shell: true,
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    git.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    git.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    git.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    
    git.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    console.log('=== Git Status ===');
    const status = await runGitCommand(['status']);
    console.log(status.stdout);
    if (status.stderr) console.error(status.stderr);
    
    console.log('\n=== Git Diff --stat ===');
    const diffStat = await runGitCommand(['diff', '--stat']);
    console.log(diffStat.stdout || 'No changes');
    if (diffStat.stderr) console.error(diffStat.stderr);
    
    console.log('\n=== Git Diff --name-only ===');
    const diffNames = await runGitCommand(['diff', '--name-only']);
    console.log(diffNames.stdout || 'No changes');
    if (diffNames.stderr) console.error(diffNames.stderr);
    
    console.log('\n=== Git Remote -v ===');
    const remote = await runGitCommand(['remote', '-v']);
    console.log(remote.stdout || 'No remotes');
    if (remote.stderr) console.error(remote.stderr);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
