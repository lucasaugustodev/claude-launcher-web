const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoPath = 'C:\\Users\\PC\\claude-launcher-web';

function runGitCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, { cwd: repoPath, timeout: 30000 }, (error, stdout, stderr) => {
            resolve({ stdout, stderr, error });
        });
    });
}

async function main() {
    let output = '';
    
    output += '=== GIT VERSION ===\n';
    const version = await runGitCommand('git --version');
    output += version.stdout + version.stderr + '\n';
    
    output += '=== GIT STATUS ===\n';
    const status = await runGitCommand('git status --porcelain');
    output += status.stdout + status.stderr + '\n';
    
    output += '=== GIT DIFF --NAME-ONLY ===\n';
    const diff = await runGitCommand('git diff --name-only');
    output += diff.stdout + diff.stderr + '\n';
    
    output += '=== GIT DIFF --CACHED --NAME-ONLY ===\n';
    const diffCached = await runGitCommand('git diff --cached --name-only');
    output += diffCached.stdout + diffCached.stderr + '\n';
    
    output += '=== GIT REMOTE -V ===\n';
    const remote = await runGitCommand('git remote -v');
    output += remote.stdout + remote.stderr + '\n';
    
    fs.writeFileSync(path.join(repoPath, 'git-info.txt'), output, 'utf8');
    console.log(output);
}

main().catch(console.error);
