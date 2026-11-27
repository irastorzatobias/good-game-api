# Copia en la nube (local apagado)

Con la PC del local prendida, la app usa la API como siempre. Si el local no responde (PC apagada, sin internet,
API caída), la app sigue viendo **lo último que había cuando el server estuvo prendido**: catálogo, cotización, y
para cada cliente que tenía la sesión abierta su perfil, cuenta (último año), comprobantes y sus PDF, puntos,
órdenes de servicio y solicitudes. Sin el local no se puede iniciar sesión ni hacer cambios (503 con un mensaje).

Todo es gratis en Cloudflare (Workers + R2 dentro de los límites gratuitos).

## Cómo funciona

- `nube/worker.ts`: Worker delante de la API. Pasa cada pedido al túnel; si el túnel no contesta (502/504/530 o
  15 s sin respuesta en una lectura), atiende `nube/sinLocal.ts` con la copia de R2. Toda respuesta de la copia
  lleva `X-GG-Respaldo: <fecha>` y la app muestra "El local está sin conexión".
- `src/nube/foto.ts`: la API arma la copia pidiéndole a sus propias rutas lo mismo que pediría la app. Un objeto
  por cliente (`cli/<hash>`, todos los del sistema), el catálogo (`pub/…`), la lista del panel (`admin/clientes`),
  los accesos para el login (`acc/xx`, 256 grupos) y los índices de sesiones.
- `src/nube/subida.ts`: cada 10 minutos carga lo anotado, sube solo lo que cambió (el ranking de puntos no cuenta
  como cambio) y borra lo que sobra; en la primera pasada barre lo que quedó de antes.
- En R2 no hay tokens ni códigos de cliente en los nombres: solo hashes.

## Con el local apagado

Se puede: entrar (clientes y panel), leer todo lo de la copia, mandar mensajes de servicio, pedir un service,
responder un presupuesto, cambiar foto y avisos, y desde el panel buscar clientes y dar, cambiar o quitar cuentas.
No se puede comprar ni canjear puntos (dependen de precios, stock y saldo del local).

- **Login sin el local:** cada cuenta tiene además una versión liviana de la clave (PBKDF2, `src/app/verificador.ts`)
  que el Worker puede comprobar en el plan gratis. Es más débil que el scrypt de la base del local y solo vive en R2.
  Se guarda al fijar una clave, al entrar con el local prendido, y en segundo plano para las claves de fábrica
  (CUIT o DNI). Una cuenta vieja que todavía no la tiene no puede entrar sin el local.
- **Libreta:** cada cambio queda en `pend/<fecha>-<id>`, cifrado (AES-GCM con una llave sacada de la clave
  compartida: puede llevar claves). Al volver, la API los carga en orden con las mismas rutas y con la hora en que
  pasaron (`src/nube/pendientes.ts`); uno que ya no corresponde se descarta y queda en el log.
- Las sesiones abiertas sin el local (`ses-off/`, `adm-off/`) pasan a la base del local con el mismo token.

## Prueba

Otro Worker y otro bucket: `npx wrangler deploy --env prueba --var ORIGEN:<túnel de la instancia de prueba>`
(`gg-api-prueba.hiburger.club`, bucket `gg-api-nube-prueba`), con la instancia de `C:\Huella\api-prueba`
apuntando ahí. Nunca se prueba contra el Worker de producción.

## Estado (2026-11-27)

- Worker `gg-api-nube` desplegado, con R2 `gg-api-nube`. Está delante de `gg-api.hiburger.club` (ruta de zona) y
  también en `gg-api-nube.hiburger.club` (dominio propio). La app no cambió de URL.
- La API del local (servicio `good-game-api`) sube la copia: `"nube"` en `C:\GoodGameAPI\config.json`. La
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
