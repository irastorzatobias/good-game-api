// Escritura en el sistema (sistema.exe) desde la API. Por ahora, la nota de venta.
//
// Solo escribe si config.json dice en qué carpeta ("escritura"); la API de producción no la tiene. Los precios salen
// del sistema igual que en la app (lista del cliente × dólar del día), nunca del pedido.

import { planNotaDeVenta, type EntradaNv, type RenglonNv } from '../acciones/notaDeVenta.ts'
import type { Escritor } from '../escritor/escritor.ts'
import { CLAVE_DOC, formatear } from '../escritor/plan.ts'
import { hoy } from '../fechas.ts'
import { HttpError } from '../http.ts'
import { cod, type Consultas } from '../sistema/consultas.ts'
import type { Terminal } from '../sistema/terminal.ts'
import type { Deps } from './deps.ts'

/** Punto de venta de las NV del local: X0004-… (el 0002 es solo de Mariano). */
const PUNTO_DE_VENTA = '0004'

/** Dónde y cómo escribe la API: el escritor de esa carpeta y la terminal que figura en los comprobantes. */
export type Escritura = { escritor: Escritor; terminal: Terminal }

export type PedidoNv = {
  cuenta: string
  usuario: string
  observacion?: string
  renglones: ({ articulo: string; cantidad: number } | { texto: string })[]
}

/** Arma la NV con los precios del sistema. Falla con 4xx si el cliente o algún artículo no sirve. */
export function entradaNotaDeVenta(sistema: Consultas, terminal: Terminal, p: PedidoNv): EntradaNv {
  const cliente = sistema.cliente(p.cuenta)
  if (!cliente) throw new HttpError(404, `No existe el cliente ${JSON.stringify(p.cuenta)} en el sistema`)
  if (!p.renglones.length) throw new HttpError(400, 'La nota de venta no tiene renglones')
  const lista = Number(cliente.CLI_LISTA) || 1
  const dolar = sistema.cotizacion().DC_COTIZA as number
  const venta = new Map(sistema.articulosVenta().map((a) => [a.AR_CODI as string, a]))
  let tasaIva = 21
  const renglones: RenglonNv[] = p.renglones.map((r) => {
    if ('texto' in r) return { texto: String(r.texto).slice(0, 55), cantidad: 1, precio: 0, tasaIva }
    const a = venta.get(String(r.articulo).trim())
    if (!a) throw new HttpError(409, `El artículo ${r.articulo} no está a la venta`)
    if (!Number.isInteger(r.cantidad) || r.cantidad < 1) throw new HttpError(400, `Cantidad inválida para ${r.articulo}`)
    tasaIva = a.AR_IVA_ as number
    return { articulo: cod(a.AR_CODI as string), cantidad: r.cantidad, precio: Math.round((a[`AR_LIS${lista}`] as number) * dolar), tasaIva }
  })
  return {
    cuenta: cliente.CLI_CODIGO as string,
    fecha: hoy(),
    usuario: p.usuario,
    puntoDeVenta: PUNTO_DE_VENTA,
    lista,
    dolar,
    observacion: p.observacion,
    terminal,
    renglones,
  }
}

/** Escribe la NV en el sistema y devuelve cómo quedó registrada. */
export async function escribirNotaDeVenta(e: Escritura, entrada: EntradaNv) {
  const plan = planNotaDeVenta(entrada)
  const { contadores } = await e.escritor.ejecutar(plan)
  return {
    clave: formatear(contadores.clave, CLAVE_DOC),
    numero: contadores.numero,
    comprobante: `X${entrada.puntoDeVenta}-${String(contadores.numero).padStart(8, '0')}`,
    cuenta: entrada.cuenta,
    renglones: entrada.renglones.length,
  }
}

/** POST /admin/sistema/notas-venta — body: { cuenta, renglones: [{ articulo, cantidad } | { texto }], observacion? } */
export function notaDeVentaEnSistema(d: Deps, admin: string, body: Record<string, unknown>) {
  if (!d.escritura) throw new HttpError(503, 'Esta instalación no escribe en el sistema (falta "escritura" en config.json)')
  const pedido: PedidoNv = {
    cuenta: String(body.cuenta ?? ''),
    usuario: 'API',
    observacion: String(body.observacion ?? `Desde la API (${admin})`).slice(0, 60),
    renglones: Array.isArray(body.renglones) ? (body.renglones as PedidoNv['renglones']) : [],
  }
  return escribirNotaDeVenta(d.escritura, entradaNotaDeVenta(d.sistema, d.escritura.terminal, pedido))
}
