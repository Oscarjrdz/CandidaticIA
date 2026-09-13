# Sección "Estadísticas" (Statics) — gráficas de dona de la base de candidatos

**Fecha:** 2026-09-12
**Estado:** Implementado y desplegado (commit `357372f3`).
**Sidebar id:** `stats` · **Endpoint:** `GET /api/system/stats`

Sección de overview con 7 gráficas de dona animadas sobre toda la base de
candidatos. Pensada para tráfico alto y consumo mínimo de Redis: **no lee ni un
solo blob de candidato** — se apoya en el índice invertido facetado que ya
mantiene Envíos Masivos.

## Las 7 gráficas

| Gráfica | Tipo | Cómo se calcula |
|---|---|---|
| Mujeres vs Total | dona 2 rebanadas | `SCARD bulk:idx:v1:genero:Mujer` vs `total − mujeres` |
| Hombres vs Total | dona 2 rebanadas | `SCARD bulk:idx:v1:genero:Hombre` vs `total − hombres` |
| Edades · proporción del total | dona multi | `SCARD bulk:idx:v1:edad:<n>` por cada edad, agrupado en buckets (18-24, 25-34, 35-44, 45-54, 55+, <18) |
| Por municipio de Nuevo León | dona multi | `SCARD bulk:idx:v1:municipio:<valor>`, **top 8 + "Otros"** (una dona de 51 rebanadas es ilegible) |
| Por escolaridad | dona multi | `SCARD bulk:idx:v1:escolaridad:<valor>` (Primaria…Posgrado) |
| Perfiles completos | dona 2 rebanadas | `SCARD bulk:idx:v1:estatus:completo` vs resto |
| Perfiles incompletos | dona 2 rebanadas | `SCARD bulk:idx:v1:estatus:incompleto` vs completos |

> El ejemplo original traía 8 burbujas pero solo 7 etiquetas (la 8ª venía en
> blanco), por eso son 7 gráficas.

## Arquitectura / decisiones

### Backend — `api/system/stats.js`
- **Fuente:** el índice invertido facetado (`bulk:idx:v1:*`) de
  `api/utils/facet-index.js`. Se llama `ensureFacetIndex()` para tener `meta`
  (lista de valores por dimensión + `total`) y luego se hace `SCARD` de cada
  valor en un pipeline. **Por la red solo viajan enteros**, nunca perfiles.
- **Canonicalización gratis:** los sets ya están canonizados por el motor de
  facetas (`Mujer`/`Hombre`/`Sin dato`, escolaridad normalizada, etc.), así que
  los conteos salen limpios sin re-procesar.
- **Edades:** el índice guarda un set por edad **exacta** (15–99). El endpoint
  hace `SCARD` de cada una y las agrupa en buckets en JS. Edades inválidas o sin
  dato no entran a ningún set → no se cuentan.
- **Caché:** el payload ensamblado se guarda 5 min en `stats:overview:v1`.
  `?refresh=true` lo salta y recalcula. **No crea ningún cron nuevo** ni escribe
  en el camino caliente de mensajes.
- **Auth:** `validateAdminSession` (401 si no hay sesión). El `Authorization:
  Bearer` lo agrega el interceptor global de `fetch` en `src/main.jsx`.
- Reusa `loadManualProjectData()` (igual que `candidates.js`) como `projectLoader`
  por si el índice hay que reconstruirlo, para no dejar conteos de steps
  inconsistentes para `candidates.js`.

### Frontend — `src/components/StatsSection.jsx` + `src/services/statsService.js`
- **Donas, no pastel sólido.** La dona lee igual de "pastel" pero permite el
  número héroe al centro y un hover más limpio (práctica recomendada por la skill
  `dataviz`).
- **Animación:** SVG puro. Cada rebanada es un `<circle pathLength="100">` cuyo
  `stroke-dasharray` transiciona desde `0 100` con **stagger** (cascada) por
  índice. Respeta `prefers-reduced-motion` (pinta instantáneo si está activo).
- **Hover:** resalta la rebanada, atenúa el resto y **proyecta el dato de esa
  rebanada al centro** de la dona. La leyenda comparte el mismo estado `active`.
- **Anti-brinco:** caché a nivel de módulo (`statsCache`) + siembra perezosa en
  `useState`; el `useEffect` revalida en silencio y no re-enciende el skeleton si
  ya hay caché. Ver `docs/anti-brinco-secciones.md`.
- **Color:** paleta categórica **validada** con `scripts/validate_palette.js` de
  la skill dataviz (pasa light y dark). El único WARN es de contraste en light,
  cubierto por la *relief rule*: los **valores van siempre visibles** en la
  leyenda. Tokens light/dark vía variables CSS (`--s1..--s8`, `--s-neutral`,
  `--track`) que cambian con la clase `.dark` de Tailwind. "Otros" y "Sin dato"
  usan el color neutro, no un hue categórico.

## Permisos
- Agregada a `AVAILABLE_SECTIONS` en `src/components/UsersSection.jsx` (id
  `stats`) → se puede otorgar por rol desde Usuarios. SuperAdmin la ve siempre.
- Solo desktop (la vista móvil del dashboard solo renderiza Chat Web, igual que
  las demás secciones de administración).

## Archivos
- `api/system/stats.js` — endpoint de agregación (nuevo)
- `src/services/statsService.js` — cliente `getOverviewStats()` (nuevo)
- `src/components/StatsSection.jsx` — la sección + dona animada (nuevo)
- `src/components/Sidebar.jsx` — item de menú (ícono `PieChart`)
- `src/App.jsx` — lazy import + render + título/subtítulo
- `src/components/UsersSection.jsx` — `AVAILABLE_SECTIONS`

## Notas / pendientes
- No se pudo verificar visualmente en el entorno de desarrollo (sin navegador);
  la animación/estética se confirma probando en la app real.
- Si en el futuro se quiere pastel sólido en vez de dona, o más gráficas
  (barras horizontales para municipio completo, series en el tiempo), es
  extensión directa sobre el mismo endpoint/patrón.
