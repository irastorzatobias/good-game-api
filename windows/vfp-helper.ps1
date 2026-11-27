# Ayudante de good-game-api para escribir en el sistema con el driver oficial de Visual FoxPro (VFPOLEDB).
# El driver es de 32 bits, por eso la API (64 bits) lo usa a través de este script, que corre en el PowerShell de
# 32 bits (C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe). Lo lanza la API; no hace falta abrirlo a mano.
#
# Protocolo: una línea JSON por pedido en la entrada y una por respuesta en la salida.
#   {"id":1,"carpeta":"C:\\Compartir\\Sistema","script":"..."}   ejecuta el script con EXECSCRIPT
#   {"id":2,"carpeta":"C:\\Compartir\\Sistema","probar":true}     comprueba 32 bits, driver y carpeta
# Respuesta: {"id":1,"ok":true,"valor":"..."} (lo que devuelve el script con RETURN) o {"id":1,"ok":false,"error":"..."}.

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Responder($r) {
  [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Conectar([string]$carpeta) {
  if (-not (Test-Path -LiteralPath $carpeta -PathType Container)) { throw "No existe la carpeta $carpeta" }
  $cn = New-Object System.Data.OleDb.OleDbConnection("Provider=VFPOLEDB.1;Data Source=$carpeta;Collating Sequence=machine;")
  try { $cn.Open() } catch {
    if ($_.Exception.Message -match 'not registered|no está registrado') {
      throw 'Falta instalar el driver VFPOLEDB (Microsoft OLE DB Provider for Visual FoxPro 9.0).'
    }
    throw
  }
  return $cn
}

while ($null -ne ($linea = [Console]::In.ReadLine())) {
  if (-not $linea.Trim()) { continue }
  $id = $null
  try {
    $p = $linea | ConvertFrom-Json
    $id = $p.id
    if ([IntPtr]::Size -ne 4) { throw 'El ayudante tiene que correr en el PowerShell de 32 bits (SysWOW64).' }
    $cn = Conectar ([string]$p.carpeta)
    $valor = $null
    try {
      if (-not $p.probar) {
        $cmd = $cn.CreateCommand()
        $cmd.CommandText = 'EXECSCRIPT(?)'
        [void]$cmd.Parameters.AddWithValue('script', [string]$p.script)
        $valor = $cmd.ExecuteScalar()
      }
    } finally { $cn.Close() } # cerrar la conexión libera bloqueos y tablas aunque el script haya fallado a mitad
    Responder @{ id = $id; ok = $true; valor = [string]$valor }
  } catch {
    Responder @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
