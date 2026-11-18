import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Tabla } from '../dbf/tabla.ts'

export const TABLAS = ['clientes', 'articulo', 'docum', 'doccuer', 'tipodocu', 'rubros', 'dolar_cotiz',
  'ord_repa', 'equipos', 'producto', 'tecnicos', 'ord_status', 'ord_fact', 'or_mater'] as const
export type NombreTabla = (typeof TABLAS)[number]

export class SistemaOcupado extends Error {}

/**
 * Acceso de solo lectura a las tablas de Sistema_Local. Cada tabla se relee cuando FoxPro la modifica
 * (cambia fecha o tamaño del archivo); entre cambios se sirve de memoria.
 */
export class Sistema {
  private readonly archivos = new Map<string, string>()
  private readonly cache = new Map<string, { firma: string; tabla: Tabla }>()
  private readonly derivados = new WeakMap<Tabla, Map<string, unknown>>()
  readonly carpeta: string

  constructor(carpeta: string) {
    this.carpeta = carpeta
    // El sistema mezcla mayúsculas (clientes.DBF, ORD_FACT.DBF): se busca sin distinguirlas.
    if (!existsSync(carpeta)) throw new Error(`No existe la carpeta ${carpeta}.`)
    for (const f of readdirSync(carpeta)) {
      const m = f.match(/^(.*)\.dbf$/i)
      if (m) this.archivos.set(m[1].toLowerCase(), join(carpeta, f))
    }
    const faltan = TABLAS.filter((t) => !this.archivos.has(t))
    if (faltan.length) throw new Error(`${carpeta} no es la carpeta del sistema: faltan ${faltan.join(', ')}.`)
  }

  tabla(nombre: NombreTabla): Tabla {
    const ruta = this.archivos.get(nombre)!
    const previa = this.cache.get(nombre)
    try {
      const st = statSync(ruta)
      const firma = `${st.mtimeMs}:${st.size}`
      if (previa?.firma === firma) return previa.tabla
      const tabla = new Tabla(readFileSync(ruta), nombre)
      this.cache.set(nombre, { firma, tabla })
      return tabla
    } catch (e) {
      // Abierta en exclusivo (un reindexado, un pack): se sirve la última lectura si la hay.
      if (previa) return previa.tabla
      throw new SistemaOcupado(`No se pudo leer ${nombre}: ${(e as Error).message}`)
    }
  }

  /** Resultado calculado sobre una tabla (un índice, una lista filtrada) que se recalcula solo cuando la tabla cambia. */
  derivado<T>(nombre: NombreTabla, clave: string, calcular: (t: Tabla) => T): T {
    const tabla = this.tabla(nombre)
    let m = this.derivados.get(tabla)
    if (!m) this.derivados.set(tabla, (m = new Map()))
    if (!m.has(clave)) m.set(clave, calcular(tabla))
    return m.get(clave) as T
  }
}
