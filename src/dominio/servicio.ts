// Servicio técnico: órdenes del sistema más lo que pasa en la app (mensajes, respuesta al presupuesto, solicitudes).
import type { Fila } from '../dbf/tabla.ts'
import { HttpError } from '../http.ts'
import { ahora } from '../fechas.ts'
import type { Deps } from './deps.ts'

function completa(d: Deps, o: Fila) {
  const numero = o.OR_NUMERO_ as string
  return { ...d.sistema.detalleOrden(o), app: { mensajes: d.app.mensajes(numero), respuesta: d.app.respuesta(numero) } }
}
function ordenDe(d: Deps, cliente: string, numero: string) {
  const o = d.sistema.ordenesDe(cliente).find((x) => x.OR_NUMERO_ === numero)
  if (!o) throw new HttpError(404, 'Orden inexistente')
  return o
}

/** Sin anuladas, de la más nueva a la más vieja. */
export const ordenes = (d: Deps, cliente: string) =>
  d.sistema.ordenesDe(cliente)
    .filter((o) => o.OR_ESTADO_ !== 'AA')
    .sort((a, b) => String(b.OR_NUMERO_).localeCompare(String(a.OR_NUMERO_), undefined, { numeric: true }))
    .map((o) => completa(d, o))

export const orden = (d: Deps, cliente: string, numero: string) => completa(d, ordenDe(d, cliente, numero))

/** Respuesta al presupuesto. Queda en la app: el local la ve y pasa la orden a reparación en el sistema. */
export function responder(d: Deps, cliente: string, numero: string, body: Record<string, unknown>) {
  const o = ordenDe(d, cliente, numero)
  if (o.OR_ESTADO_ !== 'DD' || !o.OR_PRE_TOT || d.app.respuesta(numero)) throw new HttpError(409, 'La orden no espera respuesta')
  const aprobado = body.aprobado === true
  d.app.guardarRespuesta(numero, {
    aprobado, fecha: ahora(), condiciones: String(body.condiciones ?? ''),
    motivo: typeof body.motivo === 'string' ? body.motivo : undefined,
    estimada: aprobado && typeof body.estimada === 'string' ? body.estimada : null,
  })
  return completa(d, o)
}

export function escribir(d: Deps, cliente: string, numero: string, texto: unknown) {
  const o = ordenDe(d, cliente, numero)
  const t = String(texto ?? '').trim().slice(0, 500)
  if (!t) throw new HttpError(400, 'Mensaje vacío')
  d.app.agregarMensaje(numero, 'cliente', t, ahora())
  return completa(d, o)
}

export function marcarLeidos(d: Deps, cliente: string, numero: string) {
  const o = ordenDe(d, cliente, numero)
  d.app.marcarLeidos(numero)
  return completa(d, o)
}

/** Pedido de servicio desde la app: no está en ord_repa hasta que el local recibe el equipo. */
export function solicitar(d: Deps, cliente: string, body: Record<string, unknown>) {
  const equipo = String(body.equipo ?? '').trim().slice(0, 80)
  const falla = String(body.falla ?? '').trim().slice(0, 240)
  if (!equipo || !falla) throw new HttpError(400, 'Faltan datos')
  return d.app.agregarSolicitud(cliente, ahora(), equipo, falla)
}
