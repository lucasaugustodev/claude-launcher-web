# HiveClip VM Provisioner - Run this directly on the target VM via RDP
# Installs: Node.js, Git, TightVNC, Claude Launcher Web, all CLIs

$ErrorActionPreference = "Continue"
Write-Host "=== HiveClip VM Provisioner ===" -ForegroundColor Cyan

# --- Step 1: Install Node.js ---
Write-Host "`n=== Step 1: Node.js ===" -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "Node.js already installed: $(node --version)" -ForegroundColor Green
} else {
    Write-Host "Downloading Node.js..."
    curl.exe -L -o "$env:TEMP\node-setup.msi" "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi" --connect-timeout 15 --max-time 300
    Write-Host "Installing Node.js..."
    Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\node-setup.msi`" /quiet /norestart" -Wait
    # Refresh PATH
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Node.js installed: $(node --version)" -ForegroundColor Green
}

# --- Step 2: Install Git ---
Write-Host "`n=== Step 2: Git ===" -ForegroundColor Yellow
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "Git already installed: $(git --version)" -ForegroundColor Green
} else {
    Write-Host "Downloading Git..."
    curl.exe -L -o "$env:TEMP\git-setup.exe" "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe" --connect-timeout 15 --max-time 300
    Write-Host "Installing Git..."
    Start-Process "$env:TEMP\git-setup.exe" -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS" -Wait
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Git installed: $(git --version)" -ForegroundColor Green
}

# --- Step 3: Install TightVNC ---
Write-Host "`n=== Step 3: TightVNC ===" -ForegroundColor Yellow
$vncService = Get-Service tvnserver -ErrorAction SilentlyContinue
if ($vncService -and $vncService.Status -eq "Running") {
    Write-Host "TightVNC already running" -ForegroundColor Green
} else {
    Write-Host "Downloading TightVNC..."
    curl.exe -L -o "$env:TEMP\tightvnc.msi" "https://www.tightvnc.com/download/2.8.84/tightvnc-2.8.84-gpl-setup-64bit.msi" --connect-timeout 15 --max-time 180
    Write-Host "Installing TightVNC..."
    Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\tightvnc.msi`" /quiet /norestart ADDLOCAL=Server SET_USEVNCAUTHENTICATION=1 VALUE_OF_USEVNCAUTHENTICATION=1 SET_PASSWORD=1 VALUE_OF_PASSWORD=hiveclip123 SET_USECONTROLAUTHENTICATION=1 VALUE_OF_USECONTROLAUTHENTICATION=1 SET_CONTROLPASSWORD=1 VALUE_OF_CONTROLPASSWORD=hiveclip123" -Wait
    Start-Sleep -Seconds 3
    netsh advfirewall firewall add rule name=VNC-5900 dir=in action=allow protocol=TCP localport=5900
    net start tvnserver
    Write-Host "TightVNC installed and running" -ForegroundColor Green
}

# --- Step 4: Clone claude-launcher-web ---
Write-Host "`n=== Step 4: Claude Launcher Web ===" -ForegroundColor Yellow
if (Test-Path "C:\claude-launcher-web\server.js") {
    Write-Host "Already installed, pulling latest..."
    Set-Location C:\claude-launcher-web
    git pull
} else {
    Write-Host "Cloning claude-launcher-web..."
    git clone https://github.com/lucasaugustodev/claude-launcher-web.git C:\claude-launcher-web
    Set-Location C:\claude-launcher-web
    Write-Host "Installing npm dependencies..."
    npm install --production
}

# --- Step 5: Install Dev CLIs ---
Write-Host "`n=== Step 5: Dev CLIs ===" -ForegroundColor Yellow

# Refresh PATH
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
$npmGlobal = "$env:APPDATA\npm"
if ($env:Path -notlike "*$npmGlobal*") { $env:Path += ";$npmGlobal" }

# npm global packages
$packages = @(
    "@anthropic-ai/claude-code",
    "@google/gemini-cli",
    "cline",
    "@googleworkspace/cli",
    "playwright"
)

Write-Host "Installing npm global packages (batch)..."
$pkgList = $packages -join " "
npm install -g $pkgList
Write-Host "npm packages installed" -ForegroundColor Green

# GitHub CLI (MSI)
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Installing GitHub CLI..."
    curl.exe -L -o "$env:TEMP\gh-setup.msi" "https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_windows_amd64.msi" --connect-timeout 15 --max-time 180
    Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\gh-setup.msi`" /quiet /norestart" -Wait
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "GitHub CLI installed" -ForegroundColor Green
} else {
    Write-Host "GitHub CLI already installed: $(gh --version | Select-Object -First 1)" -ForegroundColor Green
}

# Playwright browsers
Write-Host "Installing Playwright chromium..."
npx playwright install chromium

# --- Step 6: Update system PATH ---
Write-Host "`n=== Step 6: PATH ===" -ForegroundColor Yellow
$machinePath = [Environment]::GetEnvironmentVariable("Path","Machine")
$extraPaths = @(
    "C:\Program Files\nodejs",
    "C:\Program Files\Git\cmd",
    "C:\Program Files\GitHub CLI",
    "$env:APPDATA\npm"
)
foreach ($p in $extraPaths) {
    if ($machinePath -notlike "*$p*") {
        $machinePath = $machinePath.TrimEnd(";") + ";" + $p
        Write-Host "  Added: $p"
    }
}
[Environment]::SetEnvironmentVariable("Path", $machinePath, "Machine")

# --- Step 7: Firewall ---
Write-Host "`n=== Step 7: Firewall ===" -ForegroundColor Yellow
netsh advfirewall firewall add rule name="ClaudeLauncher-3001" dir=in action=allow protocol=TCP localport=3001

# --- Step 8: Create start.bat and scheduled task ---
Write-Host "`n=== Step 8: Auto-start ===" -ForegroundColor Yellow
$fullPath = [Environment]::GetEnvironmentVariable("Path","Machine")
$batContent = "@echo off`nset PATH=$fullPath;%PATH%`nset PORT=3001`ncd /d C:\claude-launcher-web`nnode server.js"
Set-Content -Path "C:\claude-launcher-web\start.bat" -Value $batContent -Encoding ASCII

schtasks /delete /tn "ClaudeLauncherWeb" /f 2>$null
schtasks /create /tn "ClaudeLauncherWeb" /tr "cmd /c C:\claude-launcher-web\start.bat" /sc onstart /ru SYSTEM /rl HIGHEST /f

# --- Step 9: Start launcher ---
Write-Host "`n=== Step 9: Start ===" -ForegroundColor Yellow
taskkill /f /im node.exe 2>$null
Start-Sleep -Seconds 2
schtasks /run /tn "ClaudeLauncherWeb"
Start-Sleep -Seconds 5

$test = Test-NetConnection -ComputerName localhost -Port 3001
Write-Host "Port 3001 listening: $($test.TcpTestSucceeded)" -ForegroundColor $(if ($test.TcpTestSucceeded) {"Green"} else {"Red"})

# --- Verify ---
Write-Host "`n=== Verification ===" -ForegroundColor Cyan
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\npm"
Write-Host "Node.js: $(node --version 2>&1)"
Write-Host "Git: $(git --version 2>&1)"
Write-Host "Claude Code: $(claude --version 2>&1)"
Write-Host "GitHub CLI: $(gh --version 2>&1 | Select-Object -First 1)"
Write-Host "Gemini: $(gemini --version 2>&1)"
Write-Host "Cline: $(cline --version 2>&1)"

Write-Host "`n=== DONE ===" -ForegroundColor Green
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
Write-Host "VNC:      ${ip}:5900 (pass: hiveclip123)"
Write-Host "Launcher: http://${ip}:3001"
Write-Host "CLIs:     claude, gh, gemini, cline, gws, playwright"
