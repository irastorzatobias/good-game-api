// Cuenta corriente: comprobantes del sistema más las notas de venta hechas en la app que el local todavía ve en la base propia.
import type { Fila } from '../dbf/tabla.ts'
import type { Nota } from '../app/store.ts'
import { HttpError } from '../http.ts'
import { cod } from '../sistema/consultas.ts'
import type { Deps } from './deps.ts'

const r2 = (n: number) => Math.round(n * 100) / 100
/** Fila de docum con sus renglones de doccuer. */
export type Documento = Record<string, unknown> & { items: Fila[] }
export const claveNota = (nro: number) => 'APP' + String(nro).padStart(6, '0')

/** Una nota de venta de la app con la forma de docum + sus renglones con la de doccuer. */
export function notaComoDocumento({ sistema }: Deps, n: Nota): Documento {
  const DOC_CLAVE_ = claveNota(n.nro)
  return {
    DOC_CLIPRO: 'C', DOC_CUENTA: n.cliente, DOC_FECEMI: n.fecha, DOC_FECVTO: n.fecha, DOC_TIPDOC: 'NV',
    DOC_NRODOC: 'X0099' + String(n.nro).padStart(8, '0'), DOC_TOTAL_: n.total, DOC_CLAVE_,
    DOC_OBSERV: `APP ${n.medio.toUpperCase()}`.slice(0, 25), DOC_USUARI: 'APP', DOC_PAGADO: true, DOC_ANULED: false,
    DOC_SUCURS: '1', DOC_NROCAE: '', DOC_DOLAR_: n.dolar,
    items: n.items.map((i) => ({
      DCC_CLAVE_: DOC_CLAVE_, DCC_ARTICU: cod(i.articulo), DCC_CANTID: i.cantidad, DCC_PRECIO: i.precio, DCC_TASIVA: i.tasaIva,
      DCC_BONIFI: i.bonif, DCC_FECHA_: n.fecha, DCC_LISPRE: n.lista, AR_DESC: sistema.articulos().get(i.articulo)?.AR_DESC ?? '',
    })),
  }
}

/** Todos los comprobantes del cliente con sus renglones, del más nuevo al más viejo. */
export function documentos(d: Deps, cuenta: string, desde = '0000-00-00'): Documento[] {
  const delSistema = d.sistema.documentosDe(cuenta).filter((x) => (x.DOC_FECEMI ?? '') >= desde)
  const renglones = d.sistema.renglones(delSistema.map((x) => x.DOC_CLAVE_ as string))
  const todos: Documento[] = [
    ...delSistema.map((x) => ({ ...x, items: renglones.get(x.DOC_CLAVE_ as string) ?? [] })),
    ...d.app.notas(cuenta).filter((n) => n.fecha >= desde).map((n) => notaComoDocumento(d, n)),
  ]
  return todos.sort((a, b) => String(b.DOC_FECEMI).localeCompare(String(a.DOC_FECEMI)))
}

/** Saldo: solo tipos con TD_GENSAL 'S', sobre todo el historial (no solo lo que se lista). */
function saldo(d: Deps, docs: Fila[]) {
  const tipos = d.sistema.tipos()
  return r2(docs.reduce((s, x) => {
    const t = tipos.get(x.DOC_TIPDOC as string)
    return t?.TD_GENSAL === 'S' ? s + (t.TD_IMP_DH === 'D' ? 1 : -1) * (x.DOC_TOTAL_ as number) : s
  }, 0))
}

export function cuenta(d: Deps, cliente: string, desde?: string) {
  return {
    saldo: saldo(d, d.sistema.documentosDe(cliente)),
    CLI_L_CRED: d.sistema.cliente(cliente)?.CLI_L_CRED ?? 0,
    documentos: documentos(d, cliente, desde),
  }
}

export function documento(d: Deps, cliente: string, clave: string) {
  const doc = documentos(d, cliente).find((x) => x.DOC_CLAVE_ === clave)
  if (!doc) throw new HttpError(404, 'Comprobante inexistente')
  return doc
}
