import type { ArchivoContenido } from '../app/contenido.ts'
import type { AppStore } from '../app/store.ts'
import type { Consultas } from '../sistema/consultas.ts'

/** Las tres fuentes: el sistema (solo lectura), la base propia de la app y el contenido que edita el local. */
export type Deps = { sistema: Consultas; app: AppStore; contenido: ArchivoContenido }
