// Acceso y perfil. La clave no existe en el sistema: el DNI se busca en clientes.DBF y la clave en la base propia.
import { randomUUID } from 'node:crypto'
import { HttpError } from '../http.ts'
import { ahora } from '../fechas.ts'
import type { Deps } from './deps.ts'

export function login(d: Deps, body: Record<string, unknown>) {
  const dni = String(body.dni ?? '').replace(/\D/g, '')
  const clave = String(body.clave ?? '')
  // Un DNI puede estar en más de una ficha (persona y su empresa): entra a la que tenga esa clave.
  const cli = dni ? d.sistema.clientesPorDni(dni).find((c) => d.app.claveValida(c.CLI_CODIGO as string, clave)) : undefined
  if (!cli) throw new HttpError(401, 'DNI o clave incorrectos')
  const token = randomUUID()
  d.app.abrirSesion(token, cli.CLI_CODIGO as string, ahora())
  return { token, CLI_CODIGO: cli.CLI_CODIGO }
}

/** Fila de clientes.DBF tal cual (los datos de contacto los maneja el local); `app` son preferencias de la app. */
export function perfil(d: Deps, cliente: string) {
  const c = d.sistema.cliente(cliente)
  if (!c) throw new HttpError(404, 'Cliente inexistente')
  return { ...c, app: d.app.prefs(cliente) }
}

/** Solo preferencias de la app (foto y avisos). Los datos del sistema no se cambian desde la app. */
export function actualizarPerfil(d: Deps, cliente: string, body: Record<string, unknown>) {
  if (body.app && typeof body.app === 'object') {
    const a = body.app as Record<string, unknown>
    d.app.guardarPrefs(cliente, {
      foto: typeof a.foto === 'string' ? a.foto : null,
      notificaciones: a.notificaciones !== false,
      avisosServicio: a.avisosServicio !== false,
    })
  }
  return perfil(d, cliente)
}
