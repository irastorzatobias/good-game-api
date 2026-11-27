# El sistema del local (sistema.exe, Visual FoxPro)

Mapa del sistema deducido de sus datos (copia del 28/10/2026) y de cómo la API escribe en él. El código de sistema.exe
está encriptado: todo lo de acá sale de los DBF y se confirma con huellas (copia antes / después de una operación).

## Cómo escribe la API

- Cada operación es una **acción** (`src/acciones/`) que arma un **plan** (`src/escritor/plan.ts`): qué contadores toma
  y qué registros agrega, como datos. Es una función pura: se verifica contra lo que escribió sistema.exe.
- El **escritor** (`src/escritor/`) traduce el plan a un script de FoxPro y lo corre con el driver oficial (VFPOLEDB)
  a través de `windows/vfp-helper.ps1` (PowerShell de 32 bits). El driver actualiza los índices (.CDX) y bloquea como
  sistema.exe. Un plan a la vez.
- Los contadores se toman con `RLOCK` (espera hasta 30 s), se usan y se avanzan. Si algo falla a mitad, los registros
  agregados se marcan como borrados (como hace el sistema al corregir) y el contador queda avanzado: puede quedar un
  número salteado, nunca uno repetido.
- La cabecera (`docum`) se escribe última: un comprobante existe para el sistema cuando tiene cabecera.

## Verificar una acción

1. Contra los datos reales: `node scripts/verificar-nv.ts <carpeta del sistema>` reconstruye cada NV del año con la
   receta y la compara campo por campo con la que escribió sistema.exe.
2. Contra una huella, en la PC del local (no toca el sistema; solo copias):

   ```
   robocopy C:\Compartir\Sistema C:\Huella\antes /LEV:1 /R:0 /W:0
   (en el mostrador cargan una NV normal)
   robocopy C:\Compartir\Sistema C:\Huella\despues /LEV:1 /R:0 /W:0
   good-game-api huella C:\Huella\antes C:\Huella\despues          <- lo que escribió sistema.exe

   robocopy C:\Huella\antes C:\Huella\api /E
   good-game-api probar-escritura C:\Huella\api                     <- escribe una NV de prueba en la copia
   good-game-api huella C:\Huella\antes C:\Huella\api               <- lo que escribió la API
   ```

   Las dos huellas tienen que tocar los mismos archivos y los mismos campos. Después, abrir sistema.exe apuntando a
   `C:\Huella\api` (nunca al real) y comprobar que la NV de prueba se ve, se factura y se anula bien.

   Requiere el driver **VFPOLEDB** (Microsoft OLE DB Provider for Visual FoxPro 9.0) instalado en la PC;
   `probar-escritura` avisa si falta. Instalado en la PC del local el 2026-11-27.

   Antes de abrir sistema.exe sobre una copia, apuntar `config.cfg_respal` y `config.cfg_p_sis2` de la copia a
   carpetas dentro de `C:\Huella`: por defecto apuntan a `C:\COMPARTIR\SISTEMA\ZIP\` y `C:\COMPARTIR\SISTEMA_ARIEL\`.
   Nunca facturar desde una copia: pide CAE real a AFIP.

   Toda prueba va a la cuenta de **IRASTORZA TOBIAS** (`1 20758`), que es la que usa `probar-escritura` por defecto.

### Escribir desde la API

`POST /admin/sistema/notas-venta` (sesión del panel del local) escribe una NV en el sistema:
`{ "cuenta": "1 20758", "renglones": [{ "articulo": "6", "cantidad": 1 }, { "texto": "..." }], "observacion": "..." }`.
Los precios salen del sistema (lista del cliente × dólar del día). Solo funciona si `config.json` tiene `escritura` (la
carpeta donde escribe); la API de producción no lo tiene.

Instancia de prueba en la PC del local: `C:\Huella\api-prueba` (puerto 8791, lee y escribe en la copia `C:\Huella\api`,
base y usuarios propios). Se arranca con las tareas programadas `GG-API-Prueba` y `GG-Tunel-Prueba` (túnel temporal de
Cloudflare; la dirección queda en `tunel.log`). El 2026-11-27 escribió desde internet la NV X0004-00035428 en la cuenta
de prueba y la huella coincidió con la de sistema.exe.

El driver tiene que estar instalado para toda la máquina (`msiexec /i VFPOLEDBSetup.msi ALLUSERS=1`): instalado para un
solo usuario, la API corriendo como servicio no lo ve.

### Límites del driver

VFPOLEDB corre un subconjunto de FoxPro. No tiene `TRY/CATCH`, `ERROR` ni `STRTOFILE` ("Feature is not available" /
"Function is not implemented"). Sí tiene `ON ERROR`, `PUBLIC`, funciones propias, `RLOCK`, `INSERT`, `REPLACE` y
`RETURN` (el helper lo lee con `ExecuteScalar`). Un error sin atrapar deja bloqueos tomados hasta cerrar la conexión;
por eso el helper abre y cierra una conexión por pedido.

## Tablas vivas

177 tablas; unas 40 con datos de negocio. Las `*_temp` / `*tmp` son borradores de cada terminal (llevan `MACHIN`).

| Área | Tablas |
|---|---|
| Comprobantes | `docum` (cabecera), `doccuer` (renglones), `doctexto` (texto libre por renglón), `tipodocu`, `numeros` |
| Cobranza y caja | `recibos` (qué comprobantes cancela un recibo), `for_pago` (formas de pago), `caja`, `sal_caja` (cierres), `mov_tarj` (cupones), `cheques`, `chqprop`, `deposito` / `dep_cuer`, `conciliaciones_bancarias` |
| Servicio técnico | `ord_repa`, `equipos`, `or_mater`, `or_matnn`, `ord_fact` (orden ↔ comprobante) |
| Stock | `articulo` (`AR_CANT`), `ajustock`, `hist_stock` (stock a una fecha con punteros a registros de docum/doccuer) |
| Maestros | `clientes`, `proveedo`, `proeven`, `articulo`, `rubros` / `subrubro` / `subsubr`, `marcas`, `tarjetas`, `bancos`, `vendedor`, `tecnicos`, `password` |
| Precios | `articulo` (listas en dólares), `dolar_cotiz`, `histprec`, `actprecios` |
| Fiscal | `fe_cabecera` / `fe_cuerpo` (pedido de CAE a AFIP), certificado en `WSAFIPFE/`, impresora en `Epson Fiscal/` |

## Contadores

- `codemstr.DOC_CLAV`: clave interna de comprobantes, `P` + hexadecimal (`P  2F4D6`). La comparten `docum`, `caja`,
  `for_pago`, `ord_fact`... Guarda el próximo valor.
- `numeros.N_*`: número visible por tipo; `tipodocu.TD_FLD_NUM` dice cuál usa cada tipo. Guarda el próximo valor.
- `code_dep.DOC_CLAV`: depósitos. En `cheques` y `mov_tarj` la clave es el número de registro.
- El sistema no bloquea bien la numeración: en 2026 hay 13 NV con número repetido entre terminales.

## Acciones

Qué hace el local con sistema.exe, contado en los datos de 2026 (enero a noviembre). `sistema.exe` está comprimido:
no se puede leer su menú, así que el catálogo sale de lo que escribe. Cada acción se confirma con una huella de una
operación real hecha en sistema.exe, con la cuenta de prueba.

### Ventas y clientes

| Acción | Uso 2026 | Qué escribe | Estado |
|---|---|---|---|
| Nota de venta (NV) | 1.735 (145 anuladas) | `docum`, `doccuer`, `doctexto`; `codemstr`, `numeros.N_NOTAVTA`. No toca caja, pagos ni stock. Editar = borrar y reescribir con la misma clave. | **Escribe.** Receta 95% idéntica a las NV reales; huella sobre copia OK (2026-11-27). Falta verla en sistema.exe y confirmar `DOC_PAGADO`. |
| Presupuesto (PR) | 846 | Igual que la NV con `numeros.N_PRESUP`. | Siguiente: misma receta, otro contador. |
| Factura contado (FE) / cta. cte. (FC) | 949 / 1.045 | `docum`, `doccuer`, `fe_cabecera`/`fe_cuerpo` (CAE de AFIP), `numeros.N_FE_FAC_A/B`, stock (`articulo.AR_CANT`), `caja` (concepto 1), `for_pago`, `mov_tarj`, `cheques`. | Pendiente. Lo más difícil: AFIP. |
| Recibo de cobranza (RE) | 956 | `docum` RE, `recibos` (qué comprobantes cancela), `for_pago`, `caja` (concepto 2), `cheques`/`mov_tarj` según el medio. | Pendiente. |
| N. de crédito / débito (NC, CE, ND) | 61 | Como la factura, con `N_FE_CRE_*`/`N_FE_DEB_*`. | Pendiente (fiscal). |
| Saldo anterior (AN) | 30 | `docum` AN: ajuste de saldo de la cuenta. | Pendiente. |
| Alta / edición de cliente | 2.490 clientes | `clientes`. | Pendiente. |

### Servicio técnico

| Acción | Uso 2026 | Qué escribe | Estado |
|---|---|---|---|
| Orden de reparación | 1.134 | `ord_repa`, `equipos`, `or_mater` (materiales), `or_matnn` (notas). Estados `DD` en depósito → `XX` en reparación → `RR` reparada → `EE` entregada (`AA` anulada). Al facturar, `ord_fact` une la orden con el comprobante. | Pendiente. La app ya la lee. |

### Proveedores

| Acción | Uso 2026 | Qué escribe | Estado |
|---|---|---|---|
| Compra (FC/FE de proveedor) | 457 | `docum` P, `doccuer`, stock, `caja` (concepto 3). Sin AFIP: el comprobante lo emite el proveedor. | Pendiente. |
| Pago a proveedor (RE de proveedor) | 258 | `recibos`, `for_pago`, `caja` (concepto 4), `chqprop` (cheques propios). | Pendiente. |

### Caja, bancos y tarjetas

| Acción | Uso 2026 | Qué escribe | Estado |
|---|---|---|---|
| Movimiento manual de caja | ~670 | `caja`: retiro a caja general (10), gastos varios (12), anticipo de sueldo (6), devolución de dinero (19), ingreso de caja general (7). | Pendiente. Fácil. |
| Cierre de caja | 211 | `sal_caja`, `saldocaj`. | Pendiente. |
| Depósito bancario | 2.761 | `deposito`, `dep_cuer`, `caja` (concepto 11); contador `code_dep`. Por la cantidad, puede que lo genere solo cada cobro por transferencia: confirmar con huella. | Pendiente. |
| Cheques de terceros | 289 recibidos, 284 entregados | `cheques` (entrada con el cobro; salida con `ch_fecsa`/`ch_salid`). | Pendiente. |
| Cupones de tarjeta | 2.507 | `mov_tarj`, generados por cobros con tarjeta. | Pendiente, con la venta. |
| Conciliación bancaria / cheques propios | 3.368 / 871 | `conciliaciones_bancarias`, `chqprop`. | Pendiente. |

Los códigos de `for_pago.FP_T_PAGO` (T, C, E, V, P, D, O, G, I, U, R...) se decodifican con las huellas de cobros.

### Stock y precios

| Acción | Uso 2026 | Qué escribe | Estado |
|---|---|---|---|
| Ajuste de stock | 186 | `ajustock`, `articulo.AR_CANT`. | Pendiente. Fácil. |
| Actualización de precios | 8.755 cambios | `articulo` (listas), `histprec`. | Pendiente. |
| Cotización del dólar | 4 | `dolar_cotiz`. | Pendiente. Fácil. |
| Alta / edición de artículo | — | `articulo`. | Pendiente. |

Sin uso en 2026: remitos, retenciones, notas de pedido, pagos a empleados, reingresos.

### Orden propuesto

1. **Sin plata ni AFIP:** presupuesto, orden de reparación (alta, estados, materiales), cliente, ajuste de stock,
   movimientos manuales de caja, cotización.
2. **Con plata, sin AFIP:** recibo de cobranza con sus medios de pago, compras y pagos a proveedores, depósitos,
   cheques, cierre de caja.
3. **Fiscal:** facturas y notas de crédito/débito con CAE de AFIP.

Cada acción sigue el mismo camino que la NV: huella de una operación real en sistema.exe con la cuenta de prueba,
receta como plan, backtest contra los datos del año, prueba sobre copia y endpoint.
