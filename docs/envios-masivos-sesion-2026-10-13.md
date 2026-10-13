# Bitácora — Envíos Masivos + media del banco (sesión 2026-10-13)

Sesión intensa sobre la sección **Envíos Masivos** y un fix urgente de media en el **banco de respuestas**. Todo desplegado a producción (Vercel auto-deploy en push). Orden cronológico y con causa raíz de cada cosa.

---

## 1. Público de "lista fija" (selección a mano) — arregla "se crea con toda la base"

**Commit:** `1edbd43b`

**Problema:** al palomear uno o dos candidatos en la vista previa y crear un público, se creaba con **toda la base**. Causa: un público solo guardaba filtros dinámicos (`selection` + `excludeIds`), nunca una lista fija de personas; sin filtros, el server lo resolvía a toda la base. Las palomas eran "al revés" (todos incluidos, destildar para excluir).

**Fix:**
- Las palomas de la vista previa ahora son **selección positiva** (`pickedIds` en `src/components/BulksSection.jsx`). Palomear candidatos → público **ESTÁTICO** (`includeIds`) de solo esos. Cero palomeados = filtros / toda la base (como antes).
- Backend `api/bulks.js`: `includeIds` en `audience_create` / `audience_update` / duplicar / `audiences_list` (conteo = tamaño de la lista) / `start` (resuelve candidates = includeIds directo, sin filtros). `includeIds` y `selection`/`excludeIds` son excluyentes. Retrocompatible con públicos dinámicos existentes.
- UI: botón verde "Crear público con los N seleccionados"; tarjeta con "✓ Lista fija · N elegidos"; resumen "Enviando a → Elegidos a mano".
- **Decisión de diseño:** al volver las palomas positivas se **quitó la UI de excluir** ("todos menos X"). Los públicos guardados con `excludeIds` siguen funcionando; solo ya no hay botón para editarlos a mano.

## 2. Variables de plantilla: recordar por plantilla + no vaciarlas al limpiar

**Commits:** `1edbd43b` (recordar) · `c7607f15` (no vaciar)

**Problema:** las "Valores de Variables" eran efímeras (el letrero "Se guarda al escribir" mentía); se borraban al cambiar de plantilla o al enviar.

**Fix:**
- `templateParamsByTemplate` (mapa por `templateId`) persistido en el draft de masivos (`bulks:draft`). Al elegir una plantilla se recargan sus últimos valores. Letrero correcto: "✓ Se recuerda para esta plantilla".
- Al limpiar la campaña (`clearBulk`) ya **no se vacían**: se re-cargan los últimos valores recordados para la plantilla seleccionada, disponibles hasta que el usuario los cambie.

## 3. Modal de Historial de Campañas con altura fija

**Commit:** `a83aa516`

El modal crecía con el número de campañas. Ahora tiene altura constante (`h-[600px]`, tope `max-h-[85vh]`) con scroll interno. Se sembraron 8 campañas `🧪 PRUEBA` en `bulks:history` para ver el scroll (tienen botón de basura que borra la entrada + sus `bulk_stats`).

---

## 4. Abort confiable — "aborté, recargué y siguió enviando"

**Commit:** `0c160f05`

**Problema (crítico):** el motor avanza por "ticks". Al abortar, un tick que **ya estaba en vuelo** tenía su copia de `state` en memoria (`isRunning:true`) y al terminar su lote hacía `saveState` que **pisaba** el abort → al recargar la UI la campaña seguía enviando.

**Fix:** señal **durable** `bulks:engine_aborted` (`REDIS_KEY_ABORT`) que vive fuera del blob de estado y se lee **fresca** desde Redis:
- `abort` escribe la señal (antes de tocar el estado).
- `tickEngine` la revisa fresca al entrar, antes de CADA envío (para a media ráfaga) y antes del `saveState` final (no revive `isRunning`).
- `status`: si la señal está puesta, fuerza `isRunning=false` y no hace tick.
- `start` / `clear` la borran para la próxima campaña.

## 5. Paro de emergencia de la campaña "MASIVO METALSA" + limpieza del público

Durante la sesión corría una campaña real que había que parar ya.

- **Paro operativo:** se escribió `isRunning:false` + `candidates:[]` en bucle sobre `bulks:engine_state` hasta que quedó **estable** (un tick en vuelo pisa UNA vez; después gana la escritura repetida). Quedó en **123/766** (se colaron 3 del lote en vuelo).
- **Limpieza del público "METALSA MASIVO":** se recuperaron los destinatarios enviados por el marcador `campaign:reply_await:<candId>` = campaignId (TTL 90d) → **117** ids, y se agregaron a los `excludeIds` del público (es dinámico). Faltan 6 porque **ya habían respondido** (el webhook hace `GETDEL` del marcador al contestar; `bulk_stats:<id>.replied = 6`). `bulk_stats:<id>` es un hash de conteos (sent/delivered/read/replied), **no** guarda ids.

---

## 6. Motor de masivos empujado por el SERVIDOR + progreso inline + reloj

**Commit:** `f43fc014`

**Problema:** el motor avanzaba SOLO mientras la sección Masivos estaba abierta y pollando (`?action=status`). Salir de la sección **pausaba** la campaña → el usuario quedaba ~25 min "encerrado" bajo un overlay `absolute inset-0` que tapaba toda la sección. No hay cron de bulks.

**Fix — driver server-side (`api/bulks.js`):**
- Acción interna **`drive`** (auth con `CRON_SECRET` vía `Authorization: Bearer`): `driveLoop` drena lotes hasta ~50s (bajo `maxDuration` 60s) y **encadena** la siguiente invocación con auto-fetch al mismo endpoint. **Un solo driver a la vez** con `bulk_driver_lock` (EX 65, refrescado con `pexpire`).
- Arranca en `start` vía `runInBackground` (waitUntil, `api/utils/background.js`). Se **re-lanza desde `status`** si no hay driver vivo (robustez si se cae el encadenado).
- **`tickOnceLocked()`**: toma `bulk_lock` y **RELEE `getState()` fresco dentro del lock** antes de `tickEngine`. **Crítico:** evita envíos **duplicados** ahora que driver + poll del frontend pueden empujar a la vez (antes se ticqueaba con estado rancio; también corrige una carrera latente que ya existía con 2 pestañas).
- Funciona en los 3 escenarios: viendo en vivo, cambiando de sección y volviendo, o **cerrando el navegador** (el servidor sigue).

**UI (`src/components/BulksSection.jsx`):**
- El overlay que tapaba la sección → **tarjeta flotante compacta no bloqueante** (`absolute bottom-4 right-4 z-[55]`) con progreso + botón Detener. El modal queda solo para el evento de completado.
- **Reloj de duración** de la campaña: `startedAt`/`finishedAt` en el estado + `formatDuration`; tick de 1s mientras corre, congelado al terminar.

**Auto-auditoría que atrapó un bug antes de escribir:** el plan original no cubría la carrera de estado rancio (dos empujadores → duplicados). Se agregó `tickOnceLocked` (relee dentro del lock) como corrección central.

**Pendiente de validar en prod:** no se pudo testear envío real (manda WhatsApp). Verificar con campaña de **2-3 contactos**: avanza al salir de la sección y al cerrar pestaña, sin duplicados (`bulk_stats.sent ≈ targets`).

---

## 7. Fix urgente — imágenes del banco de respuestas en números NO-default

**Commit:** `6d3c40b8`

**Problema:** mandar imágenes del **banco de respuestas** desde un número que no es el default daba el error de Meta **"image.id is not a valid whatsapp business account media attachment ID"** (y el 2º del grupo: "No enviado: falló el mensaje anterior del grupo").

**Causa raíz:** `uploadMediaToMeta` (`api/whatsapp/utils.js`) **siempre subía al número default** (`META_PHONE_NUMBER_ID` = `1061455557054529` Candidatic IA), pero el envío sale **desde** `ultraConfig.instanceId` (el número real del candidato; p.ej. Hr One México = `1249373631587237`). **Los media_id de Meta son POR número** → el id subido a un número es inválido al enviarse desde otro. Además la caché `meta:image:<id>.metaMediaId` era única (no por número) y servía el id equivocado.

**Fix:**
- `uploadMediaToMeta(buffer, mime, filename, phoneNumberId?)` — sube a `${GRAPH}/${phoneNumberId||default}/media`.
- `api/chat.js` (path `isInternalMedia` del banco): calcula `senderNumberId = ultraConfig.instanceId` (si es id numérico de Meta) y lo pasa a `uploadMediaToMeta` en el envío inicial **y** en el retry.
- Caché **por número**: `meta.metaMediaIds[phoneId]` (reemplaza el único `metaMediaId`). Migración segura: el viejo id único solo se reusa si el emisor === default (así lo subía la versión anterior).

**Regla general:** cualquier envío de media por media_id en WABA multi-número debe subir/cachear el id atado al número emisor. Las plantillas ya lo hacían bien (`resolveTemplateHeaderMedia` recibe `phoneNumberId: ultraConfig.instanceId`). Otros callers de `uploadMediaToMeta` (stickers de `media-engine.js`, `webhook.js`, `media/upload.js`) siguen usando el default — si aparece el mismo error ahí en un número no-default, aplicar el mismo patrón.

---

## Resumen de commits (orden de push)

| Commit | Qué |
|--------|-----|
| `1edbd43b` | Público de lista fija (selección a mano) + recordar variables por plantilla |
| `c7607f15` | No vaciar las variables al limpiar la campaña |
| `a83aa516` | Altura fija del modal de Historial de Campañas |
| `0c160f05` | Abort confiable (señal durable) |
| `f43fc014` | Motor auto-empujado por el servidor + progreso inline + reloj |
| `6d3c40b8` | Media del banco: subir al número emisor + caché por número |

## Verificación / pendientes de prueba manual (mandan WhatsApp real, no testeable desde el entorno)
1. **Público lista fija:** palomear 2-3 → crear público → debe quedar "Lista fija · N".
2. **Variables:** escribir valores, cambiar de plantilla y volver → reaparecen; tras enviar/limpiar siguen ahí.
3. **Motor servidor:** campaña de 2-3 contactos → salir de la sección / cerrar pestaña → sigue avanzando; sin duplicados (`bulk_stats.sent ≈ targets`).
4. **Abort:** iniciar, Detener desde la tarjeta flotante → para y no revive al recargar.
5. **Media banco:** mandar una imagen del banco en un chat de número no-default (Hr One) → llega sin el error de media_id.
