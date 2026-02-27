import paramiko
import time
import sys

HOST = '216.238.116.106'
USER = 'root'
PASS = 'Kj@6nVwA7DCD[XfH'

def ssh_exec(ssh, cmd, timeout=120, show_stderr=True):
    """Execute command and return output"""
    print(f"\n{'='*60}")
    print(f">>> {cmd}")
    print('='*60)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out)
    if err and show_stderr:
        print(f"[stderr] {err}")
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        print(f"[exit_code: {exit_code}]")
    return out, err, exit_code

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)
    print("Connected to server!")

    # Step 1: Install Node.js 20.x LTS
    print("\n\n### STEP 1: Installing Node.js 20.x ###")
    ssh_exec(ssh, 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -', timeout=60)
    ssh_exec(ssh, 'apt-get install -y nodejs', timeout=120)
    ssh_exec(ssh, 'node --version && npm --version')

    # Step 2: Install pm2 globally
    print("\n\n### STEP 2: Installing PM2 ###")
    ssh_exec(ssh, 'npm install -g pm2', timeout=60)

    # Step 3: Install build essentials for node-pty
    print("\n\n### STEP 3: Installing build tools ###")
    ssh_exec(ssh, 'apt-get install -y build-essential python3 make g++', timeout=120)

    # Step 4: Clone repos
    print("\n\n### STEP 4: Cloning repositories ###")
    ssh_exec(ssh, 'cd /root && rm -rf claude-launcher-web && git clone https://github.com/lucasaugustodev/claude-launcher-web.git')
    ssh_exec(ssh, 'cd /root && rm -rf vultr-vm-creator && git clone https://github.com/lucasaugustodev/vultr-vm-creator.git')

    # Step 5: Install dependencies for claude-launcher-web
    print("\n\n### STEP 5: Installing claude-launcher-web dependencies ###")
    ssh_exec(ssh, 'cd /root/claude-launcher-web && npm install', timeout=180)

    # Step 6: Install dependencies for vultr-vm-creator
    print("\n\n### STEP 6: Installing vultr-vm-creator dependencies ###")
    ssh_exec(ssh, 'cd /root/vultr-vm-creator && npm install', timeout=180)

    # Step 7: Check what ports each app uses
    print("\n\n### STEP 7: Checking port configurations ###")
    ssh_exec(ssh, 'grep -rn "PORT\\|listen" /root/claude-launcher-web/server.js | head -10')
    ssh_exec(ssh, 'ls /root/vultr-vm-creator/ && cat /root/vultr-vm-creator/package.json')
    ssh_exec(ssh, 'grep -rn "PORT\\|listen" /root/vultr-vm-creator/*.js 2>/dev/null || grep -rn "PORT\\|listen" /root/vultr-vm-creator/src/*.js 2>/dev/null || echo "checking other files..."')
    ssh_exec(ssh, 'find /root/vultr-vm-creator -name "*.js" -not -path "*/node_modules/*" | head -10')

    # Step 8: Start apps with PM2
    print("\n\n### STEP 8: Starting applications with PM2 ###")
    ssh_exec(ssh, 'cd /root/claude-launcher-web && pm2 start server.js --name claude-launcher-web')
    ssh_exec(ssh, 'cd /root/vultr-vm-creator && pm2 start server.js --name vultr-vm-creator 2>/dev/null || pm2 start index.js --name vultr-vm-creator 2>/dev/null || echo "NEED_TO_CHECK_ENTRY_POINT"')

    # Step 9: Check PM2 status
    print("\n\n### STEP 9: PM2 Status ###")
    time.sleep(3)
    ssh_exec(ssh, 'pm2 status')
    ssh_exec(ssh, 'pm2 logs --lines 15 --nostream')

    # Step 10: Setup PM2 startup
    print("\n\n### STEP 10: PM2 Startup ###")
    ssh_exec(ssh, 'pm2 startup systemd -u root --hp /root')
    ssh_exec(ssh, 'pm2 save')

    # Step 11: Check firewall
    print("\n\n### STEP 11: Firewall check ###")
    ssh_exec(ssh, 'ufw status || echo "ufw not active"')
    ssh_exec(ssh, 'ss -tlnp | grep -E "3000|3001|8080|4000"')

    print("\n\n### DONE! ###")
    ssh.close()

if __name__ == '__main__':
    main()
