<#
    Koppelt de bridge aan Claude met een vast token (claude setup-token, een
    jaar geldig). Starten met een dubbelklik op Koppel-Claude.cmd.

    Het token komt via het klembord binnen: plakken in een invoerregel gaat mis
    zodra het over twee regels is afgebroken. Het wordt eerst getest, dan pas
    opgeslagen, en komt nooit in het logbestand.

    Dit bestand blijft bewust puur ASCII: Windows PowerShell leest een script
    zonder BOM niet als UTF-8.
#>
$hier     = Split-Path -Parent $PSCommandPath
$map      = Join-Path $env:LOCALAPPDATA "projectdoc-bridge"
$tokenPad = Join-Path $map "claude-token.txt"
$logPad   = Join-Path $map "koppel.log"
$wachtMin = 15

New-Item -ItemType Directory -Force -Path $map | Out-Null
Add-Type -AssemblyName System.Windows.Forms

function Log([string]$regel, [string]$kleur = "Gray") {
    Write-Host $regel -ForegroundColor $kleur
    Add-Content -Path $logPad -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $regel)
}

function Stop-Koppelen([bool]$gelukt, [string]$tekst) {
    Write-Host ""
    if ($gelukt) {
        Log "GELUKT: $tekst" "Green"
    } else {
        Log "MISLUKT: $tekst" "Red"
        Write-Host "Verslag: $logPad"
    }
    exit $(if ($gelukt) { 0 } else { 1 })
}

function Lees-Klembord {
    try { return [System.Windows.Forms.Clipboard]::GetText() } catch { return "" }
}

function Leeg-Klembord {
    try { [System.Windows.Forms.Clipboard]::Clear() } catch { }
}

# Afgebroken over twee regels? Dan eerst proberen zoals het er staat, daarna aan elkaar.
function Vind-Tokens([string]$tekst) {
    $patroon = "sk-ant-oat[0-9A-Za-z_\-]{20,}"
    $gevonden = @()
    if ($tekst -match $patroon) { $gevonden += $Matches[0] }
    $aaneen = $tekst -replace "[\s|\u2502]", ""
    if ($aaneen -match $patroon) { $gevonden += $Matches[0] }
    return @($gevonden | Select-Object -Unique)
}

function Test-Token([string]$token) {
    $env:CLAUDE_CODE_OAUTH_TOKEN = $token
    $uit = "Antwoord met alleen het woord OK." |
        & $claude -p --model haiku --no-session-persistence --output-format text 2>$null
    $code = $LASTEXITCODE
    Remove-Item Env:\CLAUDE_CODE_OAUTH_TOKEN -ErrorAction SilentlyContinue
    return ($code -eq 0) -and (($uit -join " ") -match "OK")
}

Log "Koppelen gestart op $env:COMPUTERNAME" "Cyan"

# --- Claude Code zoeken -------------------------------------------------------
$configPad = Join-Path $hier "config.json"
if (-not (Test-Path $configPad)) { Stop-Koppelen $false "geen config.json in $hier" }
$config = (Get-Content $configPad -Raw) -replace "^\xEF\xBB\xBF", "" | ConvertFrom-Json
$poort = if ($config.poort) { $config.poort } else { 8787 }

$claude = $null
if ($config.claudeCommando -and $config.claudeCommando -ne "claude" -and (Test-Path $config.claudeCommando)) {
    $claude = $config.claudeCommando
}
if (-not $claude) {
    $claude = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty Source
}
if (-not $claude) {
    $claude = @(
        (Join-Path $env:USERPROFILE ".local\bin\claude.exe"),
        (Join-Path $env:APPDATA "npm\claude.cmd")
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $claude) { Stop-Koppelen $false "Claude Code niet gevonden op deze pc" }
Log "Claude Code: $claude"
Set-Location $map

# --- Token aanmaken -----------------------------------------------------------
Leeg-Klembord
$binnen = '/k "mode con: cols=170 lines=40 & "' + $claude + '" setup-token"'
$venster = Start-Process -FilePath "cmd.exe" -ArgumentList $binnen -PassThru

Write-Host ""
Write-Host "Er opent nu een tweede venster en je browser." -ForegroundColor White
Write-Host "  1. Keur de login goed in de browser." -ForegroundColor White
Write-Host "  2. Selecteer in het tweede venster het token (begint met sk-ant-oat)" -ForegroundColor White
Write-Host "     en kopieer het: slepen met de muis en dan Enter of Ctrl+C." -ForegroundColor White
Write-Host "De rest gaat vanzelf. Ik wacht maximaal $wachtMin minuten." -ForegroundColor White
Write-Host ""

$token = $null
$vorige = ""
$einde = (Get-Date).AddMinutes($wachtMin)
while (-not $token -and (Get-Date) -lt $einde) {
    Start-Sleep -Milliseconds 700
    $tekst = Lees-Klembord
    if (-not $tekst -or $tekst -eq $vorige) { continue }
    $vorige = $tekst
    $kandidaten = Vind-Tokens $tekst
    if ($kandidaten.Count -eq 0) { continue }
    Log "Token gevonden op het klembord, ik test het..."
    foreach ($k in $kandidaten) {
        if (Test-Token $k) { $token = $k; break }
    }
    if (-not $token) {
        Log "Dit token doet het niet. Kopieer het nog eens, precies van begin tot eind." "Yellow"
    }
}

Leeg-Klembord
Stop-Process -Id $venster.Id -Force -ErrorAction SilentlyContinue
if (-not $token) { Stop-Koppelen $false "geen werkend token ontvangen binnen $wachtMin minuten" }

# --- Opslaan en de bridge laten overnemen -------------------------------------
[System.IO.File]::WriteAllText($tokenPad, $token)
Log "Token werkt en is opgeslagen in $tokenPad" "Green"

Log "Bridge herstarten..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $hier "herstart.ps1")

Log "Controleren of de bridge Claude bereikt (dit kan een halve minuut duren)..."
try {
    $test = Invoke-RestMethod "http://127.0.0.1:$poort/api/zelftest" `
        -Headers @{ Authorization = "Bearer $($config.token)" } -TimeoutSec 180
} catch {
    Stop-Koppelen $false "de bridge antwoordt niet: $($_.Exception.Message)"
}
if (-not $test.ok) { Stop-Koppelen $false "de bridge meldt: $($test.melding)" }
Stop-Koppelen $true "de bridge draait op het vaste token. Dit is een jaar geldig; daarna dubbelklik je dit bestand opnieuw."
