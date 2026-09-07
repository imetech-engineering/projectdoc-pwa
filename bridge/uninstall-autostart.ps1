<# Haalt de automatische start weer weg. #>
$ErrorActionPreference = "Stop"
$naam = "Projectdoc bridge"

if (-not (Get-ScheduledTask -TaskName $naam -ErrorAction SilentlyContinue)) {
    Write-Host "'$naam' bestaat niet; er valt niets weg te halen."
    return
}
Stop-ScheduledTask -TaskName $naam -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $naam -Confirm:$false
Write-Host "'$naam' is verwijderd. De bridge start niet meer automatisch."
