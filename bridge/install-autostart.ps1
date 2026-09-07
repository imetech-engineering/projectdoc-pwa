<#
    Zorgt dat de bridge automatisch meestart zodra je op deze pc inlogt, en
    blijft draaien zonder venster. Beheerdersrechten zijn niet nodig: de taak
    draait onder je eigen account.

    Waarom bij het inloggen en niet bij het opstarten: Claude Code gebruikt de
    inloggegevens uit jouw gebruikersprofiel. Zonder aangemeld account kan hij
    daar niet bij. Start je pc automatisch op en logt hij vanzelf in, dan komt
    dat op hetzelfde neer.

    Draaien:   .\install-autostart.ps1
    Weghalen:  .\uninstall-autostart.ps1
#>
$ErrorActionPreference = "Stop"
$hier = Split-Path -Parent $PSCommandPath
$naam = "Projectdoc bridge"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js niet gevonden. Installeer Node 18 of nieuwer en probeer opnieuw."
}
if (-not (Test-Path (Join-Path $hier "config.json"))) {
    throw "Geen config.json in $hier. Maak die eerst aan (zie README) en draai dit script daarna opnieuw."
}

$actie = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument ('"{0}\start-bridge-verborgen.vbs"' -f $hier) `
    -WorkingDirectory $hier

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$instellingen = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $naam -Action $actie -Trigger $trigger `
    -Settings $instellingen -Force `
    -Description "Projectdocumentatie-bridge: verbindt de telefoon-app met Claude Code en de projectmappen." | Out-Null

Start-ScheduledTask -TaskName $naam

Write-Host ""
Write-Host "Klaar. '$naam' start voortaan mee zodra je inlogt, en draait nu al."
Write-Host "Logboek:  $hier\bridge.log"
Write-Host "Stoppen:  Stop-ScheduledTask -TaskName '$naam'"
Write-Host "Weghalen: .\uninstall-autostart.ps1"
Write-Host ""
Write-Host "Had je de bridge al handmatig draaien? Sluit dat venster, anders is"
Write-Host "de poort bezet en komt de geplande taak niet omhoog."
