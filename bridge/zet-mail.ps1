<#
    Zet het mail-blok in config.json, op de juiste plek en met de juiste komma's.

    Handmatig plakken gaat mis: het blok hoort binnen de buitenste accolades,
    en JSON vergeeft een vergeten komma niet.

        powershell -ExecutionPolicy Bypass -File .\zet-mail.ps1 `
            -ClientId <toepassings-id> -TenantId <map-id>

    Met -Uit zet je het meelezen weer uit zonder de id's kwijt te raken.
#>
param(
    [string]$ClientId,
    [string]$TenantId,
    [int]$Dagen = 60,
    [int]$MaxBerichten = 15,
    [switch]$Uit
)
$ErrorActionPreference = "Stop"
$pad = Join-Path (Split-Path -Parent $PSCommandPath) "config.json"
if (-not (Test-Path $pad)) { throw "Geen config.json gevonden op $pad." }

$ruw = (Get-Content $pad -Raw) -replace "^﻿", ""
try {
    $config = $ruw | ConvertFrom-Json
} catch {
    Write-Host ""
    Write-Warning "config.json is op dit moment geen geldige JSON."
    Write-Warning "Haal het handmatig geplakte 'mail'-blok er eerst weer uit, zodat het"
    Write-Warning "bestand eindigt op een enkele } , en draai dit script daarna opnieuw."
    throw
}

$bestaand = $config.mail
$mail = [ordered]@{
    aan          = -not $Uit
    clientId     = if ($ClientId) { $ClientId } elseif ($bestaand) { $bestaand.clientId } else { "" }
    tenantId     = if ($TenantId) { $TenantId } elseif ($bestaand) { $bestaand.tenantId } else { "" }
    dagen        = $Dagen
    maxBerichten = $MaxBerichten
}
if (-not $Uit -and (-not $mail.clientId -or -not $mail.tenantId)) {
    throw "Geef -ClientId en -TenantId mee; die vind je in Azure onder je app-registratie -> Overzicht."
}

$config | Add-Member -NotePropertyName mail -NotePropertyValue ([pscustomobject]$mail) -Force

# Zonder BOM wegschrijven: Node struikelt daarover en Windows PowerShell zet er
# er standaard wel een voor.
$json = $config | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($pad, $json, (New-Object Text.UTF8Encoding $false))

Write-Host "config.json bijgewerkt."
Write-Host ("Mail meelezen staat nu {0}." -f $(if ($Uit) { "uit" } else { "aan" }))
if (-not $Uit) {
    Write-Host ""
    Write-Host "Volgende stap:  node koppel-mail.js"
}
