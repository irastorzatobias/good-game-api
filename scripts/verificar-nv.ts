// Verifica la receta de la nota de venta contra las NV reales: para cada NV vigente del año, arma el plan con los mismos
// datos (cliente, renglones, usuario...) y compara campo por campo lo que escribiría la API con lo que escribió
// sistema.exe en docum, doccuer y doctexto. Solo lee.
//
//   node scripts/verificar-nv.ts <carpeta del sistema> [desde AAAA-MM-DD]

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Tabla, type Fila } from '../src/dbf/tabla.ts'
import { planNotaDeVenta, type RenglonNv } from '../src/acciones/notaDeVenta.ts'
import { CLAVE_DOC, leerFormato, resolver, type Alta } from '../src/escritor/plan.ts'

const [carpeta, desde = '2026-01-01'] = process.argv.slice(2)
if (!carpeta) {
  console.error('Uso: node scripts/verificar-nv.ts <carpeta del sistema> [desde AAAA-MM-DD]')
  process.exit(1)
}
const archivos = new Map(readdirSync(carpeta).filter((f) => /\.dbf$/i.test(f)).map((f) => [f.replace(/\.dbf$/i, '').toLowerCase(), join(carpeta, f)]))
const tabla = (n: string) => new Tabla(readFileSync(archivos.get(n)!), n)

function agrupar(t: Tabla, campo: string) {
  const m = new Map<string, Fila[]>()
  for (let i = 0; i < t.cantidad; i++) {
    if (t.borrado(i)) continue
    const k = t.crudo(i, campo)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(t.fila(i))
  }
  return m
}

const docum = tabla('docum')
const renglones = agrupar(tabla('doccuer'), 'DCC_CLAVE_')
const textos = agrupar(tabla('doctexto'), 'DT_CLAVE__')
const fechaDesde = desde.replaceAll('-', '')

// Estado posterior a la carga (se anula, se cobra): no es parte de lo que escribe la NV al crearse.
const ESTADO = new Set(['DOC_PAGADO', 'DOC_ANULED'])
const vacio = (v: unknown) => v === '' || v === null || v === 0 || v === false
const igual = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b)

const fallasPorCampo = new Map<string, { n: number; ejemplos: string[] }>()
const fallar = (campo: string, ejemplo: string) => {
  const f = fallasPorCampo.get(campo) ?? { n: 0, ejemplos: [] }
  f.n++
  if (f.ejemplos.length < 3) f.ejemplos.push(ejemplo)
  fallasPorCampo.set(campo, f)
}

function comparar(nv: string, planeado: Alta, real: Fila) {
  let ok = true
  for (const [campo, valor] of Object.entries(real)) {
    if (ESTADO.has(campo)) continue
    const esperado = campo in planeado.fila ? planeado.fila[campo] : null
    if (esperado === null ? !vacio(valor) : !igual(esperado, valor)) {
      ok = false
      fallar(`${planeado.tabla}.${campo}`, `${nv}: API=${JSON.stringify(esperado)} sistema=${JSON.stringify(valor)}`)
    }
  }
  return ok
}

let total = 0
let identicas = 0
let errores = 0
for (let i = 0; i < docum.cantidad; i++) {
  if (docum.borrado(i) || docum.crudo(i, 'DOC_TIPDOC') !== 'NV' || docum.crudo(i, 'DOC_FECEMI') < fechaDesde) continue
  const d = docum.fila(i)
  total++
  const nv = d.DOC_NRODOC as string
  const clave = d.DOC_CLAVE_ as string
  const rs = renglones.get(clave) ?? []
  const txt = new Map((textos.get(clave) ?? []).map((t) => [t.DT_RENGLON as string, t.DT_DESCRIP as string]))
  const entrada = {
    cuenta: d.DOC_CUENTA as string,
    fecha: d.DOC_FECEMI as string,
    usuario: d.DOC_USUARI as string,
    puntoDeVenta: nv.slice(1, 5),
    lista: d.DOC_CUOTAS as number,
    dolar: d.DOC_DOLAR_ as number,
    observacion: d.DOC_OBSERV as string,
    bonificacion: d.DOC_PORBON as number,
    terminal: { machin: d.DOC_MACHIN as string, maquin: d.DOC_MAQUIN as number, sucursal: d.DOC_SUCURS as string },
    renglones: rs.map((r, n): RenglonNv => {
      const texto = r.DCC_ARTICU === 'TEXTO_' ? txt.get(String(n + 1)) : undefined
      return {
        articulo: texto === undefined ? (r.DCC_ARTICU as string) : undefined,
        texto,
        cantidad: r.DCC_CANTID as number,
        precio: r.DCC_PRECIO as number,
        tasaIva: r.DCC_TASIVA as number,
        bonificacion: r.DCC_BONIFI as number,
      }
    }),
  }
  try {
    const altas = resolver(planNotaDeVenta(entrada), {
      clave: leerFormato(clave, CLAVE_DOC)!,
      numero: Number(nv.slice(5)),
    })
    const reales: Fila[] = [...rs, ...(textos.get(clave) ?? []), d]
    const planeados = [...altas.filter((a) => a.tabla === 'doccuer'), ...altas.filter((a) => a.tabla === 'doctexto'), ...altas.filter((a) => a.tabla === 'docum')]
    let ok = planeados.length === reales.length
    if (!ok) fallar('(cantidad de registros)', `${nv}: API=${planeados.length} sistema=${reales.length}`)
    planeados.forEach((p, n) => reales[n] && (ok = comparar(nv, p, reales[n]) && ok))
    if (ok) identicas++
  } catch (e) {
    errores++
    fallar('(no se pudo armar)', `${nv}: ${(e as Error).message}`)
  }
}

console.log(`NV vigentes desde ${desde}: ${total}`)
console.log(`Idénticas a lo que escribió el sistema: ${identicas} (${Math.round((identicas / total) * 1000) / 10}%)`)
if (errores) console.log(`No se pudieron armar: ${errores}`)
for (const [campo, f] of [...fallasPorCampo].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${campo}: ${f.n} — ${f.ejemplos.join(' | ')}`)
