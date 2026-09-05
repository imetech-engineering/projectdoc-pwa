@echo off
REM Start de bridge en houdt hem draaiend; sluit dit venster om te stoppen.
cd /d "%~dp0"
:lus
node server.js
echo.
echo Bridge gestopt. Opnieuw starten over 5 seconden... (Ctrl+C om te stoppen)
timeout /t 5 /nobreak >nul
goto lus
