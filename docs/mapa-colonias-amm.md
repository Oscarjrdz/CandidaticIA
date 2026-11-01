# Mapa — Catálogo de Colonias del AMM (buscador, coloreado y candidatos por colonia)

Feature de la sección **Mapa** que permite buscar colonias del Área Metropolitana de Monterrey,
**colorear su contorno** y **ver los candidatos que están dentro de cada colonia**. Construido en la
sesión de 2026‑11‑01. Commits: `b22fb54b`, `aba0c602`, `8577c2fb`, `61364463`, `869fdb27`, `149a6ee2`.

## Qué hace (resumen de producto)

- Botón **"Colonias"** en la barra de la sección Mapa → abre un buscador multi‑selector.
- Al seleccionar una o varias colonias:
  - Se **colorea su zona** (contorno real, violeta), **solo** de las colonias que tienen contorno delineado.
  - Se **iluminan los candidatos** que dieron esa colonia pero **no** compartieron GPS (los de GPS exacto
    ya se ven siempre como pin verde y **no** se duplican).
- Toggle **"Solo colonias con candidatos"**: filtra el buscador a las colonias pobladas (ordenadas por
  # de candidatos). Su estado se **persiste en Redis** (`preferences.coloniasSoloConCandidatos`).

## Dos tipos de candidato en el mapa

| Tipo | Origen | Cómo se muestra |
|---|---|---|
| **Ubicación exacta** | compartió GPS por WhatsApp (`candidatic:candidate_locations`) | pin verde, **siempre visible**, en vivo (SSE `sse:location:pin`) |
| **Solo colonia** | solo tiene colonia en texto | aparece **dentro de su colonia** (centroide + jitter ~165 m) al seleccionarla |

Un candidato con **GPS + colonia** se muestra **una sola vez** en su ubicación exacta (el endpoint
excluye los ids que ya tienen pin GPS). No se duplica ni se double‑cuenta.

## Fuentes de datos (todo abierto, cero Google)

- **Nombres de colonia** → catálogo postal de **SEPOMEX** (`gomflo/codigos-postales-mexico` + polígonos
  por CP de `open-mexico/mexico-geojson`), unidos por código postal.
- **Contornos y ubicaciones** → **OpenStreetMap**: contornos vía Overpass (`landuse=residential` con
  nombre) y geocodeo de las faltantes vía Nominatim. **Ninguna** dependencia de Google (sus contornos
  son propietarios y sus Términos no permiten usarlos en un mapa no‑Google como el nuestro con Leaflet/OSM).
- Todo se materializa en **archivos estáticos** embebidos (como Ecovía/Metro) → **cero ancho de banda de
  Redis** recurrente.

## Pipeline y archivos de datos

Generador reproducible: **`scripts/build-colonias-amm.mjs`** (`node scripts/build-colonias-amm.mjs`).
Baja las fuentes a `/tmp` (SEPOMEX + OSM Overpass), las une, aplica overrides/geocodeo/alias, y emite:

| Archivo | Qué es |
|---|---|
| `src/data/coloniasAMM.js` | Catálogo (nombres, centroides) + **`matchColoniaId()`** (matcher). Carga perezosa. |
| `src/data/coloniasAMMPolys.js` | `COLONIA_POLYS` — contornos reales de OSM por id de colonia. Carga perezosa (`import()`). |
| `src/data/coloniasAMMOverrides.json` | Overrides **manuales** de centroide por colonia (coords de Maps). |
| `src/data/coloniasGeocoded.json` | Colonias de candidatos **geocodificadas de OSM** (punto + contorno). |
| `src/data/coloniasAliases.json` | **Correcciones de sentido común** (texto candidato → id de colonia). |

### `matchColoniaId(municipio, colonia)` — único lugar de la lógica de match

Resuelve el texto libre de un candidato a un id de colonia del catálogo, o `null`. Orden:
1. Match exacto `muniNorm|coloniaNorm` (con alias de municipio: "Benito Juárez"→"Juárez", etc.).
2. **`COLONIA_TEXT_ALIAS`** (tabla estática O(1)): typos ("Monte Cristal"→"Monte Kristal"), abreviaturas
   ("Noria Nte"→"Noria Norte"), municipio pegado ("Margaritas Apodaca"→"Margaritas"), nombre único.
3. Colonia de nombre único en el AMM (sin cruzar de municipio).
4. Fuzzy conservador dentro del mismo municipio.

**Nunca cruza de municipio** (evita falsos positivos tipo "Centro" o colocar candidatos de otro estado).
El fuzzy de los alias se **precomputa en build** — no corre en el navegador.

### Precedencia de centroide por colonia

`override manual` > `centroide del polígono OSM` > `punto geocodificado` > `centroide del CP` (respaldo).

## Backend — `api/system/colonia-candidates.js`

`GET` (auth admin). Devuelve los candidatos del AMM con colonia en texto y **sin** GPS, compactos
(`{id, n, m, c, cat, tags}`).

- Enumera desde **`candidates:list`** (se actualiza en cada `saveCandidate` → candidatos **nuevos**
  entran dentro de la ventana de caché, ~1 min; no depende del rebuild del índice facetado).
- Lee proyecciones **`candidate:facet:<id>`** (~277 B), **no** los blobs (22 MB). Filtra AMM + con colonia.
- Excluye los ids con pin GPS. Incluye **completos e incompletos** por igual (sin filtro de completitud).
- **Caché 60 s** en memoria + **fetch perezoso** en el frontend (solo al abrir el panel de Colonias).

## Frontend — `src/components/MapSection.jsx`

- Leaflet directo (como el resto del Mapa). Capa de polígonos (SVG) + capa de pines de colonia (canvas).
- El catálogo, el matcher y los polígonos se cargan **100 % perezoso** (`import()`) al abrir el filtro
  Colonias → el bundle inicial y el chunk del Mapa **no** pagan nada.
- El match de candidato→colonia se hace una vez (`coloniaBuckets`), y el buscador topa a 60 resultados.
- Jitter determinista por id (~165 m) para que los pines no se encimen ni brinquen entre renders.

## Cobertura lograda (pool de candidatos)

Sobre **11,110** candidatos con colonia / **2,960** colonias distintas:

| Etapa | Candidatos ubicados |
|---|---|
| Match base (SEPOMEX) | 63 % (6,996) |
| + geocodeo OSM | 82 % (9,102) |
| + correcciones de sentido común | **86 % (9,560)** |

- **1,411** colonias distintas de candidatos ubicadas; **~879** con contorno real.
- Catálogo total: 4,177 → **4,605** (+428 colonias nuevas recuperadas de OSM que SEPOMEX no listaba).
- El ~14 % restante es **ruido del dato**: calles puestas como colonia, nombres inventados, o colonias que
  ni SEPOMEX ni OSM listan. Listas de revisión en `docs/colonias-por-revisar.md` y
  `docs/colonias-aliases-aplicados.md`.

## Cómo mantener / ampliar

- **Corregir una colonia mal ubicada / sin contorno:** agrega su coordenada a
  `src/data/coloniasAMMOverrides.json` (`"id-colonia": [lat, lng]`) y regenera. Override gana sobre todo.
- **Ampliar a todas las colonias del AMM** (no solo las de candidatos): en el script de geocodeo, cambiar
  el universo de "colonias de candidatos sin contorno" a "todas las del catálogo sin contorno".
- **Rutas de camión u otras capas OSM:** mismo pipeline Overpass (`route=bus`), como Ecovía/Metro.
- **Mejora futura (no implementada):** índice incremental colonia→candidatos mantenido en `saveCandidate`
  para que los candidatos nuevos con solo colonia aparezcan **instantáneo** (hoy ~1 min por caché).

## Guard rails / notas

- Guard de nombre en el geocodeo (Jaccard de tokens): evita colocar p.ej. "Parques La Fama" en "Plaza La
  Fama". Las dudosas quedan **fuera del mapa** para revisión manual, no mal colocadas.
- Los alias se filtran a **solo municipios del AMM** (un candidato de Veracruz con una colonia homónima
  **no** se jala a NL).
