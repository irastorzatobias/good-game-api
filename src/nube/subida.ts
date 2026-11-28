// Sube la foto (foto.ts) al Worker de Cloudflare (nube/worker.ts), que la sirve cuando el local está apagado, y carga
// en el local lo que se hizo mientras tanto (pendientes.ts). Solo sube lo que cambió desde la subida anterior.
// La PC no tiene credenciales de Cloudflare: el Worker recibe con una clave compartida (config.json "nube").

import type { Ruta } from '../http.ts'
import type { Deps } from '../dominio/deps.ts'
import { documentoDeAcceso } from '../dominio/admin.ts'
import { VERSION } from '../version.ts'
import { carpetaCliente, foto, sha256, type Pieza } from './foto.ts'
import { aplicar, descifrar } from './pendientes.ts'

export type ConfigNube = { url: string; clave: string }

const CADA_MS = 10 * 60 * 1000
const EN_PARALELO = 4
// Lo que maneja el Worker (anotaciones y sesiones de cuando el local estaba apagado): el barrido no lo toca.
const DEL_WORKER = ['pend/', 'ses-off/', 'adm-off/', 'meta']

export class Nube {
  // Lo que ya está arriba, clave → huella. Vive en memoria: al arrancar se sube todo una vez y se barre lo que sobre.
  private subido = new Map<string, string>()
  private barrido = false
  private readonly probados = new Set<string>() // cuentas a las que ya se les probó la clave de fábrica
  private readonly cfg: ConfigNube
  constructor(cfg: ConfigNube) {
    this.cfg = cfg
  }

  private async pedir(metodo: 'GET' | 'PUT' | 'DELETE', clave: string, cuerpo?: Buffer, tipo?: string) {
    const res = await fetch(`${this.cfg.url}/_nube/${clave}`, {
      method: metodo,
      headers: { 'X-Nube-Clave': this.cfg.clave, ...(tipo && { 'Content-Type': tipo }) },
      body: cuerpo && new Uint8Array(cuerpo),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`${metodo} ${clave}: ${res.status} ${await res.text().catch(() => '')}`.trim())
    return res
  }

  private async subir(p: Pieza) {
    await this.pedir('PUT', p.clave, await p.cuerpo(), p.tipo)
    this.subido.set(p.clave, p.huella)
  }

  /** Carga lo anotado con el local apagado. Devuelve cuántos se cargaron. */
  private async cargarPendientes(d: Deps, rutas: Ruta[]) {
    const lista = (await (await this.pedir('GET', '_pendientes')).json()) as { id: string; dato: string }[]
    if (!lista.length) return 0
    const porCarpeta = new Map(d.sistema.buscarClientes('').map((c) => [carpetaCliente(c.CLI_CODIGO as string), c.CLI_CODIGO as string]))
    for (const { id, dato } of lista) {
      const p = descifrar(dato, this.cfg.clave)
      try {
        for (const carpeta of await aplicar(d, rutas, p, (c) => porCarpeta.get(c))) this.subido.delete(carpeta)
      } catch (e) {
        console.error(`Copia en la nube: no se cargó ${p.tipo === 'pedido' ? `${p.metodo} ${p.path}` : p.tipo} (${(e as Error).message})`)
      }
      await this.pedir('DELETE', id)
      // La sesión ya está en la base del local (y en el índice "sesiones" de la próxima subida).
      if (p.tipo === 'sesion') await this.pedir('DELETE', 'ses-off/' + sha256(p.token))
      if (p.tipo === 'sesion-admin') await this.pedir('DELETE', 'adm-off/' + sha256(p.token))
    }
    // El Worker también tocó los accesos, la lista del panel y los índices: se vuelven a subir.
    for (const c of [...this.subido.keys()]) if (!c.startsWith('cli/') && !c.startsWith('pub/')) this.subido.delete(c)
    return lista.length
  }

  /**
   * Una pasada: carga lo pendiente, sube lo cambiado, borra lo que sobra y por último la fecha ("meta"), que marca
   * la copia como completa.
   */
  async sincronizar(d: Deps, rutas: Ruta[]) {
    const cargados = await this.cargarPendientes(d, rutas)
    await d.app.completarVerificadores((c) => {
      const fila = d.sistema.cliente(c)
      return fila ? documentoDeAcceso(fila) : null
    }, this.probados)
    const piezas = await d.sistema.fijo(() => foto(d, rutas))
    const cambiadas = piezas.filter((p) => this.subido.get(p.clave) !== p.huella)
    // Los índices de sesiones van al final: nunca apuntan a algo que todavía no se subió.
    const indice = (p: Pieza) => p.clave.startsWith('sesiones')
    const resto = cambiadas.filter((p) => !indice(p))
    for (let i = 0; i < resto.length; i += EN_PARALELO) await Promise.all(resto.slice(i, i + EN_PARALELO).map((p) => this.subir(p)))
    for (const p of cambiadas.filter(indice)) await this.subir(p)

    const vigentes = new Set(piezas.map((p) => p.clave))
    let sobrantes = [...this.subido.keys()].filter((c) => !vigentes.has(c))
    if (!this.barrido) {
      // Primera pasada: lo que haya arriba de antes (otra versión, cuentas quitadas con la API apagada).
      const arriba = (await (await this.pedir('GET', '_lista')).json()) as string[]
      sobrantes = arriba.filter((c) => !vigentes.has(c) && !DEL_WORKER.some((p) => c.startsWith(p)))
    }
    for (const c of sobrantes) {
      await this.pedir('DELETE', c)
      this.subido.delete(c)
    }
    this.barrido = true
    const meta = { fecha: new Date().toISOString(), version: VERSION }
    await this.pedir('PUT', 'meta', Buffer.from(JSON.stringify(meta)), 'application/json')
    return { piezas: piezas.length, subidas: cambiadas.length, borradas: sobrantes.length, cargados }
  }

  /** Mientras la API corre, una pasada al arrancar y otra cada 10 minutos. Un fallo se avisa y no corta la API. */
  sincronizarSeguido(d: Deps, rutas: Ruta[]) {
    let corriendo = false
    const pasada = async () => {
      if (corriendo) return
      corriendo = true
      try {
        const t = Date.now()
        const r = await this.sincronizar(d, rutas)
        const s = Math.round((Date.now() - t) / 1000)
        if (r.cargados) console.log(`Copia en la nube: se cargaron ${r.cargados} cambios hechos con el local apagado.`)
        if (r.subidas || r.borradas) console.log(`Copia en la nube: ${r.subidas} subidas, ${r.borradas} borradas (${r.piezas} en total, ${s} s).`)
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
