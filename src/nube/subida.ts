// Sube la foto (foto.ts) al Worker de Cloudflare (nube/worker.ts), que la sirve cuando el local está apagado.
// Solo sube lo que cambió desde la subida anterior y borra lo que ya no está (sesiones cerradas, cuentas quitadas).
// La PC no tiene credenciales de Cloudflare: el Worker recibe con una clave compartida (config.json "nube").

import type { Ruta } from '../http.ts'
import { VERSION } from '../version.ts'
import { foto, type Pieza } from './foto.ts'

export type ConfigNube = { url: string; clave: string }
type Sesiones = () => { token: string; cliente: string }[]

const CADA_MS = 10 * 60 * 1000
const EN_PARALELO = 4

export class Nube {
  // Lo que ya está arriba, clave → huella. Vive en memoria: al arrancar la API se sube todo una vez.
  private subido = new Map<string, string>()
  private readonly cfg: ConfigNube
  constructor(cfg: ConfigNube) {
    this.cfg = cfg
  }

  private async pedir(metodo: 'PUT' | 'DELETE', clave: string, cuerpo?: Buffer, tipo?: string) {
    const res = await fetch(`${this.cfg.url}/_nube/${clave}`, {
      method: metodo,
      headers: { 'X-Nube-Clave': this.cfg.clave, ...(tipo && { 'Content-Type': tipo }) },
      body: cuerpo && new Uint8Array(cuerpo),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`${metodo} ${clave}: ${res.status} ${await res.text().catch(() => '')}`.trim())
  }

  private async subir(p: Pieza) {
    await this.pedir('PUT', p.clave, await p.cuerpo(), p.tipo)
    this.subido.set(p.clave, p.huella)
  }

  /** Una pasada: sube lo cambiado, borra lo que sobra y por último la fecha ("meta"), que marca la copia como completa. */
  async sincronizar(rutas: Ruta[], sesiones: Sesiones) {
    const piezas = await foto(rutas, sesiones())
    const cambiadas = piezas.filter((p) => this.subido.get(p.clave) !== p.huella)
    // El índice de sesiones va al final: nunca apunta a una carpeta que todavía no se subió.
    const indice = cambiadas.filter((p) => p.clave === 'sesiones')
    const resto = cambiadas.filter((p) => p.clave !== 'sesiones')
    for (let i = 0; i < resto.length; i += EN_PARALELO) await Promise.all(resto.slice(i, i + EN_PARALELO).map((p) => this.subir(p)))
    for (const p of indice) await this.subir(p)
    const vigentes = new Set(piezas.map((p) => p.clave))
    const sobrantes = [...this.subido.keys()].filter((c) => !vigentes.has(c))
    for (const c of sobrantes) {
      await this.pedir('DELETE', c)
      this.subido.delete(c)
    }
    const meta = { fecha: new Date().toISOString(), version: VERSION }
    await this.pedir('PUT', 'meta', Buffer.from(JSON.stringify(meta)), 'application/json')
    return { piezas: piezas.length, subidas: cambiadas.length, borradas: sobrantes.length }
  }

  /** Mientras la API corre, una pasada al arrancar y otra cada 10 minutos. Un fallo se avisa y no corta la API. */
  sincronizarSeguido(rutas: Ruta[], sesiones: Sesiones) {
    let corriendo = false
    const pasada = async () => {
      if (corriendo) return
      corriendo = true
      try {
        const r = await this.sincronizar(rutas, sesiones)
        if (r.subidas || r.borradas) console.log(`Copia en la nube: ${r.subidas} subidas, ${r.borradas} borradas (${r.piezas} en total).`)
      } catch (e) {
        console.error(`No se pudo actualizar la copia en la nube: ${(e as Error).message}`)
      } finally {
        corriendo = false
      }
    }
    void pasada()
    setInterval(pasada, CADA_MS).unref()
  }
}
