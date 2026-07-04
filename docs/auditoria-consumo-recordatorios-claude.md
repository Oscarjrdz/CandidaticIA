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

### Seed manual de historial (1-3 de julio) — a peticion del usuario

El medidor solo empieza a acumular desde que se desplego (4 de julio). El usuario reporto el numero oficial del panel de Redis Cloud para lo que iba del mes: **12.4 GB** entre el 1 y el 3 de julio (3 dias antes de que el medidor existiera). Pidio repartir ese total de forma estatica entre esos 3 dias y dejar que a partir del 4 de julio el medidor acumule solo, dinamicamente, con datos reales del cron.

Se hizo un seed de un solo uso (script temporal, no queda en el repo) escribiendo directo en Redis:
- `bandwidth:daily:2026-07-01`, `2026-07-02`, `2026-07-03` → `netOutputBytes` con 12.4 GiB repartidos en partes iguales (4,438,132,872 / 4,438,132,872 / 4,438,132,874 bytes — la diferencia de 2 bytes en el ultimo dia es solo para que la suma sea exacta), `netInputBytes: 0`, `samples: 1`, mismo TTL de ~95 dias que usa el resto del sistema.
- Se verifico leyendo de vuelta con `getBandwidthSummary(redis, 30)`: el total de 30 dias dio exactamente 12.40 GB, igual al numero que reporto el usuario.

**Importante para el futuro:** los dias 2026-07-01 a 2026-07-03 en `bandwidth:daily:*` son un valor manual fijo, no una medicion real dia por dia (no sabemos cuanto se consumio especificamente cada uno de esos 3 dias, solo el total). A partir de 2026-07-04 todo es medicion real via `recordBandwidthSnapshot`. Si se audita este sistema mas adelante y esos 3 dias se ven sospechosamente parejos entre si, es por esto, no es un bug del snapshot.

---

## Sexta auditoria (Claude) — encontrar y corregir una fuga real de bandwidth

Fecha: 2026-07-04. Con el medidor ya funcionando, el usuario pidio ir mas alla: no solo medir cuanto, sino encontrar de donde sale el consumo para corregirlo.

### Metodologia: `MONITOR` en vivo en vez de instrumentar codigo a ciegas

En lugar de modificar los 27 sitios que llaman `getCandidateById()` sin saber si esa era siquiera la causa correcta, se uso `redis.monitor()` (ioredis) para capturar el trafico real de comandos durante ventanas cortas (12-30s) contra produccion. Es seguro porque el promedio historico es de solo ~17 comandos/seg (`total_commands_processed` / `uptime_in_days` de una medicion anterior) — una ventana corta de captura no representa riesgo de carga.

Se hicieron 4 capturas coordinadas con el usuario en tiempo real:
1. Ventana con la pestaña de Configuracion recien recargada: **7,974 comandos en ~17s reales** (~400/seg) — parecia alarmante.
2. Ventana limpia, usuario con la pestaña de chat abierta sin mandar nada: **~1 comando/seg** — practicamente silencio. Esto descarto que hubiera un drenaje constante de fondo.
3. Ventana pidiendole al usuario refrescar de nuevo: solo 4 comandos (el refresh en si fue muy rapido/liviano esta vez).
4. Ventana pidiendole al usuario entrar a la seccion Candidatos mientras se capturaba: **183 comandos en 30s**, de los cuales **100 eran `GET candidate:<id>` — uno por cada uno de los 100 candidatos de la pagina, ninguno repetido**.

Conclusion de esta parte: no hay un "drenaje" constante de fondo con la app idle — el consumo es proporcional a la actividad real (abrir la lista de candidatos), lo cual es esperado. La pregunta correcta paso de "por que se gasta esto estando idle" a "por que pesa tanto cargar 100 candidatos".

### El hallazgo real: 65% del payload es un campo que nadie usa en la lista

Se leyeron los 100 candidatos reales de `candidates:list` directo de Redis y se sumo el tamaño de cada campo JSON a traves de todos ellos:

| Campo | Bytes (100 candidatos) | % del total |
|---|---|---|
| `adBody` | 117,190 | 43.3% |
| `adImageUrl` | 39,326 | 14.5% |
| `adClickId` | 12,273 | 4.5% |
| `adUrl` | 2,225 | 0.8% |
| *(resto de ~40 campos combinados)* | resto | ~36.9% |

**`adBody` + `adImageUrl` + `adUrl` + `adClickId` = 65% de los 264 KB totales de una pagina de 100 candidatos.**

Se verifico con grep en todo `src/` y `api/` que:
- `adBody`, `adImageUrl`, `adUrl`: solo los usa `src/components/AdsStatisticsSection.jsx`, que **no consume `/api/candidates`** (usa `/api/ads-stats`, `/api/ad-labels`, `/api/ads-comments` — endpoints separados). El backend (`storage.js`, agregacion de stats de ads) tambien los lee, pero directo de Redis, no via este endpoint.
- `adClickId`: no se usa en ningun componente de frontend; solo en `api/whatsapp/webhook.js` (Meta Conversions API) y `api/utils/storage.js`, ambos leyendo directo de Redis.
- `adId` y `adHeadline` (mas chicos, ~0.7% y ~0.5%) **si se usan** en `ChatSection.jsx`/`ChatRow.jsx` (badge de "vino de anuncio") — **no se tocaron**, se quedan en la respuesta.

O sea: candidatos que llegaron por un anuncio de Meta cargan el texto completo del anuncio (`adBody`) y la URL de la imagen en cada carga de la lista de candidatos, sin que ninguna pantalla de lista los muestre — se usan solo en la seccion de estadisticas de anuncios, que ya los obtiene por otro camino.

### Fix aplicado

`api/candidates.js` → `buildCandidatesListPayload()` (el unico punto donde se arma la respuesta de lista, usado por los 5 modos de listado: normal, por proyecto manual, por filtro unread/complete/incomplete, unreadFirst, unreadFirst+tag): se agrego `stripHeavyListFields()` que quita `adBody`, `adImageUrl`, `adUrl`, `adClickId` de cada candidato antes de mandarlo al navegador. No se toco `getCandidates()`/`hydrateCandidateIds()` en `storage.js` (siguen leyendo el registro completo de Redis, lo necesitan otros consumidores), ni la respuesta de candidato individual por `?id=` (menor impacto, un solo candidato a la vez, no 100).

**Impacto esperado:** para cualquier pagina de candidatos con mezcla de origenes de anuncio, hasta ~65% menos bytes por carga de lista — sin afectar ninguna pantalla (verificado que ningun componente de lista/chat lee esos 4 campos).

### Verificacion

- Prueba de la funcion `stripHeavyListFields` con un objeto de ejemplo: confirma que quita `adBody`/`adImageUrl` y conserva `adId`/`adHeadline`.
- `node --check api/candidates.js` OK.
- `npx eslint api/candidates.js`: sin errores nuevos (el unico error que sale es un `catch {}` preexistente sin relacion a este cambio, confirmado con `git diff`).
- `npm run build` exitoso.

### Pendiente / siguientes pasos posibles

- No se instrumento `getCandidateById()` con contadores por origen (la Opcion 2 que se habia propuesto) porque `MONITOR` ya dio la respuesta sin necesidad de tocar 27 sitios de codigo — se prioriza esta via (observar antes de instrumentar) para futuras investigaciones similares.
- Si se quiere seguir bajando el peso de la lista de candidatos, el siguiente candidato a revisar seria `adHeadline`/`adId` si algun dia se puede evitar mandarlos tambien salvo cuando el candidato realmente tiene esos datos (ya son chicos, ~1.2% combinado, no urge).
- Revisar si `/api/ads-stats` (que si necesita `adBody` etc.) tiene su propio problema de consumo — no se audito en esta pasada.

### Segundo hallazgo (bonus): el propio lock de reengagement de esta sesion generaba de mas

Al pedirle al usuario cambiar a la seccion "Chat Web" para capturar ese flujo con `MONITOR`, la ventana coincidio por casualidad con una corrida del cron `reengagement` (corre cada 15 min). De 2,151 comandos capturados en 30s, **1,590 (74%) eran puro overhead del lock que se agrego en la Segunda auditoria de esta sesion**: `acquireProcessingLock`/`releaseProcessingLock` (SET+GET+DEL, 3 comandos) se ejecutaba para **cada uno de los ~530 candidatos muestreados** (500 del loop principal + 30 de paso2), **antes** de revisar si el candidato siquiera calificaba para recibir un mensaje. La gran mayoria se descarta por elegibilidad (intentos ya agotados, fuera de horario de silencio, etc.) y nunca llega a enviar nada — pero ya habian gastado 3 comandos de Redis en vano.

**Fix:** se movio `acquireProcessingLock`/`releaseProcessingLock` (loop principal y paso2) para que solo envuelvan el envio real — despues de que todos los checks de elegibilidad ya pasaron, justo antes de armar y mandar el mensaje. La proteccion contra duplicados sigue intacta (la seccion critica que importa — decidir enviar + mandar + guardar estado — sigue siendo atomica por candidato), pero ahora solo se paga el costo del lock para los candidatos que de verdad van a recibir un mensaje, no para los ~500 que se descartan en el camino.

**Impacto esperado:** de ~1,590 comandos de lock por corrida a probablemente decenas (solo los que realmente califican), cada 15 minutos, 24/7 — el segundo ahorro mas grande de esta pasada despues del fix de `adBody`.

Verificado: `node --check` y `npx eslint` limpios, `npm run build` exitoso.

---

## Septima auditoria (Claude) — el flujo del bot conversacional (webhook + agent)

Fecha: 2026-07-04. El usuario propuso mandarle un mensaje real al bot de WhatsApp mientras se capturaba con `MONITOR`, para revisar el unico flujo que nunca se habia medido (`api/whatsapp/webhook.js` → `api/ai/agent.js`).

### Captura real: procesar UN mensaje

989 comandos en 40 segundos (mezclado con algo de ruido de fondo del dashboard admin abierto — sesion, presencia). Lo relevante, filtrando ese ruido, para el candidato que mando el mensaje:

- **`candidate:<id>`**: 30 operaciones (lecturas + escrituras) para procesar un solo mensaje.
- **`messages:<id>`**: 33 operaciones (`LRANGE`, `LLEN`, `RPUSH`, `LTRIM`).
- **`custom_fields`**: 12 lecturas directas de Redis — el mismo config casi-estatico, releido una y otra vez por funciones distintas en la misma corrida.
- **`candidatic:phone_index`**: 12 lecturas + 6 escrituras.
- **`waitlist:candidate:<id>`**: 9 lecturas.
- Debug (`debug:webhook_history`, `debug:last_webhook_raw`) y telemetria (`telemetry_logs_v4`, `telemetry:ai:events`, `telemetry_stream`): ~30+30 operaciones combinadas de puro registro.

### Causa raiz encontrada y corregida: `custom_fields` sin cache consistente

Se investigo por que `custom_fields` (un array de configuracion que casi no cambia) se releia 12 veces. Ya existia una utilidad de cache en memoria (`api/utils/cache.js`, `getCachedConfig`/`getCachedConfigBatch`, TTL de 10 min para `custom_fields`) — usada correctamente en `agent.js` (detras de `FEATURES.USE_BACKEND_CACHE`, confirmado activo en produccion porque `ENABLE_CACHE` no esta seteado a `'false'` en ningun `.env`) y en `bulks.js`. Pero **8 sitios distintos en 5 archivos** seguian leyendo `client.get('custom_fields')`/`redis.get('custom_fields')` directo, sin pasar por esa cache:

- `api/utils/storage.js`: 4 sitios (dentro de `getCandidatesFiltered`, `getCandidates` con `excludeLinked`, `getCandidatesUnreadFirst`, y la funcion de auditoria de perfil).
- `api/chat-unread-count.js`, `api/chat.js`, `api/ai/query.js`: 1 sitio cada uno.
- `api/utils/intelligent-extractor.js`: leia 4 llaves (`automation_rules`, `custom_fields`, `candidatic_categories`, `bot_categories`) con un `MGET` propio — ya era 1 solo viaje de red por invocacion, pero no compartia cache entre invocaciones distintas del mismo warm instance.

**Fix:** los 4 sitios de `storage.js` + los 3 archivos sueltos ahora usan `getCachedConfig(client, 'custom_fields')` en vez de `client.get('custom_fields')`. `intelligent-extractor.js` ahora usa `getCachedConfigBatch(redis, [...])` para las mismas 4 llaves, reusando cache entre invocaciones en vez de solo dentro de la misma.

**Por que esto es seguro:** `getCachedConfig`/`getCachedConfigBatch` ya son parte del codebase (usadas en produccion por `agent.js`/`bulks.js`), TTL de 10 min para `custom_fields` — cualquier cambio real a los campos personalizados tarda maximo 10 min en reflejarse en estos sitios (aceptable, es configuracion que cambia rara vez, no datos de candidato).

### No resuelto en esta pasada: los 30 toques al candidato y 33 al historial de mensajes

`webhook.js` llama `getCandidateById` 3 veces (lineas 422, 511, 919) y `agent.js` 1 vez (linea 1154) — eso son 4 llamadas explicitas, no 30. El resto probablemente viene de funciones auxiliares dentro de `storage.js`/`intelligent-extractor.js`/`orchestrator.js` que cada una vuelve a leer el candidato o el historial de mensajes en vez de recibir el objeto ya cargado como parametro. Esto **no se toco en esta pasada** — `agent.js` tiene 5,276 lineas y es el corazon del bot en produccion; encontrar y corregir cada re-lectura redundante ahi requiere una investigacion mas cuidadosa que los fixes anteriores (que fueron cambios de una sola linea en un solo lugar). Queda pendiente como la siguiente investigacion, ya con `MONITOR` como metodo confirmado para no tener que adivinar.

### Verificacion

- `node --check` en los 5 archivos tocados: OK.
- `npx eslint`: sin errores nuevos (los que aparecen en `storage.js`/`ai/query.js` son preexistentes en lineas que no se tocaron, confirmado con `git diff`).
- `npm run build` exitoso.

### Limitacion importante de `MONITOR` descubierta despues

Se probo el flujo de candidato nuevo (usuario se elimino como candidato y mando "Hola" de nuevo) capturando con `MONITOR` durante 45 segundos. La captura mostro solo el dedup inicial del webhook (~0.05s) y despues **nada** relacionado a ese candidato en toda la ventana — parecia que `agent.js` nunca corrio.

Se verifico directo en Redis (`GET candidate:<id>`, `LRANGE messages:<id>`) y **el candidato se creo perfecto, con respuesta del bot correcta, en ~358ms** — confirmado tambien por el usuario, que si recibio el saludo de Brenda pidiendole su nombre. El candidato tambien aparecio correctamente arriba en la seccion Candidatos del dashboard (orden por actividad reciente).

**Conclusion: `MONITOR` se perdio la mayoria de esos comandos.** Es una limitacion conocida de Redis Cloud (y la mayoria de Redis administrados/proxeados): `MONITOR` no necesariamente ve el 100% del trafico de todas las conexiones por igual, sobre todo cuando el flujo completo pasa en menos de 1 segundo. **No fue un bug de la aplicacion.**

**Implicacion para las capturas anteriores de esta misma auditoria (candidatos, chat web, reengagement):** si `MONITOR` puede perderse comandos, los numeros reportados ahi (30 toques al candidato, 33 al historial, etc.) son un **piso, no el total exacto** — la actividad real podria ser igual o mayor, nunca menor. Los fixes ya aplicados (`adBody`, lock de reengagement, `custom_fields`) siguen siendo validos porque se confirmaron ademas con evidencia directa independiente de `MONITOR` (tamanos de campo leidos directo de Redis, codigo fuente, conteo de comandos por tipo via `INFO commandstats`). Para futuras investigaciones: cruzar siempre `MONITOR` con una lectura directa del estado final en Redis antes de concluir que "algo no paso".

### Verificacion post-deploy con MONITOR real (candidatos + chat + mensajes)

Despues de subir los 3 fixes de arriba, se repitio la captura en vivo (90s) mientras el usuario entraba a Candidatos, luego a Chat Web, y mandaba mensajes reales (incluyendo un candidato nuevo). 10,232 comandos capturados, sin senales de nada roto: el candidato de prueba se creo y respondio bien, no aparecio ningun `lock:reengagement:*` (el cron no corrio en esa ventana de 90s, nada que ver con el fix). Nota importante: `MONITOR` cuenta comandos, no bytes — el ahorro de `adBody` (65% menos bytes por candidato) no se puede confirmar con este metodo, solo se vera reflejado en el panel de Ancho de Banda comparando dias antes/despues del deploy.

---

## Octava auditoria (Claude) — revision del "motor de apagado por inactividad" completo, riesgo de falso positivo

Fecha: 2026-07-04. El usuario pidio explicitamente revisar todos los mecanismos de ahorro basados en detectar inactividad (los de esta sesion + los de la Tercera auditoria de Codex), con miedo de que un falso positivo ("el sistema cree que no estamos trabajando") apagara algo que si hace falta mientras se esta trabajando activamente.

### Confirmado de nuevo: nada de esto toca el envio de mensajes

Se reconfirmo en codigo que `webhook.js`/`agent.js` solo se detienen por el switch manual `bot_ia_active` o `candidate.blocked` — cero dependencia de actividad humana. Esto ya se habia verificado varias veces en esta auditoria; se revalida aqui porque es la pregunta de fondo detras de la preocupacion del usuario.

### Revision mecanismo por mecanismo

1. **Auto-desbloqueo de chat** (`src/components/ChatSection.jsx`, `CHAT_LOCK_IDLE_MS`) — el de mayor riesgo real. Antes: 60 segundos sin mouse/teclado/scroll/click se consideraba "ya no estas trabajando" y se liberaba el lock del chat. 60s sin tocar nada es comun leyendo o pensando una respuesta — falso positivo plausible. Se reviso el backend (`api/chat.js:216-241`, acciones `lock`/`unlock`/`heartbeat`) y se confirmo que el lock **no bloquea tecnicamente nada** — es un indicador visual en la lista lateral ("Fulano ya esta viendo este chat"), no impide que otro reclutador escriba o mande mensajes. O sea, la severidad de un falso positivo aqui es baja (el indicador parpadea de mas), no hay riesgo de duplicar respuestas por una falla de un candado tecnico que de por si nunca existio.
2. **Heartbeat de presencia idle** (`usePresence.js`, 60s idle → intervalo pasa de 45s a 4min) — se verifico la matematica de TTLs: TTL idle (5 min, ajustado en la Tercera auditoria) es mayor al intervalo idle (4 min), por lo que no hay hueco de "desaparece de en linea por error". Efecto de un falso positivo: minutos de tiempo activo mal contados en estadisticas de reclutadores, estatus "idle" en pantalla con hasta 4 min de retraso al volver a estar activo — cosmetico, nada se apaga.
3. **Desconexion de Redis por inactividad** (`storage.js`, 120s sin ningun comando) y **cierre de SSE** — no dependen de actividad humana especificamente (cualquier trafico los resetea), y aunque se disparen, se reconectan solos sin efecto visible. Sin riesgo.

### Fix aplicado

Se subio `CHAT_LOCK_IDLE_MS` de 60 segundos a **5 minutos** (`src/components/ChatSection.jsx:56`) — unico cambio de esta auditoria, a peticion del usuario. El costo de que el indicador de "chat ocupado" tarde un poco mas en desaparecer es mucho menor al costo de que desaparezca mientras el reclutador sigue ahi pensando su respuesta.

### Verificacion

- `npx eslint src/components/ChatSection.jsx`: sin errores nuevos (los 21 que aparecen son preexistentes en lineas no tocadas).
- `npm run build` exitoso.

---

## Novena auditoria (Claude) — fuga real: presencia disparaba en cada mensaje, no cada 45s/4min

Fecha: 2026-07-04. El usuario pidio mandar un mensaje normal, uno de plantilla, y uno de banco de mensajes desde el chat, capturando con `MONITOR` para revisar si hay fuga.

### Captura: 9,788 comandos en 100 segundos

De eso, el bloque de presencia/reclutador (`presence:hash`, `presence:expiry`, `presence:last_hash`, `recruiter:ids:*`, `recruiter:time:*`, `recruiter:visited:*`, `recruiter:meta:*`) aparecio **~60-67 veces** en la ventana — un heartbeat cada ~1.5 segundos, cuando el diseño de `usePresence.js` (Segunda/Tercera auditoria) establece 45s activo / 4min idle. Con solo 3 envios manuales de mensaje, esa frecuencia no cuadra con el diseño esperado.

### Causa raiz

`src/components/ChatSection.jsx` (linea ~635, antes de este fix) tenia:
```js
useEffect(() => {
    window.dispatchEvent(new CustomEvent('presence_chat_change', { detail: { chatId: selectedChat?.id || null } }));
}, [selectedChat]);
```
`usePresence.js` escucha ese evento y fuerza un heartbeat **inmediato** (`sendHeartbeatRef.current?.({ hydrate: true })`), sin pasar por el throttle de 45s/4min — diseñado para notificar quien esta viendo un chat cuando el usuario cambia de conversacion.

El problema: la dependencia era `[selectedChat]` (el objeto completo), no `[selectedChat?.id]`. Y `selectedChat` se reemplaza por un objeto **nuevo** en cada actualizacion SSE del candidato activo (`setSelectedChat(prev => ({ ...prev, ...patch }))` en varios sitios de `ChatSection.jsx`, disparado por cada mensaje enviado/recibido, cada cambio de estado de entrega, etc.). Como el efecto compara por referencia, cada mensaje —no solo cada cambio de chat— disparaba un heartbeat de presencia inmediato, saltandose por completo el throttle que se construyo especificamente para bajar este consumo.

### Fix aplicado

Se cambio la dependencia del `useEffect` de `[selectedChat]` a `[selectedChat?.id]` (una palabra). El efecto solo necesita el id (es lo unico que usa en el cuerpo), asi que el comportamiento intencionado (avisar cuando cambias de chat) queda identico, pero ya no dispara con cada mutacion de datos del mismo chat.

**Impacto esperado:** el heartbeat de presencia vuelve a respetar 45s/4min real, en vez de dispararse en cada mensaje enviado o recibido mientras un chat esta abierto — que es exactamente el escenario mas comun de uso (un reclutador respondiendo una conversacion activa).

### Verificacion

- `npx eslint src/components/ChatSection.jsx`: sin errores nuevos.
- `npm run build` exitoso.
- **Confirmado post-deploy con `MONITOR` real:** mandando mensajes de nuevo despues de desplegar el fix, las llaves especificas de presencia (`presence:hash`, `presence:expiry`, `presence:last_hash`, `recruiter:ids`, `recruiter:time`, `recruiter:meta`, `recruiter:visited`) bajaron de ~616 hits en 100s (antes del fix) a ~84 hits en 90s — **reduccion del 86%**. (Nota: en el primer vistazo se conto de mas por agrupar junto `recruiter:msgs`/`recruiter:chats`/`recruiter:win24`, que son contadores legitimos de "mensaje enviado", no presencia — no son parte de esta fuga.)

---

## Decima auditoria (Claude) — 20 mensajes de prueba (10 salientes, 10 entrantes): dos fugas mas en `storage.js`

Fecha: 2026-07-04. El usuario pidio mandar 10 mensajes salientes manuales y 10 entrantes manuales (los flujos mas repetitivos del dia a dia) capturando con `MONITOR`, para encontrar mas fugas de las mas comunes.

### Captura: 12,695 comandos para 20 mensajes (~635 por mensaje)

Dos patrones concretos y verificables destacaron:

1. **`candidatic:phone_index` reescrito 40 veces (2 por mensaje)** — el telefono de un candidato no deberia cambiar nunca despues de creado.
2. **`stats:list:pending`/`stats:list:complete` tocados 108 veces cada uno (~5.4 por mensaje)** — muchas mas veces que candidatos que realmente cambiaron de pendiente a completo o viceversa en esos 20 mensajes.

### Causa raiz y fix 1: `candidatic:phone_index` — escritura siempre redundante

`api/utils/storage.js` → `saveWebhookTransaction()` (la funcion "ATOMIC WEBHOOK TRANSACTION" usada en cada mensaje, entrante y saliente) tenia, en la seccion "3. Update Candidate":
```js
if (finalCandidate.whatsapp) {
    pipeline.hset(KEYS.PHONE_INDEX, cleanPhone, candidateId);
}
```
El comentario original decia "Update Index if it's a new candidate or phone changed (safety)" pero el codigo no verificaba ninguna de las dos condiciones — simplemente lo hacia siempre. Se confirmo que:
- El telefono se indexa una sola vez, correctamente, al crear el candidato (`saveCandidate`, linea ~1327).
- Para que `saveWebhookTransaction` reciba un `candidateId`, ese candidato ya tuvo que resolverse via ese mismo indice (o crearse momentos antes en el mismo request) — el indice siempre ya existe y ya es correcto en este punto.
- Se busco en todo el codebase alguna funcion de "cambiar telefono"/"merge de candidatos" y no existe ninguna.

**Fix:** se elimino el `pipeline.hset(KEYS.PHONE_INDEX, ...)` de `saveWebhookTransaction` — es codigo muerto en la practica, siempre reescribe el mismo valor que ya estaba.

### Causa raiz y fix 2: `syncCandidateStats` — SADD/SREM sin verificar si el estado cambio

`api/utils/storage.js` → `syncCandidateStats()` (llamada desde `saveWebhookTransaction` en cada mensaje, y desde `updateCandidate`/`saveCandidate`) calculaba `wasIncomplete` (estado antes) e `isComplete` (estado ahora) pero **nunca los comparaba** antes de escribir — hacia `SADD`+`SREM` sobre `stats:list:pending`/`stats:list:complete` en every llamada, sin importar si el candidato seguia exactamente en el mismo estado que antes (el caso mas comun, ya que la mayoria de mensajes en una conversacion no cambian el estado pendiente/completo del perfil).

**Fix:** se agrego `const statusChanged = isFirstSync || (wasIncomplete === isComplete);` y se envolvio el bloque de `SADD`/`SREM` (ambas variantes, con y sin pipeline) en `if (statusChanged)`. `isFirstSync` (`c.statusAudit == null`) garantiza que un candidato genuinamente nuevo si se agregue la primera vez.

### Verificacion end-to-end contra Redis real (no solo lint)

Se escribio un script de prueba temporal que llama `syncCandidateStats` directo contra un candidato de prueba desechable en Redis produccion, verificando membresia real en los sets (`SISMEMBER`) antes/despues de cada llamada:

| Caso | Resultado |
|---|---|
| 1. Candidato nuevo (sin `statusAudit` previo), incompleto | ✅ Se agrega a `pending` |
| 2. Mismo estado (sigue incompleto) | ✅ No escribe nada |
| 3. Cambia a completo (con `paso2Estado: 'completo'` y todos los campos core) | ✅ Se mueve de `pending` a `complete` |
| 4. Sigue completo (sin cambio) | ✅ No escribe nada |

(Nota: el primer intento de prueba fallo porque el candidato sintetico no incluia `fechaNacimiento` ni `paso2Estado: 'completo'`, campos requeridos reales de `CORE_REQUIRED_FIELDS`/`isProfileComplete` — una vez corregido el dato de prueba, los 4 casos pasaron. El bug estaba en el test, no en el fix.)

### Verificacion

- `node --check api/utils/storage.js`: OK.
- `npx eslint api/utils/storage.js`: sin errores nuevos (30 preexistentes, confirmado con `git diff` que ninguno esta en lineas tocadas).
- `npm run build` exitoso.
- Prueba funcional contra Redis real (arriba): 4/4 casos correctos.

---

## Onceava auditoria (Claude) — flujo completo de Brenda (registro paso1+paso2), y el fix de phone_index estaba incompleto

Fecha: 2026-07-04. El usuario pidio probar "el flujo de Brenda" (la conversacion completa de registro: nombre, fecha de nacimiento, municipio, escolaridad, categoria, colonia, experiencia) — el flujo que mas corre en produccion, y el que vive dentro de `agent.js` (5,276 lineas), marcado como pendiente de revision cuidadosa desde la Septima auditoria.

### Captura: 11,539 comandos en 180s

### Hallazgo 1 (descartado tras investigar): 630 `SCAN`

El numero mas alarmante a primera vista. Se investigo el timeline exacto (cursor de SCAN entre 0 y ~15,700, consistente con recorrer las ~15,500 llaves del Redis completo) y se encontro el origen: `deleteCandidate()` en `storage.js` (linea ~1476-1483) hace un `SCAN` completo del keyspace (`MATCH pipeline:*:*:${id}:*`, `COUNT 50`) para limpiar marcadores de pipeline antes de borrar un candidato. **No es parte del flujo de Brenda** — se disparo porque el usuario se auto-elimino como candidato varias veces durante las pruebas de esta sesion para poder re-probar como "candidato nuevo". Es una operacion de administrador poco frecuente (borrar candidatos), no un costo por mensaje. Queda anotado como optimizable a futuro (bajo prioridad) pero no se toco en esta pasada.

### Hallazgo 2 (real): el fix de `phone_index` de la Decima auditoria estaba incompleto

Se esperaba que `candidatic:phone_index` ya no se reescribiera por mensaje (fix aplicado a `saveWebhookTransaction`), pero la captura mostro **22 `HSET` en una sola conversacion**. Investigando: `updateCandidate()` llama internamente a `saveCandidate()` en cada actualizacion (`storage.js:1789`), y **`saveCandidate()` tiene su propia escritura incondicional a `PHONE_INDEX`** (linea ~1330-1334), separada de la que ya se habia arreglado en `saveWebhookTransaction`. Mismo bug, segunda ubicacion, no detectada en la pasada anterior por revisar solo un call site.

**Fix:** `saveCandidate()` ya calculaba internamente `_isNewCandidate` (via `SET candidate:new:seen:${id} NX`, usado para telemetria de candidatos nuevos) — se reutilizo ese mismo flag para condicionar la escritura a `PHONE_INDEX`: `if (client && candidate.whatsapp && _isNewCandidate)`. Ahora solo se indexa la primera vez que se crea el candidato, nunca en actualizaciones posteriores.

**Verificacion real contra Redis** (script temporal, candidato de prueba desechable):
1. Guardar candidato nuevo → se indexa correctamente.
2. Plantar un valor centinela manual en `phone_index`, luego re-guardar el MISMO candidato (simulando un update) → el valor centinela sobrevive intacto, confirmando que `saveCandidate` ya no lo toca en actualizaciones.

### Aclarado con el usuario: los 4 candidatos eran trafico real

Durante la captura aparecieron **4 candidatos distintos** (`byghd8t8y`, `mm9zxqg6h`, `3d61locli`, `73axocw6x`). El usuario confirmo que son candidatos reales llegando organicamente en paralelo a la prueba (no producto de las pruebas de "candidato nuevo" de esta sesion). Cierra sin ser un bug — el sistema simplemente estaba procesando trafico real de produccion al mismo tiempo que se hacia la prueba manual con Brenda.

### Verificacion

- `node --check api/utils/storage.js`: OK.
- `npx eslint api/utils/storage.js`: sin errores nuevos.
- `npm run build` exitoso.
- Prueba funcional contra Redis real: 2/2 casos correctos (arriba).

---

## Doceava auditoria (Claude) — flujo de Brenda nombre→experiencia: por que "tarda" y por que "se quedo callada"

Fecha: 2026-07-04. El usuario reporto dos sintomas del flujo de extraccion de datos (nombre hasta experiencia): (1) siente que tarda en guardar el nombre y responder, y (2) en una prueba anterior el bot se quedo callado un buen rato y luego contesto mucho despues. Pidio revision detallada de todo `agent.js` en ese tramo especifico.

### Arquitectura real descubierta (no documentada antes en este archivo)

`api/whatsapp/webhook.js` **espera la respuesta de IA completa antes de responderle a Meta** (`await Promise.allSettled([aiPromise])`, linea 991) — no es fire-and-forget. Dentro de esa espera:

1. `webhook.js` llama directo (no por HTTP, mismo proceso) a `runTurboEngine()` en `api/workers/process-message.js`.
2. Ese worker usa un lock por candidato (`isCandidateLocked`) para evitar procesar mensajes del mismo candidato en paralelo. Si el candidato ya tiene un mensaje en proceso, **espera hasta 50 segundos** (poll cada 500ms) a que se libere.
3. `webhook.js` y el worker tienen `maxDuration = 60` segundos.
4. El propio codigo del worker ya tiene una advertencia explicita para este caso (`process-message.js:126`): *"Lock never freed after 50000ms... Message may be lost."*

**Conclusion: si la espera del lock (hasta 50s) mas el procesamiento real (llamada a OpenAI + envios a Meta) se pasan de 60s, Vercel mata la funcion a la fuerza sin haber mandado ninguna respuesta.** Esto explica exactamente el sintoma de "se quedo callada un buen rato y contesto mucho despues" — coincide con que un candado tardo en liberarse (dos mensajes muy seguidos, o un OpenAI lento) y la funcion goteando cerca del limite.

**Sobre la teoria del deploy:** se descarto como causa directa — el worker se invoca con `import()` dentro del mismo proceso, no via HTTP self-call, asi que un deploy a mitad de un turno no deberia cortar la ejecucion en curso (Vercel deja terminar las invocaciones en vuelo del deployment anterior). El deploy que coincidio con la prueba probablemente fue casualidad, no la causa.

### Extraccion del nombre especificamente: 1 sola llamada a OpenAI, no varias

Se conto cuantas llamadas a `getOpenAIResponse` ocurren para el turno donde el candidato da su nombre: **una sola** (linea 4548, "Capturista Brain", modelo `gpt-4o-mini`, `max_tokens: 500`, modo JSON). El primer saludo ("Hola") es determinista (`bypassGpt`, sin llamada a IA — de ahi que esa primera respuesta sea casi instantanea, ~358ms medido en la Septima auditoria). La respuesta al nombre si pasa por la IA real, asi que 1-4 segundos de latencia ahi es esperable y normal para un modelo de lenguaje, no un bug.

### Fix real encontrado y aplicado: debug logging bloqueante en cada webhook

`api/whatsapp/webhook.js` (lineas 141-150) guardaba los ultimos 50 webhooks crudos para inspeccion — **en cada llamada al webhook** (no solo mensajes de candidatos; tambien confirmaciones de entrega de Meta, que son mas frecuentes), con **3 escrituras a Redis awaited de forma bloqueante** (`LPUSH` + `LTRIM` + `SET`, sin pipeline, sin interruptor de `DEBUG_MODE` a diferencia de logs similares en `agent.js` que si estan bien apagados por defecto). Esto sumaba latencia real a la respuesta de cada mensaje, incluyendo el turno del nombre.

**Fix:** se combino en un solo `pipeline` y se quito el `await` (fire-and-forget con `.catch(() => {})`) — se preserva la capacidad de debug (los ultimos 50 webhooks siguen guardandose) pero ya no bloquea la respuesta al candidato.

### Verificacion

- `node --check api/whatsapp/webhook.js`: OK.
- `npx eslint api/whatsapp/webhook.js`: sin errores nuevos (33 preexistentes, confirmado con `git diff` que ninguno esta en la seccion tocada).
- `npm run build` exitoso.

### Pendiente — riesgo arquitectonico, no corregido en esta pasada

El riesgo real de "mensaje perdido" por el limite de 50s de espera de lock + 60s de `maxDuration` **sigue existiendo** — el fix de esta auditoria (debug logging) reduce la latencia de fondo pero no elimina el riesgo de fondo bajo carga real (mensajes muy seguidos del mismo candidato, o una respuesta de OpenAI inusualmente lenta). Posibles soluciones a futuro:
- Subir `maxDuration` si el plan de Vercel lo permite (actualmente 60s). **Implementado despues, ver Treceava auditoria.**
- Reducir el tiempo maximo de espera del lock (actualmente 50s) para fallar mas rapido y reintentar en vez de arriesgar el timeout duro. No implementado.
- Desacoplar la respuesta a Meta del procesamiento de IA (responder 200 OK a Meta inmediatamente, procesar en background) — cambio arquitectonico mayor, mas riesgoso, requiere diseño cuidadoso para no perder mensajes en el camino. No implementado.

---

## Treceava auditoria (Claude) — sube maxDuration de 60s a 120s (mitigacion de la Opcion 1)

Fecha: 2026-07-04. Antes de aplicar este cambio se reviso con el usuario, con datos reales: latencia real de las llamadas a OpenAI (`consolidated_brain`) en las ultimas 100 muestras de telemetria fue minimo 1.5s, mediana 2.3s, **maximo observado 9.3s** — muy por debajo del limite. Ademas, revisando los ultimos 100 eventos de telemetria general no hay ningun `BRENDA_DELIVERY_FAILED` ni rafagas de mensajes agrupados (senal de contencion de lock), y el usuario reviso manualmente 100 chats reales sin encontrar ningun caso de "Brenda muda". **Conclusion: el riesgo es real arquitectonicamente pero no se esta materializando en la practica hoy** — no es una emergencia, pero subir el limite es una mejora de proteccion sin costo de velocidad (confirmado con el usuario: `maxDuration` es solo un techo, no afecta cuanto tarda una respuesta normal).

### Cambio aplicado

Se subio `maxDuration` de 60 a 120 segundos en los 3 archivos donde aplica (los que realmente son invocados por HTTP — `runTurboEngine` se llama por `import()` interno desde estos, nunca por HTTP directo, asi que el limite relevante es el de quien recibe el webhook):
- `api/whatsapp/webhook.js`
- `api/messenger/webhook.js`
- `api/workers/process-message.js` (por si algo mas lo invoca directo en el futuro; hoy no aplica en la practica)

Se actualizaron tambien los comentarios en `process-message.js` que hacian referencia al limite viejo de 60s.

### Nota sobre el plan de Vercel

No se pudo confirmar por CLI si el plan actual soporta 120s (Hobby tope 60s, Pro hasta 300s, Enterprise hasta 900s, segun documentacion general de Vercel). Se decidio intentar el deploy directamente: si el plan no lo soporta, Vercel rechaza el deploy con un error claro y no afecta la produccion actual (sigue sirviendo el ultimo deploy exitoso mientras tanto).

### Verificacion

- `node --check` en los 3 archivos: OK.
- `npx eslint`: sin errores nuevos (confirmado con `git diff`).
- `npm run build` exitoso.
- Resultado del deploy: ver mensaje de seguimiento inmediato despues de esta entrada.
