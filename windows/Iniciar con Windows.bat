@echo off
rem Deja la API corriendo siempre, como servicio de Windows. Pide permiso de administrador.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
cd /d "%~dp0"
if not exist config.json (
  echo Primero abri good-game-api.exe con doble clic y elegi la carpeta del sistema.
  pause & exit /b 1
)
good-game-api-service.exe stop >nul 2>&1
good-game-api-service.exe uninstall >nul 2>&1
good-game-api-service.exe install || (pause & exit /b 1)
good-game-api-service.exe start || (pause & exit /b 1)
netsh advfirewall firewall delete rule name="Good Game API" >nul 2>&1
netsh advfirewall firewall add rule name="Good Game API" dir=in action=allow program="%~dp0good-game-api.exe" enable=yes >nul
rem Acceso directo en el escritorio (de todos los usuarios): abre el tablero de estado.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('CommonDesktopDirectory')+'\Estado Good Game API.lnk'); $s.TargetPath='%~dp0good-game-api.exe'; $s.WorkingDirectory='%~dp0'; $s.Save()"
rem Indicador en la bandeja: arranca al iniciar sesion (cualquier usuario) y se abre ya.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('CommonStartup')+'\Good Game API - indicador.lnk'); $s.TargetPath='%~dp0Indicador.vbs'; $s.WorkingDirectory='%~dp0'; $s.Save()"
start "" wscript.exe "%~dp0Indicador.vbs"
echo.
echo Listo: la API queda corriendo y arranca sola con Windows.
echo Al lado del reloj queda un punto: verde si todo anda, rojo si no. Doble clic para ver el detalle.
echo En el escritorio quedo "Estado Good Game API" con el detalle.
echo Si algo falla, el registro esta en good-game-api-service.out.log y .err.log
pause
