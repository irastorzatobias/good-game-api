// Lo que se hizo con el local apagado queda anotado en la nube ("pendientes", nube/worker.ts). Al volver, la API lo
// carga en orden con las mismas rutas que usa la app y con la hora en que pasó; un pedido que ya no corresponde
// (la orden cambió de estado, el cliente ya no existe) se descarta y queda en el log.
// Van cifrados en R2 (pueden llevar claves): AES-256-GCM con una llave sacada de la clave compartida.

import { createDecipheriv, createHash } from 'node:crypto'
import { encontrar, type Ruta } from '../http.ts'
import { ahora, conFecha } from '../fechas.ts'
import type { Deps } from '../dominio/deps.ts'
import { carpetaCliente } from './foto.ts'

export type Pendiente =
  | { tipo: 'sesion'; fecha: number; token: string; carpeta: string }
  | { tipo: 'sesion-admin'; fecha: number; token: string; usuario: string }
  | { tipo: 'pedido'; fecha: number; metodo: string; path: string; body: Record<string, unknown>; carpeta?: string; usuario?: string }

export function descifrar(texto: string, clave: string): Pendiente {
  const llave = createHash('sha256').update('pendientes:' + clave).digest()
  const b = Buffer.from(texto, 'base64')
  const d = createDecipheriv('aes-256-gcm', llave, b.subarray(0, 12))
  d.setAuthTag(b.subarray(b.length - 16))
  return JSON.parse(Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8'))
}

/** Carga uno. Devuelve las carpetas de clientes que tocó (su copia hay que volver a subirla). */
export async function aplicar(d: Deps, rutas: Ruta[], p: Pendiente, clienteDe: (carpeta: string) => string | undefined) {
  const cuando = () => conFecha(p.fecha, ahora)
  if (p.tipo === 'sesion-admin') {
    d.app.abrirSesionAdmin(p.token, p.usuario, cuando())
    return []
  }
  const cliente = p.carpeta ? clienteDe(p.carpeta) : undefined
  if (p.carpeta && !cliente) throw new Error('el cliente ya no está en el sistema')
  if (p.tipo === 'sesion') {
    d.app.abrirSesion(p.token, cliente!, cuando())
    return []
  }
  const hallada = encontrar(rutas, p.metodo, p.path)
  if (!hallada) throw new Error(`${p.metodo} ${p.path} no es una ruta de la API`)
  if ((hallada.ruta.acceso === 'cliente' && !cliente) || (hallada.ruta.acceso === 'admin' && !p.usuario)) throw new Error('sin sesión')
  await conFecha(p.fecha, () =>
    hallada.ruta.manejar({ cliente: cliente ?? '', admin: p.usuario ?? '', body: p.body, query: new URLSearchParams(), params: hallada.params }))
  // Cambiar o quitar la clave desde el panel toca la copia de ese cliente.
  const deOtro = hallada.ruta.acceso === 'admin' && hallada.params[0] ? [carpetaCliente(hallada.params[0])] : []
  return [...(p.carpeta ? [p.carpeta] : []), ...deOtro]
}
