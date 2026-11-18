// Fechas en hora local del servidor del local, como las guarda FoxPro.
const local = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString()
export const hoy = () => local().slice(0, 10)
export const ahora = () => local().slice(0, 16) // YYYY-MM-DDTHH:mm
export const enDias = (dias: number) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10)
