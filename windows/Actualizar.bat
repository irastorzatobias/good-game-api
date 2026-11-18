@echo off
rem Actualiza la API a la ultima version publicada. Pide permiso de administrador.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1"
echo.
pause
