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
