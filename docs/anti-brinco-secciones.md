# Anti-brinco de secciones — caché stale-while-revalidate

**Fecha:** 2026-09-13
**Estado:** Implementado y verificado en producción en 6 secciones.

## El problema

El dashboard renderiza cada sección de forma **condicional** en `src/App.jsx`
(`activeSection === 'x' ? <XSection/> : ...`). Eso significa que al cambiar de tab
la sección anterior se **desmonta por completo** y, al volver, se **remonta desde cero**:

1. El componente arranca con su estado vacío (`loading = true`, listas `[]`, etc.).
2. Pinta un **skeleton**.
3. Dispara el fetch en `useEffect`.
4. Llega la data → el layout se **re-arma** y **salta** ("brinco").

Ese brinco es lo que se percibe feo al entrar/salir de una sección.

## La solución: stale-while-revalidate a nivel de módulo

Patrón estilo Amazon/Linear: **instant paint + silent revalidation**.

Se guarda la última data conocida en una variable a **nivel de módulo** (fuera del
componente). Como el módulo NO se recarga al desmontar/remontar el componente, esa
variable **sobrevive** al cambio de tab. Entonces:

- Los estados se **siembran** desde el caché con el inicializador perezoso de `useState`:
  ```jsx
  const [data, setData] = useState(() => cache || defaultValue);
  const [loading, setLoading] = useState(() => !cache); // sin skeleton si ya hay caché
  ```
- El `useEffect` de carga **siempre corre** y revalida en silencio; al terminar, **escribe
  el caché** para la próxima re-entrada:
  ```jsx
  if (res.success) { setData(res.data); cache = res.data; }
  ```
- Para mutaciones locales (crear/borrar/editar/reordenar) se **espeja** el estado al caché
  con un efecto, guardado para no sembrar vacío antes de la primera carga real:
  ```jsx
  useEffect(() => { if (cache) cache = data; }, [data]);
  ```

**Resultado:** la primera vez de la sesión sí se ve skeleton (una sola vez, inevitable);
todas las re-entradas pintan al instante lo último conocido, sin skeleton ni salto, y la
data se refresca por debajo.

> El caché vive lo que dura la pestaña del navegador (memoria del módulo). No se persiste
> en `localStorage` — es intencional: solo evita el brinco intra-sesión, no cachea entre
> recargas completas.

> ⚠️ **PITFALL frecuente (nos mordió en Proyectos, Bot IA y Usuarios):** sembrar el estado
> NO basta si la función de carga hace `setLoading(true)` (o `setIsInitialLoading(true)`,
> `setLoadingTemplates(true)`, etc.) al arrancar. Ese `useEffect` corre en cada montaje y
> **re-enciende el skeleton/spinner encima de lo sembrado**, anulando el caché. SIEMPRE hay
> que guardar ese seteo: `if (!cache) setLoading(true);`. Cuidado con loaders secundarios
> (spinner de una sub-lista) y con verificar contra una sonda que sí distinga el estado real
> (p.ej. `main.innerText` NO incluye el valor de un `<textarea>`, y hay pulsos decorativos
> permanentes que no son skeletons — pueden dar falsos positivos/negativos).

## Dónde está aplicado

| Sección | Componente | Qué se cachea |
|---|---|---|
| Candidatos | `src/components/CandidatesSection.jsx` (`sectionCache`) | candidatos, stats, totalItems, fields, gráfica diaria |
| Chat Web | `src/components/ChatSection.jsx` (`chatSectionCache`) | lista de chats de la **vista por defecto** (filtro `unread`, sin tag/búsqueda/filtros locales) |
| Flows | `src/components/flows/FlowsGallery.jsx` (`flowsCache`) | galería de flujos (+ espejo en activar/borrar/crear) |
| Settings · WhatsApp | `src/components/WhatsAppSettings.jsx` (`whatsappStatusCache`) | estado de Meta Cloud API |
| Settings · GPT | `src/components/GPTSettings.jsx` (`gptConfigCache`, `gptStatusCache`) | config + veredicto de validación (no re-valida en cada entrada) |
| Settings · Ancho de banda | `src/components/RedisBandwidthSettings.jsx` (`bandwidthCache`) | gráfica de ancho de banda |
| Vacantes | `src/components/VacanciesSection.jsx` (`vacanciesCache`, `categoriesCache`) | vacantes + categorías (+ espejo en mutaciones locales) |
| Proyectos | `src/components/CRMProjectsSection.jsx` (`projectsCache`, `activeProjectCache`, `projectCandidatesCache`) | lista de proyectos, proyecto activo y candidatos por proyecto |
| Bot IA | `src/components/BotIASection.jsx` (`botIACache`) | config del bot (settings + gptConfig + templates) |
| Estadísticas de Ads | `src/components/AdsStatisticsSection.jsx` (`adsStatsCache`, `adsLabelsCache`) | stats de la vista por defecto (sin archivadas, rango `today`) + etiquetas |
| Usuarios | `src/components/UsersSection.jsx` (`usersSectionCache`) | usuarios, roles, proyectos, tags, números de WA |
| Bolsa (App) | `src/components/BolsaSection.jsx` (`bolsaJobsCache`, `bolsaEmpresasCache`) | vacantes y empresas (ambos tabs) |
| Notificaciones | `src/components/NotificacionesSection.jsx` (`notifCache`) | stats + tokens de push |
| Biblioteca | `src/components/MediaLibrarySection.jsx` (`mediaAssetsCache`) | assets multimedia |
| Agent IA | `src/components/AgentIASection.jsx` (`agentIACache`) | config del agente (el panel en vivo/cola NO se cachea, es tiempo real) |
| Envíos Masivos | `src/components/BulksSection.jsx` (`facetCache`, `audienceCache`) | facetas/preview + públicos (los cachés ya existían; se sembraron los flags de loading y se hizo silenciosa la revalidación de montaje) |

### Refinamientos extra en Candidatos (además del caché)

El brinco de Candidatos tenía dos causas más, arregladas en el mismo cambio:

1. **`tabular-nums`** en todas las métricas vivas (Total, Completos/Incompletos, CTR,
   Entrantes, Enviados, total diario). Dígitos de ancho fijo → al actualizarse por SSE
   el número cambia **en su lugar**, sin empujar los badges de al lado (sin tironeo).
2. **Barras de "Capturas por día"** con transición de altura (`transition-[height]`) para
   que un incremento por SSE anime suave en vez de saltar; además la gráfica diaria se
   cachea (con su rango) para no hacer loader→barras al re-entrar.

### Notas de alcance por sección

- **Chat Web:** el caché es deliberadamente acotado a la **lista** (panel izquierdo). NO
  toca mensajes, chat abierto ni la maquinaria frágil de freeze-while-engaged / anclaje de
  scroll / dedup. Solo se cachea la vista por defecto para que la lista sembrada siempre
  cuadre con la UI (que al montar arranca en `unread`). Verificado que el freeze de la lista
  sigue intacto bajo SSE (ver más abajo).
- **Proyectos:** se cachea la estructura del tablero (proyectos + proyecto activo +
  candidatos por proyecto) para que el Kanban aparezca al instante; los candidatos del
  proyecto activo revalidan solos vía el `useEffect([activeProject?.id])` existente.

## Verificación (producción, medición programática frame por frame)

Metodología: con el navegador ya logueado, se hace clic en la sección y se sondea el DOM
cada frame (`requestAnimationFrame`) midiendo en cuántos ms aparece el contenido real y si
se ve un skeleton antes. La re-entrada se mide tras haber entrado una vez (caché poblado).

| Sección | Re-entrada | Skeleton previo |
|---|---|---|
| Chat Web (**antes**, código viejo) | 164 ms | **Sí** ← el brinco |
| Candidatos | 33 ms | No |
| Chat Web | 25 ms | No |
| Flows | 16 ms | No |
| Settings | 22 ms | No |
| Vacantes | 12 ms | No |
| Proyectos | instantáneo | No (tras corregir el pitfall del loader) |
| Envíos Masivos | instantáneo (ratio 0.96) | No |
| Estadísticas de Ads | instantáneo (ratio 1.0) | No |
| Bolsa | instantáneo (ratio 1.0) | No |
| Notificaciones | instantáneo (ratio 1.0) | No |
| Usuarios | instantáneo (ratio 1.0) | No |
| Bot IA | contenido principal instantáneo | No (queda spinner de la lista de plantillas — endpoint de Meta, carga aparte) |
| Agent IA | config instantánea | El spinner que se ve es el panel EN VIVO / cola, que a propósito no se cachea |

> Nota de método: medir "re-entrada" contando `main.innerText` puede engañar — el valor de
> los `<textarea>` no cuenta y hay pulsos decorativos. La sonda fiable es contar el elemento
> real del contenido (fila/tarjeta/textarea) y detectar el spinner/skeleton específico de esa
> sección.

### Estabilidad de la lista de Chat Web bajo SSE (regresión clave)

Se simuló un mensaje entrante real (evento `sse:candidate:update`) para un candidato de
la lista estando **engaged** (chat abierto). Resultado:

- El dato **sí se aplicó** (su `ultimoMensaje` pasó a "ahora").
- El orden visible **no cambió** y el scroll **no se movió** (freeze-while-engaged intacto).

Es decir: el caché **no rompió** la maquinaria de estabilidad de la lista.

## Caveat operativo: service worker / PWA

La app es PWA con service worker (workbox precache). Tras un deploy, el navegador sigue
sirviendo el **bundle viejo del precache** hasta que el SW se actualiza (normalmente en la
siguiente visita). Por eso, al verificar en producción justo después de un deploy hay que
forzar la actualización (desregistrar el SW + limpiar `caches`, sin tocar `localStorage`
para no perder la sesión) y recargar. Para usuarios reales el bundle nuevo entra solo en la
siguiente visita — puede haber un desfase de una carga. No es un bug introducido por este
trabajo.

## Cómo aplicarlo a una sección nueva

Si en el futuro se agrega una sección que carga datos al montar y "brinca" al re-entrar:

1. Declarar el caché **fuera** del componente: `let miCache = null;`
2. Sembrar los estados: `useState(() => miCache || defecto)` y `useState(() => !miCache)`
   para el `loading`.
3. **Guardar TODO seteo de loading en el loader** (ver el pitfall de arriba):
   `if (!miCache) setLoading(true);` — incluye loaders secundarios (spinners de sub-listas).
4. Escribir el caché al terminar el fetch: `miCache = data;`
5. Si hay mutaciones locales, espejar: `useEffect(() => { if (miCache) miCache = data; }, [data]);`
6. Verificar en producción con una sonda que distinga el estado REAL (no `innerText` a secas)
   y recordar el caveat del service worker.

## Commits

- `9e8651e6` — Candidatos (caché + tabular-nums + barras diarias)
- `aba67089` — Candidatos (comentario resumen)
- `451bfa4e` — Chat Web
- `c7cd4e59` — Flows + Settings (4 componentes)
- `900fa232` — Vacantes + Proyectos
- `029633a3` — doc inicial
- `5fc7eafe` — Bot IA, Ads, Usuarios, Bolsa, Notificaciones, Biblioteca, Agent IA, Envíos Masivos
- `0baef7e3` — fix guard loader Bot IA + Usuarios
- `4c48895a` — fix spinner de plantillas Bot IA
- `8a68528c` — fix guard loader Proyectos (el que veías brincar)
