// Contrato HTTP de la app. Las reglas viven en dominio/; acá solo se arma cada ruta.
import type { Ruta } from './http.ts'
import type { Deps } from './dominio/deps.ts'
import { actualizarPerfil, login, perfil } from './dominio/clientes.ts'
import { cuenta, documento, pdfDocumento } from './dominio/cuenta.ts'
import { canjear, puntos } from './dominio/puntos.ts'
import { escribir, marcarLeidos, orden, ordenes, responder, solicitar } from './dominio/servicio.ts'
import { notaDeVenta } from './dominio/ventas.ts'
import { VERSION } from './version.ts'
import { buscarClientes, loginAdmin, quitarCuenta, fijarCuenta } from './dominio/admin.ts'

const r = (metodo: string, patron: RegExp, manejar: Ruta['manejar'], acceso: Ruta['acceso'] = 'cliente'): Ruta => ({ metodo, patron, manejar, acceso })

export const rutas = (d: Deps): Ruta[] => [
  r('GET', /^\/health$/, () => ({ ok: true, version: VERSION }), 'publica'),
  r('POST', /^\/auth\/login$/, ({ body }) => login(d, body), 'publica'),

  r('GET', /^\/clientes\/me$/, ({ cliente }) => perfil(d, cliente)),
  r('PATCH', /^\/clientes\/me$/, ({ cliente, body }) => actualizarPerfil(d, cliente, body)),

  r('GET', /^\/rubros$/, () => d.sistema.rubros(), 'publica'),
  r('GET', /^\/articulos$/, () => d.sistema.articulosVenta(), 'publica'),
  r('GET', /^\/cotizacion$/, () => d.sistema.cotizacion(), 'publica'),
  r('GET', /^\/tipodocu$/, () => [...d.sistema.tipos().values()], 'publica'),
  r('GET', /^\/promo$/, () => d.contenido.leer().promo, 'publica'),
  r('GET', /^\/avisos$/, () => d.contenido.leer().avisos),

  // ?desde=YYYY-MM-DD acota la lista; el saldo siempre es sobre todo el historial.
  r('GET', /^\/cuenta$/, ({ cliente, query }) => cuenta(d, cliente, query.get('desde') ?? undefined)),
  r('GET', /^\/documentos\/([^/]+)$/, ({ cliente, params: [clave] }) => documento(d, cliente, clave)),
  r('GET', /^\/documentos\/([^/]+)\/pdf$/, ({ cliente, params: [clave] }) => pdfDocumento(d, cliente, clave)),
  // body: { items: [{ AR_CODI, cantidad }], medio: 'mp' | 'tarjeta' | 'transf' }
  r('POST', /^\/notas-venta$/, ({ cliente, body }) => notaDeVenta(d, cliente, body)),

  r('GET', /^\/puntos$/, ({ cliente }) => puntos(d, cliente)),
  r('POST', /^\/canjes$/, ({ cliente, body }) => canjear(d, cliente, body.premio)),

  r('GET', /^\/ordenes$/, ({ cliente }) => ordenes(d, cliente)),
  r('GET', /^\/ordenes\/(\d+)$/, ({ cliente, params: [n] }) => orden(d, cliente, n)),
  // body: { aprobado, motivo?, condiciones, estimada }
  r('POST', /^\/ordenes\/(\d+)\/respuesta$/, ({ cliente, body, params: [n] }) => responder(d, cliente, n, body)),
  r('POST', /^\/ordenes\/(\d+)\/mensajes$/, ({ cliente, body, params: [n] }) => escribir(d, cliente, n, body.texto)),
  r('POST', /^\/ordenes\/(\d+)\/leidos$/, ({ cliente, params: [n] }) => marcarLeidos(d, cliente, n)),

  r('GET', /^\/solicitudes$/, ({ cliente }) => d.app.solicitudes(cliente)),
  r('POST', /^\/solicitudes$/, ({ cliente, body }) => solicitar(d, cliente, body)),

  // ---- Panel del local (/admin en la app)
  r('POST', /^\/admin\/login$/, ({ body }) => loginAdmin(d, body), 'publica'),
  r('GET', /^\/admin\/clientes$/, ({ query }) => buscarClientes(d, query.get('q') ?? ''), 'admin'),
  // body: { clave } — da de alta la cuenta o cambia la clave
  r('POST', /^\/admin\/clientes\/([^/]+)\/clave$/, ({ body, params: [c] }) => fijarCuenta(d, c, body), 'admin'),
  r('DELETE', /^\/admin\/clientes\/([^/]+)\/clave$/, ({ params: [c] }) => quitarCuenta(d, c), 'admin'),
]
