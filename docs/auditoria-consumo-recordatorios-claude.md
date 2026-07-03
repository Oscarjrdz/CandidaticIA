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
