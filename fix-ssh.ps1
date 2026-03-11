# Fix SSH for Administrator access on Windows Server 2022
$ErrorActionPreference = "Stop"

Write-Host "=== Fixing SSH for Administrator ===" -ForegroundColor Cyan

# Ensure OpenSSH Server is installed
$cap = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
if ($cap.State -ne 'Installed') {
    Write-Host "Installing OpenSSH Server..."
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
}

# Stop sshd
Stop-Service sshd -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Rewrite sshd_config from scratch with permissive settings
$cfg = "C:\ProgramData\ssh\sshd_config"
$content = @"
# HiveClip SSH Config
Port 22
PasswordAuthentication yes
PubkeyAuthentication yes
PermitRootLogin yes
AllowUsers Administrator
Subsystem sftp sftp-server.exe
"@

Set-Content -Path $cfg -Value $content -Force -Encoding ASCII
Write-Host "Wrote clean sshd_config" -ForegroundColor Green

# Delete the administrators_authorized_keys file that overrides config
$adminKeys = "C:\ProgramData\ssh\administrators_authorized_keys"
if (Test-Path $adminKeys) {
    Remove-Item $adminKeys -Force
    Write-Host "Removed administrators_authorized_keys" -ForegroundColor Green
}

# Set proper permissions on sshd_config
icacls $cfg /inheritance:r /grant "SYSTEM:(F)" /grant "Administrators:(F)" | Out-Null

# Firewall
netsh advfirewall firewall add rule name="SSH-22" dir=in action=allow protocol=TCP localport=22 2>$null

# Restart
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

Write-Host "SSH service restarted" -ForegroundColor Green
Write-Host "Testing local connection..."

# Quick test
$test = Test-NetConnection -ComputerName localhost -Port 22
Write-Host "Port 22 open: $($test.TcpTestSucceeded)" -ForegroundColor $(if($test.TcpTestSucceeded){"Green"}else{"Red"})

# Also reset Administrator password to make sure it matches
Write-Host "`nResetting Administrator password to ensure it matches..."
net user Administrator hZJK5I8Dtm0RhIzT

Write-Host "`n=== SSH Fix Complete ===" -ForegroundColor Green
Write-Host "Test with: ssh Administrator@$((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress)"
