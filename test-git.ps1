$ErrorActionPreference = "Continue"
$repoPath = "C:\Users\PC\claude-launcher-web"

try {
    $output = & git -C $repoPath status 2>&1
    $output | Out-File -FilePath "$repoPath\git-output.txt" -Encoding UTF8
    Write-Host "Git status output:"
    Get-Content "$repoPath\git-output.txt"
} catch {
    Write-Host "Error: $_"
}

try {
    $output = & git -C $repoPath diff --stat 2>&1
    $output | Out-File -FilePath "$repoPath\git-diff-stat.txt" -Encoding UTF8 -Append
} catch {
    Write-Host "Error in diff: $_"
}
