// Lo que decide el local y no está en el sistema: promo vigente, premios, avisos y reglas de puntos.
// Vive en contenido.json junto al ejecutable; se relee cuando cambia, sin reiniciar el servicio.
import { readFileSync, statSync } from 'node:fs'

export type Contenido = {
  pesosPorPunto: number // 1 punto cada $X de comprobante
  diasCupon: number // vigencia de un cupón canjeado
  promo: { id: string; titulo: string; hasta: string; descuento: number; medio: string; condicion: string; codigos: string[] } | null
  premios: { id: string; nombre: string; detalle: string; costo: number }[]
  avisos: { id: string; tipo: string; titulo: string; cuerpo: string; fecha: string; hasta?: string }[]
}

export class ArchivoContenido {
  private readonly ruta: string
  private cache?: { firma: string; contenido: Contenido }

  constructor(ruta: string) {
    this.ruta = ruta
    this.leer() // falla al arrancar si el archivo falta o está mal
  }

  leer(): Contenido {
    const st = statSync(this.ruta)
    const firma = `${st.mtimeMs}:${st.size}`
    if (this.cache?.firma !== firma) {
      const json = JSON.parse(readFileSync(this.ruta, 'utf8').replace(/^﻿/, ''))
      this.cache = { firma, contenido: { pesosPorPunto: 1000, diasCupon: 30, promo: null, premios: [], avisos: [], ...json } }
    }
    return this.cache.contenido
  }
}
