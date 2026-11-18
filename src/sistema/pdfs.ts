// PDFs que el sistema guarda al emitir cada comprobante (carpeta "Factura Electronica", una subcarpeta por tipo).
// El nombre es tipo + número, con variaciones a mano: "_FC B000600008971.PDF", "nc b000600000260.pdf",
// "RE000000013483.PDF", "OR    46647.PDF", "NC B000600000257_DUPLICADO.PDF", "OR    46648 - copia.PDF".
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// Tipos que comparten numeración (factura cta. cte. y contado son la misma factura de AFIP).
const FAMILIA: Record<string, string> = { FC: 'F', FE: 'F', NC: 'C', CE: 'C', ND: 'D', DE: 'D', RE: 'R', OR: 'O', PR: 'P' }
const NOMBRE = /^_*([A-Z]{2})\s*([A-Z]?\d+)\s*(.*)\.PDF$/
const REESCANEO_MS = 60_000 // un comprobante nuevo aparece a lo sumo un minuto después

export class ArchivoPdfs {
  private readonly carpeta: string
  private indice = new Map<string, string>()
  private escaneado = 0

  constructor(carpeta: string) {
    this.carpeta = carpeta
    this.escanear()
  }

  /** Ruta del PDF del comprobante (tipo de docum/ord_repa + número), o null si el sistema no lo guardó. */
  buscar(tipo: string, numero: string): string | null {
    const clave = (FAMILIA[tipo] ?? '') + numero.replace(/\s/g, '').toUpperCase()
    if (!this.indice.has(clave) && Date.now() - this.escaneado > REESCANEO_MS) this.escanear()
    return this.indice.get(clave) ?? null
  }

  private escanear() {
    const indice = new Map<string, string>()
    const copias = new Map<string, string>()
    for (const rel of readdirSync(this.carpeta, { recursive: true, encoding: 'utf8' })) {
      const archivo = rel.split(/[\\/]/).pop()!.toUpperCase()
      const m = archivo.match(NOMBRE)
      if (!m || !FAMILIA[m[1]]) continue
      const clave = FAMILIA[m[1]] + m[2]
      // El original gana sobre "_DUPLICADO" o "- copia", que quedan como respaldo.
      ;(m[3] ? copias : indice).set(clave, join(this.carpeta, rel))
    }
    for (const [clave, ruta] of copias) if (!indice.has(clave)) indice.set(clave, ruta)
    this.indice = indice
    this.escaneado = Date.now()
  }
}
