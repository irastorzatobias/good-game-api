# Actualiza la API a la ultima version publicada en GitHub (repo publico, sin cuenta).
# Reemplaza solo los programas; config.json, contenido.json y la carpeta datos no se tocan.
# Lo llama "Actualizar.bat" con permisos de administrador.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location $PSScriptRoot

$repo = 'irastorzatobias/good-game-api'
$servicio = 'good-game-api'
# Se copia todo lo del paquete menos lo que es del local: contenido.json (solo si falta), config.json y datos.
$delLocal = @('contenido.json', 'config.json')
# Si falta alguno (instalacion de una version que no los copiaba), se reinstala aunque la version sea la misma.
$esperados = @('good-game-api.exe', 'indicador.ps1', 'Indicador.vbs')

function Paso($texto) { Write-Host "`n> $texto" -ForegroundColor Cyan }
function Arrancar($comoServicio) {
  if ($comoServicio) { Start-Service $servicio } else { Start-Process (Join-Path $PSScriptRoot 'good-game-api.exe') -WorkingDirectory $PSScriptRoot }
}
$parada = $false

try {
  Paso 'Buscando la ultima version'
  # Sin entrada (no espera un Enter); una version que no conoce el comando cuenta como vieja.
  $actual = ('' | & .\good-game-api.exe version 2>$null | Select-Object -First 1)
  if ($actual -notmatch '^\d+\.\d+\.\d+$') { $actual = '0.0.0' }
  $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'good-game-api' }
  $nueva = $release.tag_name.TrimStart('v')
  Write-Host "Instalada: $actual   Ultima: $nueva"
  $faltan = @($esperados | Where-Object { -not (Test-Path $_) })
  if ([version]$nueva -le [version]$actual -and -not $faltan) {
    Write-Host "`nYa esta actualizada." -ForegroundColor Green
    return
  }

  Paso "Bajando la version $nueva"
  $zip = $release.assets | Where-Object { $_.name -like '*win-x64.zip' } | Select-Object -First 1
  if (-not $zip) { throw "La version $nueva no tiene el paquete para Windows." }
  $tmp = Join-Path $env:TEMP "good-game-api-$nueva"
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item $tmp -ItemType Directory | Out-Null
  Invoke-WebRequest $zip.browser_download_url -OutFile "$tmp\paquete.zip" -UseBasicParsing
  Expand-Archive "$tmp\paquete.zip" $tmp
  $origen = Get-ChildItem $tmp -Directory | Select-Object -First 1

  # La API puede estar como servicio o abierta en una ventana.
  $comoServicio = [bool](Get-Service $servicio -ErrorAction SilentlyContinue)
  Paso 'Parando la API'
  if ($comoServicio) { Stop-Service $servicio }
  Get-Process good-game-api -ErrorAction SilentlyContinue | Stop-Process -Force
  $parada = $true
  Start-Sleep -Seconds 2

  Paso 'Reemplazando los programas'
  Get-ChildItem $origen.FullName -File | Where-Object { $delLocal -notcontains $_.Name } | Copy-Item -Destination $PSScriptRoot -Force
  if (-not (Test-Path 'contenido.json')) { Copy-Item (Join-Path $origen.FullName 'contenido.json') $PSScriptRoot }
  Get-ChildItem $PSScriptRoot -File | Unblock-File
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

  Paso 'Arrancando la API'
  Arrancar $comoServicio
  $parada = $false

  # Confirma que responde, y con la version nueva.
  $puerto = 8787
  if (Test-Path 'config.json') { $c = Get-Content 'config.json' -Raw | ConvertFrom-Json; if ($c.puerto) { $puerto = $c.puerto } }
  $salud = $null
  foreach ($i in 1..15) {
    Start-Sleep -Seconds 2
    try { $salud = Invoke-RestMethod "http://localhost:$puerto/health"; break } catch {}
  }
  if (-not $salud) { throw "La API no responde en el puerto $puerto. Mira good-game-api-service.err.log" }
  Write-Host "`nListo: la API $($salud.version) esta funcionando." -ForegroundColor Green
} catch {
  Write-Host "`nNo se pudo actualizar: $($_.Exception.Message)" -ForegroundColor Red
  # Que no quede caida: se vuelve a arrancar con lo que haya quedado instalado.
  if ($parada) { try { Arrancar $comoServicio; Write-Host 'Se volvio a arrancar la API.' } catch { Write-Host 'Arranca la API a mano (good-game-api.exe).' } }
}
