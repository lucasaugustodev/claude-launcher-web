import subprocess
import os

os.chdir("C:/Users/PC/claude-launcher-web")

# Run git push
result = subprocess.run(["git", "push"], capture_output=True, text=True)
print("=== GIT PUSH ===")
print(result.stdout)
print(result.stderr)
if result.returncode == 0:
    print("SUCCESS: Push completed!")
else:
    print(f"FAILED with code: {result.returncode}")
