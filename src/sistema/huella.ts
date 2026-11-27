// Huella de una operación en el sistema: compara dos copias de la carpeta (antes y después de, por ejemplo, cargar una
// nota de venta en sistema.exe) y devuelve qué archivos cambiaron y, en cada DBF, qué registros se agregaron, cambiaron
// o se borraron, campo por campo. Es la referencia contra la que se verifica que la API escribe igual que el sistema.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Tabla, type Fila, type Valor } from '../dbf/tabla.ts'

export type Cambio =
  | { tipo: 'alta'; tabla: string; registro: number; borrado: boolean; fila: Fila }
  | { tipo: 'cambio'; tabla: string; registro: number; campos: Record<string, [Valor, Valor]> }
  | { tipo: 'borrado' | 'recuperado' | 'quitado'; tabla: string; registro: number }

export type Huella = {
  archivosNuevos: string[]
  archivosQuitados: string[]
  archivosCambiados: string[]
  cambios: Cambio[]
  ilegibles: { tabla: string; error: string }[]
}

/** Archivos de la carpeta (sin subcarpetas) por nombre en minúsculas: el sistema mezcla mayúsculas. */
function archivos(carpeta: string) {
  const m = new Map<string, string>()
  for (const f of readdirSync(carpeta)) {
    const ruta = join(carpeta, f)
    if (statSync(ruta).isFile()) m.set(f.toLowerCase(), ruta)
  }
  return m
}

const igual = (a: Valor, b: Valor) => a === b

function compararTabla(tabla: string, a: Tabla, b: Tabla): Cambio[] {
  const cambios: Cambio[] = []
  const comunes = Math.min(a.cantidad, b.cantidad)
  for (let i = 0; i < comunes; i++) {
    const fa = a.fila(i)
    const fb = b.fila(i)
    const campos: Record<string, [Valor, Valor]> = {}
    for (const k of Object.keys(fb)) if (!igual(fa[k], fb[k])) campos[k] = [fa[k], fb[k]]
    if (Object.keys(campos).length) cambios.push({ tipo: 'cambio', tabla, registro: i + 1, campos })
    if (a.borrado(i) !== b.borrado(i)) cambios.push({ tipo: b.borrado(i) ? 'borrado' : 'recuperado', tabla, registro: i + 1 })
  }
  for (let i = comunes; i < b.cantidad; i++) cambios.push({ tipo: 'alta', tabla, registro: i + 1, borrado: b.borrado(i), fila: b.fila(i) })
  for (let i = comunes; i < a.cantidad; i++) cambios.push({ tipo: 'quitado', tabla, registro: i + 1 })
  return cambios
}

export function huella(antes: string, despues: string): Huella {
  const A = archivos(antes)
  const B = archivos(despues)
  const h: Huella = { archivosNuevos: [], archivosQuitados: [], archivosCambiados: [], cambios: [], ilegibles: [] }
  for (const [f, rb] of B) {
    const ra = A.get(f)
    if (!ra) h.archivosNuevos.push(f)
    else if (!readFileSync(ra).equals(readFileSync(rb))) h.archivosCambiados.push(f)
  }
  for (const f of A.keys()) if (!B.has(f)) h.archivosQuitados.push(f)
  for (const f of h.archivosCambiados.filter((f) => f.endsWith('.dbf'))) {
    const tabla = f.replace(/\.dbf$/, '')
    try {
      h.cambios.push(...compararTabla(tabla, new Tabla(readFileSync(A.get(f)!), tabla), new Tabla(readFileSync(B.get(f)!), tabla)))
    } catch (e) {
      h.ilegibles.push({ tabla, error: (e as Error).message })
    }
  }
  return h
}

const mostrarFila = (f: Fila) =>
  Object.entries(f)
    .filter(([, v]) => v !== '' && v !== null && v !== 0 && v !== false)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ')

/** La huella como texto para leer en consola. */
export function textoHuella(h: Huella): string {
  const l: string[] = []
  for (const f of h.archivosNuevos) l.push(`+ archivo nuevo: ${f}`)
  for (const f of h.archivosQuitados) l.push(`- archivo quitado: ${f}`)
  l.push(`Archivos cambiados (${h.archivosCambiados.length}): ${h.archivosCambiados.join(', ') || '-'}`)
  let tabla = ''
  for (const c of h.cambios) {
    if (c.tabla !== tabla) l.push(`\n## ${(tabla = c.tabla)}`)
    if (c.tipo === 'alta') l.push(`  + #${c.registro}${c.borrado ? ' (borrado)' : ''}: ${mostrarFila(c.fila)}`)
    else if (c.tipo === 'cambio')
      l.push(`  ~ #${c.registro}: ${Object.entries(c.campos).map(([k, [a, b]]) => `${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join(', ')}`)
    else l.push(`  ${c.tipo === 'quitado' ? '-' : '*'} #${c.registro}: ${c.tipo}`)
  }
  for (const x of h.ilegibles) l.push(`\n## ${x.tabla}: no se pudo leer (${x.error})`)
  return l.join('\n')
}
