# Indicador en la bandeja (al lado del reloj): verde si la app de los clientes anda, amarillo si la API anda pero
# no se llega desde internet (tunel), rojo si la API no responde. Avisa con una notificacion cuando cambia.
# Lo abre "Indicador.vbs" al iniciar sesion (sin ventanas). Solo ASCII: PowerShell 5 lee el archivo como ANSI.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Set-Location $PSScriptRoot

# Una sola instancia por sesion.
$mutex = New-Object System.Threading.Mutex($false, 'GoodGameApiIndicador')
if (-not $mutex.WaitOne(0)) { exit }

$puerto = 8787
$publica = 'https://gg-api.hiburger.club'
if (Test-Path 'config.json') {
  $cfg = Get-Content 'config.json' -Raw | ConvertFrom-Json
  if ($cfg.puerto) { $puerto = $cfg.puerto }
  if ($cfg.PSObject.Properties.Name -contains 'urlPublica') { $publica = $cfg.urlPublica }
}

function Icono($r, $g, $b) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.SmoothingMode = 'AntiAlias'
  $gr.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($r, $g, $b))), 1, 1, 14, 14)
  $gr.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$iconos = @{ ok = (Icono 34 197 94); tunel = (Icono 234 179 8); caida = (Icono 220 38 38); revisando = (Icono 148 163 184) }

$bandeja = New-Object System.Windows.Forms.NotifyIcon
$bandeja.Icon = $iconos.revisando
$bandeja.Text = 'Good Game API: revisando...'
$bandeja.Visible = $true

function VerEstado { Start-Process (Join-Path $PSScriptRoot 'good-game-api.exe') -ArgumentList 'estado' -WorkingDirectory $PSScriptRoot }
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('Ver estado', $null, { VerEstado })
[void]$menu.Items.Add('Reiniciar API y tunel', $null, {
  Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', 'Restart-Service good-game-api -Force; Restart-Service Cloudflared -Force'
})
[void]$menu.Items.Add('Cerrar indicador', $null, { $bandeja.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$bandeja.ContextMenuStrip = $menu
$bandeja.add_DoubleClick({ VerEstado })

function Responde($url) {
  try { (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200 } catch { $false }
}

$script:anterior = $null
function Revisar {
  $local = Responde "http://localhost:$puerto"
  $internet = if ($publica) { Responde $publica } else { $true }
  $estado = if ($local -and $internet) { 'ok' } elseif ($local) { 'tunel' } else { 'caida' }
  $texto = @{
    ok    = 'Funcionando: la app de los clientes anda'
    tunel = 'La API anda, pero no se llega desde internet'
    caida = 'La API no responde: la app no anda'
  }[$estado]
  $bandeja.Icon = $iconos[$estado]
  $bandeja.Text = "Good Game API`n$texto"  # maximo 63 caracteres
  if ($script:anterior -and $script:anterior -ne $estado) {
    $tipo = if ($estado -eq 'ok') { 'Info' } else { 'Error' }
    $bandeja.ShowBalloonTip(8000, 'Good Game API', $texto, $tipo)
  }
  $script:anterior = $estado
}

$reloj = New-Object System.Windows.Forms.Timer
$reloj.Interval = 30000
$reloj.add_Tick({ Revisar })
$reloj.Start()
Revisar
[System.Windows.Forms.Application]::Run()
