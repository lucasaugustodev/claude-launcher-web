import subprocess
import os

os.chdir("C:/Users/PC/claude-launcher-web")

# Run git status
result = subprocess.run(["git", "status"], capture_output=True, text=True)
print("=== GIT STATUS ===")
print(result.stdout)
print(result.stderr)

# Run git diff
result = subprocess.run(["git", "diff", "--stat"], capture_output=True, text=True)
print("\n=== GIT DIFF STAT ===")
print(result.stdout)
print(result.stderr)

# Run git diff --name-only
result = subprocess.run(["git", "diff", "--name-only"], capture_output=True, text=True)
print("\n=== GIT DIFF NAME-ONLY ===")
print(result.stdout)
print(result.stderr)
