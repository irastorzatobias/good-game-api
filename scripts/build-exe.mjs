// Arma el paquete de instalación para Windows: dist/good-game-api-<versión>-win-x64.zip
//   good-game-api.exe          la API en un solo ejecutable (Node SEA, no hace falta Node en el servidor)
//   good-game-api-service.exe  WinSW: la registra como servicio de Windows
//   Iniciar con Windows.bat / Quitar inicio automatico.bat, contenido.json, LEEME.txt
//
// node scripts/build-exe.mjs          paquete para Windows (se puede armar desde macOS o Linux)
// node scripts/build-exe.mjs --host   ejecutable para esta máquina, para probar el .exe sin Windows
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const WINSW = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
const host = process.argv.includes('--host')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const nombre = `good-game-api-${version}-win-x64`
const salida = join('dist', host ? 'host' : nombre)
const cache = '.cache'
const run = (cmd, args, cwd) => execFileSync(cmd, args, { stdio: 'inherit', cwd })

async function bajar(url, destino) {
  if (existsSync(destino)) return
  console.log(`Bajando ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  writeFileSync(destino, Buffer.from(await res.arrayBuffer()))
}

rmSync(salida, { recursive: true, force: true })
mkdirSync(salida, { recursive: true })
mkdirSync(cache, { recursive: true })

// 1. Un solo archivo CommonJS: SEA no carga módulos ESM ni node_modules.
await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist/build/main.cjs',
  define: { __VERSION__: JSON.stringify(version) } })

// 2. Blob SEA. Sin snapshot ni code cache para que el blob armado acá sirva en el node.exe de Windows.
writeFileSync('dist/build/sea-config.json', JSON.stringify({
  main: 'dist/build/main.cjs', output: 'dist/build/sea.blob',
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false,
}))
run(process.execPath, ['--experimental-sea-config', 'dist/build/sea-config.json'])

// 3. Se inyecta en un node.exe de la misma versión que armó el blob.
const fuse = ['--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']
const postject = join('node_modules', '.bin', 'postject')
if (host) {
  const exe = join(salida, 'good-game-api')
  copyFileSync(process.execPath, exe)
  if (process.platform === 'darwin') run('codesign', ['--remove-signature', exe])
  run(postject, [exe, 'NODE_SEA_BLOB', 'dist/build/sea.blob', ...fuse, ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])])
  if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe])
  console.log(`Listo: ${exe}`)
  process.exit(0)
}
const nodeExe = join(cache, `node-${process.version}-win-x64.exe`)
await bajar(`https://nodejs.org/dist/${process.version}/win-x64/node.exe`, nodeExe)
copyFileSync(nodeExe, join(salida, 'good-game-api.exe'))
run(postject, [join(salida, 'good-game-api.exe'), 'NODE_SEA_BLOB', 'dist/build/sea.blob', ...fuse])

// 4. Servicio y archivos de instalación.
const winsw = join(cache, 'WinSW-x64-2.12.0.exe')
await bajar(WINSW, winsw)
copyFileSync(winsw, join(salida, 'good-game-api-service.exe'))
cpSync('windows', salida, { recursive: true })
copyFileSync('contenido.json', join(salida, 'contenido.json'))

rmSync(`dist/${nombre}.zip`, { force: true })
// Windows 10+ trae tar, que también arma zip.
if (process.platform === 'win32') run('tar', ['-a', '-cf', `${nombre}.zip`, nombre], 'dist')
else run('zip', ['-qr', `${nombre}.zip`, nombre], 'dist')
console.log(`Listo: dist/${nombre}.zip`)
