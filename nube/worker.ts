// Worker de Cloudflare delante de la API del local.
//
// Con el local prendido no hace nada: pasa cada pedido a la API (por el túnel) y devuelve su respuesta. Si el túnel
// no responde (PC apagada, sin internet, API caída), contesta las lecturas de la app con la última copia que subió la
// API (src/nube/) a R2. Sin el local no se puede escribir ni iniciar sesión: eso devuelve 503 con un mensaje claro.
// Cada respuesta de la copia lleva "X-GG-Respaldo: <fecha de la copia>" para que la app pueda avisarlo.

type Env = { NUBE: R2Bucket; ORIGEN: string; CLAVE: string } // CLAVE es un secret (wrangler secret put)

/** Lo que devuelve Cloudflare cuando el túnel o la API no están: el local no contestó. */
const SIN_LOCAL = new Set([502, 504, 530])
const ESPERA_LECTURA_MS = 15_000
// Rutas que la app lee sin sesión: misma lista que PUBLICAS en src/nube/foto.ts.
const PUBLICAS = new Set(['/rubros', '/articulos', '/cotizacion', '/tipodocu', '/promo'])

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-GG-Respaldo',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/_nube/')) return recibir(req, env, url.pathname.slice('/_nube/'.length))
    try {
      const origen = new URL(url.pathname + url.search, env.ORIGEN)
      const res = await fetch(new Request(origen, req), req.method === 'GET' ? { signal: AbortSignal.timeout(ESPERA_LECTURA_MS) } : {})
      if (!SIN_LOCAL.has(res.status)) return res
    } catch {
      // sin respuesta: igual que el local apagado
    }
    return desdeLaCopia(req, env, url)
  },
}

/** La API del local sube (PUT) o borra (DELETE) piezas de la copia, con la clave compartida. */
async function recibir(req: Request, env: Env, clave: string) {
  if (!env.CLAVE || req.headers.get('X-Nube-Clave') !== env.CLAVE) return json(401, { error: 'Clave inválida' })
  if (!clave || clave.includes('..')) return json(400, { error: 'Clave de pieza inválida' })
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

async function desdeLaCopia(req: Request, env: Env, url: URL) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const meta = await env.NUBE.get('meta')
  if (!meta) return json(503, { error: 'El local está apagado y todavía no hay una copia guardada.' })
  const { fecha } = await meta.json<{ fecha: string }>()
  const aviso = { 'X-GG-Respaldo': fecha }
  const path = url.pathname
  if (path === '/health') return json(200, { ok: true, respaldo: fecha }, aviso)
  if (req.method !== 'GET') {
    const error = path.endsWith('/login')
      ? 'El local está apagado: no se puede iniciar sesión hasta que vuelva. Si ya habías entrado, tus datos siguen a mano.'
      : 'El local está apagado: por ahora solo se puede ver lo último guardado, no hacer cambios.'
    return json(503, { error }, aviso)
  }

  let clave = 'pub' + path
  if (!PUBLICAS.has(path)) {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')
    const sesiones = token && (await env.NUBE.get('sesiones'))
    const carpeta = sesiones && (await sesiones.json<Record<string, string>>())[await sha256(token)]
    // Puede ser una sesión abierta después de la última copia: no se la cierra (un 401 saca al cliente de la app).
    if (!carpeta) return json(503, { error: 'El local está apagado y tu sesión es posterior a la última copia. Probá cuando vuelva.' }, aviso)
    clave = carpeta + path
  }
  const obj = await env.NUBE.get(clave)
  if (!obj) {
    // Un comprobante u orden que no está en la copia es como uno inexistente; el resto es que falta en la copia.
    const detalle = /^\/(documentos|ordenes)\//.test(path)
    return json(detalle ? 404 : 503, { error: detalle ? 'No está en la copia guardada' : 'El local está apagado y esto no está en la copia.' }, aviso)
  }
  return new Response(obj.body, {
    headers: { ...CORS, ...aviso, 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
  })
}

function json(status: number, datos: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(datos), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' } })
}

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
