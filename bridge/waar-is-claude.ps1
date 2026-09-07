<#
    Laat zien hoe Claude Code op deze pc geinstalleerd is.

    De bridge start hem het liefst rechtstreeks met node; lukt dat niet, dan
    via de opdrachtprompt, en dat is de route waar een JSON-schema onderweg
    kan sneuvelen. Dit script laat zien waarom die keuze uitvalt zoals hij
    uitvalt.

        powershell -ExecutionPolicy Bypass -File .\waar-is-claude.ps1
#>
Write-Host "--- wat vindt Windows zelf? ---"
Get-Command claude -All -ErrorAction SilentlyContinue |
    Select-Object -Property CommandType, Name, Source | Format-Table -AutoSize

$npm = Join-Path $env:APPDATA "npm"
Write-Host "--- bestanden in $npm die op claude lijken ---"
Get-ChildItem $npm -Filter "claude*" -ErrorAction SilentlyContinue |
    Select-Object Name, Length | Format-Table -AutoSize

$shim = Join-Path $npm "claude.CMD"
if (Test-Path $shim) {
    Write-Host "--- inhoud van claude.CMD ---"
    Get-Content $shim
}

Write-Host ""
Write-Host "--- staat er een js- of exe-bestand van het pakket? ---"
foreach ($p in @(
    (Join-Path $npm "node_modules\@anthropic-ai\claude-code\cli.js"),
    (Join-Path $npm "node_modules\@anthropic-ai\claude-code\claude.exe"),
    (Join-Path $env:USERPROFILE ".local\bin\claude.exe")
)) {
    Write-Host ("{0,-6} {1}" -f $(if (Test-Path $p) { "ja" } else { "nee" }), $p)
}
Get-ChildItem (Join-Path $npm "node_modules\@anthropic-ai\claude-code") -ErrorAction SilentlyContinue |
    Select-Object Name, Length | Format-Table -AutoSize
