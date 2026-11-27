// Datos propios de la app, que no existen en el sistema y no se pueden escribir en sus DBF
// (FoxPro no se entera y los índices CDX quedan desfasados): claves, sesiones, preferencias,
// puntos que no salen de un comprobante, cupones, mensajes, respuestas a presupuestos, solicitudes y notas de venta.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS accesos (cliente TEXT PRIMARY KEY, hash TEXT NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, cliente TEXT NOT NULL, creada TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (usuario TEXT PRIMARY KEY, hash TEXT NOT NULL, creado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones_admin (token TEXT PRIMARY KEY, usuario TEXT NOT NULL, creada TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prefs (cliente TEXT PRIMARY KEY, foto TEXT, notificaciones INTEGER NOT NULL, avisos_servicio INTEGER NOT NULL);
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
export type Acceso = { creado: string; actualizado: string }

// scrypt con sal propia por clave; se guarda "sal:hash" en hex.
function hashear(clave: string) {
  const sal = randomBytes(16)
  return `${sal.toString('hex')}:${scryptSync(clave, sal, 32).toString('hex')}`
}
function coincide(guardado: unknown, clave: string) {
  const [sal, hash] = String(guardado ?? '').split(':')
  if (!sal || !hash) return false
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(clave, Buffer.from(sal, 'hex'), 32))
}

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

  /** Copia consistente de la base (aunque la API esté atendiendo) en `destino`, que no debe existir. */
  copiarA(destino: string) {
    this.correr('VACUUM INTO ?', destino)
  }

  // ---- Acceso de clientes: la cuenta es del cliente (CLI_CODIGO); entra con cualquiera de sus DNI/CUIT.

  /**
   * Hasta la v1.2 las claves se guardaban por el DNI tipeado (tabla claves). Se pasan a su cliente una sola vez;
   * las que no corresponden a ningún cliente se descartan.
   */
  migrarClaves(clienteDeDni: (dni: string) => string | undefined, fecha: string) {
    if (!this.uno("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'claves'")) return
    this.transaccion(() => {
      for (const r of this.todos('SELECT dni, hash FROM claves')) {
        const cliente = clienteDeDni(String(r.dni))
        if (cliente) this.correr('INSERT OR IGNORE INTO accesos VALUES (?, ?, ?, ?)', cliente, String(r.hash), fecha, fecha)
      }
      this.db.exec('DROP TABLE claves')
    })
  }
  fijarClave(cliente: string, clave: string, fecha: string) {
    this.correr(`INSERT INTO accesos VALUES (?, ?, ?, ?)
      ON CONFLICT(cliente) DO UPDATE SET hash = excluded.hash, actualizado = excluded.actualizado`, cliente, hashear(clave), fecha, fecha)
  }
  /**
   * Alta en bloque, en una sola transacción. Con `pisar`, a los que ya tenían cuenta les cambia la clave
   * y les cierra las sesiones; sin `pisar`, los deja como están. Devuelve cuántas cuentas se fijaron.
   */
  fijarClaves(cuentas: { cliente: string; clave: string }[], fecha: string, pisar: boolean) {
    return this.transaccion(() => {
      let fijadas = 0
      for (const { cliente, clave } of cuentas) {
        if (!pisar && this.acceso(cliente)) continue
        this.fijarClave(cliente, clave, fecha)
        this.cerrarSesiones(cliente)
        fijadas++
      }
      return fijadas
    })
  }
  claveValida(cliente: string, clave: string) {
    return coincide(this.uno('SELECT hash FROM accesos WHERE cliente = ?', cliente)?.hash, clave)
  }
  acceso(cliente: string): Acceso | null {
    return (this.uno('SELECT creado, actualizado FROM accesos WHERE cliente = ?', cliente) as Acceso | undefined) ?? null
  }
  /** Clientes con cuenta en la app (para marcarlos en la búsqueda del admin). */
  accesos(): Map<string, Acceso> {
    return new Map(this.todos('SELECT cliente, creado, actualizado FROM accesos').map(({ cliente, ...a }) => [cliente as string, a as Acceso]))
  }
  /** Quita la cuenta y cierra sus sesiones abiertas. */
  quitarAcceso(cliente: string) {
    this.transaccion(() => {
      this.correr('DELETE FROM accesos WHERE cliente = ?', cliente)
      this.cerrarSesiones(cliente)
    })
  }
  cerrarSesiones(cliente: string) {
    this.correr('DELETE FROM sesiones WHERE cliente = ?', cliente)
  }
  abrirSesion(token: string, cliente: string, fecha: string) {
    this.correr('INSERT INTO sesiones (token, cliente, creada) VALUES (?, ?, ?)', token, cliente, fecha)
  }
  clienteDeSesion(token: string) {
    return this.uno('SELECT cliente FROM sesiones WHERE token = ?', token)?.cliente as string | undefined
  }

  // ---- Administradores del local (se crean desde la consola del servidor)

  fijarAdmin(usuario: string, clave: string, fecha: string) {
    this.correr('INSERT INTO admins VALUES (?, ?, ?) ON CONFLICT(usuario) DO UPDATE SET hash = excluded.hash', usuario, hashear(clave), fecha)
  }
  adminValido(usuario: string, clave: string) {
    return coincide(this.uno('SELECT hash FROM admins WHERE usuario = ?', usuario)?.hash, clave)
  }
  abrirSesionAdmin(token: string, usuario: string, fecha: string) {
    this.correr('INSERT INTO sesiones_admin VALUES (?, ?, ?)', token, usuario, fecha)
  }
  adminDeSesion(token: string) {
    return this.uno('SELECT usuario FROM sesiones_admin WHERE token = ?', token)?.usuario as string | undefined
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
