<#
    Herstart de bridge en controleert daarna of de nieuwe versie echt draait.

    Stop-ScheduledTask beëindigt de taak, maar node-processen die daaronder
    hangen kunnen blijven leven. Die houden dan de poort bezet, waardoor de
    nieuwe versie niet start en de oude blijft antwoorden — een reparatie lijkt
    dan niet te werken terwijl hij nog niet eens draait.

    Daarom sluiten we af op poort, niet op procesnaam: wat de poort vasthoudt,
    is per definitie de bridge die weg moet.

    Draaien:  powershell -ExecutionPolicy Bypass -File .\herstart.ps1
#>
$hier = Split-Path -Parent $PSCommandPath
$naam = "Projectdoc bridge"

$configPad = Join-Path $hier "config.json"
if (-not (Test-Path $configPad)) { throw "Geen config.json in $hier." }
$config = (Get-Content $configPad -Raw) -replace "^\xEF\xBB\xBF", "" | ConvertFrom-Json
$poort = if ($config.poort) { $config.poort } else { 8787 }

Write-Host "Taak stoppen..."
Stop-ScheduledTask -TaskName $naam -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "Alles afsluiten dat poort $poort vasthoudt..."
$weg = 0
Get-NetTCPConnection -LocalPort $poort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        $weg++
    }
Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*start-bridge-verborgen*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "$weg proces(sen) op poort $poort afgesloten."

Start-Sleep -Seconds 2
Write-Host "Taak starten..."
Start-ScheduledTask -TaskName $naam
Start-Sleep -Seconds 5

$log = Join-Path $hier "bridge.log"
if (Test-Path $log) {
    Write-Host ""
    Write-Host "--- start van bridge.log ---"
    Get-Content $log -TotalCount 8
}

Write-Host ""
Write-Host "--- controle ---"
try {
    $status = Invoke-RestMethod "http://127.0.0.1:$poort/api/status" `
        -Headers @{ Authorization = "Bearer $($config.token)" } -TimeoutSec 10
    Write-Host "Bridge $($status.versie) draait. $($status.aantalProjecten) projecten, model $($status.model)."
} catch {
    Write-Warning "De bridge antwoordt niet op poort $poort. Kijk in $log."
}
