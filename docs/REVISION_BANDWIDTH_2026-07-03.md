# REVISION BANDWIDTH - VIERNES 2026-07-03

## Objetivo

Revisar si las optimizaciones del jueves 2026-07-02 redujeron el consumo diario de Redis sin afectar la experiencia del Chat Web ni los filtros.

Meta operativa:
- Objetivo final: 500 MB/dia con 3 usuarios activos.
- Ideal inmediato: acercarse a 500 MB/dia.
- Aceptable temporal: menos de 1 GB/dia con uso normal.
- Alerta: mas de 2 GB/dia sin carga excepcional.

## Cambios aplicados el jueves 2026-07-02

1. `/api/chat-unread-count`
   - Antes: cada llamada podia releer muchos `candidate:*` para recalcular todos los contadores de no leidos.
   - Ahora: construye un agregado cacheado por `stats:unread:version` durante 60 segundos.
   - Mantiene la misma respuesta para UI: `unreadCount`, `counts.tags`, `counts.crmProjects`, completos/incompletos y sin etiqueta.
   - Para usuarios con restricciones, filtra el agregado en memoria sin volver a leer todos los perfiles.

2. `/api/candidates` con filtro por etiqueta
   - Antes: los filtros por etiqueta podian caer en full scan.
   - Ahora: si no hay busqueda libre ni `excludeLinked`, usa el indice Redis de tags y preserva el orden de `candidates:list`.
   - Se verifico contra Redis produccion con la etiqueta `METALSA ANUNCIO`: mismo orden para los primeros 10 resultados.

3. Auditor de endpoints
   - `GET /api/system/endpoint-usage` ahora suma `redisReads` y `redisWrites` en `totals`.
   - La accion pesada `mark_read_by_tag` queda separada como `/api/chat/mark-read-by-tag`, con `candidateReads`, `redisWrites` y `estimatedRedisBytes`.

4. Deploy adicional para bajar consumo real
   - `__candidatic_untagged__` ahora tiene indice Redis `index:candidates:untagged` ordenado por actividad.
   - El filtro "Sin etiqueta" ya no necesita escanear perfiles completos: lee IDs del indice e hidrata solo la pagina visible.
   - `getCandidatesUnreadFirstByTag` ahora cruza IDs por indice antes de hidratar candidatos; evita cargar todos los no leidos + ventana reciente para filtrar en Node.
   - `/api/candidates` ya no marca filtros por tag como `fullScan` cuando van por indices.
   - El medidor debe usarse como ciclo de mejora: medir, ordenar endpoints por bytes/calls, quitar el siguiente full scan, repetir hasta 500 MB/dia.

## Como revisar el viernes

1. Abrir Configuracion > Redis Telemetry.
   - Revisar barra del dia 2026-07-03.
   - Comparar con:
     - 2026-06-29: 1.26 GB
     - 2026-06-30: 2.61 GB
     - 2026-07-01: 1.01 GB

2. Consultar auditor por endpoint:
   - `GET /api/system/endpoint-usage?day=2026-07-03`
   - Requiere sesion admin.

3. Revisar especialmente:
   - `/api/chat-unread-count`
     - Debe bajar fuerte en `candidateReads`.
     - Debe subir `cacheHitRate` si no cambia `stats:unread:version` constantemente.
   - `/api/candidates`
     - Debe bajar `fullScans` cuando se usen filtros por etiqueta normales.
     - Debe mantenerse bajo tambien con el filtro "Sin etiqueta".
   - `/api/chat/mark-read-by-tag`
     - Solo debe aparecer cuando se use el boton de marcar como leidos por etiqueta/filtro.
   - `totals.redisReads` y `totals.redisWrites`
     - Sirven para detectar consumo que no necesariamente lee candidatos o mensajes.

## Senales de exito

- `/api/chat-unread-count` ya no domina `candidateReads`.
- `/api/candidates` muestra menos `fullScans`.
- La UI mantiene:
  - badge global de Chat correcto,
  - conteos por etiqueta,
  - conteos por CRM,
  - filtros de completos/incompletos,
  - "marcar como leido" por etiqueta/filtro.

## Si todavia queda alto

Siguiente foco:
1. Busqueda libre en `/api/candidates`, porque todavia requiere stream/scan para coincidencias generales.
2. Bulk `mark_read_by_tag`, si aparece con muchos `candidateReads`.
3. `/api/chat`, si `messageReads` crece por cargas de historial.
4. Endpoints no instrumentados que aparezcan en logs de Vercel con mucha frecuencia.

No migrar hosting ni Redis antes de medir estos cambios 24 horas. Si el consumo baja, el problema era patron de lectura; si no baja, ampliar instrumentacion a endpoints restantes que aparezcan en logs de Vercel.
