// Copia diaria de la base propia de la app (cuentas, claves, contactos editados...): lo único que no está en el sistema.
// Una por día, "app-AAAA-MM-DD.db", y se conservan las últimas DIAS_GUARDADOS.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AppStore } from './store.ts'
import { hoy } from '../fechas.ts'

const DIAS_GUARDADOS = 14
const CADA_MS = 60 * 60 * 1000 // revisa cada hora si ya se hizo la de hoy (la PC puede no estar prendida a medianoche)
const NOMBRE = /^app-\d{4}-\d{2}-\d{2}\.db$/

/** Hace la copia de hoy si falta; con `forzar`, la rehace. Devuelve la ruta, o null si ya estaba. */
export function respaldar(app: AppStore, carpeta: string, forzar = false) {
  mkdirSync(carpeta, { recursive: true })
  const destino = join(carpeta, `app-${hoy()}.db`)
  if (existsSync(destino) && !forzar) return null
  // Se escribe aparte y se renombra: una copia a medias nunca queda con el nombre de una buena.
  const tmp = `${destino}.tmp`
  rmSync(tmp, { force: true })
  app.copiarA(tmp)
  renameSync(tmp, destino)
  const viejas = readdirSync(carpeta).filter((f) => NOMBRE.test(f)).sort().slice(0, -DIAS_GUARDADOS)
  for (const f of viejas) rmSync(join(carpeta, f))
  return destino
}

/** Mientras la API corre: la copia de hoy al arrancar y después una por día. Un fallo se avisa y no corta la API. */
export function respaldarCadaDia(app: AppStore, carpeta: string) {
  const intentar = () => {
    try {
      const r = respaldar(app, carpeta)
      if (r) console.log(`Copia de seguridad: ${r}`)
    } catch (e) {
      console.error(`No se pudo hacer la copia de seguridad en ${carpeta}: ${(e as Error).message}`)
    }
  }
  intentar()
  setInterval(intentar, CADA_MS).unref()
}
