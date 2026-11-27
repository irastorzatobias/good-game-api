// La terminal que registra los comprobantes: cada instalación de sistema.exe tiene la suya en config.DBF (CFG_MAQUIN,
// p. ej. "1P") y la deja en DOC_MACHIN / DOC_MAQUIN. La API escribe como la terminal de la carpeta en la que escribe.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Tabla } from '../dbf/tabla.ts'

export type Terminal = { machin: string; maquin: number; sucursal: string }

export function terminalDe(carpeta: string): Terminal {
  const archivo = readdirSync(carpeta).find((f) => f.toLowerCase() === 'config.dbf')
  if (!archivo) throw new Error(`${carpeta}: no está config.dbf (la configuración de la terminal)`)
  const t = new Tabla(readFileSync(join(carpeta, archivo)), 'config')
  if (!t.cantidad) throw new Error('config.dbf está vacía')
  const f = t.fila(0)
  const machin = String(f.CFG_MAQUIN ?? '').trim()
  const maquin = parseInt(machin, 10)
  if (!machin || !Number.isInteger(maquin)) throw new Error(`config.dbf: CFG_MAQUIN inválido (${JSON.stringify(f.CFG_MAQUIN)})`)
  return { machin, maquin, sucursal: String(f.CFG_SUCURS ?? '1').trim() || '1' }
}
