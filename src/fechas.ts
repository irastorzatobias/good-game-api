// Fechas en hora local del servidor del local, como las guarda FoxPro.
import { AsyncLocalStorage } from 'node:async_hooks'

// Lo que se hizo con el local apagado se carga después con la hora en que pasó (nube/pendientes.ts): dentro de
// conFecha, "ahora" es ese momento.
const reloj = new AsyncLocalStorage<number>()
export const conFecha = <T>(ms: number, f: () => T) => reloj.run(ms, f)

const local = () => {
  const t = reloj.getStore() ?? Date.now()
  return new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString()
}
export const hoy = () => local().slice(0, 10)
export const ahora = () => local().slice(0, 16) // YYYY-MM-DDTHH:mm
export const enDias = (dias: number) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10)
