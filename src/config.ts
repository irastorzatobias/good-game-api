import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { isSea } from 'node:sea'

export type Config = {
  sistema: string | null // carpeta Sistema_Local con los DBF
  sucursal: string // AR_SUCU de la que salen precios y stock
  puerto: number
  base: string // SQLite con los datos propios de la app
  contenido: string // promo, premios y avisos que edita el local
  pdfs: string | null // PDFs que guarda el sistema; por defecto "Factura Electronica" junto a la carpeta del sistema
  // Copias diarias de la base. Por defecto "Backup App" junto a la carpeta del sistema: así entra en el backup que
  // ya tenga el local de esa carpeta y no queda en el mismo lugar que la base.
  backups: string
}

// Instalado, todo vive junto al .exe; en desarrollo, en la carpeta del proyecto.
export const raiz = isSea() ? dirname(process.execPath) : process.cwd()
const ruta = (p: string) => (isAbsolute(p) ? p : resolve(raiz, p))
const archivo = ruta('config.json')

function leerJson(): Record<string, unknown> {
  return existsSync(archivo) ? JSON.parse(readFileSync(archivo, 'utf8').replace(/^﻿/, '')) : {}
}

/** config.json junto al ejecutable (si no existe, valores por defecto); GG_SISTEMA y PORT lo pisan. */
export function leerConfig(): Config {
  const json = leerJson()
  const sistema = process.env.GG_SISTEMA ?? (json.sistema as string | undefined)
  return {
    sistema: sistema ? ruta(sistema) : null,
    sucursal: String(json.sucursal ?? '1'),
    puerto: Number(process.env.PORT ?? json.puerto ?? 8787),
    base: ruta(String(json.base ?? 'datos/app.db')),
    contenido: ruta(String(json.contenido ?? 'contenido.json')),
    pdfs: json.pdfs ? ruta(String(json.pdfs)) : sistema ? resolve(ruta(sistema), '..', 'Factura Electronica') : null,
    backups: json.backups ? ruta(String(json.backups)) : sistema ? resolve(ruta(sistema), '..', 'Backup App') : ruta('datos/backups'),
  }
}

/** Recuerda la carpeta del sistema para los próximos arranques. */
export function guardarSistema(carpeta: string) {
  writeFileSync(archivo, JSON.stringify({ ...leerJson(), sistema: carpeta }, null, 2))
}
