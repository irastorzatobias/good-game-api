// Lecturas del sistema con la forma del contrato: filas con los nombres de campo del DBF.
import type { Fila } from '../dbf/tabla.ts'
import type { Sistema } from './sistema.ts'

/** Códigos compuestos del sistema: sucursal '1' + número alineado a la derecha (CLI_CODIGO, DCC_ARTICU, OM_ARTICUL). */
export const cod = (n: string | number) => '1' + String(n).padStart(6)
const soloDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const plano = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

export class Consultas {
  private readonly s: Sistema
  private readonly sucursal: string

  constructor(sistema: Sistema, sucursal: string) {
    this.s = sistema
    this.sucursal = sucursal
  }

  // ---- Catálogo

  cotizacion() {
    return this.s.derivado('dolar_cotiz', 'ultima', (t) => {
      let ultima: Fila | undefined
      for (const f of t.filas())
        if (!ultima || `${f.DC_FECHA_}${f.DC_HORA__}` >= `${ultima.DC_FECHA_}${ultima.DC_HORA__}`) ultima = f
      if (!ultima) throw new Error('dolar_cotiz está vacía')
      return ultima
    })
  }

  tipos() {
    return this.s.derivado('tipodocu', 'porCodigo', (t) => new Map([...t.filas()].map((f) => [f.TD_CODIGO as string, f])))
  }

  /** Artículos de la sucursal, por AR_CODI. */
  articulos() {
    return this.s.derivado('articulo', 'sucursal', (t) =>
      new Map([...t.filas((c) => c('AR_SUCU') === this.sucursal)].map((f) => [f.AR_CODI as string, f])))
  }
  /** Por código compuesto (DCC_ARTICU, OM_ARTICUL). */
  articuloDe(compuesto: string) {
    return this.articulos().get(compuesto.slice(1).trim())
  }
  /** Lo que el cliente puede comprar: activo, con precio y con stock en la sucursal. */
  articulosVenta() {
    return [...this.articulos().values()].filter((a) => a.AR_ACTIVO === 'S' && (a.AR_LIS1 as number) > 0 && (a.AR_CANT as number) > 0)
  }
  /** Solo los rubros que tienen algo a la venta. */
  rubros() {
    const conVenta = new Set(this.articulosVenta().map((a) => a.AR_RUBR))
    return [...this.s.tabla('rubros').filas()].filter((r) => conVenta.has(r.RU_CODIGO))
  }

  // ---- Clientes

  private clientes() {
    return this.s.derivado('clientes', 'porCodigo', (t) => new Map([...t.filas()].map((f) => [f.CLI_CODIGO as string, f])))
  }
  cliente(codigo: string) {
    return this.clientes().get(codigo)
  }
  /**
   * Para el admin: por DNI/CUIT o número de cliente si son dígitos; si no, por nombre o fantasía (todas las palabras).
   * Los activos primero.
   */
  buscarClientes(texto: string, limite = 30) {
    const digitos = soloDigitos(texto)
    let r: Fila[]
    if (digitos && digitos.length === texto.replace(/[\s.-]/g, '').length) {
      const porCodigo = this.cliente(cod(Number(digitos)))
      r = [...new Set([...(porCodigo ? [porCodigo] : []), ...this.clientesPorDni(digitos)])]
    } else {
      const palabras = plano(texto).split(/\s+/).filter(Boolean)
      if (!palabras.length) return []
      r = [...this.clientes().values()].filter((c) => {
        const t = `${plano(c.CLI_NOMBRE)} ${plano(c.CLI_FANTAS)}`
        return palabras.every((p) => t.includes(p))
      })
    }
    return r.sort((a, b) => Number(b.CLI_ACTIVO) - Number(a.CLI_ACTIVO)).slice(0, limite)
  }
  /** El DNI puede estar en CLI_DNI_, en CLI_CUIT__ (casi siempre ahí) o dentro de un CUIT de 11 dígitos. Los activos primero. */
  clientesPorDni(dni: string) {
    const porDni = this.s.derivado('clientes', 'porDni', () => {
      const m = new Map<string, Fila[]>()
      for (const c of this.clientes().values()) {
        const cuit = soloDigitos(c.CLI_CUIT__)
        const claves = new Set([soloDigitos(c.CLI_DNI_), cuit, cuit.length === 11 ? cuit.slice(2, 10) : ''])
        for (const k of claves) if (k) m.set(k, [...(m.get(k) ?? []), c])
      }
      for (const l of m.values()) l.sort((a, b) => Number(b.CLI_ACTIVO) - Number(a.CLI_ACTIVO))
      return m
    })
    return porDni.get(soloDigitos(dni)) ?? []
  }

  // ---- Comprobantes

  /** Comprobantes de un cliente, sin anulados. */
  documentosDe(cuenta: string) {
    return [...this.s.tabla('docum').filas((c) => c('DOC_CUENTA') === cuenta && c('DOC_CLIPRO') === 'C' && c('DOC_ANULED') !== 'T')]
  }
  /** Comprobantes de clientes de ciertos tipos desde una fecha (para el ranking). */
  documentosDesde(desde: string, tipos: string[]) {
    const d = desde.replaceAll('-', '')
    return [...this.s.tabla('docum').filas((c) =>
      c('DOC_FECEMI') >= d && c('DOC_CLIPRO') === 'C' && c('DOC_ANULED') !== 'T' && tipos.includes(c('DOC_TIPDOC')))]
  }
  /** Renglones (doccuer) de varios comprobantes, con la descripción del artículo. */
  renglones(claves: string[]) {
    const buscadas = new Set(claves)
    const porClave = new Map<string, Fila[]>()
    for (const r of this.s.tabla('doccuer').filas((c) => buscadas.has(c('DCC_CLAVE_')))) {
      const k = r.DCC_CLAVE_ as string
      porClave.set(k, [...(porClave.get(k) ?? []), { ...r, AR_DESC: this.articuloDe(r.DCC_ARTICU as string)?.AR_DESC ?? '' }])
    }
    return porClave
  }
  /** DOC_CLAVE_ de los comprobantes que cobraron una orden de servicio. */
  clavesDeServicio() {
    return this.s.derivado('ord_fact', 'claves', (t) => new Set([...t.filas()].map((f) => f.OF_CODIGO as string)))
  }

  // ---- Servicio técnico

  ordenesDe(cliente: string) {
    return [...this.s.tabla('ord_repa').filas((c) => c('OR_CLIENTE') === cliente)]
  }
  /** Equipo, tipo, técnico, estado, comprobante y materiales de una orden. */
  detalleOrden(o: Fila) {
    const numero = o.OR_NUMERO_ as string
    const eq = [...this.s.tabla('equipos').filas((c) => c('EQ_NUMERO_') === o.OR_EQUIPO_)][0]
    const buscar = (t: 'producto' | 'tecnicos' | 'ord_status', campo: string, valor: unknown, dev: string) =>
      [...this.s.tabla(t).filas()].find((f) => String(f[campo]) === String(valor))?.[dev] ?? ''
    return {
      ...o,
      ...eq,
      PR_DESCRI: buscar('producto', 'PR_CODIGO', eq?.EQ_PRODUCT, 'PR_DESCRI'),
      TEC_NOMBRE: buscar('tecnicos', 'TEC_CODIGO', o.OR_TECNICO, 'TEC_NOMBRE'),
      OS_DESCRI: buscar('ord_status', 'OS_CODIGO', o.OR_ESTADO_, 'OS_DESCRI'),
      OF_CODIGO: [...this.s.tabla('ord_fact').filas((c) => c('OF_ORDEN_') === numero)][0]?.OF_CODIGO ?? '',
      materiales: [...this.s.tabla('or_mater').filas((c) => c('OM_NUMERO_') === numero)]
        .map((m) => ({ ...m, AR_DESC: this.articuloDe(m.OM_ARTICUL as string)?.AR_DESC ?? '' })),
    }
  }
}
