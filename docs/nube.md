# Copia en la nube (local apagado)

Con la PC del local prendida, la app usa la API como siempre. Si el local no responde (PC apagada, sin internet,
API caída), la app sigue viendo **lo último que había cuando el server estuvo prendido**: catálogo, cotización, y
para cada cliente que tenía la sesión abierta su perfil, cuenta (último año), comprobantes y sus PDF, puntos,
órdenes de servicio y solicitudes. Sin el local no se puede iniciar sesión ni hacer cambios (503 con un mensaje).

Todo es gratis en Cloudflare (Workers + R2 dentro de los límites gratuitos).

## Cómo funciona

- `nube/worker.ts`: Worker delante de la API. Pasa cada pedido al túnel; si el túnel no contesta (502/504/530 o
  15 s sin respuesta en una lectura), responde desde R2. Toda respuesta de la copia lleva `X-GG-Respaldo: <fecha>`.
- `src/nube/foto.ts`: la API arma la copia pidiéndole a sus propias rutas lo mismo que pediría la app.
- `src/nube/subida.ts`: cada 10 minutos sube solo lo que cambió (y borra lo que ya no está) a `/_nube/...` del
  Worker, con la clave compartida. La PC no tiene credenciales de Cloudflare.
- En R2 no hay tokens ni códigos de cliente: el índice `sesiones` es sha256(token) → carpeta, y la carpeta es un hash
  del cliente. Cerrar una sesión en el local la saca de la copia en la siguiente subida.

## Estado (2026-11-27)

- Worker `gg-api-nube` desplegado, con R2 `gg-api-nube`. Está delante de `gg-api.hiburger.club` (ruta de zona) y
  también en `gg-api-nube.hiburger.club` (dominio propio). La app no cambió de URL.
- La API del local (1.8.0, servicio `good-game-api`) sube la copia: `"nube"` en `C:\GoodGameAPI\config.json`. La
  clave está ahí y como secret `CLAVE` del Worker; si se pierde, se genera otra y se cambia en los dos lados.
- 1.7.0 quedó en `C:\GoodGameAPI\_anterior-1.7.0` por si hay que volver.

## Puesta en marcha (desde cero)

1. Habilitar R2 una vez en el dashboard de Cloudflare.
2. `cd nube && npx wrangler r2 bucket create gg-api-nube`
3. `npx wrangler secret put CLAVE` (una clave larga al azar) y `npx wrangler deploy`.
4. En `config.json` de la API: `"nube": { "url": "https://gg-api-nube.hiburger.club", "clave": "<la misma>" }` y
   reiniciar. En el log aparece "Copia en la nube: N subidas".
5. Sacar el Worker de delante de la app: quitar la ruta `gg-api.hiburger.club/*` de `wrangler.jsonc` y deploy.
   Una sola instancia de la API sube a la copia (la de prueba en C:\Huella no tiene "nube").

Tipos del Worker: `cd nube && npx wrangler types` (genera worker-configuration.d.ts, no va al repo).

Prueba local sin Cloudflare: `cd nube && npx wrangler dev --port 8788 --local` con `nube/.dev.vars`
(`CLAVE=...`, `ORIGEN=http://localhost:8790`) y la API con `"nube": { "url": "http://localhost:8788", ... }`.
