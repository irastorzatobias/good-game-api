// Versión liviana de una clave para la copia en la nube: con el local apagado, el Worker de Cloudflare comprueba el
// login con esto (PBKDF2-SHA256, que corre en el plan gratis). Es más débil que el scrypt de la base del local, por
// eso solo se usa en la nube. Formato "iteraciones:sal:hash" en hex; nube/cripto.ts lo comprueba igual.
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const ITERACIONES = 10_000

export function verificador(clave: string) {
  const sal = randomBytes(16)
  return `${ITERACIONES}:${sal.toString('hex')}:${pbkdf2Sync(clave, sal, ITERACIONES, 32, 'sha256').toString('hex')}`
}
