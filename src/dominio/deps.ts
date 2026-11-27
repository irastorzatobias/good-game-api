import type { ArchivoContenido } from '../app/contenido.ts'
import type { AppStore } from '../app/store.ts'
import type { Consultas } from '../sistema/consultas.ts'
import type { ArchivoPdfs } from '../sistema/pdfs.ts'
import type { Escritura } from './escritura.ts'

/**
 * Las fuentes: el sistema y sus PDFs, la base propia de la app y el contenido que edita el local. `escritura` es
 * dónde puede escribir la API en el sistema; null si esta instalación no escribe.
 */
export type Deps = { sistema: Consultas; pdfs: ArchivoPdfs | null; app: AppStore; contenido: ArchivoContenido; escritura: Escritura | null }
