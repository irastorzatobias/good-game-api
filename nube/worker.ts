// Worker de Cloudflare delante de la API del local.
//
// Con el local prendido no hace nada: pasa cada pedido a la API (por el túnel) y devuelve su respuesta. Si el túnel
// no responde (PC apagada, sin internet, API caída), atiende con la última copia y anota los cambios para el local
// (sinLocal.ts). Cada respuesta de la copia lleva "X-GG-Respaldo: <fecha de la copia>": la app lo avisa.
//
// /_nube/… es solo para la API del local (clave compartida): subir y borrar piezas de la copia, leer lo anotado
// (_pendientes) y listar todo (_lista).

import { json, sinLocal, type Env } from './sinLocal.ts'

/** Lo que devuelve Cloudflare cuando el túnel o la API no están: el local no contestó. */
const SIN_LOCAL = new Set([502, 504, 530])
const ESPERA_LECTURA_MS = 15_000

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/_nube/')) return paraElLocal(req, env, url.pathname.slice('/_nube/'.length))
    // Se guarda el cuerpo antes de mandarlo: si el local no contesta, lo atiende la copia.
    const cuerpo = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
    try {
      const origen = new URL(url.pathname + url.search, env.ORIGEN)
      const res = await fetch(new Request(origen, { method: req.method, headers: req.headers, body: cuerpo }),
        req.method === 'GET' ? { signal: AbortSignal.timeout(ESPERA_LECTURA_MS) } : {})
      if (!SIN_LOCAL.has(res.status)) return res
    } catch {
      // sin respuesta: igual que el local apagado
    }
    return sinLocal(new Request(req.url, { method: req.method, headers: req.headers, body: cuerpo }), env, url)
  },
}

async function paraElLocal(req: Request, env: Env, clave: string) {
  if (!env.CLAVE || req.headers.get('X-Nube-Clave') !== env.CLAVE) return json(401, { error: 'Clave inválida' })
  if (req.method === 'GET' && clave === '_pendientes') {
    const ids = await listar(env, 'pend/')
    const datos = await Promise.all(ids.map(async (id) => ({ id, dato: (await (await env.NUBE.get(id))?.text()) ?? '' })))
    return json(200, datos.filter((p) => p.dato))
  }
  if (req.method === 'GET' && clave === '_lista') return json(200, await listar(env))
  if (!clave || clave.includes('..') || clave.startsWith('_')) return json(400, { error: 'Clave de pieza inválida' })
  if (req.method === 'PUT') {
    await env.NUBE.put(clave, req.body, { httpMetadata: { contentType: req.headers.get('Content-Type') ?? 'application/octet-stream' } })
    return json(200, { ok: true })
  }
  if (req.method === 'DELETE') {
    await env.NUBE.delete(clave)
    return json(200, { ok: true })
  }
  return json(405, { error: 'Método no permitido' })
}

/** Todas las claves (con `prefijo`), en orden. */
async function listar(env: Env, prefijo?: string) {
  const claves: string[] = []
  let cursor: string | undefined
  do {
    const r = await env.NUBE.list({ prefix: prefijo, cursor })
    claves.push(...r.objects.map((o) => o.key))
    cursor = r.truncated ? r.cursor : undefined
  } while (cursor)
  return claves
}
