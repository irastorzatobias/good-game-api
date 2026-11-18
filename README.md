# good-game-api

API de la app de clientes de Good Game. Lee el sistema Visual FoxPro del local (carpeta `Sistema_Local`, archivos DBF)
**sin escribir nunca en él**, y guarda lo propio de la app (claves, sesiones, puntos, cupones, mensajes, respuestas a
presupuestos, solicitudes, notas de venta, contactos editados) en SQLite (`datos/app.db`).

## Desarrollo (Node 22.18+)

```sh
npm install
echo '{ "sistema": "/ruta/a/Sistema_Local" }' > config.json
npm run revisar            # lee todas las tablas
npm run clave -- 33456789 1234
npm run dev                # http://localhost:8787
npm run check              # tsc
```

## Paquete para Windows

```sh
npm run build:exe          # dist/good-game-api-<versión>-win-x64.zip
```

Un solo `good-game-api.exe` (Node SEA, no requiere Node en el servidor). Doble clic: la primera vez pide la carpeta del
sistema y la guarda en `config.json`. `Iniciar con Windows.bat` lo registra como servicio (WinSW). Ver `windows/LEEME.txt`.
`node scripts/build-exe.mjs --host` arma el ejecutable para la máquina actual, para probarlo sin Windows.

## Estructura

- `src/dbf/` lector de DBF (VFP y dBase/FoxPro 2, páginas 1252/850/437)
- `src/sistema/` tablas de Sistema_Local con caché por fecha/tamaño de archivo, y consultas con la forma del contrato
- `src/app/` base SQLite propia y `contenido.json` (promo, premios, avisos, puntos)
- `src/dominio/` reglas: cuenta, puntos, ventas, servicio técnico, clientes
- `src/rutas.ts`, `src/http.ts` contrato HTTP (el mismo que el fake de `good-game-app/server`)
