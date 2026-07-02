# REVISION BANDWIDTH - MARTES 2026-06-30

Nota para retomar rapido:
El domingo 2026-06-28 se implemento un paquete de reduccion de consumo Redis/Vercel sin cambiar funcionalidad visible. Revisar este archivo el martes 2026-06-30 antes de tocar mas cosas.

## Objetivo

Bajar consumo de bandwidth/Redis para una operacion de 3 usuarios. El consumo historico de 24-39 GB/dia no era normal; parecia causado por lecturas repetidas de candidatos, full scans y endpoints que recargaban demasiado.

Meta acordada:
- Consumo comodo objetivo: ~500 MB/dia con 4 usuarios.
- Si se mantiene por debajo de 500 MB/dia en uso normal, considerar el paquete exitoso.
- Si queda entre 500 MB y 1 GB/dia, seguir optimizando endpoints calientes.
- Si vuelve a superar 2-5 GB/dia sin una carga excepcional, investigar fuga activa.

## Cambios implementados

1. Chat Web muestra 10 chats y revela de 10 en 10.
   - Archivo: `src/components/ChatSection.jsx`
   - Constantes: `CHAT_LIST_PAGE_SIZE = 10`, `CHAT_LIST_LOCAL_FILTER_PAGE_SIZE = 500`
   - Importante: cuando hay filtros cliente delicados, se mantiene carga amplia para no perder resultados.

2. `/api/candidates` tiene cache corto en memoria.
   - Archivo: `api/candidates.js`
   - TTL: 15 segundos
   - Key: usuario + limit + offset + search + tag + unreadFirst + filter
   - Se limpia en POST/PUT/DELETE.

3. Paginacion real para No Leidos y etiqueta + No Leidos.
   - Archivos: `api/candidates.js`, `api/utils/storage.js`
   - Funciones: `getCandidatesUnreadFirst(limit, offset)`, `getCandidatesUnreadFirstByTag(tag, limit, offset)`
   - Se ordenan no leidos antes de paginar para evitar saltos.

4. Eliminados `KEYS` de Redis en rutas productivas.
   - `api/chat-stats.js`: usa `chat_locks:active`.
   - `api/chat.js`: mantiene indice de locks al lock/heartbeat/unlock.
   - `api/recruiter-stats.js`: usa `recruiter:ids:{date}`.
   - `api/presence.js`: alimenta `recruiter:ids:{date}`.
   - `api/media/list.js` y `api/fields.js`: fallback con `SCAN` controlado.

5. Menos lectura de mensajes para read receipts.
   - Archivo: `api/chat.js`
   - `mark_read` y `send_read_receipt` ahora leen ultimos 20 mensajes en vez de 100.

6. Manual projects hidrata candidatos por pipeline.
   - Archivo: `api/manual_projects.js`
   - Misma respuesta, menos round trips a Redis.

7. Cache en endpoints con fallback caro.
   - `api/candidate-daily-stats.js`: cache de fallback por rango durante 5 min.
   - `api/bypass-search.js`: cache de busqueda identica durante 60s.

## Archivos modificados

- `src/components/ChatSection.jsx`
- `api/candidates.js`
- `api/utils/storage.js`
- `api/chat.js`
- `api/chat-stats.js`
- `api/recruiter-stats.js`
- `api/presence.js`
- `api/media/list.js`
- `api/fields.js`
- `api/manual_projects.js`
- `api/candidate-daily-stats.js`
- `api/bypass-search.js`

## Verificacion ya corrida

`npm run build` paso correctamente el 2026-06-28.

## Que revisar el martes 2026-06-30

1. Medir Redis bandwidth actual.
   - Abrir endpoint/app de monitoreo que use `api/system/bandwidth`.
   - Comparar contra dias previos:
     - 2026-06-24: 3.29 GB
     - 2026-06-25: 5.25 GB
     - 2026-06-26: 2.56 GB
     - 2026-06-27: 2.95 GB
     - 2026-06-28 al momento de medicion: 343 MB

2. Revisar auditor por endpoint.
   - Endpoint nuevo: `GET /api/system/endpoint-usage`
   - Requiere sesion admin.
   - Parametro opcional: `?day=YYYY-MM-DD`
   - Revisar:
     - `calls`
     - `cacheHits`
     - `cacheMisses`
     - `candidateReads`
     - `messageReads`
     - `estimatedRedisBytes`
     - `fullScans`
   - Endpoints instrumentados al inicio:
     - `/api/candidates`
     - `/api/chat`
     - `/api/chat-unread-count`
     - `/api/bypass-search`
     - `/api/candidate-daily-stats`
     - `/api/ai/query`
     - `/api/public/ai-search`
     - `/api/tags`
     - `/api/media/list`
     - `/api/image`
     - `/api/sse/candidates`
     - `/api/bulks`

3. Confirmar experiencia Chat Web.
   - Lista inicial debe mostrar 10.
   - Scroll debe revelar otros 10.
   - Filtros de No Leidos, Todos, Completos, Incompletos deben seguir funcionando.
   - Filtros por etiqueta, edad, genero, municipio y CRM no deben perder candidatos.
   - Contadores/badges no deben bajar artificialmente por mostrar solo 10.

4. Confirmar headers de cache en API.
   - `/api/candidates` puede responder `X-Candidatic-Cache: HIT` en llamadas repetidas.
   - Si no aparece siempre, no es bug: en Vercel puede haber multiples instancias.

5. Revisar comandos Redis.
   - Ya no deberia haber `KEYS` desde codigo productivo.
   - Si Redis sigue mostrando muchos `SCAN`, buscar scripts/debug o endpoints externos.

## Senales de exito

- Objetivo principal: ~500 MB/dia con 4 usuarios.
- Redis baja hacia menos de 1 GB/dia con uso normal de 3 usuarios.
- No hay picos de 20-40 GB/dia.
- Chat Web se siente igual o mas ligero.
- No se reportan candidatos faltantes al filtrar.

## Si algo falla

Rollback pequeno:
1. En `src/components/ChatSection.jsx`, subir `CHAT_LIST_PAGE_SIZE` temporalmente a 33.
2. Si faltan resultados solo en filtros locales, no tocar `CHAT_LIST_LOCAL_FILTER_PAGE_SIZE`; ya esta en 500 justamente para proteger eso.
3. Si hay conteos raros, revisar primero SSE/globalStats antes de revertir paginacion.
4. Si cache de `/api/candidates` muestra datos viejos, bajar `CANDIDATES_LIST_CACHE_TTL_MS` de 15000 a 5000.

## Proximo paquete recomendado

Extender metricas por endpoint:
- Si el auditor no explica el consumo, instrumentar los endpoints restantes que aparezcan por logs de Vercel.
- Agregar alerta si Redis supera 1 GB/hora o 5 GB/dia.
- Agregar vista simple en UI para `GET /api/system/endpoint-usage`.

No migrar hosting hasta medir 24-48h despues de estos cambios. Migrar sin arreglar patrones de lectura solo cambia donde se paga la fuga.

## Nota para futuros deploys

Antes de ejecutar deploy, ponerle un nombre/descripcion que corresponda al cambio. No dejar deploys con nombre generico o sin contexto.

Formato sugerido:
- `bandwidth-guardrails-chat-pagination`
- `redis-cache-candidates-api`
- `fix-chat-web-unread-pagination`
- `media-cache-r2-migration`

Checklist antes de deploy:
1. Resumir en una frase que cambia.
2. Usar esa frase como nombre/descripcion del deploy si la herramienta lo permite.
3. Si Vercel CLI no permite nombre directo, al menos dejarlo anotado en el commit/tag/release note antes del deploy.
4. No hacer redeploy solo para corregir nombre si el deploy ya quedo bien funcionalmente.
