// good-game-api               levanta la API (en Windows, la primera vez pide elegir la carpeta del sistema)
// good-game-api clave DNI X   da de alta o cambia la clave de un cliente
// good-game-api revisar       comprueba la configuración y lee las tablas
import { networkInterfaces } from 'node:os'
import { ArchivoContenido } from './app/contenido.ts'
import { AppStore } from './app/store.ts'
import { guardarSistema, leerConfig } from './config.ts'
import type { Deps } from './dominio/deps.ts'
import { servidor } from './http.ts'
import { rutas } from './rutas.ts'
import { Consultas } from './sistema/consultas.ts'
import { Sistema, TABLAS } from './sistema/sistema.ts'
import { elegirCarpeta, esWindows, esperarEnter } from './windows.ts'

// node:sqlite avisa que es experimental en cada arranque: no aporta nada en el log.
process.removeAllListeners('warning').on('warning', (w) => w.name !== 'ExperimentalWarning' && console.warn(w))

/** Abre Sistema_Local. Si no está configurada o no es la carpeta correcta, en Windows se pide elegirla y se recuerda. */
function abrirSistema(carpeta: string | null): Sistema {
  let motivo = 'Todavía no se eligió la carpeta del sistema.'
  if (carpeta) {
    try {
      return new Sistema(carpeta)
    } catch (e) {
      motivo = (e as Error).message
    }
  }
  if (!esWindows) throw new Error(`${motivo} Poné "sistema" en config.json o usá GG_SISTEMA.`)
  for (;;) {
    console.log(motivo)
    const elegida = elegirCarpeta('Elegí la carpeta del sistema de Good Game (la que tiene clientes.dbf, articulo.dbf, docum.dbf...)')
    if (!elegida) throw new Error('No se eligió ninguna carpeta.')
    try {
      const sistema = new Sistema(elegida)
      guardarSistema(elegida)
      return sistema
    } catch (e) {
      motivo = (e as Error).message
    }
  }
}

function abrir(): Deps & { puerto: number; tablas: Sistema } {
  const cfg = leerConfig()
  const tablas = abrirSistema(cfg.sistema)
  return { tablas, sistema: new Consultas(tablas, cfg.sucursal), app: new AppStore(cfg.base),
    contenido: new ArchivoContenido(cfg.contenido), puerto: cfg.puerto }
}

const direcciones = () =>
  Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address)

const [comando, ...args] = process.argv.slice(2)
try {
  const d = abrir()
  if (comando === 'clave') {
    const [dni, clave] = args
    if (!dni || !clave) throw new Error('Uso: good-game-api clave <DNI> <clave>')
    const cli = d.sistema.clientesPorDni(dni)[0]
    if (!cli) throw new Error(`No hay ningún cliente con DNI ${dni} en clientes.DBF`)
    d.app.fijarClave(dni.replace(/\D/g, ''), clave)
    console.log(`Clave guardada para ${cli.CLI_NOMBRE} (${cli.CLI_CODIGO})`)
  } else if (comando === 'revisar') {
    for (const t of TABLAS) console.log(`${t.padEnd(12)} ${d.tablas.tabla(t).cantidad} registros`)
    console.log(`Dólar: ${d.sistema.cotizacion().DC_COTIZA} · artículos a la venta: ${d.sistema.articulosVenta().length}`)
  } else if (!comando) {
    servidor(rutas(d), (token) => d.app.clienteDeSesion(token))
      .on('error', (e: NodeJS.ErrnoException) => {
        console.error(e.code === 'EADDRINUSE' ? `El puerto ${d.puerto} ya está en uso: ¿la API ya está corriendo (o como servicio)?` : e.message)
        esperarEnter()
        process.exit(1)
      })
      .listen(d.puerto, () => {
        console.log(`Good Game API funcionando. Lee el sistema de ${d.tablas.carpeta}`)
        for (const ip of ['localhost', ...direcciones()]) console.log(`  http://${ip}:${d.puerto}`)
        console.log('No cierres esta ventana mientras la app esté en uso.')
      })
  } else {
    throw new Error(`Comando desconocido: ${comando}`)
  }
} catch (e) {
  console.error((e as Error).message)
  esperarEnter()
  process.exit(1)
}
