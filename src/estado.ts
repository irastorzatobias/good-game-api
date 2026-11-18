// Tablero de estado para quien abre good-game-api.exe en el servidor mientras la API corre como servicio:
// muestra de un vistazo si todo anda (servicio, API, túnel, acceso desde internet, copias) y permite reiniciar.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AppStore } from './app/store.ts'
import { raiz, type Config } from './config.ts'
import { VERSION } from './version.ts'
import { esWindows } from './windows.ts'

export const SERVICIO_API = 'good-game-api'
const SERVICIO_TUNEL = 'Cloudflared'
const CADA_MS = 15_000

type Servicio = { instalado: boolean; corriendo: boolean; automatico: boolean }

/** Estado de un servicio de Windows según `sc`. */
export function servicio(nombre: string): Servicio {
  const sc = (...a: string[]) => {
    try {
      return execFileSync('sc.exe', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return '' // no instalado (1060)
    }
  }
  const q = sc('query', nombre)
  if (!q) return { instalado: false, corriendo: false, automatico: false }
  return { instalado: true, corriendo: /RUNNING/.test(q), automatico: /AUTO_START/.test(sc('qc', nombre)) }
}

async function salud(url: string) {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) })
    const j = (await r.json()) as { version?: string }
    return r.ok ? { ok: true, detalle: `responde · versión ${j.version ?? '?'}` } : { ok: false, detalle: `respondió ${r.status}` }
  } catch (e) {
    return { ok: false, detalle: `no responde (${(e as Error).name === 'TimeoutError' ? 'tardó demasiado' : 'sin conexión'})` }
  }
}

const hace = (ms: number) => {
  const min = Math.round(ms / 60000)
  return min < 60 ? `hace ${min} min` : min < 2880 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`
}

function ultimaCopia(carpeta: string) {
  if (!existsSync(carpeta)) return null
  const f = readdirSync(carpeta).filter((x) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(x)).sort().pop()
  return f ? { archivo: f, edad: Date.now() - statSync(join(carpeta, f)).mtimeMs } : null
}

/** Últimos errores del registro del servicio, si los hay. */
function ultimosErrores(n = 4) {
  const log = join(raiz, `${SERVICIO_API}-service.err.log`)
  if (!existsSync(log)) return null
  const lineas = readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings/.test(l))
  return lineas.length ? { lineas: lineas.slice(-n), cuando: statSync(log).mtimeMs } : null
}

const c = { ok: '\x1b[32m', mal: '\x1b[31m', aviso: '\x1b[33m', gris: '\x1b[90m', neg: '\x1b[1m', fin: '\x1b[0m' }
const linea = (ok: boolean | null, titulo: string, detalle: string) =>
  `  ${ok === null ? `${c.aviso}●` : ok ? `${c.ok}●` : `${c.mal}●`}${c.fin} ${titulo.padEnd(26)} ${c.gris}${detalle}${c.fin}`

async function pintar(cfg: Config) {
  const api = servicio(SERVICIO_API)
  const tunel = servicio(SERVICIO_TUNEL)
  const [local, publica] = await Promise.all([salud(`http://localhost:${cfg.puerto}`), cfg.urlPublica ? salud(cfg.urlPublica) : null])
  const copia = ultimaCopia(cfg.backups)
  const errores = ultimosErrores()
  let cuentas = '?'
  try {
    cuentas = String(new AppStore(cfg.base).accesos().size)
  } catch {}
  const descServicio = (s: Servicio) => (!s.instalado ? 'no está instalado' : `${s.corriendo ? 'en ejecución' : 'DETENIDO'}${s.automatico ? ' · arranca con Windows' : ' · NO arranca solo'}`)
  const todoBien = api.corriendo && local.ok && tunel.corriendo && (publica?.ok ?? true)

  const out = [
    `\x1b[2J\x1b[H${c.neg}GOOD GAME API${c.fin} ${c.gris}· estado del servidor · ${new Date().toLocaleTimeString('es-AR')}${c.fin}`,
    '',
    todoBien ? `  ${c.ok}${c.neg}TODO FUNCIONANDO${c.fin}  La app de los clientes está andando.` : `  ${c.mal}${c.neg}HAY UN PROBLEMA${c.fin}  Mirá los puntos en rojo. Probá R para reiniciar.`,
    '',
    linea(api.corriendo && api.automatico, 'Servicio de la API', descServicio(api)),
    linea(local.ok, 'API en este equipo', local.detalle),
    linea(tunel.corriendo && tunel.automatico, 'Túnel de Cloudflare', descServicio(tunel)),
    publica ? linea(publica.ok, 'Acceso desde internet', `${cfg.urlPublica} · ${publica.detalle}`) : linea(null, 'Acceso desde internet', 'sin "urlPublica" en config.json'),
    copia ? linea(copia.edad < 36 * 3600_000, 'Copia de seguridad', `${copia.archivo} · ${hace(copia.edad)}`) : linea(false, 'Copia de seguridad', `ninguna todavía en ${cfg.backups}`),
    linea(null, 'Cuentas de clientes', cuentas),
    '',
  ]
  if (errores && Date.now() - errores.cuando < 24 * 3600_000) {
    out.push(`  ${c.aviso}Errores recientes (${hace(Date.now() - errores.cuando)}):${c.fin}`, ...errores.lineas.map((l) => `  ${c.gris}${l.slice(0, 110)}${c.fin}`), '')
  }
  out.push(`${c.gris}  Se actualiza solo cada ${CADA_MS / 1000} s · programa ${VERSION}${c.fin}`, `  ${c.neg}R${c.fin} reiniciar API y túnel   ${c.neg}Q${c.fin} cerrar`)
  process.stdout.write(out.join('\n') + '\n')
}

/** Reinicia (o arranca) los dos servicios; pide permiso de administrador. */
function reiniciar() {
  const ps = `Restart-Service ${SERVICIO_API} -Force; Restart-Service ${SERVICIO_TUNEL} -Force`
  spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','${ps}'`], { stdio: 'ignore' })
}

export async function tablero(cfg: Config) {
  if (!esWindows) throw new Error('El tablero de estado es para el servidor Windows.')
  let ocupado = false
  const refrescar = async () => {
    if (ocupado) return
    ocupado = true
    try {
      await pintar(cfg)
    } finally {
      ocupado = false
    }
  }
  await refrescar()
  setInterval(refrescar, CADA_MS)
  if (!process.stdin.isTTY) return
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (b) => {
    const k = b.toString().toLowerCase()
    if (k === 'q' || k === '\x1b' || k === '\x03') process.exit(0)
    if (k === 'r') {
      process.stdout.write(`\n  ${c.aviso}Reiniciando… aceptá el permiso de administrador.${c.fin}\n`)
      reiniciar()
      setTimeout(refrescar, 8000)
    }
  })
}
