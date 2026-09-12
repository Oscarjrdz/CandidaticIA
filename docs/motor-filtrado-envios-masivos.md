# Motor de filtrado facetado — Envíos Masivos

**Fecha:** 2026-09-12
**Archivos:** `api/utils/facet-index.js` (nuevo), `api/bulks.js`, `api/candidates.js`, `src/components/BulksSection.jsx`

## Qué se construyó y por qué

La sección **Envíos Masivos** (donde cada mensaje cuesta dinero) filtraba en el navegador sobre **máximo 2000 candidatos** descargados completos. Con ~13.6k candidatos eso dejaba a los ~11.6k más antiguos **inalcanzables** y gastaba mucho ancho de banda. Solo había filtros de estatus y una etiqueta, y no se cruzaban.

Se reemplazó por un **motor de filtrado facetado tipo Meta Ads / Amazon**: filtros por **género, edad, escolaridad, municipio, estatus, etiquetas y ventana de 24h**, donde *todo depende de todo* (al elegir un valor se recalculan los conteos de los demás — drill-down). Sin límite de volumen y cuidando el consumo.

## Arquitectura: índice invertido en Redis + intersección de sets

Patrón estándar de faceted search: un **SET de candidateIds por cada valor de faceta**. El cruce de filtros se resuelve **dentro de Redis con `SINTERCARD`**, así por la red solo viajan enteros — nunca perfiles de candidato.

### Claves Redis (`api/utils/facet-index.js`)
- `bulk:idx:v1:all` → SET universo (todos los candidateIds existentes)
- `bulk:idx:v1:<dim>:<valor>` → SET de ids con ese valor
- `bulk:idx:v1:meta` → JSON `{ generatedAt, total, dims: { dim: [valores...] } }` (evita `SCAN`)
- `bulk:idx:v1:counts` / `:counts_stale` / `:lock` → cache de conteos + fallback + lock de build

Dimensiones: `genero` (Hombre/Mujer/Sin dato), `municipio` (nombres oficiales), `escolaridad` (Primaria/Secundaria/Preparatoria/Técnica/Licenciatura/Posgrado/Sin dato), `edad` (**edad exacta** `bulk:idx:v1:edad:<n>` para rangos desde/hasta), `estatus` (completo/incompleto vía `auditProfile`), `ventana24h` (`si`), `tags` (multi-valor). Dentro de una dimensión = **OR**; entre dimensiones = **AND**.

**Edad (rango desde/hasta):** se indexa por edad exacta. Un rango `{min,max}` (`selection.edadRange`) se resuelve con `SUNIONSTORE` de los sets de edad en `[min,max]` (cap 15–99). No se expone `edad` en `meta.dims` (se filtra por rango, no por lista).

**Municipio (solo Nuevo León):** el dropdown solo muestra los 51 municipios de NL. La lista es **única fuente de verdad** reutilizada de `NL_MUNICIPIOS` en `api/flows.js` (no se duplicó); `bulks.js` filtra `meta.dims.municipio` contra ese set antes de responder.

### Frescura: materializado desde el escaneo cacheado (NO ruta de escritura)
- **Un solo escaneo** de `candidates:list` alimenta a la vez los conteos legados (`candidates.js` action=`filter_counts`) **y** el índice invertido. No se duplica el escaneo de ~14 MB.
- Cacheado 30 min (conteos) + índice/meta con TTL 24 h + copia stale + lock — mismo patrón que el `buildFilterCounts` previo.
- Se **invalida al instante** en alta/edición/borrado de candidatos vía `clearFilterCountsCache` → `clearFacetIndex` (borra meta+counts; rebuild perezoso en la siguiente petición).
- Cambios entrantes por WhatsApp se reflejan hasta en unos minutos — aceptable para una herramienta donde se revisa el conteo antes de enviar. **Cero escrituras extra en el camino caliente de cada mensaje.**

## Flujo de datos

1. **Al abrir la sección / cambiar un filtro** (debounce 350 ms), el front hace `POST /api/bulks?action=facets` con `{ selection }`.
2. El endpoint: `ensureFacetIndex` (build si falta) → `computeFacets` (total + conteos drill-down por dimensión, todo con `SINTERCARD` dentro de Redis) → `resolveSegmentIds(limit=100)` + `hydratePreview` (solo esos 100, sin campos pesados de anuncio).
3. Devuelve `{ total, counts, meta:{dims}, preview }`. El navegador pinta "**X coinciden**", los conteos por valor y la vista previa.
4. **Al enviar**, el front manda `POST ?action=start` con `{ segment: { selection, excludeIds } }` (NO la lista de IDs). El servidor resuelve la **lista completa** con `resolveSegmentIds(limit=0)` (ordenada por recencia vía `ZINTERSTORE` contra `candidates:list`, restando `excludeIds`) y arranca el motor de envío existente **sin cambios** en `tickEngine`.

## UI de filtros
- **Género, Escolaridad, Municipio, Etiquetas** → dropdowns **multi-select** con conteo drill-down por opción (Municipio y Etiquetas con buscador interno; Etiquetas con color).
- **Edad** → dos inputs **Desde / Hasta**.
- **Estatus** (Todos/Completos/Incompletos) → chips; **Últimas 24h** → toggle.
- Municipio solo lista municipios de NL (ver arriba).

## Modelo de selección (UI)
- El segmento lo definen los **filtros** (facetas), no checkboxes uno por uno.
- Botón de envío muestra el conteo: `INICIAR CAMPAÑA (N)`.
- La **vista previa** (~100 más recientes) permite **destildar** casos puntuales → van a `excludeIds` (se restan del envío). Cambiar cualquier filtro limpia las exclusiones (segmento nuevo).
- El buscador de la vista previa es un **localizador** dentro de esos ~100; **no redefine el segmento** (limitación conocida: un match que esté fuera de los 100 de preview no aparece al buscar, pero sí se le envía porque el segmento lo define el filtro).

## Ancho de banda / consumo
- El navegador **ya no baja miles de perfiles**: solo enteros (conteos) + ~100 de vista previa (sin `adBody`/`adImageUrl`/`adUrl`/`adClickId`), con debounce.
- El cruce de facetas ocurre **dentro de Redis** (`SINTERCARD`) → egress = enteros.
- Un solo escaneo alimenta conteos + índice. El índice sirve facetas hasta 24 h sin reconstruir; solo se reconstruye tras invalidación o expiración.
- Enganchado al medidor real (`recordScanEvent(redis, 'facet_index')`), sin crons nuevos.

## Compatibilidad y rollout
- `?action=start` sigue aceptando `candidates: []` explícito (retrocompatible).
- Claves versionadas `v1`.
- `SINTERCARD` (Redis 7+, confirmado en prod). Fallback automático a `SINTERSTORE`+`SCARD` si no estuviera disponible.
- El endpoint legado `?action=filter_counts` de `candidates.js` conserva su contrato; ahora delega en el escaneo compartido.

## Diferencias vs. la versión anterior
- Se eliminó el filtro **"Vacíos"** (era nicho y no tiene faceta en el índice). Reemplazable con otros filtros.
- El orden por "Recientes/Antiguos" se quitó de la columna; la vista previa siempre va por recencia (más recientes primero), igual que `candidates:list`.
- "Completos" ahora usa `auditProfile(c).isComplete` (paso 1: los 6 campos core), consistente con el resto de la plataforma.

## Verificación realizada
- `node --check` + `npx eslint` (limpio) + `npm run build` (OK).
- **Test contra Redis real** (`scratchpad/test-facets.mjs`, desechable): 3 candidatos de prueba con facetas conocidas → build → **17/17 checks** (drill-down por dimensión, cruce AND, ventana24h, `resolveSegmentIds` con orden por recencia, `excludeIds`, `hydratePreview`). Limpieza exhaustiva verificada (0 residuos, meta nulo tras `clearFacetIndex`).

## Bug corregido durante la revisión de la sección
El diálogo de confirmación (`_confirmModalJSX` de `useConfirmModal`) estaba **destructurado pero nunca renderizado** → **Abortar Campaña** y **Eliminar Historial** no mostraban diálogo y quedaban colgados (la promesa de `showConfirm` nunca resolvía). Se agregó `{_confirmModalJSX}` al render. Abortar es crítico (es cómo se detiene una campaña en curso).

## Cómo extender (agregar una faceta nueva)
1. En `buildCandidateFacetIndex` (facet-index.js): agregar la dimensión a `members`, hacer `push('nuevaDim', normaliza(c.campo), id)` y, si es de valores fijos, ordenarla en el bloque `orderBy`.
2. En `buildConstraintKeys`: si es multi-valor, agregarla a `dimsMulti`; si es single/booleana, manejarla aparte (como `estatus`/`ventana24h`).
3. En `BulksSection.jsx`: agregar el `<FacetGroup>` y el campo en `EMPTY_SELECTION`, `toggleFacetValue`/`activeFilterCount`.
4. No requiere migración: el índice se reconstruye del escaneo. Basta invalidar (`clearFacetIndex`) o esperar el TTL.
