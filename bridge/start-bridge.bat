@echo off
REM Start de bridge en houdt hem draaiend; sluit dit venster om te stoppen.
cd /d "%~dp0"
:lus
node server.js
if errorlevel 3 if not errorlevel 4 (
  echo.
  echo De poort is bezet door een andere bridge. Deze stopt ermee.
  goto einde
)
echo.
echo Bridge gestopt. Opnieuw starten over 5 seconden... (Ctrl+C om te stoppen)
REM ping in plaats van timeout: timeout werkt niet als er geen venster is,
REM en dit script draait ook onbeheerd via de geplande taak.
ping -n 6 127.0.0.1 >nul
goto lus

:einde
