@echo off
rem Saca el servicio. Los datos de la app (carpeta datos) no se tocan.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
cd /d "%~dp0"
good-game-api-service.exe stop >nul 2>&1
good-game-api-service.exe uninstall
netsh advfirewall firewall delete rule name="Good Game API" >nul 2>&1
del "%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\StartUp\Good Game API - indicador.lnk" >nul 2>&1
echo Listo: la API ya no arranca con Windows.
pause
