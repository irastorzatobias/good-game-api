// Versión del paquete, fijada al armar el .exe (scripts/build-exe.mjs); en desarrollo, "dev".
declare const __VERSION__: string | undefined
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'
