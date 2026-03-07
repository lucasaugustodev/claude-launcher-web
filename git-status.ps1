# Git operations for claude-launcher-web
$repoPath = "C:\Users\PC\claude-launcher-web"
$outputFile = "$repoPath\git-output.txt"

# Clear output file
"" | Out-File -FilePath $outputFile -Encoding UTF8

# Git status
"=== GIT STATUS ===" | Out-File -FilePath $outputFile -Append -Encoding UTF8
git -C $repoPath status 2>&1 | Out-File -FilePath $outputFile -Append -Encoding UTF8

# Git diff --stat
"`n=== GIT DIFF STAT ===" | Out-File -FilePath $outputFile -Append -Encoding UTF8
git -C $repoPath diff --stat 2>&1 | Out-File -FilePath $outputFile -Append -Encoding UTF8

# Git diff --name-only
"`n=== GIT DIFF NAME-ONLY ===" | Out-File -FilePath $outputFile -Append -Encoding UTF8
git -C $repoPath diff --name-only 2>&1 | Out-File -FilePath $outputFile -Append -Encoding UTF8

# Git diff --cached --name-only
"`n=== GIT DIFF --CACHED NAME-ONLY ===" | Out-File -FilePath $outputFile -Append -Encoding UTF8
git -C $repoPath diff --cached --name-only 2>&1 | Out-File -FilePath $outputFile -Append -Encoding UTF8

# Git diff HEAD
"`n=== GIT DIFF HEAD ===" | Out-File -FilePath $outputFile -Append -Encoding UTF8
git -C $repoPath diff HEAD 2>&1 | Out-File -FilePath $outputFile -Append -Encoding UTF8

Write-Host "Git output saved to $outputFile"
