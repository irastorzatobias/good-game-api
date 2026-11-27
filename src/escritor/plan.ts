// Plan de escritura: lo que una acción escribe en el sistema, expresado como datos. Las acciones (src/acciones/) arman
// el plan con funciones puras, que se verifican contra lo que escribió sistema.exe; el escritor lo ejecuta en el sistema
// tomando los contadores bloqueados, como hace sistema.exe.
//
// Los contadores del sistema (codemstr.DOC_CLAV, numeros.N_*) guardan el PRÓXIMO valor a usar: el escritor lo lee,
// lo usa y lo avanza en uno mientras lo tiene bloqueado.

/** Cómo se escribe un contador dentro de un campo: base, largo, relleno a la izquierda y prefijo. */
export type Formato = { base: 10 | 16; largo: number; relleno: ' ' | '0'; prefijo: string }

/** Valor de un campo. Las fechas van marcadas porque FoxPro las escribe distinto que el texto. */
export type Valor = string | number | boolean | { fecha: string | null } | { contador: string; formato?: Formato }

export type Paso =
  /** Reserva el próximo valor de un contador (tabla de un solo registro) y lo deja con ese nombre para los campos. */
  | { tipo: 'contador'; nombre: string; tabla: string; campo: string }
  /** Agrega un registro. Los campos que no figuran quedan vacíos, como los deja sistema.exe. */
  | { tipo: 'alta'; tabla: string; fila: Record<string, Valor> }

export type Plan = { accion: string; pasos: Paso[] }

/** Contadores con la clave interna de los comprobantes: "P" y el número en hexadecimal, 8 caracteres (P  2F4D6). */
export const CLAVE_DOC: Formato = { base: 16, largo: 7, relleno: ' ', prefijo: 'P' }

export const esFecha = (v: Valor): v is { fecha: string | null } => typeof v === 'object' && 'fecha' in v
export const esContador = (v: Valor): v is { contador: string; formato?: Formato } => typeof v === 'object' && 'contador' in v

/** Escribe un número con un formato. El escritor de FoxPro hace exactamente lo mismo (gg_num en vfp.ts). */
export function formatear(n: number, f: Formato): string {
  return f.prefijo + Math.trunc(n).toString(f.base).toUpperCase().padStart(f.largo, f.relleno)
}

/** Lee un valor formateado (la inversa de formatear), o null si no tiene ese formato. */
export function leerFormato(s: string, f: Formato): number | null {
  if (!s.startsWith(f.prefijo)) return null
  const resto = s.slice(f.prefijo.length).trim()
  const n = parseInt(resto, f.base)
  return Number.isFinite(n) && formatear(n, f) === s ? n : null
}

export type Alta = { tabla: string; fila: Record<string, string | number | boolean | null> }

/** Las altas del plan con los contadores ya resueltos: lo que quedaría escrito si los contadores valen eso. */
export function resolver(plan: Plan, contadores: Record<string, number>): Alta[] {
  const valor = (v: Valor) => {
    if (esFecha(v)) return v.fecha
    if (esContador(v)) {
      const n = contadores[v.contador]
      if (n === undefined) throw new Error(`${plan.accion}: falta el contador ${v.contador}`)
      return v.formato ? formatear(n, v.formato) : n
    }
    return v
  }
  return plan.pasos
    .filter((p) => p.tipo === 'alta')
    .map((p) => ({ tabla: p.tabla, fila: Object.fromEntries(Object.entries(p.fila).map(([k, v]) => [k, valor(v)])) }))
}
