import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { SistemaOcupado } from './sistema/sistema.ts'

export class HttpError extends Error {
  status: number
  constructor(status: number, mensaje: string) {
    super(mensaje)
    this.status = status
  }
}

/** Lo que devuelve un manejador cuando la respuesta es un archivo y no JSON. */
export class Archivo {
  ruta: string
  tipo: string
  nombre: string
  constructor(ruta: string, tipo: string, nombre: string) {
    this.ruta = ruta
    this.tipo = tipo
    this.nombre = nombre
  }
}

export type Ctx = { cliente: string; body: Record<string, unknown>; query: URLSearchParams; params: string[] }
export type Ruta = { metodo: string; patron: RegExp; manejar: (c: Ctx) => unknown; publica?: boolean }

function enviar(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function enviarArchivo(res: ServerResponse, a: Archivo) {
  res.writeHead(200, { 'Content-Type': a.tipo, 'Content-Disposition': `inline; filename="${a.nombre}"` })
  createReadStream(a.ruta).on('error', () => res.destroy()).pipe(res)
}

const LIMITE_BODY = 2_000_000 // alcanza para una foto de perfil
async function leerBody(req: IncomingMessage) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > LIMITE_BODY) throw new HttpError(413, 'Pedido demasiado grande')
  }
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

/** Servidor JSON con CORS abierto: la app es una PWA en otro dominio. */
export function servidor(rutas: Ruta[], clienteDeToken: (token: string) => string | undefined) {
  return createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      for (const { metodo, patron, manejar, publica } of rutas) {
        const m = url.pathname.match(patron)
        if (!m || metodo !== req.method) continue
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
        const cliente = token ? clienteDeToken(token) : undefined
        if (!publica && !cliente) throw new HttpError(401, 'Sesión inválida')
        const params = m.slice(1).map(decodeURIComponent)
        const r = await manejar({ cliente: cliente ?? '', body: await leerBody(req), query: url.searchParams, params })
        if (r instanceof Archivo) return enviarArchivo(res, r)
        return enviar(res, 200, r)
      }
      throw new HttpError(404, 'Ruta inexistente')
    } catch (e) {
      if (e instanceof HttpError) return enviar(res, e.status, { error: e.message })
      if (e instanceof SistemaOcupado) return enviar(res, 503, { error: 'El sistema del local está ocupado, probá en un rato' })
      console.error(new Date().toISOString(), req.method, url.pathname, e)
      enviar(res, 500, { error: 'Error interno' })
    }
  })
}
