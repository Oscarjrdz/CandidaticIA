# Auditoria para segundo repaso: consumo, sesiones y recordatorios

Fecha: 2026-07-03
Repositorio: Candidatic_IA

Este documento es un handoff para que Claude haga una segunda auditoria independiente. El foco no es estilo de codigo: es evitar perdida de candidatos, evitar que mensajes programados no salgan, y bajar consumo de Redis/ancho de banda sin afectar UI ni funcionalidad critica.

## Contexto del problema

Se detecto consumo alto de Redis/ancho de banda aun cuando no habia reclutadores trabajando. Se hicieron cambios para:

- Expirar sesiones admin despues de 8 horas y mandar al usuario de vuelta al landing/login.
- Medir mejor consumo de endpoints y cron jobs.
- Desconectar Redis despues de inactividad.
- Registrar presencia/actividad humana.
- Evitar que llamadas no autenticadas marquen actividad humana.

Decision importante de esta auditoria: no se deben pausar los cron jobs que envian mensajes solo porque no haya un humano activo. Eso baja consumo, pero puede romper recordatorios y recontactos automaticos.

## Cambios relevantes ya hechos

### Sesiones y navegador

Archivos:

- `api/auth.js`
- `src/contexts/AuthContext.jsx`
- `src/main.jsx`
- `src/hooks/useCandidatesSSE.js`

Comportamiento esperado:

- La sesion admin caduca a las 8 horas.
- El frontend detecta sesion expirada y redirige al landing/login.
- Las respuestas 401 globales limpian sesion y evitan que la pantalla quede abierta en blanco.
- SSE se cierra si la sesion ya no esta autorizada.

### Presencia humana

Archivos:

- `api/presence.js`
- `api/utils/human-activity.js`

Comportamiento esperado:

- `POST /api/presence` requiere sesion admin valida.
- Solo un usuario autenticado y no idle marca actividad humana.
- El campo `idle` queda guardado para distinguir pestana abierta vs humano trabajando.

Punto para revisar:

- Confirmar que todos los clientes que llaman `POST /api/presence` mandan cookies/sesion correctamente. Si alguna llamada legitima queda sin credenciales, presencia fallara con 401.

### Cron de recordatorios

Archivo principal:

- `api/cron/send-reminders.js`

Cambios criticos:

- Se elimino el gate de "humano activo" para `send-reminders`.
- Los recordatorios de proyecto en `scheduled_reminders` ya no se eliminan del zset antes de enviar.
- Se agregaron locks por recordatorio para evitar doble procesamiento simultaneo.
- Se valida `sendResult.success`; si Meta/API falla temporalmente, el recordatorio queda en cola para reintento.
- Se agrega marcador `done:scheduled_reminder:*` por 30 dias despues de envio exitoso para reducir reprocesos si falla el `zrem`.
- Los recordatorios directos en `direct_reminders` tambien usan lock.
- Los directos se eliminan del zset solo cuando terminan en estado final: enviado, fallido terminal, incompleto, o raw faltante.
- Fallos temporales de directos quedan como `pending` con `lastAttemptAt` y `failureReason`, para que sigan visibles y reintentables.
- Fallos terminales como ventana 24h sin template o numero invalido se marcan `failed` y salen del zset.

Escenarios que Claude debe revisar:

1. Si `sendUltraMsgMessage` devuelve `{ success: false }` por timeout/error temporal, el recordatorio no debe desaparecer.
2. Si Meta acepta el mensaje y luego Redis falla al quitarlo del zset, el marcador `done:*` debe prevenir reenvio en la siguiente corrida.
3. Si Redis falla justo despues de que Meta acepta el mensaje, antes de guardar marcador y antes de `zrem`, todavia existe riesgo residual de duplicado. Revisar si conviene agregar idempotencia externa o registro previo.
4. Si falta config de WhatsApp/Meta temporalmente, el recordatorio queda pendiente. Revisar si eso puede generar demasiados reintentos.
5. Si un recordatorio directo ya tiene `status: sent` o `status: failed` pero sigue en `direct_reminders`, debe removerse del zset sin reenviar.
6. Si el candidato no tiene WhatsApp o el reminder fue deshabilitado, el scheduled reminder se elimina como terminal.
7. Revisar que `saveMessage` fallando despues del envio no provoque reenvio; actualmente el zset se remueve antes de guardar historial para evitar duplicado.

### Reengagement

Archivo:

- `api/cron/reengagement.js`
- `api/cron/paso2-trigger.js`

Cambio critico:

- Se elimino el gate de "humano activo".
- Se valida `sendResult.success` antes de guardar historial o incrementar intentos.
- Si falta configuracion WhatsApp/Meta, el candidato no se marca como contactado.
- En `paso2-trigger`, se valida cada burbuja y se guarda progreso temporal para no repetir la primera si falla la segunda.
- `paso2-trigger` ahora respeta `CRON_SECRET` si esta configurado, igual que los otros cron endpoints.

Motivo:

- El recontacto automatico puede ser parte del flujo de candidatos. Pausarlo por falta de humano activo puede hacer que candidatos no reciban mensajes.
- Un fallo de Meta no debe contar como intento enviado.

Puntos para Claude:

- Revisar si los limites `silenceHours`, `intervalHours`, `maxSilenceHours` pueden hacer que un candidato quede fuera si un cron falla varias veces.
- Revisar si reengagement necesita una cola/idempotencia mas fuerte como `send-reminders`, porque hoy depende de volver a calificar por reglas de tiempo.
- Revisar si `paso2_trigger_progress:*` con TTL de 24 horas es suficiente para el peor caso de caida prolongada.

## Riesgos residuales conocidos

- No hay prueba end-to-end real contra Meta/WhatsApp en local.
- La idempotencia no es perfecta si Meta acepta envio y Redis cae antes de guardar marcador y antes de quitar del zset.
- `api/cron/reengagement.js` ya valida resultado de envio antes de marcar intento, pero no tiene una cola/idempotencia tan fuerte como `send-reminders`.
- Otros flujos que mandan mensajes con `sendUltraMsgMessage` fuera de `api/cron` podrian tener patrones de "fire and forget"; revisar si son criticos para candidatos.
- El lint global del repo ya trae muchos errores preexistentes; para esta auditoria usar `npm run build`, `git diff --check`, busquedas dirigidas y revision manual.

## Busquedas sugeridas

```bash
rg -n "sendUltraMsgMessage\\(" api src -g '*.{js,jsx}'
rg -n "zrem\\(|zremrangebyscore|zrangebyscore" api -g '*.js'
rg -n "shouldRunHumanGatedJob|sleep_mode_no_human_active|human-activity" api src -g '*.{js,jsx}'
rg -n "validateAdminSession|presence" api src -g '*.{js,jsx}'
rg -n "setInterval|EventSource|SSE|visibilitychange|beforeunload" src api -g '*.{js,jsx}'
```

## Criterio de aceptacion

- Ningun job que envie mensajes a candidatos debe depender de que haya un humano activo en la UI.
- Una sesion vencida debe cerrar la experiencia y regresar al landing/login sin pantalla blanca permanente.
- Recordatorios programados no deben desaparecer antes de envio exitoso o fallo terminal.
- Fallos temporales deben quedar pendientes para reintento.
- Fallos terminales deben quedar visibles como fallidos, no reintentarse indefinidamente.
- Ahorro de consumo debe venir de apagar conexiones/UI/presencia/Redis idle, no de pausar mensajes criticos.

---

## Segunda auditoria (Claude) — hallazgos y cambios aplicados

Fecha: 2026-07-03. Auditoria de solo lectura sobre todo lo anterior, verificando cada afirmacion contra el codigo real (no contra la intencion). Todos los hallazgos fueron confirmados leyendo el codigo fuente antes de tocar nada; despues, con aprobacion explicita, se implementaron los fixes de bajo riesgo/alto impacto.

### Confirmado correcto (sin cambios)

- Escenarios 1, 2, 5, 6 de `send-reminders.js` (scheduled reminders): fallo temporal no borra el recordatorio, `done:*` protege contra doble envio si el `zrem` falla, casos terminales se limpian bien.
- Sesion admin (8h): TTL en Redis y timer en cliente sincronizados; interceptor global de `main.jsx` y cierre de SSE en `useCandidatesSSE.js` limpian sesion y redirigen en 401/`unauthorized`.
- Presencia: `validateAdminSession` lee el token del header `Authorization` (no son cookies pese a como lo describia la seccion original de este doc); el unico caller (`usePresence.js`) pasa por el interceptor global que inyecta ese header — sin riesgo de 401 por falta de credenciales.
- Reengagement: `reengagement_attempts` solo se incrementa tras `assertSuccessfulSend` exitoso — un fallo de Meta no cuenta como intento (correcto antes y despues de los cambios de esta pasada).
- El bot conversacional (`api/whatsapp/webhook.js` → `agent.js`) nunca depende de actividad humana. Su unico gate es el switch manual `bot_ia_active` (Redis) y `candidate.blocked` — confirmado por grep, cero referencias a presencia/sesion en el pipeline de IA.

### Hallazgos nuevos (no estaban en la version original de este doc)

1. **`api/cron/paso2-trigger.js` era codigo muerto.** No estaba en `vercel.json` desde el commit `536c236d` ("disparar paso2 inmediatamente — eliminar cron"); leia llaves `paso2_pendiente:*` que nada en el repo escribia (el flujo real vive en `agent.js:4824`, comentario propio: *"Disparar Paso 2 inmediatamente — sin cron, sin Redis key"*). Tenia ademas un bug latente: si `updateCandidate` fallaba, solo lo logueaba y aun asi borraba las llaves del trigger, dejando al candidato con la pregunta de colonia enviada pero sin estado para interpretarla. **Accion: archivo eliminado (`git rm`).**
2. **`reengagement.js` no tenia lock de procesamiento** (a diferencia de `send-reminders.js`). Riesgo concreto: el boton "Enviar ya" de la UI pega al mismo endpoint con `forceCandidateId`; un doble clic o retry de red podia disparar dos invocaciones concurrentes y mandar el mensaje dos veces antes de que cualquiera persistiera `reengagement_last_sent`. **Accion: se extrajo el patron de lock de `send-reminders.js` a `api/utils/reminder-lock.js` (compartido) y se aplico a `reengagement.js` — loop principal y loop paso2.**
3. **Orden de escritura invertido en dos rutas** (riesgo de duplicado si el proceso muere a medias entre awaits): `saveMessage()` corria antes de persistir el estado de "ya enviado" en `reengagement.js` (ambos loops) y en la ruta de **recordatorios directos** de `send-reminders.js`. El punto 7 original de este doc afirmaba que "el zset se remueve antes de guardar historial" — cierto solo para *scheduled reminders*, no para directos. **Accion: se invirtio el orden en las 3 ubicaciones para que el estado se persista antes del historial, igual que ya hacia la ruta de scheduled reminders.**
4. **Los checks `if (!config)` en `send-reminders.js` y `reengagement.js` eran codigo muerto.** `getUltraMsgConfig()` nunca devuelve falsy — siempre arma un objeto aunque falten las env vars de Meta. El comportamiento correcto ocurria igual, pero via el chequeo interno de `sendMetaMessage()`, no por este check. **Accion: cambiado a `if (!config?.token || !config?.instanceId)` en las 3 ubicaciones (scheduled, directos, reengagement, paso2), igual al patron que ya usaba correctamente el extinto `paso2-trigger.js`.**
5. **`getHumanActivity()` (`api/utils/human-activity.js`) estaba exportada pero nunca se llamaba en todo el repo.** Solo `markHumanActivity()` se usaba desde `presence.js`, escribiendo una llave (`system:human:last_active_at`) que nadie leia. El indicador de "quien esta en linea" en la UI no depende de este modulo (arma su lista directo de `presence:hash`/`presence:expiry`). **Accion: se elimino el archivo completo y su unica llamada en `presence.js`. Se confirmo con grep que nada mas lo referenciaba y que `npm run build` sigue pasando.**
6. **Sin corte de vigencia en `send-reminders.js`** para recordatorios programados: si Meta/config fallaba de forma persistente, el cron reintentaba cada 15 min para siempre, y al arreglarse podia mandar un recordatorio de una cita ya pasada dias atras. **Accion: se agrego `STALE_REMINDER_MS` (48h) — un recordatorio que lleva mas de 48h vencido se marca terminal en vez de seguir reintentando.**
7. **`reengagement.js`: el corte por `maxSilenceHours` puede sacar candidatos del funnel para siempre, en silencio,** si el cron estuvo caido varios dias (el tiempo se mide contra reloj de pared, no contra corridas del cron). No habia forma de detectarlo. **Accion: se agrego contador `agedOut`/`paso2AgedOut`, expuesto en la respuesta JSON del endpoint y logueado con `console.warn` cuando > 0.**
8. **El heartbeat de presencia (`usePresence.js`) corria cada 45s sin importar si el usuario estaba idle o activo**, gastando el mismo Redis (~10-15 comandos por heartbeat) con una pestaña abierta y abandonada que con un reclutador trabajando activo. Acotado a un maximo de 8h por el TTL de sesion, pero desperdicio real dentro de esa ventana. **Accion: el heartbeat se espacia a cada 4 min una vez que el usuario lleva idle (sin mouse/teclado/scroll/touch) mas de 60s; vuelve a 45s en cuanto hay actividad de nuevo.**

### Cambios de codigo aplicados en esta pasada

- Nuevo: `api/utils/reminder-lock.js` (lock + marcador de completado, compartido entre `send-reminders.js` y `reengagement.js`).
- Modificado: `api/cron/send-reminders.js` (usa el lock compartido, corte de vigencia 48h, checks de config corregidos, orden de escritura en recordatorios directos).
- Modificado: `api/cron/reengagement.js` (lock por candidato en ambos loops, orden de escritura corregido, checks de config corregidos, contador `agedOut`).
- Modificado: `api/presence.js` (se quito la llamada a `markHumanActivity`, ya sin destino).
- Modificado: `src/hooks/usePresence.js` (heartbeat adaptativo segun idle).
- Eliminado: `api/cron/paso2-trigger.js` (muerto).
- Eliminado: `api/utils/human-activity.js` (muerto).

Verificacion realizada: `node --check` en los 5 archivos tocados, `npx eslint` sobre los mismos (limpio salvo errores preexistentes de `usePresence.js` no relacionados con este cambio), `npm run build` exitoso, y grep de confirmacion de que no quedan referencias colgantes a los archivos/funciones eliminados.

### Pendiente (no aplicado en esta pasada, discutido pero de menor prioridad)

- `reengagement.js` muestrea solo 500 pendientes al azar por corrida (`srandmember('stats:list:pending', 500)`) — cobertura probabilistica si el pool supera ese numero. Revisar solo si el volumen de pendientes se acerca a 500 en produccion.

---

## Tercera auditoria (Codex) — foco: ahorro real cuando no hay humano activo

Fecha: 2026-07-03. Se revisaron los cambios de Claude contra el objetivo original: bajar consumo de Redis/ancho de banda cuando la app queda abierta pero nadie esta trabajando, sin pausar cron jobs ni mensajes automaticos a candidatos.

### Confirmado

- El commit de Claude `14321efe` esta en `origin/main`.
- `send-reminders`, `reengagement` y el bot conversacional no dependen de presencia humana para mandar mensajes criticos.
- `paso2-trigger.js` y `human-activity.js` fueron eliminados y no quedan referencias de codigo productivo.
- `usePresence.js` ya reduce el heartbeat de presencia de 45s a 4min cuando detecta idle.

### Hallazgos adicionales

1. **TTL de presencia incompatible con heartbeat idle.** El cliente idle late cada 4min, pero `api/presence.js` expiraba usuarios a los 90s. Eso ahorraba consumo, pero hacia que usuarios idle desaparecieran/reaparecieran de la lista en linea. **Accion:** TTL activo queda en 90s y TTL idle sube a 5min.
2. **Actividad diaria seguia escribiendose aunque el usuario estuviera idle.** Aunque `activeSeconds` fuera 0, el endpoint seguia escribiendo meta/ids/visited. **Accion:** las estadisticas `recruiter:*` solo se escriben cuando `idle=false`.
3. **El lock del chat seguia latiendo cada 30s aunque no hubiera humano.** Si un reclutador dejaba un candidato abierto toda la noche, `ChatSection.jsx` mantenia `/api/chat` heartbeat y el lock activo. **Accion:** si pasan 60s sin mouse/teclado/click/scroll/touch o la pestana se oculta, el chat se desbloquea y deja de mandar heartbeats; al volver actividad real, se bloquea de nuevo.

### Resultado esperado de consumo

- Pestaña abierta sin uso: presencia baja de 1 llamada cada 45s a 1 cada 4min.
- Chat abierto sin uso: lock baja de 1 llamada cada 30s a 0 llamadas despues de 60s idle.
- Cron jobs y mensajes automaticos siguen corriendo, para no perder recordatorios ni candidatos.

### Verificacion

- `node --check api/presence.js` OK.
- `npx eslint api/presence.js src/hooks/usePresence.js` OK.
- `npm run build` OK.
- `git diff --check` OK.

---

## Cuarta auditoria (Claude) — limpieza de medicion de consumo duplicada

Fecha: 2026-07-04. Contexto: al investigar por que el consumo real de Redis Cloud (12 GB/mes reportados en el panel) no cuadraba con el estimado interno (`api/utils/usage-metrics.js`, ~334 MB en 6 dias), se descubrio que Codex ya habia intentado un reemplazo ("Use Redis Cloud official bandwidth metrics", commit `b64212d4`) y lo revirtio 25 minutos despues ("Remove internal bandwidth monitor", commit `f5fe1f26`), dejando el mensaje explicito en `copilot-platform-stats.js`: *"El monitor interno de ancho de banda fue retirado para evitar datos estimados. El consumo oficial debe revisarse en Redis Cloud > candidatic-kv > Configuration > Monthly network used."*

Decision registrada: **no duplicar la medicion de consumo que Redis Cloud ya hace bien.** Cualquier estimado interno (JSON.stringify de payloads, o incluso una integracion con la API oficial de Redis Cloud) puede desalinearse de la realidad — la fuente de verdad es el panel de Redis Cloud.

### Por que hacia falta una segunda pasada

Codex ya habia convertido `api/utils/usage-metrics.js` en funciones vacias (`recordUsageMetric` retorna `false`, `readUsageMetrics` retorna `[]`), pero **14 archivos seguian importando y llamando esas funciones muertas** (sin efecto, pero como codigo/CPU desperdiciado y ruido de lectura), y `api/utils/copilot-platform-stats.js` seguia calculando `endpointUsageToday` a partir de llaves Redis (`metrics:endpoint:*`) que ya nadie escribe — esa rama del copiloto respondia "0 llamadas, sin datos aun" para siempre.

### Cambios aplicados

- **Eliminado** `api/utils/usage-metrics.js` completo (ya era un stub sin efecto).
- **Limpiados los 14 archivos** que importaban/llamaban `recordUsageMetric`/`estimateJsonBytes` (import + bloque de llamada + variables que solo alimentaban esas llamadas): `api/tags.js`, `api/image.js`, `api/public/ai-search.js`, `api/ai/query.js`, `api/candidate-daily-stats.js`, `api/bypass-search.js`, `api/media/list.js`, `api/candidates.js`, `api/chat-unread-count.js`, `api/bulks.js`, `api/chat.js`, `api/sse/candidates.js`, `api/cron/send-reminders.js`, `api/cron/reengagement.js`.
- **`api/utils/copilot-platform-stats.js`**: eliminadas `summarizeEndpointUsage()` y `readEndpointUsage()` (leian llaves `metrics:endpoint:*` que nadie escribe desde que `recordUsageMetric` es un stub), quitada `endpointUsageToday` de todos lados donde se propagaba, y fusionada la pregunta del copiloto sobre "endpoints/llamadas/cache/full scan" con la misma respuesta ya existente sobre ancho de banda (redirige a Redis Cloud). Tambien se elimino `formatBytes()`, que habia quedado sin ningun caller.
- **Bug encontrado y corregido durante la limpieza**: en `api/cron/send-reminders.js`, la remocion mecanica dejo un `if (reminder.candidateId) { }` vacio (el cuerpo original solo actualizaba el `usageMetrics` eliminado). Se quito el `if` completo — no afectaba el envio, pero era codigo muerto que eslint marco como "empty block statement".
- Se quito `Buffer` del comentario `/* global process, Buffer */` en `send-reminders.js` y `reengagement.js` porque ya no se usa (todo el uso de `Buffer.byteLength(...)` era para estimar bytes de las metricas eliminadas).

### Que NO se toco (a proposito)

- `api/utils/copilot-platform-stats.js` → `readRecruiterStats()` / `recruiter:*` (tiempo activo, mensajes, chats visitados de reclutadores) — sigue vivo y sirve, `presence.js` todavia escribe esas llaves.
- El heartbeat de presencia (`usePresence.js`) y su TTL — eso es actividad humana, no medicion de consumo; ya lo ajusto la Tercera auditoria (Codex).
- El indicador "quien esta en linea" (`presence:hash`/`presence:expiry`) — feature real de UI, no duplica nada de Redis Cloud.

### Verificacion

- `node --check` en los 14 archivos + `copilot-platform-stats.js`: OK.
- `npx eslint` sobre los mismos: limpio de errores nuevos (los que aparecen son preexistentes — `catch {}`/`catch (_) {}` vacios intencionales, variables sin usar en codigo que no se toco — confirmado comparando contra `git diff` linea por linea).
- `npm run build`: OK.
- `grep` de confirmacion: cero referencias a `usage-metrics`, `recordUsageMetric`, `estimateJsonBytes`, `readUsageMetrics`, `endpointUsageToday`, `summarizeEndpointUsage`, `readEndpointUsage` en todo `api/` y `src/`.

### Siguiente paso (pendiente de decision con el usuario)

Con la duplicacion removida, quedaba pendiente decidir si construir un reemplazo real y donde debe vivir la fuente de verdad. Se eligio la Opcion C (ver abajo), implementada en la Quinta auditoria.

- Opcion A: no construir nada — confiar en el panel de Redis Cloud (`Configuration > Monthly network used` y la pestaña `Metrics`) como unica fuente, tal como ya decidio Codex.
- Opcion B: instrumentar `api/whatsapp/webhook.js` y `api/ai/agent.js` (los dos archivos que reciben/procesan cada mensaje de candidato y que nunca tuvieron ningun tipo de medicion) ya que un analisis con `INFO commandstats` mostro que `GET` es el 94.5% de todos los comandos Redis (226.5M de 239.8M en 167 dias de uptime) y esos dos archivos son los principales sospechosos de generar ese volumen (llaman `getCandidateById` sin cache). **Pendiente, no implementado.**
- **Opcion C (elegida):** un snapshot periodico de `INFO stats` (bytes reales de red, no comandos) que calcula deltas dia a dia, guardado en Redis, expuesto en un panel de Settings.

---

## Quinta auditoria (Claude) — medidor de ancho de banda real (unico, sin duplicar)

Fecha: 2026-07-04. A peticion explicita del usuario: *"quiero que tu crees el medidor de ancho de banda trayendo... los datos reales... no quiero tener nada que mida que no sea eso"*. O sea: un solo medidor, con datos reales (no heuristicos), y nada mas midiendo consumo en paralelo.

### Diseño

- **Dato real, no estimado:** se usa `INFO stats` de Redis (`total_net_input_bytes`, `total_net_output_bytes`, `total_commands_processed`) — los mismos contadores que usa el motor de Redis internamente. No es un `JSON.stringify().length` de payloads de la app (que fue precisamente el problema de la version anterior, la que se desalineo 27x contra el numero real de Redis Cloud).
- **Snapshot + delta, no lectura directa:** como esos contadores son acumulados desde que el proceso de Redis arranco (se resetean si Redis reinicia), se guarda una foto (`bandwidth:snapshot:last`) y en cada corrida se calcula el delta contra la foto anterior. Si el valor actual es menor al anterior, se asume reinicio del proceso y el delta se cuenta completo desde cero (evita numeros negativos).
- **Sin cron nuevo:** el snapshot se llama desde dentro de `api/cron/send-reminders.js` (que ya corre cada 15 min via Vercel Cron), no se agrego ninguna entrada nueva a `vercel.json`.
- **Acumulacion diaria:** el delta de cada corrida se suma a una llave `bandwidth:daily:<YYYY-MM-DD>` (zona horaria Monterrey, mismo criterio que el resto del proyecto), con TTL de ~95 dias.

### Archivos nuevos

- `api/utils/redis-bandwidth.js` — `recordBandwidthSnapshot(redis)` (guarda snapshot + delta) y `getBandwidthSummary(redis, days)` (lee y suma N dias).
- `api/system/bandwidth.js` — unico endpoint nuevo (`GET`, protegido por `validateAdminSession`), regresa hoy/rango de dias/totales.
- `src/components/RedisBandwidthSettings.jsx` — tercer modulo en Configuracion (junto a `WhatsAppSettings` y `GPTSettings`, mismo componente `Card`), muestra hoy / 7 dias / 30 dias, con nota que apunta a Redis Cloud como fuente oficial de facturacion.

### Archivos modificados

- `api/cron/send-reminders.js` — una linea: `recordBandwidthSnapshot(redis).catch(() => {});` justo despues de confirmar que Redis esta disponible.
- `src/components/SettingsSection.jsx` — se agrego `<RedisBandwidthSettings />` al grid junto a los otros dos modulos.

### Verificacion

- **Prueba real end-to-end contra Redis de produccion** (no solo sintaxis): se corrio `recordBandwidthSnapshot` dos veces con 300 operaciones reales de por medio (100 SET + 100 GET + 100 DEL). El primer snapshot establecio la base en 0: el segundo mostro un delta real de 65,504 bytes de entrada, 329,308 bytes de salida, 286 comandos — numeros correctos y consistentes con el trafico generado. Las llaves de prueba (`bandwidth:snapshot:last`, `bandwidth:daily:2026-07-04`) se borraron despues para no contaminar el primer dia real de medicion.
- `node --check` y `npx eslint` limpios en los 3 archivos nuevos y los 2 modificados.
- `npm run build` exitoso.
- **No verificado:** la vista visual del panel en el navegador — no hay herramienta de control de navegador disponible en este entorno. El componente sigue el mismo patron visual que `GPTSettings.jsx` (mismo `Card`, mismos estilos), pero no se confirmo con captura.

### Que sigue siendo el unico medidor

Se confirmo con grep que no queda ningun otro sistema midiendo/mostrando consumo en `api/` ni `src/` fuera de este (ver Cuarta auditoria). Si en el futuro se decide implementar la Opcion B (instrumentar `webhook.js`/`agent.js` para saber exactamente que candidato/flujo genera mas trafico), deberia integrarse a este mismo modulo (`redis-bandwidth.js`) en vez de crear una fuente de datos paralela.
