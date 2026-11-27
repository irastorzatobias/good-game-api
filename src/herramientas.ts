// Comandos para verificar la escritura en el sistema sin tocar el sistema real:
//
// good-game-api huella <antes> <después> [--json]
//     Qué cambió entre dos copias de la carpeta del sistema (antes y después de una operación en sistema.exe).
// good-game-api probar-escritura <copia> [--cuenta "1 20758"]
//     Escribe una nota de venta de prueba en una COPIA de la carpeta del sistema con el driver de FoxPro.
//     Se niega a escribir en la carpeta del sistema configurada.

import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { leerConfig } from './config.ts'
import { EscritorVfp } from './escritor/escritor.ts'
import { entradaNotaDeVenta, escribirNotaDeVenta } from './dominio/escritura.ts'
import { Consultas, cod } from './sistema/consultas.ts'
import { huella, textoHuella } from './sistema/huella.ts'
import { Sistema } from './sistema/sistema.ts'
import { terminalDe } from './sistema/terminal.ts'

export const HERRAMIENTAS = ['huella', 'probar-escritura']

const opcion = (args: string[], nombre: string) => {
  const i = args.indexOf(`--${nombre}`)
  return i >= 0 ? args[i + 1] : undefined
}

function mismaCarpeta(a: string, b: string) {
  const n = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase()
  return n(a) === n(b)
}

export async function herramienta(comando: string, args: string[]) {
  if (comando === 'huella') {
    const [antes, despues] = args.filter((a) => !a.startsWith('--'))
    if (!antes || !despues) throw new Error('Uso: good-game-api huella <carpeta antes> <carpeta después> [--json]')
    const h = huella(antes, despues)
    console.log(args.includes('--json') ? JSON.stringify(h, null, 1) : textoHuella(h))
    return
  }

  if (comando === 'probar-escritura') {
    const copia = args.find((a) => !a.startsWith('--'))
    if (!copia) throw new Error('Uso: good-game-api probar-escritura <copia de la carpeta del sistema> [--cuenta "1 20758"]')
    const real = leerConfig().sistema
    if (real && mismaCarpeta(copia, real)) throw new Error('Esa es la carpeta del sistema en uso. La prueba se hace sobre una copia.')
    if (!existsSync(copia) || !readdirSync(copia).some((f) => f.toLowerCase() === 'docum.dbf'))
      throw new Error(`${copia} no es una copia de la carpeta del sistema (no tiene docum.dbf)`)

    const sistema = new Consultas(new Sistema(copia), '1')
    const terminal = terminalDe(copia)
    const articulo = sistema.articulosVenta()[0]
    if (!articulo) throw new Error('La copia no tiene artículos a la venta')
    const entrada = entradaNotaDeVenta(sistema, terminal, {
      cuenta: opcion(args, 'cuenta') ?? cod(20758), // IRASTORZA TOBIAS: toda prueba va a esta cuenta
      usuario: 'PRUEBA',
      observacion: 'PRUEBA GOOD GAME API',
      renglones: [{ articulo: articulo.AR_CODI as string, cantidad: 1 }, { texto: 'Renglón de prueba de la API' }],
    })

    const escritor = new EscritorVfp(copia)
    try {
      console.log('Comprobando el driver de FoxPro...')
      await escritor.probar()
      console.log(`Escribiendo una nota de venta de prueba en ${resolve(copia)} (terminal ${terminal.machin})...`)
      const r = await escribirNotaDeVenta({ escritor, terminal }, entrada)
      console.log(`Listo. Clave ${r.clave}, NV ${r.comprobante}.`)
      console.log('Para ver qué escribió: good-game-api huella <la copia sin tocar> ' + copia)
    } finally {
      escritor.cerrar()
    }
    return
  }

  throw new Error(`Comando desconocido: ${comando}`)
}
