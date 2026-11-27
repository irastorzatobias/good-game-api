// Foto de lo que la app lee de la API, para servirla desde la nube cuando el local está apagado.
//
// Se arma pidiéndole a las mismas rutas de la API lo que pediría la app (así la copia nunca difiere de la respuesta
// real): el catálogo, y para cada cliente con una sesión abierta su perfil, cuenta, comprobantes, puntos y servicio.
// La nube la guarda por clave; el Worker traduce cada pedido de la app a una de estas claves.

import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Archivo, encontrar, HttpError, type Ruta } from '../http.ts'
import { enDias } from '../fechas.ts'

/** Un objeto de la copia: `huella` cambia cuando cambia el contenido, y solo entonces se vuelve a subir. */
export type Pieza = { clave: string; tipo: string; huella: string; cuerpo: () => Promise<Buffer> }

const PUBLICAS = ['/rubros', '/articulos', '/cotizacion', '/tipodocu', '/promo']
const DEL_CLIENTE = ['/clientes/me', '/avisos', '/cuenta', '/puntos', '/ordenes', '/solicitudes']
// La app pide la cuenta de los últimos 6 meses; la copia guarda un año y se sirve para cualquier ?desde.
const DIAS_DE_CUENTA = 366

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
/** Carpeta de un cliente en la nube: no lleva su código. Debe coincidir con el Worker (nube/worker.ts). */
export const carpetaCliente = (cliente: string) => 'cli/' + sha256('cliente:' + cliente).slice(0, 32)

function json(clave: string, datos: unknown): Pieza {
  const b = Buffer.from(JSON.stringify(datos))
  return { clave, tipo: 'application/json; charset=utf-8', huella: sha256(b), cuerpo: async () => b }
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
  const piezas: Pieza[] = []
  const agregar = async (path: string, query = '') => {
    const r = await pedir(rutas, path, cliente, query)
    if (r !== undefined) piezas.push(r instanceof Archivo ? archivo(carpeta + path, r) : json(carpeta + path, r))
    return r
  }
  for (const path of DEL_CLIENTE.filter((p) => p !== '/cuenta' && p !== '/ordenes')) await agregar(path)

  const cuenta = (await agregar('/cuenta', `desde=${enDias(-DIAS_DE_CUENTA)}`)) as { documentos: { DOC_CLAVE_: string; pdf?: boolean }[] }
  for (const doc of cuenta.documentos) {
    const path = `/documentos/${encodeURIComponent(doc.DOC_CLAVE_)}`
    await agregar(path)
    if (doc.pdf) await agregar(path + '/pdf')
  }
  const ordenes = (await agregar('/ordenes')) as { OR_NUMERO_: string }[]
  for (const o of ordenes) await agregar(`/ordenes/${encodeURIComponent(String(o.OR_NUMERO_).trim())}`)
  return piezas
}

/**
 * La foto completa. `sesiones` va como índice hash(token) → carpeta del cliente: la nube nunca ve un token ni un
 * código de cliente, y una sesión cerrada en el local deja de abrir la copia en la próxima subida.
 */
export async function foto(rutas: Ruta[], sesiones: { token: string; cliente: string }[]): Promise<Pieza[]> {
  const piezas: Pieza[] = []
  for (const path of PUBLICAS) {
    const r = await pedir(rutas, path)
    if (r !== undefined) piezas.push(json('pub' + path, r))
  }
  for (const cliente of new Set(sesiones.map((s) => s.cliente))) piezas.push(...(await delCliente(rutas, cliente)))
  piezas.push(json('sesiones', Object.fromEntries(sesiones.map((s) => [sha256(s.token), carpetaCliente(s.cliente)]))))
  return piezas
}
