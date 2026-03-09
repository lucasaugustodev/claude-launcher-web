import subprocess
import os

repo_path = r'C:\Users\PC\claude-launcher-web'

print('=== Git Status ===')
try:
    result = subprocess.run(['git', 'status'], cwd=repo_path, capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print(result.stderr)
except Exception as e:
    print(f'Error: {e}')

print('\n=== Git Diff (unstaged) ===')
try:
    result = subprocess.run(['git', 'diff'], cwd=repo_path, capture_output=True, text=True)
    print(result.stdout if result.stdout else 'No unstaged changes')
except Exception as e:
    print(f'Error: {e}')

print('\n=== Git Diff --stat ===')
try:
    result = subprocess.run(['git', 'diff', '--stat'], cwd=repo_path, capture_output=True, text=True)
    print(result.stdout if result.stdout else 'No changes')
except Exception as e:
    print(f'Error: {e}')

print('\n=== Git Diff --cached --stat ===')
try:
    result = subprocess.run(['git', 'diff', '--cached', '--stat'], cwd=repo_path, capture_output=True, text=True)
    print(result.stdout if result.stdout else 'No staged changes')
except Exception as e:
    print(f'Error: {e}')
