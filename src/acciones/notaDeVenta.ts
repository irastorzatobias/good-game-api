// Nota de venta (NV) tal como la escribe sistema.exe. Deducido de las NV reales de 2026 y verificado contra ellas con
// `node scripts/verificar-nv.ts <carpeta del sistema>`; la huella de una NV cargada a mano lo confirma.
//
// Escribe: los renglones en doccuer (y su texto libre en doctexto) y la cabecera en docum, que va última: un comprobante
// existe para el sistema cuando tiene cabecera, así que si algo falla a mitad no queda una NV a medias a la vista.
// Usa dos contadores: la clave interna (codemstr.DOC_CLAV) y el número de NV (numeros.N_NOTAVTA).
// No toca caja, formas de pago ni stock: eso pasa cuando el local la factura o la cobra.

import { CLAVE_DOC, type Formato, type Paso, type Plan, type Valor } from '../escritor/plan.ts'

export type RenglonNv = {
  /** Código compuesto del artículo como en doccuer ("1  2102"), o ausente para un renglón de texto libre. */
  articulo?: string
  /** Descripción de un renglón de texto libre (hasta 55 caracteres): va a doctexto. */
  texto?: string
  cantidad: number
  /** Precio unitario final, con IVA, como lo carga el vendedor. */
  precio: number
  tasaIva: number
  bonificacion?: number
}

export type EntradaNv = {
  cuenta: string // CLI_CODIGO tal cual ("1   213")
  fecha: string // AAAA-MM-DD
  usuario: string // quien la hace, como en sistema.exe
  puntoDeVenta: string // las 4 cifras del número: X<pv><número>
  lista: number // lista de precios usada (DOC_CUOTAS: 1, 2 o 3)
  dolar: number // cotización vigente
  observacion?: string
  bonificacion?: number // % sobre el total (DOC_PORBON)
  /** Estado con el que nace. Las NV vigentes del sistema tienen DOC_PAGADO en .T.: a confirmar con una huella. */
  pagado?: boolean
  terminal: { machin: string; maquin: number; sucursal: string } // la máquina que la registra (config.DBF: CFG_MAQUIN)
  renglones: RenglonNv[]
}

// Redondeo a centavos sin el error binario de los .xx5 (0.285 * 100 = 28.499999...).
const r2 = (n: number) => Math.round(Number(n.toFixed(10)) * 100) / 100

const numeroNv = (pv: string): Formato => ({ base: 10, largo: 8, relleno: '0', prefijo: `X${pv}` })

/**
 * Neto e IVA por tasa, como los calcula sistema.exe: el neto de cada renglón se redondea a centavos y se suma por tasa,
 * el IVA es el neto por la tasa (redondeado) y el total es la suma de netos e IVA (por eso 4000 queda 4000.01).
 * La tasa del primer renglón va en el primer par de campos (DOC_NETO_1/DOC_TASIVA).
 * Coincide con el 95% de las NV de 2026; el resto son netos o totales retocados a mano en el sistema.
 */
export function impuestos(renglones: RenglonNv[], bonificacion = 0) {
  const factor = 1 - bonificacion / 100
  const netoPorTasa = new Map<number, number>()
  for (const r of renglones) {
    const bruto = r.cantidad * r.precio * (1 - (r.bonificacion ?? 0) / 100) * factor
    netoPorTasa.set(r.tasaIva, (netoPorTasa.get(r.tasaIva) ?? 0) + r2(bruto / (1 + r.tasaIva / 100)))
  }
  if (netoPorTasa.size > 2) throw new Error('Una nota de venta admite hasta dos tasas de IVA')
  const tasas = [...netoPorTasa].map(([tasa, suma]) => {
    const neto = r2(suma)
    return { tasa, neto, iva: r2((neto * tasa) / 100) }
  })
  return { total: r2(tasas.reduce((s, t) => s + t.neto + t.iva, 0)), tasas }
}

export function planNotaDeVenta(e: EntradaNv): Plan {
  if (!e.renglones.length) throw new Error('La nota de venta no tiene renglones')
  for (const r of e.renglones) {
    if (!r.articulo && !r.texto) throw new Error('Cada renglón lleva un artículo o un texto')
    if (!(r.cantidad > 0)) throw new Error('Cantidad inválida')
  }
  const clave: Valor = { contador: 'clave', formato: CLAVE_DOC }
  const { total, tasas } = impuestos(e.renglones, e.bonificacion)
  const [t1, t2] = tasas
  const pasos: Paso[] = [
    { tipo: 'contador', nombre: 'clave', tabla: 'codemstr', campo: 'DOC_CLAV' },
    { tipo: 'contador', nombre: 'numero', tabla: 'numeros', campo: 'N_NOTAVTA' },
  ]
  e.renglones.forEach((r, i) => {
    pasos.push({
      tipo: 'alta',
      tabla: 'doccuer',
      fila: {
        DCC_CLAVE_: clave,
        DCC_ARTICU: r.articulo ?? 'TEXTO_',
        DCC_CANTID: r.cantidad,
        DCC_PRECIO: r.precio,
        DCC_TASIVA: r.tasaIva,
        DCC_BONIFI: r.bonificacion ?? 0,
        DCC_MAQUIN: e.terminal.maquin,
      },
    })
    if (r.texto) pasos.push({ tipo: 'alta', tabla: 'doctexto', fila: { DT_CLAVE__: clave, DT_RENGLON: String(i + 1), DT_DESCRIP: r.texto } })
  })
  pasos.push({
    tipo: 'alta',
    tabla: 'docum',
    fila: {
      DOC_CLIPRO: 'C',
      DOC_CUENTA: e.cuenta,
      DOC_FECEMI: { fecha: e.fecha },
      DOC_TIPDOC: 'NV',
      DOC_NRODOC: { contador: 'numero', formato: numeroNv(e.puntoDeVenta) },
      DOC_TOTAL_: total,
      DOC_NETO_1: t1?.neto ?? 0,
      DOC_IVAINS: t1?.iva ?? 0,
      DOC_TASIVA: t1?.tasa ?? 0,
      DOC_NETO_2: t2?.neto ?? 0,
      DOC_IVAIN2: t2?.iva ?? 0,
      DOC_TASIV2: t2?.tasa ?? 0,
      DOC_PERIOD: e.fecha.slice(0, 7).replace('-', ''),
      DOC_CLAVE_: clave,
      DOC_OBSERV: e.observacion ?? '',
      DOC_MACHIN: e.terminal.machin,
      DOC_USUARI: e.usuario,
      DOC_PORBON: e.bonificacion ?? 0,
      DOC_PAGADO: e.pagado ?? true,
      DOC_MAQUIN: e.terminal.maquin,
      DOC_VENDE: '0',
      DOC_F_CAJA: { fecha: e.fecha },
      DOC_CUOTAS: e.lista,
      DOC_DOLAR_: e.dolar,
      DOC_SUCURS: e.terminal.sucursal,
    },
  })
  return { accion: 'nota de venta', pasos }
}
