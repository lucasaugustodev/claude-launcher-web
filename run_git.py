import subprocess
import os

os.chdir(r'C:\Users\PC\claude-launcher-web')

# Run git status
result = subprocess.run(['git', 'status'], capture_output=True, text=True)
print("=== git status ===")
print(result.stdout)
print(result.stderr)

# Run git diff server.js if there are changes
result = subprocess.run(['git', 'diff', 'server.js'], capture_output=True, text=True)
print("\n=== git diff server.js ===")
print(result.stdout)
print(result.stderr)
