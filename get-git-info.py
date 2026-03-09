import subprocess
import os

os.chdir("C:/Users/PC/claude-launcher-web")

# Simple test
result = subprocess.run(["git", "--version"], capture_output=True, text=True)
print("Git version:", result.stdout, result.stderr)

# Git status
result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, timeout=10)
status_output = result.stdout + result.stderr
print("Status:", status_output)

# Git diff --name-only
result = subprocess.run(["git", "diff", "--name-only", "HEAD"], capture_output=True, text=True, timeout=30)
diff_output = result.stdout + result.stderr
print("Diff:", diff_output)

# Write to file
with open("git-diff-output.txt", "w", encoding="utf-8") as f:
    f.write("=== GIT STATUS --PORCELAIN ===\n")
    f.write(status_output)
    f.write("\n=== GIT DIFF NAME-ONLY ===\n")
    f.write(diff_output)

print("Output written to git-diff-output.txt")
