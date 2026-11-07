# Candidatic IA — Guía para Claude

Plataforma de reclutamiento por WhatsApp. Un bot con IA ("Brenda") conversa con candidatos, extrae sus datos (nombre, edad, municipio, escolaridad, categoría, colonia, experiencia), y un equipo de reclutadores humanos da seguimiento desde un dashboard tipo WhatsApp Web.

> **Herramientas de desarrollo:** Candidatic se construye únicamente con **Claude dentro de Antigravity**. Ya **no se usa Codex** (dejó de usarse en agosto 2026). Las menciones a Codex en `docs/auditoria-consumo-recordatorios-claude.md` son registro histórico de auditorías pasadas — no reflejan el flujo actual.

## Stack

- **Frontend:** React + Vite, Tailwind, `react-virtuoso` para listas largas (candidatos, mensajes de chat).
- **Backend:** Funciones serverless de Vercel bajo `api/` (cada archivo `.js` con `export default` es un endpoint).
- **Base de datos:** Redis (vía `ioredis`) — **es la única fuente de verdad**, no hay SQL. Todo son llaves/valores, sets, sorted sets, hashes y listas.
- **Canal principal:** WhatsApp vía Meta Cloud API (`api/whatsapp/webhook.js`). También soporta Messenger (`api/messenger/webhook.js`) y un legado de UltraMsg.
- **Deploy:** Vercel tiene integración automática con GitHub — `git push origin main` por sí solo ya dispara un deployment a producción. **Nunca corras `vercel --prod` después de un push**: generan dos builds duplicados del mismo commit en paralelo (confirmado 2026-08-06 en el dashboard de Vercel). Si por lo que sea el auto-deploy no dispara, usa `vercel --prod` como alternativa — pero nunca ambos.
- **Plan de Vercel:** soporta `maxDuration` de al menos 120s (confirmado en julio 2026 al subirlo de 60 a 120 sin que el deploy fallara).

## Estructura de carpetas clave

```
api/
  whatsapp/webhook.js       — entrada de mensajes de WhatsApp (Meta Cloud API)
  messenger/webhook.js      — entrada de mensajes de Messenger
  workers/process-message.js — orquesta el procesamiento (lock por candidato + drena cola)
  ai/agent.js                — el cerebro de Brenda (~5,300 líneas). processMessage() es el entry point.
  ai/simulate.js             — simulador de conversación para pruebas sin WhatsApp real
  cron/send-reminders.js     — recordatorios de cita programados (corre cada 15 min)
  cron/reengagement.js       — reenganche de candidatos inactivos (corre cada 15 min)
  utils/storage.js           — TODAS las funciones de acceso a Redis (candidatos, mensajes, users, etc.) — archivo enorme, es el corazón de datos
  utils/redis-bandwidth.js   — medidor real de ancho de banda (ver abajo)
  utils/reminder-lock.js     — locks compartidos para evitar mensajes duplicados
  utils/shortcuts.js         — substituteVariables(), usado por banco de respuestas y envíos manuales
  utils/cache.js             — caché en memoria (getCachedConfig/getCachedConfigBatch) para config que casi no cambia
  system/bandwidth.js        — GET que expone el medidor de ancho de banda al frontend
src/
  components/ChatSection.jsx — el chat completo (candidatos, mensajes, banco de respuestas, CRM). Archivo gigante.
  components/SettingsSection.jsx — Configuración (WhatsApp, GPT, Ancho de Banda)
  components/FloatingCopilot.jsx — burbuja flotante "Brenda IA" (copiloto del dashboard, NO es agente real con IA — ver abajo)
  contexts/AuthContext.jsx   — sesión del usuario logueado (recruiter)
docs/
  auditoria-consumo-recordatorios-claude.md — bitácora detallada de auditorías de consumo de Redis (13 rondas), con cada fuga encontrada y su fix. Léelo si vas a tocar performance/consumo.
```

## El flujo de Brenda (extracción de datos)

Orden de captura: **nombre → fecha de nacimiento/edad → municipio → escolaridad → categoría** (paso 1), luego **colonia → experiencia → meses de experiencia** (paso 2).

- `api/ai/agent.js` → `processMessage(candidateId, incomingMessage, msgId)` es el entry point.
- El primer saludo a un candidato nuevo es **determinista** (`bypassGpt`, sin llamada a IA — por eso responde en ~350ms). Todo lo demás sí llama a OpenAI (`getOpenAIResponse`, modelo `gpt-4o-mini`, una sola llamada por turno — no hay múltiples llamadas encadenadas por mensaje).
- Datos reales de producción (julio 2026): latencia de esa llamada a OpenAI — mínimo 1.5s, mediana 2.3s, máximo observado 9.3s.
- **Reglas de extracción y validación** están en `DEFAULT_EXTRACTION_RULES`/`CORE_REQUIRED_FIELDS`/`auditProfile()` en `storage.js` — un perfil está "completo" cuando pasa paso 1 Y `paso2Estado === 'completo'`.

## Arquitectura de mensajes: el riesgo de timeout (documentado, parcialmente mitigado)

`webhook.js` **espera la respuesta de IA completa antes de responderle a Meta** (no es fire-and-forget). Dentro de esa espera, `api/workers/process-message.js` puede esperar hasta **50 segundos** a que se libere un lock si el mismo candidato ya tiene un mensaje en proceso. `maxDuration` está en **120s** (subido de 60s en julio 2026 — confirmado que el plan de Vercel lo soporta).

- Si la espera del lock + el procesamiento real se pasa del `maxDuration`, Vercel mata la función sin haber respondido nada — el candidato se queda sin respuesta y sin error visible.
- El código en `process-message.js` ya tiene una advertencia explícita para este caso ("Lock never freed... Message may be lost").
- **Auditado en julio 2026:** cero fallos de entrega registrados en telemetría, ni en revisión manual de 100 chats. El riesgo es real arquitectónicamente pero no se materializa en producción hoy — no es urgente.
- **Arreglo de fondo NO implementado:** desacoplar el ack a Meta del procesamiento de IA (responder 200 OK de inmediato, procesar en background). Es un cambio de arquitectura mayor, discutido pero pospuesto a propósito.

## El medidor de ancho de banda (real, no estimado)

`api/utils/redis-bandwidth.js` mide bytes reales de red vía `INFO stats` de Redis (`total_net_input_bytes`/`total_net_output_bytes`) — **no** es un estimado de `JSON.stringify()` de payloads (ese fue el sistema anterior, `usage-metrics.js`, que se **eliminó por completo** en julio 2026 porque estaba desalineado 27x contra el número real de Redis Cloud).

- Snapshot + delta: guarda una foto (`bandwidth:snapshot:last`), calcula el delta contra la anterior en cada corrida, acumula por día (`bandwidth:daily:YYYY-MM-DD`, zona horaria Monterrey).
- Se engancha al cron `send-reminders.js` (cada 15 min) — **no crea ningún cron nuevo**.
- Se expone en `/api/system/bandwidth` y se muestra en Configuración → tarjeta "Ancho de Banda" (`RedisBandwidthSettings.jsx`), con gráfica de barras estilo mes calendario (día 1 al último día del mes, no ventana móvil).
- **Nota histórica:** los días 2026-07-01 a 2026-07-03 en Redis tienen un valor manual sembrado (12.4 GB repartidos parejo) porque el medidor no existía todavía esos días — no es un bug si se ven sospechosamente parejos entre sí. A partir del 4 de julio todo es medición real.
- **Es el único medidor de consumo que debe existir.** Si en el futuro alguien propone otro sistema de medición de bytes/tráfico, intégralo aquí — no crear uno paralelo.

## Fugas de consumo encontradas y corregidas (julio 2026) — no las reintroduzcas

Todas verificadas con `MONITOR` en vivo contra Redis de producción, no solo revisión de código. Detalle completo en `docs/auditoria-consumo-recordatorios-claude.md`.

1. **`adBody`/`adImageUrl`/`adUrl`/`adClickId`** — 65% de los bytes de una página de 100 candidatos. Se quitan de la respuesta de lista en `api/candidates.js` (`stripHeavyListFields`), pero se conservan en Redis (los usa `AdsStatisticsSection.jsx` vía otro endpoint, y el backend de conversiones de Meta).
2. **Lock de reengagement** — se pedía para los 500 candidatos muestreados antes de checar elegibilidad. Ahora solo se pide justo antes de enviar (`api/cron/reengagement.js`).
3. **`custom_fields` sin caché** — se releía directo de Redis en 8 sitios distintos por cada mensaje. Ahora todos usan `getCachedConfig`/`getCachedConfigBatch` de `api/utils/cache.js`.
4. **`candidatic:phone_index` reescrito en cada mensaje** — dos ubicaciones (`saveWebhookTransaction` y `saveCandidate` en `storage.js`). El teléfono de un candidato no cambia después de creado — ahora solo se indexa una vez, en la creación (usa el flag `_isNewCandidate` que `saveCandidate` ya calculaba internamente).
5. **`stats:list:pending`/`stats:list:complete`** — se reescribían en cada mensaje aunque el candidato no cambiara de estado pendiente/completo. `syncCandidateStats()` ahora solo hace `SADD`/`SREM` cuando el estado realmente cambió (o es la primera vez).
6. **Debug logging bloqueante en cada webhook** (`debug:webhook_history`) — corría en CADA llamada (mensajes y confirmaciones de entrega de Meta), con 3 escrituras `await`-eadas secuenciales. Ahora es un solo pipeline, fire-and-forget.
7. **Presencia disparándose en cada mensaje** — un `useEffect` en `ChatSection.jsx` dependía del objeto completo `selectedChat` (que se reemplaza en cada actualización SSE) en vez de solo `selectedChat?.id`, forzando un heartbeat de presencia inmediato por cada mensaje en vez de cada 45s/4min. Reducción confirmada del 86%.
8. **Scroll del chat parpadeando** — `bottomAnchorRef` (bandera de "bajar al fondo al abrir un chat") nunca se reseteaba a `false`, quedando encendida para siempre desde el primer chat de la sesión y forzando scroll-al-fondo en cada cambio de altura de la lista. Se resetea justo después de consumirse.

**Pendiente, de menor prioridad (no tocar sin razón):**
- `deleteCandidate()` en `storage.js` hace un `SCAN` completo del keyspace para limpiar marcadores de pipeline — costoso con ~15,500 llaves, pero es una acción de admin poco frecuente.
- `adId`/`adHeadline` (campos de anuncio, más chicos que los de arriba) siguen en la respuesta de lista porque `ChatSection.jsx`/`ChatRow.jsx` los usan para el badge "vino de anuncio" — no quitar.

## Limpieza quirúrgica de secciones — playbook repetible (desde 2026-11-06)

Oscar quiere pasar sección por sección del dashboard dejando cada una "en su mejor versión": sin código muerto, sin logs viejos, sin parches, con arquitectura sólida — **pero sin romper nada y sin degradar la carga rápida**. Esto se hace de forma incremental, una sección por sesión. Si en una sesión futura te piden "limpia la sección X igual que Candidatos", este es el procedimiento exacto.

**Principios NO negociables (violarlos = retroceso):**
1. **La carga rápida es sagrada.** No tocar NINGUNA ruta de caché: `sectionCache` de módulo (pintado instantáneo al re-entrar), cachés de endpoint (`candidatesListCache` y equivalentes), headers `X-Candidatic-Cache`/`Cache-Control`, el patrón stale-while-revalidate ni `reconcileCandidates`. Ver [[project_anti_brinco_secciones]].
2. **Borrar solo con 0 referencias confirmadas por grep** en `src/` **Y** `api/` (grep exacto del identificador/archivo, con ojo en falsos positivos por substring — p.ej. "ADN" aparece en nombres de colonias).
3. **Cambios de comportamiento idéntico únicamente:** renombres, inline de wrappers no-op, dedupe de funciones, O(n²)→lineal. Nada que cambie la salida observable.
4. **Nada de refactors de arquitectura "de fondo" sin aprobación explícita** (ej. reescribir el SSE, desacoplar el ack de Meta, cambiar el motor de paginación). Eso es proyecto aparte.
5. **Dejar intacto a propósito** lo que ya funciona aunque "se vea raro": SSE singleton, `Set` de sesión que crecen (p.ej. `_firedConfettiIds`), catch vacíos intencionales, fire-and-forget con `.catch(()=>{})`.

**Pasos:**
1. Mapear TODOS los archivos de la sección: componente(s) de `src/components/`, su `service`, su `hook`, el endpoint `api/<x>.js` y los endpoints hijos `api/<x>/*.js`.
2. Cazar código muerto: componentes/endpoints/funciones/refs/efectos con 0 lectores reales.
3. Identificar restos arqueológicos: wrappers no-op, nombres que mienten (de sistemas ya borrados), efectos que no leen nada, comentarios de sistemas eliminados.
4. Micro-mejoras de bajo riesgo sin cambiar comportamiento.
5. Verificar SIEMPRE: `node --check <archivo>` (backend), `npm run build` (frontend), `npx eslint <solo-archivos-tocados>` (el repo tiene ~30-40 errores preexistentes — compara, no asumas que son tuyos). Si tocaste Redis, prueba contra Redis real con candidato de prueba desechable.
6. Documentar aquí abajo con fecha: qué se borró/cambió, la intención, y qué quedó intacto a propósito.

**Estado por sección** (marca al terminar cada una):
- ✅ **Candidatos** — limpiada 2026-11-06 (detalle abajo).
- ✅ **Chat Web** — limpiada 2026-11-06 (detalle abajo).
- ⬜ Flujos (`FlowsSection.jsx`) · ⬜ Envíos Masivos (`BulksSection.jsx`) · ⬜ CRM (`CRMProjectsSection.jsx`) · ⬜ Mapa (`MapSection.jsx`) · ⬜ Estadísticas (`StatsSection.jsx`) · ⬜ Ads (`AdsStatisticsSection.jsx`) · ⬜ Configuración (`SettingsSection.jsx`) · ⬜ Vacantes (`VacanciesSection.jsx`) · ⬜ Bolsa (`BolsaSection.jsx`) · ⬜ Notificaciones (`NotificacionesSection.jsx`) · ⬜ Media (`MediaLibrarySection.jsx`) · ⬜ Bot IA (`BotIASection.jsx`).

### ✅ Candidatos — 2026-11-06

**Intención:** dejar la sección en su mejor versión sin reintroducir riesgo y **sin tocar ninguna ruta de caché**. Verificado con `node --check`, `npm run build` (2×) y `eslint` (cero errores nuevos).

- **Código muerto eliminado (0 referencias en todo el repo, verificado con grep):**
  - `api/candidates/clean-gender.js` — endpoint de migración one-off para normalizar `genero`; ningún caller ni UI.
  - `src/components/CandidateADNCard.jsx` — componente huérfano (140 líneas), cero imports.
- **Restos arqueológicos del sistema de métricas eliminado (`usage-metrics.js`, borrado en julio 2026):**
  - En `api/candidates.js` se quitó el wrapper no-op `finishCandidatesResponse(status, payload)` (era solo `res.status().json()`) y se renombró `redisForMetrics` → `redis` (ya no mide nada, es el cliente general). Puro adelgazamiento de indirección; comportamiento idéntico.
- **`CandidatesSubscription` ya no hace polling (es carga inicial de un solo tiro):**
  - Se eliminó el `useEffect` que llamaba `subscriptionRef.current.updateParams()` en cada cambio de página/búsqueda — era un no-op (nada lee esos params después del montaje; el refetch real lo hace el efecto debounced de `loadCandidates`). Con eso `subscriptionRef` quedó huérfano y también se removió. La llamada `updateParams` del montaje **se conservó** porque sí alimenta `pollFull()` de la carga inicial.
- **Micro-mejora:** `fieldsMap` pasó de `reduce` con spread (O(n²)) a `Object.fromEntries(fields.map(...))` — resultado idéntico, sin crear objetos intermedios.
- **Intacto a propósito** (bajo el principio de no tocar lo que funciona): el `sectionCache` de módulo (pintado instantáneo al re-entrar), `candidatesListCache` + headers `X-Candidatic-Cache`/`Cache-Control`, el patrón stale-while-revalidate, `reconcileCandidates` (su `JSON.stringify` por fila es intencional a 100 filas), el SSE singleton y los `Set` de sesión (`_firedConfettiIds`, `dailySeenCandidateIdsRef`).

### ✅ Chat Web — 2026-11-06

**Intención:** dejar la sección más delicada (archivo gigante + alto tráfico SSE) en su mejor versión **sin tocar ninguna ruta de caché ni la arquitectura SSE**. Todo lo borrado es código muerto o estado write-only — **cero parches, salida del DOM idéntica**. Verificado con `npm run build` (✓) y `eslint` en los archivos tocados (exit 0, cero errores nuevos).

- **Archivos 100% muertos eliminados (0 referencias en `src/` y `api/`, grep):**
  - `src/components/ChatHistoryModal.jsx` (87 líneas) — cero imports en todo el repo.
  - `src/services/chatExportService.js` — sus 4 funciones (`generateChatHistoryText`, `exportChatToFile`, `deleteOldChatFile`, `downloadChatHistory`) sin un solo caller; `exportChatToFile`/`deleteOldChatFile` ya eran stubs (`'Cloud export no disponible'`), resto arqueológico del viejo export a Knowledge Base.
- **Refs muertos en `ChatSection.jsx` (solo la línea de declaración, nunca leídos/escritos):** `_messagesEndRef`, `_messagesContainerRef`, `_hasSetInitialFilter`. Los 3 empezaban con `_`, por eso ESLint los ignoraba (`varsIgnorePattern: '^[A-Z_]'`) y no salían como error.
- **Estado write-only eliminado (el valor nunca se leía; solo se llamaba al setter → re-renders que no pintaban nada distinto):**
  - `_sending`/`setSending` — redundante: la señal real de "enviando" la lleva `isSendingRef` (que sí se lee) + `addSendingMedia`/`removeSendingMedia`. Se quitó el estado y sus 2 llamadas.
  - `_recruiterTypingName`/`setRecruiterTypingName` — el indicador "otro reclutador escribiendo" ya no se pinta; se quitó el estado y la rama SSE completa (`if (recruiterTyping)` + su `setTimeout` de 8s) que solo lo alimentaba. El typing del **candidato** (`setCandidateTyping`) es otra cosa y **se conservó**. `typingTimersRef` sigue (lo usa el candidato); el cleanup `Object.values(...).forEach(clearTimeout)` sigue correcto aunque ya no exista la key `recruiter`.
  - `_chatSearchIdx`/`setChatSearchIdx` — índice de navegación de resultados de búsqueda que ya no existe; valor nunca leído. Se quitó el estado y el `setChatSearchIdx(0)` del `onChange`.
- **Intacto a propósito:** TODA la ruta de caché (`chatSectionCache` de módulo, `candidatesListCache`, headers `X-Candidatic-Cache`/`Cache-Control`, stale-while-revalidate, `reconcileCandidates`); el **SSE singleton** (`useCandidatesSSE.js` + `api/sse/candidates.js` + pub/sub) — arquitectura, no se toca; consts inline con `_` (`_mod`, `_gc`, `_quotedResolved`, etc.) que **sí se usan** (el `_` es estilo); `Set` de sesión que crecen, catch vacíos y fire-and-forget. **Fuera de alcance** (no son la sección Chat Web): `ChatWindow.jsx` (popup flotante de Candidatos/Mapa/CRM) e `InternalChat.jsx` (chat de equipo).

## Convenciones y patrones establecidos

- **Fire-and-forget para lo que no es crítico:** usa `.catch(() => {})` sin `await` para telemetría, logs de debug, notificaciones SSE — patrón ya usado en decenas de lugares (`recordAITelemetry`, `sendConversionEvent`, `notifyCandidateUpdate`). No lo confundas con negligencia: es intencional.
- **Pipeline de Redis en vez de comandos sueltos** cuando hay 2+ operaciones relacionadas en la misma función.
- **Zona horaria:** todo lo agregado por día usa `America/Monterrey` (`toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' })`), no UTC ni hora del servidor.
- **z-index del dashboard:** widgets flotantes/notificaciones (Toast, FloatingCopilot, InternalChat) están en `z-[150]` — por encima de cualquier panel normal de página, por debajo de la capa crítica `z-[9999]` (modales de confirmación, loading overlay). Si agregas un nuevo widget flotante global, súbelo a ese mismo nivel, no inventes un valor nuevo.
- **Variables de plantilla** (`{{nombre}}`, `{{municipio}}`, etc. en banco de respuestas, envíos masivos, recordatorios): usa siempre `substituteVariables()` de `api/utils/shortcuts.js` — es tolerante a mayúsculas/espacios y prioriza `nombreReal` (nombre registrado) sobre el `nombre` informal de WhatsApp. Nunca reimplementes esto con un regex propio (ya pasó una vez y causó un bug).
  - `{{texto ultimo boton}}` inyecta el título literal del último botón/opción interactiva que clicó el candidato (lo guarda el webhook en `candidate.ultimoBotonTexto`). El campo "frase dinámica" del banco también pasa por `substituteVariables()`, así que puede contener este token. Detalle en `docs/texto-ultimo-boton.md`. No confundir con `{{frase dinamica}}` (token distinto, fijado por el reclutador o por un nodo de flujo).
- **Preferencias de usuario por reclutador** (ej. si el banco de respuestas se queda abierto): se guardan en el perfil del usuario en Redis vía `PUT /api/users` con `{id, preferences: {...}}` — `saveUser()` hace merge superficial, así que mandar solo el campo que cambió es seguro.

## El copiloto "Brenda IA" del dashboard — ojo, no es un agente real

El botón flotante `FloatingCopilot.jsx` (burbuja "Brenda IA" en el dashboard, para uso de los reclutadores) **no llama a un LLM** — es un sistema de respuestas pre-escritas con detección por palabras clave en `api/utils/copilot-platform-stats.js`. Si el usuario pide "hacerlo más inteligente" o "que responda cualquier pregunta", eso implica construir un agente real con la API de Claude (tool use contra Redis para datos en vivo) — es un proyecto nuevo, no un ajuste del sistema actual.

## Verificación antes de dar por bueno un cambio

- `node --check archivo.js` para sintaxis.
- `npx eslint archivo.js` — **este repo tiene ~30-40 errores de lint preexistentes** (catch vacíos intencionales, variables sin usar en código no tocado) — compara con `git diff` antes de asumir que un error es tuyo.
- `npm run build` para el frontend.
- Para cambios de Redis: si es posible, pruébalo contra Redis real con un script temporal desechable (candidato de prueba con ID único, limpiar al final) — no confíes solo en la lectura del código. Varias veces la lógica "parecía correcta" pero fallaba en un caso real (ej. requiere `paso2Estado: 'completo'`, no solo los campos core).
- **`MONITOR` de Redis pierde comandos en flujos que corren en menos de 1 segundo** (limitación conocida de Redis Cloud/proxies administrados) — si algo parece "no pasó" en una captura de `MONITOR`, confírmalo con una lectura directa del estado final antes de concluir que hay un bug.
- No hay acceso a navegador/captura de pantalla en este entorno — los cambios visuales no se pueden verificar sin que el usuario los pruebe y confirme.

## Flujo de deploy (siempre con confirmación del usuario antes de cada paso)

```
git add <archivos específicos>
git commit -m "..."
git fetch origin main   # confirmar que no hay commits nuevos de otra sesión de Claude/Antigravity corriendo en paralelo
git push origin main    # esto YA despliega a producción — no corras vercel --prod después
```
