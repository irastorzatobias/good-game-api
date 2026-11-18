// Lector de tablas DBF de Visual FoxPro (solo lectura; nunca se escribe sobre el sistema).
// Convierte al leer: C recortado, N/F/I/B/Y -> number, D -> 'YYYY-MM-DD' | null, T -> 'YYYY-MM-DDTHH:mm' | null, L -> boolean.
// Los memos (M/G/W) no se leen: ninguna tabla que usa la API los necesita.

export type Valor = string | number | boolean | null
export type Fila = Record<string, Valor>
type Campo = { nombre: string; tipo: string; offset: number; largo: number }

// Byte 29 del encabezado. Sin marca (0) FoxPro usa la página del sistema: en Windows en español, 1252.
const PAGINAS: Record<number, string> = { 0x00: 'windows-1252', 0x03: 'windows-1252', 0x01: 'ibm437', 0x02: 'ibm850', 0xc8: 'windows-1250' }

export class Tabla {
  readonly cantidad: number
  private readonly inicio: number
  private readonly largoRegistro: number
  private readonly campos = new Map<string, Campo>()
  private readonly texto: (b: Buffer) => string
  private readonly buf: Buffer
  readonly nombre: string

  constructor(buf: Buffer, nombre: string) {
    this.buf = buf
    this.nombre = nombre
    this.cantidad = buf.readUInt32LE(4)
    this.inicio = buf.readUInt16LE(8)
    this.largoRegistro = buf.readUInt16LE(10)
    this.texto = decodificador(PAGINAS[buf[29]] ?? 'windows-1252')
    // Solo VFP (0x30-0x32) guarda el desplazamiento del campo en el descriptor; en dBase/FoxPro 2 esos bytes son basura.
    const vfp = buf[0] >= 0x30 && buf[0] <= 0x32
    let offset = 1 // el byte 0 de cada registro es la marca de borrado
    for (let p = 32; p + 32 <= this.inicio && buf[p] !== 0x0d; p += 32) {
      const nombre = buf.toString('latin1', p, p + 11).replace(/\0.*$/s, '').toUpperCase()
      const tipo = String.fromCharCode(buf[p + 11])
      const largo = buf[p + 16]
      if (vfp) offset = buf.readUInt32LE(p + 12)
      if (tipo !== '0') this.campos.set(nombre, { nombre, tipo, offset, largo })
      offset += largo
    }
    // Una tabla que se está escribiendo puede tener el contador adelantado al archivo.
    this.cantidad = Math.min(this.cantidad, Math.floor((buf.length - this.inicio) / this.largoRegistro))
  }

  tiene(campo: string) {
    return this.campos.has(campo)
  }

  /** Valor crudo de un campo (recortado, latin1): sirve para filtrar sin decodificar el registro entero. */
  crudo(i: number, campo: string) {
    const c = this.campo(campo)
    const p = this.inicio + i * this.largoRegistro + c.offset
    return this.buf.toString('latin1', p, p + c.largo).trim()
  }

  borrado(i: number) {
    return this.buf[this.inicio + i * this.largoRegistro] === 0x2a // '*'
  }

  fila(i: number): Fila {
    const base = this.inicio + i * this.largoRegistro
    const fila: Fila = {}
    for (const c of this.campos.values()) fila[c.nombre] = this.valor(c, this.buf.subarray(base + c.offset, base + c.offset + c.largo))
    return fila
  }

  /** Registros no borrados que cumplen `filtro`, que recibe un lector de valores crudos. */
  *filas(filtro?: (crudo: (campo: string) => string) => boolean): Generator<Fila> {
    for (let i = 0; i < this.cantidad; i++) {
      if (this.borrado(i)) continue
      if (filtro && !filtro((campo) => this.crudo(i, campo))) continue
      yield this.fila(i)
    }
  }

  private campo(nombre: string) {
    const c = this.campos.get(nombre)
    if (!c) throw new Error(`${this.nombre}: no existe el campo ${nombre}`)
    return c
  }

  private valor(c: Campo, b: Buffer): Valor {
    switch (c.tipo) {
      case 'C':
      case 'V':
        return this.texto(b).replace(/\0/g, '').trim()
      case 'N':
      case 'F': {
        const n = Number(b.toString('latin1').trim())
        return Number.isFinite(n) ? n : 0
      }
      case 'I':
        return b.readInt32LE(0)
      case 'B':
        return b.readDoubleLE(0)
      case 'Y':
        return Number(b.readBigInt64LE(0)) / 1e4
      case 'L':
        return /[TtYy]/.test(String.fromCharCode(b[0]))
      case 'D': {
        const s = b.toString('latin1').trim()
        return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null
      }
      case 'T': {
        const dia = b.readInt32LE(0)
        if (!dia) return null
        const fecha = new Date((dia - 2440588) * 864e5 + b.readInt32LE(4))
        return fecha.toISOString().slice(0, 16)
      }
      default:
        return null // memos y binarios
    }
  }
}

function decodificador(pagina: string): (b: Buffer) => string {
  if (pagina === 'ibm850' || pagina === 'ibm437') {
    // TextDecoder no trae las páginas DOS: solo se traducen los acentos y eñes que usa un sistema en español.
    const alto = pagina === 'ibm850' ? CP850 : CP437
    return (b) => {
      let s = ''
      for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : (alto[x - 0x80] ?? '?')
      return s
    }
  }
  const d = new TextDecoder(pagina)
  return (b) => d.decode(b)
}

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»'
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»'
