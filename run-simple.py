import subprocess
import os
import sys

os.chdir("C:/Users/PC/claude-launcher-web")

# Run git status using shell=True
result = subprocess.run("git status", shell=True, capture_output=True, text=True)
print("=== GIT STATUS ===")
print(result.stdout)
print(result.stderr)

# Run git diff --stat
result = subprocess.run("git diff --stat", shell=True, capture_output=True, text=True)
print("\n=== GIT DIFF STAT ===")
print(result.stdout)
print(result.stderr)

# Run git diff --name-only
result = subprocess.run("git diff --name-only", shell=True, capture_output=True, text=True)
print("\n=== GIT DIFF NAME-ONLY ===")
print(result.stdout)
print(result.stderr)

# Run git remote -v
result = subprocess.run("git remote -v", shell=True, capture_output=True, text=True)
print("\n=== GIT REMOTE ===")
print(result.stdout)
print(result.stderr)

# Write output to file
with open("git-status-output.txt", "w", encoding="utf-8") as f:
    f.write("=== GIT STATUS ===\n")
    f.write(result.stdout)
    f.write("\n=== GIT DIFF STAT ===\n")
    f.write(result.stdout)
