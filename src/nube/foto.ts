// Foto de lo que la app lee de la API, para servirla desde la nube cuando el local está apagado.
//
// Lo de cada cliente sale de las mismas rutas de la API (así la copia nunca difiere de la respuesta real) y va en un
// solo objeto por cliente ("paquete": ruta → respuesta); el Worker saca de ahí cada pedido, también el detalle de un
// comprobante o de una orden. Van todos los clientes del sistema, no solo los que tienen sesión: con el local apagado
// se puede entrar y el panel puede dar cuentas nuevas. Lo que ve el Worker de cada uno está en nube/worker.ts.

import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Archivo, encontrar, HttpError, type Ruta } from '../http.ts'
import { enDias } from '../fechas.ts'
import type { Deps } from '../dominio/deps.ts'
import { filaDelPanel } from '../dominio/admin.ts'
import { numerosDeAcceso, plano } from '../sistema/consultas.ts'

/** Un objeto de la copia: `huella` cambia cuando cambia el contenido, y solo entonces se vuelve a subir. */
export type Pieza = { clave: string; tipo: string; huella: string; cuerpo: () => Promise<Buffer> }

const PUBLICAS = ['/rubros', '/articulos', '/cotizacion', '/tipodocu', '/promo']
const DEL_CLIENTE = ['/clientes/me', '/avisos', '/cuenta', '/puntos', '/ordenes', '/solicitudes']
// La app pide la cuenta de los últimos 6 meses; la copia guarda un año y se sirve para cualquier ?desde.
const DIAS_DE_CUENTA = 366

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
// Los nombres de objeto no llevan códigos de cliente, DNI ni tokens: solo hashes. Deben coincidir con nube/cripto.ts.
export const carpetaCliente = (cliente: string) => 'cli/' + sha256('cliente:' + cliente).slice(0, 32)
const claveDni = (dni: string) => sha256('dni:' + dni)

function json(clave: string, datos: unknown, paraHuella: unknown = datos): Pieza {
  const b = Buffer.from(JSON.stringify(datos))
  const huella = paraHuella === datos ? sha256(b) : sha256(JSON.stringify(paraHuella))
  return { clave, tipo: 'application/json; charset=utf-8', huella, cuerpo: async () => b }
}

function archivo(clave: string, a: Archivo): Pieza {
  const st = statSync(a.ruta)
  return { clave, tipo: a.tipo, huella: `${st.size}-${st.mtimeMs}`, cuerpo: () => readFile(a.ruta) }
}

/** Lo que responde la ruta GET `path` para ese cliente; undefined si no existe (404). `null` es una respuesta válida. */
async function pedir(rutas: Ruta[], path: string, cliente = '', query = '') {
  const hallada = encontrar(rutas, 'GET', path)
  if (!hallada) throw new Error(`La foto pide ${path}, que no es una ruta de la API`)
  try {
    return await hallada.ruta.manejar({ cliente, admin: '', body: {}, query: new URLSearchParams(query), params: hallada.params })
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return undefined
    throw e
  }
}

async function delCliente(rutas: Ruta[], cliente: string): Promise<Pieza[]> {
  const carpeta = carpetaCliente(cliente)
  const paquete: Record<string, unknown> = {}
  for (const path of DEL_CLIENTE) {
    const r = await pedir(rutas, path, cliente, path === '/cuenta' ? `desde=${enDias(-DIAS_DE_CUENTA)}` : '')
    if (r !== undefined) paquete[path] = r
  }
  // El ranking cambia para todos cuando cualquiera suma puntos: no cuenta para la huella, así no se resube a todos
  // los clientes por eso (se actualiza cuando cambia algo propio del cliente).
  const puntos = paquete['/puntos'] as Record<string, unknown> | undefined
  const piezas = [json(carpeta, paquete, puntos ? { ...paquete, '/puntos': { ...puntos, ranking: null } } : paquete)]
  const cuenta = paquete['/cuenta'] as { documentos: { DOC_CLAVE_: string; pdf?: boolean }[] } | undefined
  for (const doc of cuenta?.documentos ?? []) {
    if (!doc.pdf) continue
    const pdf = await pedir(rutas, `/documentos/${encodeURIComponent(doc.DOC_CLAVE_)}/pdf`, cliente)
    if (pdf instanceof Archivo) piezas.push(archivo(`${carpeta}/pdf/${encodeURIComponent(doc.DOC_CLAVE_)}`, pdf))
  }
  return piezas
}

/**
 * Lo que necesita el Worker para el login sin el local: por cada número con el que se puede entrar (hash), las
 * cuentas que lo usan con la versión liviana de su clave. Repartido en 256 objetos ("acc/xx") para leer poco.
 */
function accesos(d: Deps): Pieza[] {
  const grupos = new Map<string, Record<string, { c: string; v: string; a: boolean }[]>>()
  for (const [cliente, v] of d.app.verificadores()) {
    const c = d.sistema.cliente(cliente)
    if (!c) continue
    for (const dni of numerosDeAcceso(c)) {
      const h = claveDni(dni)
      const grupo = grupos.get(h.slice(0, 2)) ?? {}
      grupos.set(h.slice(0, 2), grupo)
      grupo[h] = [...(grupo[h] ?? []), { c: carpetaCliente(cliente), v, a: c.CLI_ACTIVO !== false }].sort((x, y) => Number(y.a) - Number(x.a))
    }
  }
  return [...grupos].map(([g, contenido]) => json('acc/' + g, contenido))
}

/** La lista del panel, con lo que el Worker necesita para buscar (texto plano, números de acceso, número de cliente). */
function panel(d: Deps): Pieza {
  const cuentas = d.app.accesos()
  const clientes = d.sistema.buscarClientes('').map((c) => ({
    ...filaDelPanel(c, cuentas),
    t: `${plano(c.CLI_NOMBRE)} ${plano(c.CLI_FANTAS)}`,
    k: numerosDeAcceso(c),
  }))
  return json('admin/clientes', { conCuenta: cuentas.size, clientes })
}

/** La foto completa. Cede el paso entre cliente y cliente para que la API siga atendiendo mientras se arma. */
export async function foto(d: Deps, rutas: Ruta[]): Promise<Pieza[]> {
  const piezas: Pieza[] = []
  for (const path of PUBLICAS) {
    const r = await pedir(rutas, path)
    if (r !== undefined) piezas.push(json('pub' + path, r))
  }
  for (const c of d.sistema.buscarClientes('')) {
    piezas.push(...(await delCliente(rutas, c.CLI_CODIGO as string)))
    await new Promise(setImmediate)
  }
  piezas.push(...accesos(d), panel(d))
  piezas.push(json('admins', Object.fromEntries(d.app.verificadoresAdmin())))
  // Índices de sesiones: hash(token) → de quién. Una sesión cerrada en el local deja de abrir la copia.
  piezas.push(json('sesiones', Object.fromEntries(d.app.sesiones().map((s) => [sha256(s.token), carpetaCliente(s.cliente)]))))
  piezas.push(json('sesiones-admin', Object.fromEntries(d.app.sesionesAdmin().map((s) => [sha256(s.token), s.usuario]))))
  return piezas
}
