// Nota de venta tras el pago online. Precio, stock y promo salen del catálogo, no del pedido.
// Se guarda en la base propia: el stock del sistema baja recién cuando el local la factura.
import { HttpError } from '../http.ts'
import { hoy } from '../fechas.ts'
import { notaComoDocumento } from './cuenta.ts'
import type { Deps } from './deps.ts'

type Pedido = { AR_CODI: string; cantidad: number }[]

export function notaDeVenta(d: Deps, cliente: string, body: Record<string, unknown>) {
  const pedido = Array.isArray(body.items) ? (body.items as Pedido) : []
  if (!pedido.length) throw new HttpError(400, 'Pedido vacío')
  const medio = String(body.medio ?? '')
  const lista = String(d.sistema.cliente(cliente)?.CLI_LISTA || '1')
  const dolar = d.sistema.cotizacion().DC_COTIZA as number
  const promo = d.contenido.leer().promo
  const conPromo = !!promo && medio === promo.medio && hoy() <= promo.hasta
  const venta = new Map(d.sistema.articulosVenta().map((a) => [a.AR_CODI as string, a]))
  const items = pedido.map(({ AR_CODI, cantidad }) => {
    const a = venta.get(AR_CODI)
    if (!a || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > (a.AR_CANT as number))
      throw new HttpError(409, `Sin stock o cantidad inválida: ${AR_CODI}`)
    const bonif = conPromo && promo.codigos.includes(AR_CODI) ? promo.descuento * 100 : 0
    return { articulo: AR_CODI, cantidad, precio: Math.round((a[`AR_LIS${lista}`] as number) * dolar), tasaIva: a.AR_IVA_ as number, bonif }
  })
  const total = items.reduce((s, i) => s + Math.round(i.precio * (1 - i.bonif / 100)) * i.cantidad, 0)
  return notaComoDocumento(d, d.app.agregarNota({ cliente, fecha: hoy(), medio, lista, dolar, total, items }))
}
