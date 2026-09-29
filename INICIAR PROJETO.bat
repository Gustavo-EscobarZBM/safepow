@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0Iniciar-SAFEPOW.ps1" (
    echo Extraia tambem o arquivo Iniciar-SAFEPOW.ps1 na mesma pasta deste BAT.
    pause
    exit /b 1
)
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Iniciar-SAFEPOW.ps1"
if errorlevel 1 pause
endlocal
