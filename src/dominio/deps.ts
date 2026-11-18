import type { ArchivoContenido } from '../app/contenido.ts'
import type { AppStore } from '../app/store.ts'
import type { Consultas } from '../sistema/consultas.ts'
import type { ArchivoPdfs } from '../sistema/pdfs.ts'

/** Las fuentes: el sistema y sus PDFs (solo lectura), la base propia de la app y el contenido que edita el local. */
export type Deps = { sistema: Consultas; pdfs: ArchivoPdfs | null; app: AppStore; contenido: ArchivoContenido }
