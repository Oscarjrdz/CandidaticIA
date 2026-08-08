# Auditoría de confiabilidad: sistema de recordatorios

Fecha: 2026-08-07
Repositorio: Candidatic_IA

> **Actualización 2026-08-08 — `scheduled_reminders` (recordatorios de "proyecto") se eliminó por completo.**
> Oscar confirmó que ese sistema era código viejo sin uso real: no hay ninguna UI actual para
> configurarlo (`ScheduledRemindersModal.jsx` estaba huérfano, sin ningún componente que lo
> importara) — la única forma real de configurar un recordatorio es desde la sección Chat
> (tarjeta del candidato o menú de arriba del chat), que es exactamente `direct_reminders`.
> Se borraron `api/utils/reminder-scheduler.js` y `src/components/ScheduledRemindersModal.jsx`
> completos, y se quitaron sus llamadas en `api/ai/agent.js` y `api/utils/storage.js`.
> `api/cron/send-reminders.js` ahora solo procesa `direct_reminders`.
> El hallazgo #1 de abajo (`cancelRemindersForCandidate` nunca se llamaba) y toda mención a
> `scheduled_reminders`/`ScheduledRemindersModal.jsx` quedan como **registro histórico** de
> un sistema que ya no existe en el código — no como referencia de algo que sigue activo.
> Si quedó algo en el ZSET `scheduled_reminders` de Redis de antes de este cambio, ya nadie
> lo procesa (dato huérfano e inofensivo, no se limpió a propósito para no tocar Redis sin
> necesidad).

Origen: Oscar aplicó 2 plantillas de recordatorio a su número de prueba (8116038195) el 2026-08-06 y ninguna llegó al aparato, aunque Redis las marcaba `status: "sent"`. Se pidió una auditoría completa del sistema de recordatorios con estándar de confiabilidad alto ("nivel Meta/AAA") porque es crítico para la operación (candidatos citados a entrevista dependen de esto).

Cubre los dos motores que existen — **son el mismo pipeline de envío**, no dos sistemas distintos:

- **`scheduled_reminders`** (ZSET): recordatorios de proyecto, agendados automáticamente cuando Brenda mueve a un candidato al step "Citados" (`api/utils/reminder-scheduler.js` → `scheduleRemindersForCandidate()`).
- **`direct_reminders`** (ZSET): recordatorios manuales por candidato, creados desde `CandidateReminderModal.jsx` (a mano o "Usar" una plantilla guardada) o desde el botón de un clic en `ChatSection.jsx`. Las plantillas de `api/reminder-templates.js` **no tienen lógica de envío propia** — solo prellenan datos y terminan en el mismo `POST /api/candidate-reminders`.

Ambos los procesa el mismo cron, `api/cron/send-reminders.js`, cada 15 min.

## Hallazgos, de más a menos grave

### 1. CRÍTICO — `cancelRemindersForCandidate()` existe pero nunca se llama

`api/utils/reminder-scheduler.js` exporta `cancelRemindersForCandidate(candidateId, citaFecha)`, pensada para borrar del ZSET los recordatorios de una cita cancelada/reagendada. **Verificado por grep en todo el repo (api/ y src/): ninguna otra parte del código la importa ni la llama.** Es código muerto.

Consecuencia real: en `api/ai/agent.js` (~línea 3850-3860), cuando un candidato pasa de "Citados" de vuelta a "Cita" (reagenda), el código limpia `citaFecha`/`citaHora` del perfil del candidato **pero no toca el ZSET `scheduled_reminders`**. Los recordatorios de la cita vieja siguen agendados con la fecha vieja incrustada en el `member` (`{projectId}|{stepId}|{candidateId}|{reminderId}|{citaFecha}`). Cuando el candidato agenda una cita nueva, `scheduleRemindersForCandidate()` agrega un segundo set de recordatorios (member distinto porque `citaFecha` cambió) — quedan **los dos** en la cola.

Esto significa: un candidato que reagenda puede recibir un recordatorio de la cita **cancelada**, con la fecha/hora vieja, el mismo día que su cita real. Es el hallazgo que más directamente rompe la confianza — no es "no llegó", es "llegó información incorrecta".

**Fix sugerido:** llamar `cancelRemindersForCandidate(candidateId, citaFechaVieja)` justo en el bloque de reset Citados→Cita (agent.js ~línea 3854), antes de limpiar `citaFecha`/`citaHora`.

### 2. CRÍTICO — `direct_reminders` no tiene límite de reintentos ni expiración

`scheduled_reminders` sí tiene un corte: si un recordatorio lleva vencido más de 48h (`STALE_REMINDER_MS`), se descarta en vez de reintentar para siempre (`send-reminders.js` línea ~133).

`direct_reminders` **no tiene ese corte**. Si un envío falla de forma no-terminal (error de red, config temporalmente caída, etc.), el código hace `throw new Error(...)`, el `catch` guarda `status: 'pending'` con `failureReason` pero **no quita el miembro del ZSET** — se reintenta cada 15 min indefinidamente. En la UI (`CandidateReminderModal.jsx`), ese recordatorio se sigue mostrando en "Programados" (ámbar, como si fuera a enviarse pronto) aunque lleve días fallando — no hay ninguna señal visual de que algo va mal, solo se vería revisando `failureReason` que ni siquiera se renderiza en esa sección.

**Fix sugerido:** aplicar el mismo corte de "stale" (o uno más corto, ej. 24h) a `direct_reminders`, y marcarlo `failed` con una razón clara en vez de dejarlo reintentando en silencio.

### 3. ALTO — `send-reminders.js` no tiene `maxDuration` explícito

En `vercel.json`, `reengagement.js`, `agent.js`, `agent-katcon.js`, `agent-candidatic.js` y `agent-ia/chat.js` tienen overrides explícitos de `maxDuration` (60-120s). **`api/cron/send-reminders.js` no tiene ninguno** — corre con el default de la plataforma, que es notablemente menor a los 120s que CLAUDE.md confirma que el plan soporta.

El cron procesa en un loop secuencial `scheduled_reminders` + `direct_reminders`, cada uno con varios round-trips a Redis y una llamada HTTP a Meta (timeout de 30s cada una). Si en una corrida hay varios recordatorios vencidos a la vez (ej. después de una caída del cron, o un pico de citas a la misma hora), la función puede ser matada por Vercel a media cola sin terminar de procesar el resto.

Mitigante ya existente: el lock por item (`reminder-lock.js`) expira solo en 10 min, así que un corte a medias no deja nada atorado para siempre — se retoma en la siguiente corrida. Pero sí genera atraso, y en el peor caso (recordatorios sensibles a la hora, ej. "en camino a tu cita") un atraso de 15-30 min puede importar.

**Fix sugerido:** agregar `"api/cron/send-reminders.js": { "maxDuration": 120 }` en `vercel.json`, igual que los demás crons.

### 4. ALTO — `deleteCandidate()` no limpia recordatorios pendientes

Verificado: la función de borrado de candidato no toca `direct_reminders:candidate:<id>`, `direct_reminder:<id>` ni hace scan de `scheduled_reminders` para ese candidato. Como el recordatorio directo guarda `whatsapp`/`message` de forma autocontenida (no depende de que el candidato exista — `getUltraMsgConfig(undefined)` cae al número default de la cuenta), **el mensaje se sigue enviando aunque el candidato ya no exista en el sistema**. Puede violar la expectativa de "ya no le hablamos a este número" (ej. si se borró por spam, número equivocado, o petición del candidato).

**Fix sugerido:** al borrar un candidato, además del cleanup que ya existe, quitar sus IDs de `direct_reminders:candidate:<id>` del ZSET `direct_reminders` (ya tienes el set de IDs, es un `zrem` por cada uno) y hacer el mismo `ZSCAN ... MATCH *|candidateId|*` sobre `scheduled_reminders` que ya usa `cancelRemindersForCandidate`.

### 5. MEDIO — Cero observabilidad

No hay alerta ni panel que muestre si `errors` sube en una corrida del cron (la respuesta del cron con `{sent, skipped, errors}` no se registra en ningún lado persistente, solo se devuelve en el HTTP response de una llamada que dispara Vercel Cron y nadie ve). La única forma de detectar un recordatorio fallido hoy es abrir el modal candidato por candidato. Para "nivel AAA" esto es la pieza que falta más: sin esto, cualquier fix de los anteriores sigue dependiendo de que alguien note manualmente que algo no llegó (como pasó ahora).

**Fix sugerido (más grande, opcional):** guardar cada corrida del cron en una llave tipo `reminders:health:daily:YYYY-MM-DD` (sent/skipped/errors acumulados, similar al patrón ya usado por `redis-bandwidth.js`), y mostrar un badge/alerta en el dashboard si `errors > 0` en las últimas 24h.

### 6. Ya corregido en esta sesión (2026-08-07)

- `send-reminders.js` no guardaba el `ultraMsgId` (wamid) al registrar el mensaje del recordatorio en el historial de chat — un fallo asíncrono de Meta (llega vía webhook después del 200 OK inicial) no se podía enlazar de vuelta al mensaje ni al `direct_reminder`, y quedaba invisible para siempre (el mensaje se marca "read" al guardarse, sin verificación real de entrega). **Fix aplicado:** ahora se guarda `ultraMsgId: sendResult.messageId` en ambos bloques (scheduled y direct).
- `webhook.js`, en el manejo de status `failed`, ahora además de marcar el mensaje como fallido, revisa si es un recordatorio directo (`meta.directReminder` + `meta.reminderId`) y actualiza `direct_reminder:<id>` a `status: "failed"` con la razón — antes esto solo tocaba el mensaje del chat, nunca el registro del recordatorio.
- Este fix **no cubre retroactivamente** los envíos de antes del 2026-08-07 — esos ya no tienen wamid guardado y no se puede saber si fallaron async.

### Nota, no es un bug — comportamiento a confirmar

Editar el `scheduledReminders` de un step de proyecto (mensaje, hora, `enabled`) afecta **retroactivamente** a todos los recordatorios ya agendados de ese step — `send-reminders.js` lee la config del step en vivo al momento de enviar (`step?.scheduledReminders?.find(...)`), no guarda una copia (snapshot) al agendar. Puede ser el comportamiento deseado (permite corregir un typo en un mensaje ya agendado), pero vale confirmarlo — si alguien apaga (`enabled: false`) un recordatorio pensando "esto solo aplica a candidatos nuevos", en realidad también cancela los que ya estaban agendados para candidatos con cita esta semana.

## Resumen para decidir qué atacar primero

| # | Hallazgo | Severidad | Esfuerzo del fix | Estado |
|---|----------|-----------|-------------------|--------|
| 1 | Reagendar no cancela recordatorios viejos → fecha equivocada | Crítico | Bajo (1 llamada en agent.js) | ✅ Corregido 2026-08-07 |
| 2 | `direct_reminders` reintenta para siempre sin marcarse failed | Crítico | Bajo (mismo patrón que ya existe para scheduled) | ✅ Corregido 2026-08-07 |
| 3 | Sin `maxDuration` explícito en el cron | Alto | Trivial (1 línea en vercel.json) | ✅ Corregido 2026-08-07 |
| 4 | Candidato borrado sigue recibiendo recordatorios | Alto | Bajo-medio | ✅ Corregido 2026-08-07 |
| 5 | Cero observabilidad / alertas | Medio | Medio-alto (feature nueva) | ⚠️ Parcial — ver abajo |
| — | ultraMsgId / status async perdido | Corregido hoy | — | ✅ Corregido 2026-08-07 |

## Cambios aplicados (2026-08-07) — detalle técnico

Reescritura completa de `api/cron/send-reminders.js` y `api/utils/reminder-scheduler.js`, no parches puntuales. Resumen:

### `api/utils/reminder-scheduler.js`
- Nuevo índice `scheduled_reminders:candidate:<id>` (SET de members) mantenido en paralelo al ZSET `scheduled_reminders` — mismo patrón que ya usaba `direct_reminders:candidate:<id>`.
- `cancelRemindersForCandidate(candidateId, citaFecha?)` ahora tiene implementación real usada en producción (antes existía pero nadie la llamaba): usa el índice para cancelar en O(1); si `citaFecha` se omite, cancela **todos** los recordatorios pendientes del candidato (usado por `deleteCandidate`); con `citaFecha`, solo cancela los de esa cita específica (usado al reagendar). Fallback a `ZSCAN` para candidatos agendados antes de que existiera el índice.
- Nuevo helper `removeScheduledReminderMember(redis, member)` — quita de ambas estructuras a la vez, usado por el cron.

### `api/cron/send-reminders.js`
- Refactor: la lógica de cada cola se extrajo a `processScheduledReminderMember()` y `processDirectReminderItem()`, cada una con su propio lock/try/catch, en vez de vivir dentro de un solo handler de 400 líneas. Permite probarlas de forma aislada (una sola prueba no dispara el `ZRANGEBYSCORE` completo, que procesaría también recordatorios reales pendientes).
- `direct_reminders` ahora tiene el mismo corte de 48h que ya tenía `scheduled_reminders` (`isStaleDue()`, función pura y exportada) — un recordatorio directo que lleva vencido +48h se marca `failed` con razón explícita en vez de reintentarse cada 15 min para siempre.
- Ambas colas guardan `ultraMsgId` (wamid de Meta) en el mensaje del historial — permite que `webhook.js` enlace un fallo async de entrega de vuelta al mensaje y al `direct_reminder`.
- `recordHealthSnapshot()`: cada corrida incrementa `reminders:health:daily:YYYY-MM-DD` (sent/skipped/errors/runs, TZ Monterrey, TTL 90 días) — primera pieza de observabilidad (ver limitación abajo).

### `api/whatsapp/webhook.js`
- El manejo de status `failed` ahora, además de marcar el mensaje del chat, revisa si es un recordatorio directo y actualiza `direct_reminder:<id>` a `failed` con la razón real de Meta.

### `api/ai/agent.js`
- En el reset Citados→Cita (candidato reagenda), ahora llama `cancelRemindersForCandidate(candidateId, citaFechaVieja)` antes de limpiar la fecha — cierra el hallazgo #1. Cambio aislado a ese bloque, no toca extracción ni flujo conversacional de Brenda.

### `api/utils/storage.js` (`deleteCandidate`)
- Ahora cancela recordatorios de proyecto (vía `cancelRemindersForCandidate(id)`, import dinámico para evitar dependencia circular con `reminder-scheduler.js`) y limpia `direct_reminders`/`direct_reminder:<id>`/`direct_reminders:candidate:<id>` del candidato borrado.

### `vercel.json`
- `api/cron/send-reminders.js` ahora tiene `maxDuration: 120`, igual que los demás crons.

### Pruebas internas ejecutadas (2026-08-07, contra Redis de producción, datos 100% desechables)
Script temporal (borrado al terminar) usando un proyecto real existente (`proj_1776278440719_leso1b`, step "CITADOS") con candidatos de prueba con ID único (`test_reminder_audit_*`, `test_stale_direct_*`) — nunca candidatos reales, todo limpiado y verificado al final (`ZRANGE`/`KEYS` confirmando cero rastro).

22/22 aserciones pasaron:
1. Agendar + cancelar con la citaFecha exacta — el ZSET y el índice quedan sincronizados.
2. Cancelar con una citaFecha equivocada **no** borra nada (protege citas futuras reales).
3. Flujo completo de reagendado (Citados→Cita→Citados): el recordatorio viejo se cancela y solo sobrevive el nuevo.
4. `cancelRemindersForCandidate(id)` sin citaFecha borra TODOS los recordatorios del candidato (caso `deleteCandidate`).
5. `isStaleDue()` — función pura: casos límite (49h/10h/exactamente el umbral/NaN).
6. Un `direct_reminder` vencido 50h se marca `failed` con razón clara y se saca del ZSET — `processDirectReminderItem()` ejecutado directamente contra Redis real, sin disparar el resto de la cola.

## Hallazgo #7 (2026-08-08) — el fallback a template nunca se intentaba en el rechazo async

Descubierto probando en vivo con el número de prueba: dos recordatorios directos con `fallbackTemplateData` configurado fallaron igual, con `sentVia` quedando en `"text"` (nunca cambió a `"template_fallback"`).

Causa: Meta puede rechazar un mensaje de dos formas —
1. **Síncrona**: el POST responde de inmediato con error 131047. `send-reminders.js` sí manejaba este caso (intenta el template ahí mismo).
2. **Asíncrona**: Meta responde `200 OK` (acepta el mensaje) y el rechazo real llega segundos/minutos después por el webhook de status `failed`. Este caso **nunca intentaba el template** — `webhook.js` solo marcaba `failed` y ya.

En el número de prueba, Meta está rechazando de la forma asíncrona, así que el template de respaldo configurado nunca se usaba aunque estuviera ahí.

**Fix:** se extrajo la lógica de armar/enviar el template de respaldo a `api/utils/reminder-fallback.js` (`attemptReminderTemplateFallback()`), compartida por los dos casos — antes estaba duplicada solo en el lado síncrono. `webhook.js` ahora, en el fallo async con código 131047, intenta el template antes de marcar `failed`, con lock (`reminder-lock.js`) para no reintentarlo dos veces si Meta manda el webhook duplicado, y guardado idempotente (solo actúa si `status === 'sent' && sentVia === 'text'`, es decir la primera vez que nos enteramos del fallo).

Probado en vivo: `attemptReminderTemplateFallback()` llamado directamente contra Redis/Meta reales con los datos del recordatorio que había fallado — Meta aceptó el template (`success: true`, wamid real devuelto), confirmado por Oscar en su teléfono.

### Limitación conocida — observabilidad (#5) sigue parcial
`recordHealthSnapshot()` guarda los contadores, pero **no hay UI ni alerta** que los muestre — hoy solo se pueden leer con un `HGETALL reminders:health:daily:YYYY-MM-DD` manual. Si se quiere una tarjeta en Configuración (como la de Ancho de Banda) o una alerta cuando `errors > 0`, es trabajo aparte, no incluido en esta pasada.
