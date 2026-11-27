// Hashes, claves y cifrado del Worker. Tienen que coincidir con la API del local:
// carpetaCliente y claveDni con src/nube/foto.ts, el verificador con src/app/verificador.ts y el cifrado de los
// pendientes con src/nube/pendientes.ts.

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const deHex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)))

export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
export const carpetaCliente = async (cliente: string) => 'cli/' + (await sha256('cliente:' + cliente)).slice(0, 32)
export const claveDni = (dni: string) => sha256('dni:' + dni)

const ITERACIONES = 10_000

async function pbkdf2(clave: string, sal: Uint8Array<ArrayBuffer>, iteraciones: number) {
  const k = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, k, 256))
}

/** ¿`clave` corresponde al verificador "iteraciones:sal:hash"? */
export async function verificar(v: string, clave: string) {
  const [it, sal, hash] = v.split(':')
  if (!it || !sal || !hash) return false
  const calculado = await pbkdf2(clave, deHex(sal), Number(it))
  // Comparación en tiempo constante.
  let distinto = calculado.length ^ hash.length
  for (let i = 0; i < calculado.length; i++) distinto |= calculado.charCodeAt(i) ^ hash.charCodeAt(i)
  return distinto === 0
}

export async function verificador(clave: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  return `${ITERACIONES}:${hex(sal.buffer)}:${await pbkdf2(clave, sal, ITERACIONES)}`
}

/** AES-256-GCM con llave sha256("pendientes:" + clave compartida); base64 de iv + cifrado (+ tag al final). */
export async function cifrar(datos: unknown, claveCompartida: string) {
  const llave = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('pendientes:' + claveCompartida)),
    'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, enc.encode(JSON.stringify(datos))))
  const todo = new Uint8Array(iv.length + c.length)
  todo.set(iv)
  todo.set(c, iv.length)
  // De a tramos: una foto de perfil no entra como argumentos de una sola llamada.
  let bin = ''
  for (let i = 0; i < todo.length; i += 0x8000) bin += String.fromCharCode(...todo.subarray(i, i + 0x8000))
  return btoa(bin)
}
