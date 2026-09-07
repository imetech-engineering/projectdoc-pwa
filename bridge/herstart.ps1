<#
    Herstart de bridge en zorgt dat er daarna precies één draait.

    Stop-ScheduledTask beëindigt de taak, maar een node-proces dat daaronder
    hangt kan blijven leven. Dan houdt de oude versie de poort bezet en start
    de nieuwe niet — met als gevolg dat een reparatie niet lijkt te werken
    terwijl hij gewoon nog niet draait.

    Draaien:  powershell -ExecutionPolicy Bypass -File .\herstart.ps1
#>
$ErrorActionPreference = "SilentlyContinue"
$naam = "Projectdoc bridge"
$hier = Split-Path -Parent $PSCommandPath

Write-Host "Taak stoppen..."
Stop-ScheduledTask -TaskName $naam

Write-Host "Achtergebleven bridge-processen opruimen..."
$weg = 0
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*projectdoc*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $weg++ }
Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" |
    Where-Object { $_.CommandLine -like "*start-bridge-verborgen*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "$weg proces(sen) afgesloten."

Start-Sleep -Seconds 2
Write-Host "Taak starten..."
Start-ScheduledTask -TaskName $naam
Start-Sleep -Seconds 4

$log = Join-Path $hier "bridge.log"
if (Test-Path $log) {
    Write-Host ""
    Write-Host "--- bridge.log ---"
    Get-Content $log -Tail 10
} else {
    Write-Warning "Geen bridge.log gevonden; draait de taak wel?"
}
