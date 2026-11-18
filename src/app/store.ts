// Datos propios de la app, que no existen en el sistema y no se pueden escribir en sus DBF
// (FoxPro no se entera y los índices CDX quedan desfasados): claves, sesiones, preferencias, contactos editados,
// puntos que no salen de un comprobante, cupones, mensajes, respuestas a presupuestos, solicitudes y notas de venta.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS claves (dni TEXT PRIMARY KEY, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, cliente TEXT NOT NULL, creada TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prefs (cliente TEXT PRIMARY KEY, foto TEXT, notificaciones INTEGER NOT NULL, avisos_servicio INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contactos (cliente TEXT PRIMARY KEY, campos TEXT NOT NULL, fecha TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS puntos (id TEXT PRIMARY KEY, cliente TEXT NOT NULL, fecha TEXT NOT NULL, detalle TEXT NOT NULL, puntos INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cupones (codigo TEXT PRIMARY KEY, cliente TEXT NOT NULL, premio TEXT NOT NULL, fecha TEXT NOT NULL, vence TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY, orden TEXT NOT NULL, de TEXT NOT NULL, texto TEXT NOT NULL, fecha TEXT NOT NULL, leido INTEGER);
CREATE TABLE IF NOT EXISTS respuestas (orden TEXT PRIMARY KEY, aprobado INTEGER NOT NULL, fecha TEXT NOT NULL, condiciones TEXT NOT NULL, motivo TEXT, estimada TEXT);
CREATE TABLE IF NOT EXISTS solicitudes (id INTEGER PRIMARY KEY, nro INTEGER NOT NULL, cliente TEXT NOT NULL, fecha TEXT NOT NULL, equipo TEXT NOT NULL, falla TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notas (nro INTEGER PRIMARY KEY, cliente TEXT NOT NULL, fecha TEXT NOT NULL, medio TEXT NOT NULL,
  lista TEXT NOT NULL, dolar REAL NOT NULL, total REAL NOT NULL);
CREATE TABLE IF NOT EXISTS notas_items (nro INTEGER NOT NULL REFERENCES notas(nro), articulo TEXT NOT NULL, cantidad INTEGER NOT NULL,
  precio REAL NOT NULL, tasa_iva REAL NOT NULL, bonif REAL NOT NULL);
CREATE INDEX IF NOT EXISTS notas_cliente ON notas(cliente);
CREATE INDEX IF NOT EXISTS mensajes_orden ON mensajes(orden);
`

export type Prefs = { foto: string | null; notificaciones: boolean; avisosServicio: boolean }
export type Movimiento = { id: string; fecha: string; detalle: string; puntos: number }
export type Cupon = { codigo: string; premio: string; fecha: string; vence: string }
export type Mensaje = { id: string; de: 'cliente' | 'tecnico'; texto: string; fecha: string; leido?: boolean }
export type Respuesta = { aprobado: boolean; fecha: string; condiciones: string; motivo?: string; estimada: string | null }
export type Solicitud = { id: string; nro: number; fecha: string; equipo: string; falla: string }
export type Nota = { nro: number; cliente: string; fecha: string; medio: string; lista: string; dolar: number; total: number;
  items: { articulo: string; cantidad: number; precio: number; tasaIva: number; bonif: number }[] }

type Row = Record<string, unknown>

export class AppStore {
  private readonly db: DatabaseSync

  constructor(ruta: string) {
    mkdirSync(dirname(ruta), { recursive: true })
    this.db = new DatabaseSync(ruta)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;' + ESQUEMA)
  }

  private uno(sql: string, ...p: (string | number | null)[]) {
    return this.db.prepare(sql).get(...p) as Row | undefined
  }
  private todos(sql: string, ...p: (string | number | null)[]) {
    return this.db.prepare(sql).all(...p) as Row[]
  }
  private correr(sql: string, ...p: (string | number | null)[]) {
    return this.db.prepare(sql).run(...p)
  }
  private transaccion<T>(f: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = f()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // ---- Acceso

  fijarClave(dni: string, clave: string) {
    const sal = randomBytes(16)
    const hash = `${sal.toString('hex')}:${scryptSync(clave, sal, 32).toString('hex')}`
    this.correr('INSERT INTO claves (dni, hash) VALUES (?, ?) ON CONFLICT(dni) DO UPDATE SET hash = excluded.hash', dni, hash)
  }
  claveValida(dni: string, clave: string) {
    const r = this.uno('SELECT hash FROM claves WHERE dni = ?', dni)
    if (!r) return false
    const [sal, hash] = String(r.hash).split(':')
    return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(clave, Buffer.from(sal, 'hex'), 32))
  }
  abrirSesion(token: string, cliente: string, fecha: string) {
    this.correr('INSERT INTO sesiones (token, cliente, creada) VALUES (?, ?, ?)', token, cliente, fecha)
  }
  clienteDeSesion(token: string) {
    return this.uno('SELECT cliente FROM sesiones WHERE token = ?', token)?.cliente as string | undefined
  }

  // ---- Perfil

  prefs(cliente: string): Prefs | null {
    const r = this.uno('SELECT * FROM prefs WHERE cliente = ?', cliente)
    return r ? { foto: r.foto as string | null, notificaciones: !!r.notificaciones, avisosServicio: !!r.avisos_servicio } : null
  }
  guardarPrefs(cliente: string, p: Prefs) {
    this.correr(`INSERT INTO prefs VALUES (?, ?, ?, ?) ON CONFLICT(cliente) DO UPDATE SET
      foto = excluded.foto, notificaciones = excluded.notificaciones, avisos_servicio = excluded.avisos_servicio`,
    cliente, p.foto, Number(p.notificaciones), Number(p.avisosServicio))
  }
  /** Datos de contacto que el cliente corrigió en la app; se muestran encima de los del sistema. */
  contacto(cliente: string): Record<string, string> {
    const r = this.uno('SELECT campos FROM contactos WHERE cliente = ?', cliente)
    return r ? JSON.parse(String(r.campos)) : {}
  }
  guardarContacto(cliente: string, campos: Record<string, string>, fecha: string) {
    this.correr('INSERT INTO contactos VALUES (?, ?, ?) ON CONFLICT(cliente) DO UPDATE SET campos = excluded.campos, fecha = excluded.fecha',
      cliente, JSON.stringify(campos), fecha)
  }

  // ---- Puntos

  /** Movimientos que no salen de un comprobante (canjes, bonificaciones). */
  puntos(cliente: string): Movimiento[] {
    return this.todos('SELECT id, fecha, detalle, puntos FROM puntos WHERE cliente = ?', cliente) as Movimiento[]
  }
  /** Puntos sumados desde una fecha, por cliente (para el ranking). */
  puntosGanadosDesde(desde: string) {
    const rs = this.todos('SELECT cliente, SUM(puntos) AS p FROM puntos WHERE puntos > 0 AND fecha >= ? GROUP BY cliente', desde)
    return new Map(rs.map((r) => [r.cliente as string, Number(r.p)]))
  }
  cupones(cliente: string, vigentesDesde: string): Cupon[] {
    return this.todos('SELECT codigo, premio, fecha, vence FROM cupones WHERE cliente = ? AND vence >= ? ORDER BY fecha DESC, rowid DESC',
      cliente, vigentesDesde) as Cupon[]
  }
  canjear(cliente: string, mov: Movimiento, cupon: Cupon) {
    this.transaccion(() => {
      this.correr('INSERT INTO puntos VALUES (?, ?, ?, ?, ?)', mov.id, cliente, mov.fecha, mov.detalle, mov.puntos)
      this.correr('INSERT INTO cupones VALUES (?, ?, ?, ?, ?)', cupon.codigo, cliente, cupon.premio, cupon.fecha, cupon.vence)
    })
  }

  // ---- Servicio técnico

  mensajes(orden: string): Mensaje[] {
    return this.todos('SELECT * FROM mensajes WHERE orden = ? ORDER BY id', orden).map((r) => ({
      id: 'm' + r.id, de: r.de as Mensaje['de'], texto: r.texto as string, fecha: r.fecha as string,
      ...(r.de === 'tecnico' ? { leido: !!r.leido } : {}),
    }))
  }
  agregarMensaje(orden: string, de: Mensaje['de'], texto: string, fecha: string) {
    this.correr('INSERT INTO mensajes (orden, de, texto, fecha, leido) VALUES (?, ?, ?, ?, ?)', orden, de, texto, fecha, de === 'tecnico' ? 0 : null)
  }
  marcarLeidos(orden: string) {
    this.correr("UPDATE mensajes SET leido = 1 WHERE orden = ? AND de = 'tecnico'", orden)
  }
  respuesta(orden: string): Respuesta | null {
    const r = this.uno('SELECT * FROM respuestas WHERE orden = ?', orden)
    if (!r) return null
    return { aprobado: !!r.aprobado, fecha: r.fecha as string, condiciones: r.condiciones as string,
      ...(r.motivo != null ? { motivo: r.motivo as string } : {}), estimada: (r.estimada as string | null) ?? null }
  }
  guardarRespuesta(orden: string, r: Respuesta) {
    this.correr('INSERT INTO respuestas VALUES (?, ?, ?, ?, ?, ?)', orden, Number(r.aprobado), r.fecha, r.condiciones, r.motivo ?? null, r.estimada)
  }
  solicitudes(cliente: string): Solicitud[] {
    return this.todos('SELECT id, nro, fecha, equipo, falla FROM solicitudes WHERE cliente = ? ORDER BY id DESC', cliente)
      .map((r) => ({ ...(r as Solicitud), id: 's' + r.id }))
  }
  agregarSolicitud(cliente: string, fecha: string, equipo: string, falla: string): Solicitud {
    return this.transaccion(() => {
      const nro = 1 + Number(this.uno('SELECT COUNT(*) AS n FROM solicitudes WHERE cliente = ?', cliente)!.n)
      const { lastInsertRowid } = this.correr('INSERT INTO solicitudes (nro, cliente, fecha, equipo, falla) VALUES (?, ?, ?, ?, ?)',
        nro, cliente, fecha, equipo, falla)
      return { id: 's' + lastInsertRowid, nro, fecha, equipo, falla }
    })
  }

  // ---- Notas de venta (compras pagadas en la app; el local las pasa al sistema)

  notas(cliente: string): Nota[] {
    return this.todos('SELECT * FROM notas WHERE cliente = ?', cliente).map((n) => this.conItems(n))
  }
  notasDesde(desde: string): Nota[] {
    return this.todos('SELECT * FROM notas WHERE fecha >= ?', desde).map((n) => this.conItems(n))
  }
  agregarNota(nota: Omit<Nota, 'nro'>): Nota {
    return this.transaccion(() => {
      const { lastInsertRowid } = this.correr('INSERT INTO notas (cliente, fecha, medio, lista, dolar, total) VALUES (?, ?, ?, ?, ?, ?)',
        nota.cliente, nota.fecha, nota.medio, nota.lista, nota.dolar, nota.total)
      const nro = Number(lastInsertRowid)
      for (const i of nota.items)
        this.correr('INSERT INTO notas_items VALUES (?, ?, ?, ?, ?, ?)', nro, i.articulo, i.cantidad, i.precio, i.tasaIva, i.bonif)
      return { ...nota, nro }
    })
  }
  private conItems(n: Row): Nota {
    const items = this.todos('SELECT * FROM notas_items WHERE nro = ? ORDER BY rowid', n.nro as number)
      .map((i) => ({ articulo: i.articulo as string, cantidad: Number(i.cantidad), precio: Number(i.precio), tasaIva: Number(i.tasa_iva), bonif: Number(i.bonif) }))
    return { ...(n as Omit<Nota, 'items'>), items }
  }
}
