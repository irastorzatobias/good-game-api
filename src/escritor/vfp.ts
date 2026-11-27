// Traduce un plan a un script de Visual FoxPro que corre dentro del driver oficial (VFPOLEDB, con EXECSCRIPT):
// el mismo motor que usa sistema.exe, así que los índices (.CDX) y los bloqueos quedan como los deja el sistema.
//
// El script toma cada contador con RLOCK (espera hasta 30 segundos si otra terminal lo tiene), lo usa y lo avanza; agrega
// los registros en el orden del plan y al final libera. Si algo falla, marca como borrados los registros que llegó a
// agregar (lo mismo que hace sistema.exe al corregir un comprobante) y devuelve el error.
// Un contador ya avanzado no se devuelve: queda un número salteado, nunca uno repetido.

import { esContador, esFecha, type Formato, type Plan, type Valor } from './plan.ts'

/** Literal de texto de FoxPro: elige un delimitador que no aparezca en el texto. */
export function texto(s: string): string {
  if (!s.includes(']')) return `[${s}]`
  if (!s.includes('"')) return `"${s}"`
  if (!s.includes("'")) return `'${s}'`
  return [...s].map((c) => `CHR(${c.charCodeAt(0)})`).join('+')
}

function numero(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Número inválido: ${n}`)
  const s = String(n)
  return /e/i.test(s) ? n.toFixed(6).replace(/\.?0+$/, '') : s
}

const variable = (nombre: string) => {
  if (!/^[a-z][a-z0-9_]*$/i.test(nombre)) throw new Error(`Nombre de contador inválido: ${nombre}`)
  return `m.gg_${nombre}`
}

const formato = (f: Formato, v: string) => `gg_num(${v}, ${f.base}, ${f.largo}, ${texto(f.relleno)}, ${texto(f.prefijo)})`

function valor(v: Valor): string {
  if (typeof v === 'string') return texto(v)
  if (typeof v === 'number') return numero(v)
  if (typeof v === 'boolean') return v ? '.T.' : '.F.'
  if (esFecha(v)) {
    if (v.fecha === null) return '{}'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) throw new Error(`Fecha inválida: ${v.fecha}`)
    return `{^${v.fecha}}`
  }
  if (esContador(v)) return v.formato ? formato(v.formato, variable(v.contador)) : variable(v.contador)
  throw new Error(`Valor inválido: ${JSON.stringify(v)}`)
}

const tablaValida = (t: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(t)) throw new Error(`Tabla inválida: ${t}`)
  return t
}

/**
 * El script para EXECSCRIPT. Devuelve (RETURN) {"ok":true,"contadores":{...}} o {"ok":false,"error":"..."}.
 *
 * El driver no tiene TRY/CATCH, ERROR ni STRTOFILE ("Feature is not available"), así que los errores se atrapan con
 * ON ERROR: guarda el primer mensaje en gg_err y cada paso corre solo si todavía no hubo ninguno. Al final, con error o
 * sin él, se liberan los bloqueos y se cierran las tablas; un error sin atrapar los dejaría tomados.
 */
export function scriptVfp(plan: Plan): string {
  const altas = plan.pasos.filter((p) => p.tipo === 'alta').length
  const contadores = plan.pasos.flatMap((p) => (p.tipo === 'contador' ? [p.nombre] : []))
  const l: string[] = [
    `* good-game-api: ${plan.accion.replace(/[\r\n]/g, ' ')}`,
    'LOCAL lcRes, lnI, lnAltas',
    `LOCAL laAltas[${Math.max(altas, 1)}, 2]`,
    'PRIVATE gg_err',
    ...contadores.map((c) => `${variable(c)} = 0`),
    'lnAltas = 0',
    "gg_err = ''",
    'SET EXCLUSIVE OFF',
    'SET MULTILOCKS ON',
    'SET REPROCESS TO 30 SECONDS',
    'SET DELETED OFF',
    'SET SAFETY OFF',
    'SET NULL OFF',
    'ON ERROR gg_err = IIF(EMPTY(gg_err), MESSAGE(), gg_err)',
  ]
  const abiertas = new Set<string>()
  plan.pasos.forEach((p, i) => {
    if (p.tipo === 'contador') {
      const alias = `gg_k${i}`
      const v = variable(p.nombre)
      l.push(
        `* contador ${p.nombre}: ${p.tabla}.${p.campo}`,
        'IF EMPTY(gg_err)',
        `  USE ${tablaValida(p.tabla)} IN 0 SHARED AGAIN ALIAS ${alias}`,
        `  GO TOP IN ${alias}`,
        `  IF EMPTY(gg_err) AND !RLOCK('${alias}')`,
        `    gg_err = ${texto(`No se pudo bloquear ${p.tabla}: otra terminal lo tiene tomado`)}`,
        '  ENDIF',
        '  IF EMPTY(gg_err)',
        `    ${v} = ${alias}.${p.campo}`,
        `    REPLACE ${p.campo} WITH ${v} + 1 IN ${alias}`,
        '  ENDIF',
        'ENDIF',
      )
      abiertas.add(alias)
    } else {
      const t = tablaValida(p.tabla)
      const campos = Object.keys(p.fila)
      for (const c of campos) if (!/^[a-z_][a-z0-9_]*$/i.test(c)) throw new Error(`Campo inválido: ${c}`)
      l.push(
        'IF EMPTY(gg_err)',
        `  INSERT INTO ${t} (${campos.join(', ')}) VALUES (${campos.map((c) => valor(p.fila[c])).join(', ')})`,
        // Solo se anota si entró: con error, RECNO() sería el registro de otro.
        '  IF EMPTY(gg_err)',
        '    lnAltas = lnAltas + 1',
        `    laAltas[lnAltas, 1] = ${texto(t)}`,
        `    laAltas[lnAltas, 2] = RECNO(${texto(t)})`,
        '  ENDIF',
        'ENDIF',
      )
      abiertas.add(t)
    }
  })
  const json = contadores.map((c) => `'"${c}":' + TRANSFORM(${variable(c)})`).join(" + ',' + ")
  l.push(
    'IF EMPTY(gg_err)',
    `  lcRes = '{"ok":true,"contadores":{' + ${json || "''"} + '}}'`,
    'ELSE',
    '  lcRes = \'{"ok":false,"error":\' + gg_json(gg_err) + \'}\'',
    '  FOR lnI = 1 TO lnAltas',
    '    GO laAltas[lnI, 2] IN (laAltas[lnI, 1])',
    '    DELETE IN (laAltas[lnI, 1])',
    '  ENDFOR',
    'ENDIF',
    'UNLOCK ALL',
    ...[...abiertas].map((a) => `USE IN SELECT(${texto(a)})`),
    'ON ERROR',
    'RETURN lcRes',
    '',
    // Igual que formatear() en plan.ts.
    'FUNCTION gg_num(tnValor, tnBase, tnLargo, tcRelleno, tcPrefijo)',
    '  LOCAL lcOut, lnV',
    "  lcOut = ''",
    '  lnV = INT(tnValor)',
    '  DO WHILE lnV > 0',
    "    lcOut = SUBSTR('0123456789ABCDEF', MOD(lnV, tnBase) + 1, 1) + lcOut",
    '    lnV = INT(lnV / tnBase)',
    '  ENDDO',
    '  IF EMPTY(lcOut)',
    "    lcOut = '0'",
    '  ENDIF',
    '  RETURN tcPrefijo + PADL(lcOut, tnLargo, tcRelleno)',
    'ENDFUNC',
    '',
    'FUNCTION gg_json(tcTexto)',
    "  RETURN '\"' + STRTRAN(STRTRAN(STRTRAN(STRTRAN(tcTexto, '\\', '\\\\'), '\"', '\\\"'), CHR(13), ' '), CHR(10), ' ') + '\"'",
    'ENDFUNC',
  )
  return l.join('\r\n')
}
