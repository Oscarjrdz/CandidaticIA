# Dashboard: "Atendidos por día" (apilada) + tarjeta CTR enriquecida

Feature 2026-11-12. Enriquece dos widgets del dashboard de Candidatos con los **retornados** y los
**convertidos**, con definiciones acordadas con Oscar (ver más abajo). No toca ninguna ruta de caché
ni el hot path de mensajes.

## Definiciones (fuente de verdad)
Por **día D** (zona Monterrey):
- **Nuevos (capturas)** = candidatos con **primer contacto** ese día. Se completen o no. *(ya existía: `stats:daily:captures`)*
- **Completo regresado** = retornado (primer contacto en día anterior) activo en D que **ya había completado su perfil ANTES de D** (`paso2CompletadoAt < 00:00 de D`).
- **Incompleto regresado** = retornado activo en D que **NO había completado al inicio de D** — aunque lo complete ese mismo día (se clasifica por **cómo llegó**).
- **Total atendidos** = nuevos + completos regresados + incompletos regresados.
- **Convertidos** *(solo tarjeta CTR, dato aparte)* = retornados que **llegaron incompletos y completaron HOY** (incompleto→completo recuperado). Subconjunto de los completos actuales.

> Clasificación por **estatus al llegar** vía `paso2CompletadoAt` (timestamp que el agente escribe en
> `agent.js` al cerrar paso 2). Legado sin ese campo = completó hace mucho → cuenta como "ya completo".

## Gráfica "Atendidos por día" (antes "Capturas por día")
Barras **apiladas** por día: 🟦 nuevos (abajo) + 🟩 completos regresados + 🟪 incompletos regresados.
El número del badge = **total atendidos** de la ventana. Tooltip con el desglose. La altura se escala
al total atendidos máximo de la ventana.

## Tarjeta "CTR de Hoy"
- **Título**: agrega el **CTR de los nuevos de hoy** (`57% nuevos`) — conversión de los que llegaron hoy.
- **Hero**: `57%` + `123/214 nuevos`.
- **Atorados**: igual (en qué paso se quedaron los nuevos incompletos).
- **Footer**: `↻ 235 volvieron (✓191 · ◷44 · ⚡27)` — total retornados + split completos/incompletos +
  convertidos — **en el mismo renglón, sin crecer el alto**. Más `⊙ 21 ubic`.

Nota: la tarjeta usa el estado **ACTUAL** para su split (235 = 191 completos + 44 incompletos, empata con
el "191" clásico), mientras la **gráfica** usa estatus **al llegar** (diferencia solo en los que llegaron
incompletos y convirtieron el mismo día — esos son los "convertidos"). Es por diseño, no un desajuste.

## Arquitectura (espejo de `stats:daily:captures`, sin parches)
- **Módulo** `api/utils/returns-daily-stats.js`: hashes `stats:daily:returns:complete` / `:incomplete`
  (ymd → count). Sólo este módulo los escribe.
- **Hoy, sin hook en el hot path**: `computeCtrBlocks` (ctr-stats.js) ya recorre los activos de hoy para
  la tarjeta → llama `persistTodayReturns()` y hace HSET del valor de hoy en cada cómputo (cacheado 60s).
  Los días pasados quedan congelados en su último valor.
- **Backfill único** (`backfillReturnsDaily`, lock + marcador, idempotente): reconstruye los días
  ANTERIORES a hoy escaneando los mensajes de los candidatos **activos en la ventana** (vía
  `activity:tracker`, no los 13.6k blobs) — por eso corre en ~7s, dentro del `maxDuration`. Se dispara una
  vez desde el endpoint, igual que el de capturas.
- **Endpoint** `api/candidate-daily-stats.js`: cada día de la respuesta trae `count` (nuevos), `compReg`,
  `incompReg`, `atendidos`; + `totalAtendidos` en la raíz.
- **Tarjeta**: `computeCtrBlocks` agrega a `retornosHoy` los campos `completos` / `incompletos` / `todos`
  / `convertidos`. `total` se conserva = completos (compat con el MCP/Grok).

## Verificación (2026-11-12)
`node --check` ✓ · `npm run build` ✓ · `eslint` (archivos tocados) exit 0 · backfill real 7.3s ·
serie 7 días coherente (Nov 11: 214 nuevos + 163 comp-reg + 70 incomp-reg = 447 atendidos) ·
`computeCtrBlocks` persiste hoy correctamente.
