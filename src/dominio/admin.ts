// Panel del local: administra las cuentas de la app. Los clientes salen del sistema; acá solo se les da o quita la clave.
import { randomUUID } from 'node:crypto'
import { HttpError } from '../http.ts'
import { ahora } from '../fechas.ts'
import type { Deps } from './deps.ts'

export const CLAVE_MINIMA = 6

export function loginAdmin(d: Deps, body: Record<string, unknown>) {
  const usuario = String(body.usuario ?? '').trim().toLowerCase()
  if (!usuario || !d.app.adminValido(usuario, String(body.clave ?? ''))) throw new HttpError(401, 'Usuario o clave incorrectos')
  const token = randomUUID()
  d.app.abrirSesionAdmin(token, usuario, ahora())
  return { token, usuario }
}

/** Clientes del sistema con lo justo para reconocerlos, y si ya tienen cuenta en la app. */
export function buscarClientes(d: Deps, q: string) {
  if (q.trim().length < 2) return []
  const accesos = d.app.accesos()
  return d.sistema.buscarClientes(q.trim()).map((c) => ({
    codigo: c.CLI_CODIGO as string,
    nombre: c.CLI_NOMBRE as string,
    fantasia: (c.CLI_FANTAS as string) || null,
    documento: (c.CLI_CUIT__ as string) || (c.CLI_DNI_ as string) || null,
    localidad: (c.CLI_LOCALI as string) || null,
    activo: c.CLI_ACTIVO !== false,
    cuenta: accesos.get(c.CLI_CODIGO as string) ?? null,
  }))
}

function clienteDelSistema(d: Deps, codigo: string) {
  const c = d.sistema.cliente(codigo)
  if (!c) throw new HttpError(404, 'Ese cliente no está en el sistema')
  return c
}

/** Alta de la cuenta o cambio de clave (cierra las sesiones abiertas con la clave anterior). */
export function fijarCuenta(d: Deps, codigo: string, body: Record<string, unknown>) {
  clienteDelSistema(d, codigo)
  const clave = String(body.clave ?? '')
  if (clave.length < CLAVE_MINIMA) throw new HttpError(400, `La clave tiene que tener al menos ${CLAVE_MINIMA} caracteres`)
  const habia = d.app.acceso(codigo)
  d.app.fijarClave(codigo, clave, ahora())
  d.app.cerrarSesiones(codigo)
  return { cuenta: d.app.acceso(codigo), nueva: !habia }
}

export function quitarCuenta(d: Deps, codigo: string) {
  clienteDelSistema(d, codigo)
  d.app.quitarAcceso(codigo)
  return { cuenta: null }
}
