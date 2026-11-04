@echo off
REM Koppelt de bridge aan Claude met een vast token. Zie koppel-claude.ps1.
title Projectdoc-bridge koppelen aan Claude
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0koppel-claude.ps1"
echo.
pause
