// Acceso y perfil. La clave no existe en el sistema: el DNI se busca en clientes.DBF y la clave en la base propia.
import { randomUUID } from 'node:crypto'
import { HttpError } from '../http.ts'
import { ahora } from '../fechas.ts'
import type { Deps } from './deps.ts'

export function login(d: Deps, body: Record<string, unknown>) {
  const dni = String(body.dni ?? '').replace(/\D/g, '')
  const cli = d.sistema.clientesPorDni(dni)[0]
  if (!cli || !d.app.claveValida(dni, String(body.clave ?? ''))) throw new HttpError(401, 'DNI o clave incorrectos')
  const token = randomUUID()
  d.app.abrirSesion(token, cli.CLI_CODIGO as string, ahora())
  return { token, CLI_CODIGO: cli.CLI_CODIGO }
}

/** Fila de clientes.DBF con los contactos que el cliente corrigió en la app encima; `app` son preferencias. */
export function perfil(d: Deps, cliente: string) {
  const c = d.sistema.cliente(cliente)
  if (!c) throw new HttpError(404, 'Cliente inexistente')
  return { ...c, ...d.app.contacto(cliente), app: d.app.prefs(cliente) }
}

// Solo datos de contacto: lista, IVA y crédito los maneja el local.
const CONTACTO = ['CLI_FANTAS', 'CLI_DIRECC', 'CLI_LOCALI', 'CLI_CELULA', 'CLI_EMAIL_'] as const

export function actualizarPerfil(d: Deps, cliente: string, body: Record<string, unknown>) {
  const cambios = { ...d.app.contacto(cliente) }
  for (const k of CONTACTO) if (typeof body[k] === 'string') cambios[k] = (body[k] as string).trim()
  d.app.guardarContacto(cliente, cambios, ahora())
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
