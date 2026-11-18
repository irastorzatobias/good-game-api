// Interacción con quien abre el .exe con doble clic en Windows: elegir la carpeta y leer los errores antes de que se cierre la ventana.
import { execFileSync } from 'node:child_process'

export const esWindows = process.platform === 'win32'

/** Ventana estándar de Windows para elegir una carpeta. null si la cancelan. */
export function elegirCarpeta(descripcion: string): string | null {
  const ps = `
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = '${descripcion.replaceAll("'", "''")}'
    $d.ShowNewFolderButton = $false
    if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`
  const r = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' }).trim()
  return r || null
}

/** Con doble clic la consola se cierra al terminar: se espera un Enter para que se pueda leer el mensaje. */
export function esperarEnter() {
  if (!esWindows || !process.stdin.isTTY) return
  process.stdout.write('\nApretá Enter para cerrar.')
  try {
    execFileSync('cmd.exe', ['/c', 'pause >nul'], { stdio: 'inherit' })
  } catch {}
}
