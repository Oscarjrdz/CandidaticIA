# Contador / Analítica de la Landing (candidatic.com)

Motor propio de analítica de la landing principal, estilo Plausible/Umami/Clarity pero
sobre **Vercel serverless + Redis** (la única fuente de verdad del proyecto). Sin GA, sin
cookies de terceros, sin dependencias nuevas.

- **Backend:** [api/lp/visit.js](../api/lp/visit.js)
- **Cliente (captura):** [src/utils/lpAnalytics.js](../src/utils/lpAnalytics.js)
- **UI (footer):** [src/components/LandingVisitCounter.jsx](../src/components/LandingVisitCounter.jsx),
  insertado en [LandingPage.jsx](../src/components/LandingPage.jsx) y [MobileLandingPage.jsx](../src/components/MobileLandingPage.jsx)
- **Disparo:** un `useEffect` en [App.jsx](../src/App.jsx) que solo corre cuando el visitante
  NO ha iniciado sesión (que es exactamente cuando se renderiza la landing).

---

## Qué se captura

Dos "latidos" desde el navegador:

1. **`view`** — al cargar la landing (`fetch` con `keepalive`). Manda: `vid` (ID persistente
   del dispositivo en `localStorage`), `sid` (ID de esta visita), `referrer`, `utm_source`.
2. **`engage`** — al salir/ocultar la pestaña (`navigator.sendBeacon`, lo único confiable al
   cerrar, sobre todo en móvil). Manda: `duración` (seg), `# clics`, `% scroll máximo`.

El servidor completa desde headers: **IP** (`x-forwarded-for`), **país**
(`x-vercel-ip-country`), **dispositivo** (del User-Agent) y el **filtro de bots**.

Se cuenta **una sola visita por sesión de pestaña** (`sessionStorage`), idempotente.

---

## Modelo de datos en Redis

Zona horaria **America/Monterrey**. `DÍA` = `YYYY-MM-DD`. TTL de 400 días (~13 meses) en
todo lo que caduca; los totales (`lp:total`, etc.) son permanentes.

| Llave | Tipo | Contenido |
|---|---|---|
| `lp:total` | INCR | Vistas acumuladas (histórico) |
| `lp:new:total` / `lp:ret:total` | INCR | Vistas nuevas / de regreso, acumuladas |
| `lp:daily:DÍA` | INCR | Vistas por día |
| `lp:new:DÍA` / `lp:ret:DÍA` | INCR | Nuevas / regreso por día |
| `lp:unique:DÍA` | HLL | Visitantes únicos por día (`PFADD vid`) |
| `lp:visitors:all` | SET | Todos los `vid` vistos. `SCARD` = únicos histórico. Su `SADD` da nuevo(1)/regreso(0) en **un comando** |
| `lp:ref:DÍA` | HASH | Vistas por dominio de origen (referrer) |
| `lp:utm:DÍA` | HASH | Vistas por `utm_source` |
| `lp:geo:DÍA` | HASH | Vistas por país (ISO-2) |
| `lp:dev:DÍA` | HASH | Vistas por dispositivo (`mobile`/`desktop`/`tablet`) |
| `lp:eng:DÍA` | HASH | Sumas de duración/clics/scroll + `sessions` (para promedios) |
| `lp:visitor:VID` | HASH | Perfil: `first`, `last`, `visits`, `ip`, `ref`, `geo`, `dev`, `clk`, `dur` |
| `lp:visitor:VID:ips` | SET | Todas las IPs vistas de ese visitante |
| `lp:s:SID` | HASH | Registro individual de la visita: `vid`, `ts`, `ip`, `ua`, `ref`, `geo`, `dev`, `utm`, `new`, `dur`, `clk`, `scr` |
| `lp:ignore:ips` | SET | IPs excluidas del conteo (ej. la del equipo) |
| `lp:rl:<sha1(ip)>:<min>` | INCR | Ventana de rate-limit (expira sola en 90s) |

> **Nota:** no existe un "log plano gigante". El registro por visita (`lp:s:SID`) **es** el
> log crudo, pero con llave propia y TTL — misma info, keyspace acotado.

---

## Endpoints

- `POST /api/lp/visit` — registra evento (público). Body `{ t: 'view'|'engage', vid, sid, ... }`.
- `GET /api/lp/visit` — **público**, para el footer. Devuelve `{ total, new, returning, unique }`.
  Cacheado 60s (`Cache-Control`). El `total` incluye un **baseline de presentación**
  (`PUBLIC_BASELINE = 100000` en [api/lp/visit.js](../api/lp/visit.js)): el número visible del
  footer arranca en 100,000. Es solo cosmético — NO afecta los datos reales; el reporte admin
  (`?report=1`) sigue mostrando las visitas reales desde 0. Para cambiar el arranque, edita
  esa constante.
- `GET /api/lp/visit?report=1&days=30` — **admin**. Reporte completo: series diarias,
  engagement (duración/scroll promedio, clics), top referrers, países, dispositivos, UTM.
- `GET /api/lp/visit?ignoreme=1` — **admin**. Agrega TU IP actual a `lp:ignore:ips`.

---

## Exclusión propia (no contar mi equipo)

Doble candado:

1. **Por dispositivo (recomendado, robusto ante IP dinámica):** abre la landing con
   `https://www.candidatic.com/?notrack` una vez. Queda `localStorage.lp_optout` y ese
   navegador **nunca** vuelve a contar. (Para deshacer: borra `lp_optout` del navegador.)
2. **Por IP:** estando logueado como admin, abre
   `https://www.candidatic.com/api/lp/visit?ignoreme=1`. Toma tu IP actual y la agrega a
   `lp:ignore:ips`. Si tu IP cambia, repítelo.

---

## Por qué es barato

- **Bots se descartan ANTES de tocar Redis** (regex en memoria, familia `isbot`).
- **Rate-limit** por IP/minuto contra inflado por `curl` en loop.
- Cada latido es **un pipeline** = un round-trip. Los `EXPIRE` de llaves diarias solo se
  mandan la **1ª visita del día**.
- **Únicos por `vid`** (localStorage), no por hashear IP en cada visita.
- Contador del footer **cacheado 60s**.
- A ~10 visitas/día: ~4,000 llaves de detalle en estado estable y **~0.5 MB/mes** de
  tráfico — insignificante contra el consumo del resto del sistema.

El medidor de ancho de banda del proyecto (`redis-bandwidth.js`) refleja este consumo
automáticamente; **no** se creó ningún medidor paralelo.

---

## Privacidad (nota)

Por decisión de producto se guarda la **IP cruda** (en `lp:s:SID`, `lp:visitor:VID`,
`lp:visitor:VID:ips`). Los motores tipo Plausible NO la guardan (la hashean con salt
rotatorio por GDPR). El tráfico es MX y es un producto propio; queda documentado para que
la decisión sea consciente y reversible si algún día se requiere anonimizar.

---

## Pendiente (futuro, cuando se quiera)

- Dashboard visual del reporte completo (`?report=1`) — hoy solo existe el número del footer.
  Consumir el endpoint admin y graficar series + tops (estilo tarjeta "Ancho de Banda").
