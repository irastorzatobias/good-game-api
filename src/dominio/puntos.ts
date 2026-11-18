// Puntos: los de cada venta o devolución salen de los comprobantes; canjes y bonificaciones, de la base propia.
import { randomUUID } from 'node:crypto'
import type { Fila } from '../dbf/tabla.ts'
import { HttpError } from '../http.ts'
import { enDias, hoy } from '../fechas.ts'
import { documentos, sinNotasFacturadas } from './cuenta.ts'
import type { Deps } from './deps.ts'

const SUMAN = ['FC', 'FE', 'TK', 'NV']
const RESTAN = ['NC', 'CE']
const puntosDe = (d: Deps, total: number) => Math.floor(total / d.contenido.leer().pesosPorPunto)

function movimientos(d: Deps, cuenta: string) {
  const servicio = d.sistema.clavesDeServicio()
  const deDocs = documentos(d, cuenta)
    .filter((x) => SUMAN.includes(x.DOC_TIPDOC as string) || RESTAN.includes(x.DOC_TIPDOC as string))
    .map((x) => {
      const nro = String(x.DOC_NRODOC)
      const numero = /^[A-Z]/.test(nro) ? `${nro.slice(0, 5)}-${nro.slice(5)}` : nro
      const resta = RESTAN.includes(x.DOC_TIPDOC as string)
      const detalle = resta ? 'Devolución' : x.DOC_USUARI === 'APP' ? 'Compra en la app' : servicio.has(x.DOC_CLAVE_ as string) ? 'Servicio técnico' : 'Compra'
      return { id: 'd' + x.DOC_CLAVE_, fecha: x.DOC_FECEMI as string, detalle: `${detalle} ${numero}`,
        puntos: (resta ? -1 : 1) * puntosDe(d, x.DOC_TOTAL_ as number) }
    })
  return [...deDocs, ...d.app.puntos(cuenta)].sort((a, b) => b.fecha.localeCompare(a.fecha))
}

/** Ranking anual: puntos ganados en el año (canjes y devoluciones no restan). Top 5, más el cliente si no entra. */
function ranking(d: Deps, yo: string) {
  const desde = hoy().slice(0, 4) + '-01-01'
  const ganados = new Map(d.app.puntosGanadosDesde(desde))
  const sumar = (cuenta: string, p: number) => ganados.set(cuenta, (ganados.get(cuenta) ?? 0) + p)
  for (const x of sinNotasFacturadas(d.sistema.documentosDesde(desde, SUMAN))) sumar(x.DOC_CUENTA as string, puntosDe(d, x.DOC_TOTAL_ as number))
  for (const n of d.app.notasDesde(desde)) sumar(n.cliente, puntosDe(d, n.total))
  ganados.set(yo, ganados.get(yo) ?? 0)
  const fila = (cuenta: string, puntos: number) => {
    const c: Fila | undefined = d.sistema.cliente(cuenta)
    const [apellido = '', nombre = ''] = String(c?.CLI_NOMBRE ?? '').split(' ')
    return { nombre: `${nombre} ${apellido[0] ?? ''}.`, puntos, yo: cuenta === yo }
  }
  const todos = [...ganados].filter(([c, p]) => p > 0 || c === yo).sort((a, b) => b[1] - a[1])
  const top = todos.slice(0, 5)
  if (!top.some(([c]) => c === yo)) top.push(todos.find(([c]) => c === yo)!)
  return top.map(([c, p]) => fila(c, p))
}

export function puntos(d: Deps, cliente: string) {
  return {
    movimientos: movimientos(d, cliente),
    premios: d.contenido.leer().premios,
    ranking: ranking(d, cliente),
    cupones: d.app.cupones(cliente, hoy()),
  }
}

export function canjear(d: Deps, cliente: string, premioId: unknown) {
  const { premios, diasCupon } = d.contenido.leer()
  const premio = premios.find((p) => p.id === premioId)
  if (!premio) throw new HttpError(404, 'Premio inexistente')
  const total = movimientos(d, cliente).reduce((s, m) => s + m.puntos, 0)
  if (total < premio.costo) throw new HttpError(409, 'Puntos insuficientes')
  const codigo = 'GG-' + randomUUID().slice(0, 5).toUpperCase()
  const cupon = { codigo, premio: premio.nombre, fecha: hoy(), vence: enDias(diasCupon) }
  d.app.canjear(cliente, { id: 'm' + randomUUID(), fecha: hoy(), detalle: `Canje: ${premio.nombre} (${codigo})`, puntos: -premio.costo }, cupon)
  return cupon
}
