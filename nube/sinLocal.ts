// Lo que contesta el Worker cuando el local no responde: la última copia que subió la API (src/nube/foto.ts) y lo
// que se puede hacer sin el local, que queda anotado ("pend/…", cifrado) para que la API lo cargue al volver
// (src/nube/pendientes.ts). Cada respuesta imita a la de la API, así la app no nota la diferencia; las reglas son
// las mismas que las de src/dominio/ (mismos límites y mensajes).
//
// Sin el local no se compra ni se canjean puntos: dependen de precios, stock y saldo que solo sabe el local.

import { carpetaCliente, cifrar, claveDni, sha256, verificador, verificar } from './cripto.ts'

export type Env = { NUBE: R2Bucket; ORIGEN: string; CLAVE: string }

// Rutas que la app lee sin sesión: misma lista que PUBLICAS en src/nube/foto.ts.
const PUBLICAS = new Set(['/rubros', '/articulos', '/cotizacion', '/tipodocu', '/promo'])
const DEL_CLIENTE = new Set(['/clientes/me', '/avisos', '/cuenta', '/puntos', '/ordenes', '/solicitudes'])
const CLAVE_MINIMA = 6 // src/dominio/admin.ts
const POR_PAGINA = 50
const HUSO_DEL_LOCAL = -3 // Argentina: las fechas de la app van en hora del local, como las pone la API

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-GG-Respaldo',
}

class Error4xx extends Error {
  status: number
  constructor(status: number, mensaje: string) {
    super(mensaje)
    this.status = status
  }
}

export function json(status: number, datos: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(datos), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' } })
}

const ahoraLocal = () => new Date(Date.now() + HUSO_DEL_LOCAL * 36e5).toISOString().slice(0, 16)
const plano = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

type Paquete = Record<string, any> // ruta de la API → su respuesta (src/nube/foto.ts)
type Acceso = { c: string; v: string; a: boolean }
type FilaPanel = { codigo: string; activo: boolean; cuenta: { creado: string; actualizado: string } | null; t: string; k: string[] } & Record<string, unknown>

class Copia {
  constructor(readonly env: Env) {}
  async leer<T>(clave: string): Promise<T | null> {
    const o = await this.env.NUBE.get(clave)
    return o ? o.json<T>() : null
  }
  guardar(clave: string, datos: unknown) {
    return this.env.NUBE.put(clave, JSON.stringify(datos), { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
  }
  /** Anota lo que el local tiene que cargar al volver, en orden. */
  async anotar(p: Record<string, unknown>) {
    const clave = `pend/${String(Date.now()).padStart(15, '0')}-${crypto.randomUUID()}`
    await this.env.NUBE.put(clave, await cifrar({ ...p, fecha: Date.now() }, this.env.CLAVE))
  }
}

export async function sinLocal(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const copia = new Copia(env)
  const meta = await copia.leer<{ fecha: string }>('meta')
  if (!meta) return json(503, { error: NO_DISPONIBLE })
  const aviso = { 'X-GG-Respaldo': meta.fecha }
  try {
    const r = await atender(req, url.pathname, url.searchParams, copia)
    if (r instanceof Response) {
      for (const [k, v] of Object.entries(aviso)) r.headers.set(k, v)
      return r
    }
    return json(200, r, aviso)
  } catch (e) {
    if (e instanceof Error4xx) return json(e.status, { error: e.message }, aviso)
    throw e
  }
}

// El cliente no se entera de que atiende la copia: ve un error genérico, como cualquier falla pasajera. El motivo
// queda en el log del Worker.
const NO_DISPONIBLE = 'No se pudo completar. Probá de nuevo en un rato.'
const apagado = (motivo: string) => (console.log('sin local:', motivo), new Error4xx(503, NO_DISPONIBLE))

async function atender(req: Request, path: string, query: URLSearchParams, copia: Copia): Promise<unknown> {
  const metodo = req.method
  const body = metodo === 'GET' || metodo === 'DELETE' ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>)
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''

  if (path === '/health') return { ok: true, respaldo: true }
  if (metodo === 'GET' && PUBLICAS.has(path)) {
    const o = await copia.env.NUBE.get('pub' + path)
    if (!o) throw apagado('esto no está en la copia.')
    return new Response(o.body, { headers: { ...CORS, 'Content-Type': o.httpMetadata?.contentType ?? 'application/json', 'Cache-Control': 'no-store' } })
  }
  if (metodo === 'POST' && path === '/auth/login') return loginCliente(copia, body)
  if (metodo === 'POST' && path === '/admin/login') return loginAdmin(copia, body)
  if (path.startsWith('/admin/')) return delPanel(copia, metodo, path, query, body, await adminDe(copia, token))
  return delCliente(copia, metodo, path, body, await carpetaDe(copia, token))
}

// ---- Sesiones: las del local (índice que sube la API) o las abiertas con el local apagado (ses-off/, adm-off/)

async function carpetaDe(copia: Copia, token: string) {
  // Nunca 401: la app cierra la sesión con un 401, y puede ser una sesión posterior a la última copia.
  const sinSesion = apagado('tu sesión es posterior a la última copia. Probá cuando vuelva.')
  if (!token) throw sinSesion
  const h = await sha256(token)
  const carpeta = (await copia.leer<Record<string, string>>('sesiones'))?.[h] ?? (await (await copia.env.NUBE.get('ses-off/' + h))?.text())
  if (!carpeta) throw sinSesion
  return carpeta
}

async function adminDe(copia: Copia, token: string) {
  const sinSesion = apagado('tu sesión del panel es posterior a la última copia. Probá cuando vuelva.')
  if (!token) throw sinSesion
  const h = await sha256(token)
  const usuario = (await copia.leer<Record<string, string>>('sesiones-admin'))?.[h] ?? (await (await copia.env.NUBE.get('adm-off/' + h))?.text())
  if (!usuario) throw sinSesion
  return usuario
}

/** POST /auth/login — como src/dominio/clientes.ts login, con la versión liviana de la clave. */
async function loginCliente(copia: Copia, body: Record<string, any>) {
  const dni = digitos(body.dni)
  const clave = String(body.clave ?? '')
  const h = await claveDni(dni)
  const cuentas = dni ? ((await copia.leer<Record<string, Acceso[]>>('acc/' + h.slice(0, 2)))?.[h] ?? []) : []
  for (const cuenta of cuentas) {
    if (!(await verificar(cuenta.v, clave))) continue
    const token = crypto.randomUUID()
    await copia.env.NUBE.put('ses-off/' + (await sha256(token)), cuenta.c)
    await copia.anotar({ tipo: 'sesion', token, carpeta: cuenta.c })
    const paquete = await copia.leer<Paquete>(cuenta.c)
    return { token, CLI_CODIGO: paquete?.['/clientes/me']?.CLI_CODIGO ?? null }
  }
  throw new Error4xx(401, 'DNI o clave incorrectos')
}

/** POST /admin/login — como src/dominio/admin.ts loginAdmin. */
async function loginAdmin(copia: Copia, body: Record<string, any>) {
  const usuario = String(body.usuario ?? '').trim().toLowerCase()
  const v = (await copia.leer<Record<string, string>>('admins'))?.[usuario]
  if (!usuario || !v || !(await verificar(v, String(body.clave ?? '')))) throw new Error4xx(401, 'Usuario o clave incorrectos')
  const token = crypto.randomUUID()
  await copia.env.NUBE.put('adm-off/' + (await sha256(token)), usuario)
  await copia.anotar({ tipo: 'sesion-admin', token, usuario })
  return { token, usuario }
}

// ---- Cliente: lecturas desde su paquete y cambios que no dependen del local (src/dominio/servicio.ts, clientes.ts)

async function delCliente(copia: Copia, metodo: string, path: string, body: Record<string, any>, carpeta: string) {
  const paquete = await copia.leer<Paquete>(carpeta)
  if (!paquete) throw apagado('tus datos no están en la copia.')
  const guardarYAnotar = async () => {
    await copia.guardar(carpeta, paquete)
    await copia.anotar({ tipo: 'pedido', metodo, path, body, carpeta })
  }
  const orden = (n: string) => {
    const o = (paquete['/ordenes'] ?? []).find((x: any) => String(x.OR_NUMERO_).trim() === n)
    if (!o) throw new Error4xx(404, 'Orden inexistente')
    return o
  }

  if (metodo === 'GET') {
    if (DEL_CLIENTE.has(path)) {
      if (paquete[path] === undefined) throw apagado('esto no está en la copia.')
      return paquete[path]
    }
    let m = path.match(/^\/documentos\/([^/]+)$/)
    if (m) {
      const clave = decodeURIComponent(m[1])
      const doc = (paquete['/cuenta']?.documentos ?? []).find((d: any) => d.DOC_CLAVE_ === clave)
      if (!doc) throw new Error4xx(404, 'No está en la copia guardada')
      return doc
    }
    m = path.match(/^\/documentos\/([^/]+)\/pdf$/)
    if (m) {
      const o = await copia.env.NUBE.get(`${carpeta}/pdf/${encodeURIComponent(decodeURIComponent(m[1]))}`)
      if (!o) throw new Error4xx(404, 'El PDF no está en la copia guardada')
      return new Response(o.body, { headers: { ...CORS, 'Content-Type': o.httpMetadata?.contentType ?? 'application/pdf' } })
    }
    m = path.match(/^\/ordenes\/(\d+)$/)
    if (m) return orden(m[1])
    throw apagado('esto no está en la copia.')
  }

  if (metodo === 'PATCH' && path === '/clientes/me') {
    const perfil = paquete['/clientes/me']
    if (!perfil) throw apagado('tus datos no están en la copia.')
    if (body.app && typeof body.app === 'object') {
      perfil.app = {
        foto: typeof body.app.foto === 'string' ? body.app.foto : null,
        notificaciones: body.app.notificaciones !== false,
        avisosServicio: body.app.avisosServicio !== false,
      }
      await guardarYAnotar()
    }
    return perfil
  }

  if (metodo === 'POST' && path === '/solicitudes') {
    const equipo = String(body.equipo ?? '').trim().slice(0, 80)
    const falla = String(body.falla ?? '').trim().slice(0, 240)
    if (!equipo || !falla) throw new Error4xx(400, 'Faltan datos')
    const lista = (paquete['/solicitudes'] ??= [])
    // Id provisorio (empieza con "s", como los del local): al volver, el local le da el suyo.
    const s = { id: 's' + crypto.randomUUID().slice(0, 8), nro: lista.length + 1, fecha: ahoraLocal(), equipo, falla }
    lista.unshift(s)
    await guardarYAnotar()
    return s
  }

  let m = path.match(/^\/ordenes\/(\d+)\/(mensajes|leidos|respuesta)$/)
  if (metodo === 'POST' && m) {
    const o = orden(m[1])
    o.app ??= { mensajes: [], respuesta: null }
    if (m[2] === 'mensajes') {
      const texto = String(body.texto ?? '').trim().slice(0, 500)
      if (!texto) throw new Error4xx(400, 'Mensaje vacío')
      o.app.mensajes.push({ id: 'm' + crypto.randomUUID().slice(0, 8), de: 'cliente', texto, fecha: ahoraLocal() })
    } else if (m[2] === 'leidos') {
      for (const x of o.app.mensajes) if (x.de === 'tecnico') x.leido = true
    } else {
      if (o.OR_ESTADO_ !== 'DD' || !o.OR_PRE_TOT || o.app.respuesta) throw new Error4xx(409, 'La orden no espera respuesta')
      const aprobado = body.aprobado === true
      o.app.respuesta = {
        aprobado, fecha: ahoraLocal(), condiciones: String(body.condiciones ?? ''),
        ...(typeof body.motivo === 'string' ? { motivo: body.motivo } : {}),
        estimada: aprobado && typeof body.estimada === 'string' ? body.estimada : null,
      }
    }
    await guardarYAnotar()
    return o
  }

  if (path === '/notas-venta' || path === '/canjes') throw apagado('las compras y los canjes de puntos se hacen cuando vuelva.')
  throw apagado('esto se puede hacer cuando vuelva.')
}

// ---- Panel del local: buscar clientes y dar, cambiar o quitar cuentas (src/dominio/admin.ts)

async function delPanel(copia: Copia, metodo: string, path: string, query: URLSearchParams, body: Record<string, any>, usuario: string) {
  const panel = await copia.leer<{ conCuenta: number; clientes: FilaPanel[] }>('admin/clientes')
  if (!panel) throw apagado('la lista de clientes no está en la copia.')
  const sinBusqueda = ({ t, k, ...fila }: FilaPanel) => fila

  if (metodo === 'GET' && path === '/admin/clientes') {
    const q = (query.get('q') ?? '').trim()
    const filtro = query.get('filtro') ?? 'todos'
    const num = digitos(q)
    let r = panel.clientes
    if (q && num && num.length === q.replace(/[\s.-]/g, '').length) {
      const codigo = '1' + num.padStart(6) // cod() de src/sistema/consultas.ts
      r = r.filter((c) => c.codigo === codigo || c.k.includes(num))
    } else if (q) {
      const palabras = plano(q).split(/\s+/).filter(Boolean)
      r = r.filter((c) => palabras.every((p) => c.t.includes(p)))
    }
    if (filtro === 'con') r = r.filter((c) => c.cuenta)
    if (filtro === 'sin') r = r.filter((c) => !c.cuenta)
    const inicio = Math.max(0, Math.floor(Number(query.get('desde') ?? 0)) || 0)
    return { total: r.length, clientes: r.slice(inicio, inicio + POR_PAGINA).map(sinBusqueda), conCuenta: panel.conCuenta }
  }

  const m = path.match(/^\/admin\/clientes\/([^/]+)\/clave$/)
  if (m && (metodo === 'POST' || metodo === 'DELETE')) {
    const fila = panel.clientes.find((c) => c.codigo === decodeURIComponent(m[1]))
    if (!fila) throw new Error4xx(404, 'Ese cliente no está en el sistema')
    let v: string | null = null
    if (metodo === 'POST') {
      const clave = String(body.clave ?? '')
      if (clave.length < CLAVE_MINIMA) throw new Error4xx(400, `La clave tiene que tener al menos ${CLAVE_MINIMA} caracteres`)
      v = await verificador(clave)
    }
    // Los accesos de sus números: con la cuenta nueva ya puede entrar, con el local todavía apagado.
    const carpeta = await carpetaCliente(fila.codigo)
    for (const dni of fila.k) {
      const h = await claveDni(dni)
      const grupo = (await copia.leer<Record<string, Acceso[]>>('acc/' + h.slice(0, 2))) ?? {}
      const resto = (grupo[h] ?? []).filter((a) => a.c !== carpeta)
      grupo[h] = v ? [...resto, { c: carpeta, v, a: fila.activo }].sort((x, y) => Number(y.a) - Number(x.a)) : resto
      await copia.guardar('acc/' + h.slice(0, 2), grupo)
    }
    const habia = fila.cuenta
    const ahora = ahoraLocal()
    fila.cuenta = v ? { creado: habia?.creado ?? ahora, actualizado: ahora } : null
    panel.conCuenta += (fila.cuenta ? 1 : 0) - (habia ? 1 : 0)
    await copia.guardar('admin/clientes', panel)
    await copia.anotar({ tipo: 'pedido', metodo, path, body, usuario })
    return metodo === 'POST' ? { cuenta: fila.cuenta, nueva: !habia } : { cuenta: null }
  }
  throw apagado('esto se puede hacer cuando vuelva.')
}
