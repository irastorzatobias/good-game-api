// Escribe planes en el sistema a través de windows/vfp-helper.ps1 (driver VFPOLEDB de 32 bits). Un solo proceso
// ayudante y un plan a la vez: las escrituras de la API al sistema van siempre en serie.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { isSea } from 'node:sea'
import { raiz } from '../config.ts'
import type { Plan } from './plan.ts'
import { scriptVfp } from './vfp.ts'

export type Resultado = { contadores: Record<string, number> }

export interface Escritor {
  ejecutar(plan: Plan): Promise<Resultado>
}

const ESPERA_MS = 90_000

/** PowerShell de 32 bits: en Windows de 64 bits está en SysWOW64; en uno de 32, el de System32 ya lo es. */
function powershell32() {
  const windir = process.env.WINDIR ?? 'C:\\Windows'
  const wow = join(windir, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(wow) ? wow : join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Instalado, el ayudante está junto al .exe (se copia la carpeta windows/); en desarrollo, en windows/. */
export const rutaAyudante = () => (isSea() ? join(raiz, 'vfp-helper.ps1') : join(raiz, 'windows', 'vfp-helper.ps1'))

type Respuesta = { id: number; ok: boolean; valor?: string; error?: string }

export class EscritorVfp implements Escritor {
  readonly carpeta: string
  private proceso: ChildProcessWithoutNullStreams | null = null
  private readonly esperando = new Map<number, (r: Respuesta) => void>()
  private ultimo = 0
  private cola: Promise<unknown> = Promise.resolve()

  constructor(carpeta: string) {
    if (process.platform !== 'win32') throw new Error('Escribir en el sistema solo es posible en Windows (driver VFPOLEDB).')
    this.carpeta = resolve(carpeta)
  }

  /** Comprueba que el ayudante corre en 32 bits, que el driver está instalado y que abre la carpeta. */
  probar(): Promise<void> {
    return this.enCola(async () => {
      const r = await this.pedir({ probar: true })
      if (!r.ok) throw new Error(r.error)
    })
  }

  ejecutar(plan: Plan): Promise<Resultado> {
    return this.enCola(async () => {
      const r = await this.pedir({ script: scriptVfp(plan) })
      if (!r.ok) throw new Error(`${plan.accion}: ${r.error}`)
      if (!r.valor) throw new Error(`${plan.accion}: el sistema no devolvió resultado`)
      const res = JSON.parse(r.valor) as { ok: boolean; error?: string; contadores?: Record<string, number> }
      if (!res.ok) throw new Error(`${plan.accion}: ${res.error}`)
      return { contadores: res.contadores ?? {} }
    })
  }

  cerrar() {
    this.proceso?.stdin.end()
    this.proceso = null
  }

  private enCola<T>(tarea: () => Promise<T>): Promise<T> {
    const r = this.cola.then(tarea)
    this.cola = r.catch(() => undefined)
    return r
  }

  private iniciar(): ChildProcessWithoutNullStreams {
    if (this.proceso) return this.proceso
    const ayudante = rutaAyudante()
    if (!existsSync(ayudante)) throw new Error(`No está el ayudante de escritura: ${ayudante}`)
    const p = spawn(powershell32(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ayudante], { windowsHide: true })
    createInterface({ input: p.stdout }).on('line', (linea) => {
      try {
        const r = JSON.parse(linea) as Respuesta
        this.esperando.get(r.id)?.(r)
      } catch {
        // PowerShell a veces escribe avisos propios: no son respuestas.
      }
    })
    let errores = ''
    p.stderr.on('data', (b: Buffer) => (errores = (errores + b.toString()).slice(-2000)))
    p.on('exit', () => {
      this.proceso = null
      for (const [id, responder] of this.esperando) responder({ id, ok: false, error: `El ayudante terminó. ${errores.trim()}` })
      this.esperando.clear()
    })
    this.proceso = p
    return p
  }

  private pedir(pedido: { script?: string; probar?: boolean }): Promise<Respuesta> {
    const p = this.iniciar()
    const id = ++this.ultimo
    return new Promise((resolver) => {
      const reloj = setTimeout(() => {
        this.esperando.delete(id)
        p.kill() // un ayudante colgado no puede seguir atendiendo: se relanza en el próximo pedido
        resolver({ id, ok: false, error: 'El sistema no respondió a tiempo' })
      }, ESPERA_MS)
      this.esperando.set(id, (r) => {
        clearTimeout(reloj)
        this.esperando.delete(id)
        resolver(r)
      })
      p.stdin.write(JSON.stringify({ id, carpeta: this.carpeta, ...pedido }) + '\n')
    })
  }
}
