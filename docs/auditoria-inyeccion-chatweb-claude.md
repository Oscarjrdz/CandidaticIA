# Auditoría de inyección de mensajes — Chat Web · objetivo: nivel WhatsApp nativo

**Fecha:** 2026-07-29
**Alcance:** la experiencia de **inyección de mensajes** en el chat: tecleo humano, banco de respuestas, info de vacantes, plantillas; con/sin mensajes previos, con/sin imágenes, con/sin stickers.
**Método:** análisis de código + **verificación EN VIVO** con sesión iniciada (Playwright), midiendo scroll, layout y timing reales. **No se enviaron mensajes reales** (eso llegaría a candidatos por WhatsApp); el acto de enviar se auditó por código + medición del DOM. Los caminos que solo inyectan al input (banco, vacante) sí se probaron en vivo.

---

## Veredicto

La base es sólida (dedup, keys estables, altura de imagen reservada, apertura anclada al fondo). Pero hay **3 gaps concretos** que hacen que la inyección no se sienta "WhatsApp nativo". El #1 es visible y molesto.

---

## 🔴 Hallazgo 1 — [ALTO · confirmado en vivo] Al inyectar, el input crecido + el preview TAPAN el último mensaje

**Qué se ve:** al inyectar un banco de respuestas largo (o teclear varias líneas), el input crece (medido: de ~36px a **144px**) y, si trae imágenes, aparece la tira de preview encima (~72px). **La lista de mensajes NO sube para compensar**, así que el último mensaje queda **cubierto** por el input y el preview.

**Evidencia en vivo (chat de Martha Garcia):**
- Antes de inyectar: `distanceFromBottom = 0` (anclado al fondo ✓), último globo en `top=822`, input en `top=902`.
- Después de inyectar banco con 3 imágenes: input creció a `top=798` (subió 104px), preview overlay en `top=730`, pero el último globo **siguió en `top=822`** → quedó **detrás** del input/preview. `distanceFromBottom` pasó de 0 → **104px**.
- Captura confirmó: el mensaje "...comedor subsidiado" queda cortado bajo la tira de preview.

**Causa raíz (doble):**
1. **Input in-flow que crece:** el `<textarea>` multilínea crece y encoge el viewport de Virtuoso (`flex-1`), pero nada re-scrollea al fondo al cambiar de altura (el navegador no reajusta `scrollTop` en resize, y `followOutput` de Virtuoso solo dispara en cambio de datos, no de tamaño). Ver `MessageInputBox.jsx` (auto-grow del textarea) y el layout en `ChatSection.jsx`.
2. **Preview overlay absoluto:** la tira de imágenes pendientes es `absolute bottom-full` ([ChatSection.jsx ~5104](../src/components/ChatSection.jsx)) — se hizo así a propósito para no reflowear al enviar (evitaba un parpadeo), pero al estar fuera de flujo **flota sobre** los mensajes y los tapa.

**Native WhatsApp:** cuando el input crece o aparece un preview de adjunto, la conversación **sube** para que el último mensaje quede justo encima del input. Nunca se tapa.

**Fix recomendado:** cuando cambie la altura efectiva de la zona de input (textarea multilínea **o** aparición/cambio del preview), si el usuario está al fondo → `scrollToBottom()` para re-anclar. Dos piezas:
- Emitir un callback de "cambió mi altura" desde `MessageInputBox` (en el auto-grow del textarea) y desde el efecto de `pendingQrImages`, que llame a `scrollToBottom()` si `isAtBottomRef.current`.
- Para el preview overlay: como es absoluto, además de re-scrollear, reservar espacio equivalente al fondo de la lista mientras esté visible (p.ej. `padding-bottom` dinámico en el contenedor de mensajes = alto del overlay), para que el último mensaje suba en vez de quedar tapado. Alternativa más nativa: volver el preview a in-flow y re-anclar al fondo en cada cambio (con el `scrollToBottom` de arriba ya no reintroduce el parpadeo original, porque el ancla se mantiene).

**Riesgo:** medio (toca scroll + input). **Verificable en vivo SIN enviar** (inyectando banco), así que se puede validar con mediciones.

---

## 🟠 Hallazgo 2 — [MEDIO] La animación de entrada es lenta y no se siente nativa

**Medido en vivo (CSS real en prod):**
- `chat-message-row-enter`: **0.4s** `cubic-bezier(.1,0,.4,1)` — keyframe `clip-path: inset(0 0 100%) → none` (revela la fila de arriba hacia abajo).
- `chat-message-enter-outgoing`: 60ms ease-out con **delay 0.4s** — `translateX(24px)→0` + opacity.
- Total ≈ **460ms**, dominado por el "revelado" vertical de 400ms.

**Native WhatsApp:** el globo aparece **casi al instante**, con un slide/fade ágil (~150–220ms), leve desplazamiento (~8–12px) y a veces micro-escala. No hay un "desplegado" vertical de 400ms.

**Fix recomendado (tunear, sin reflow):** la lista ya reserva la altura del item (por eso usaron clip-path), así que se puede animar el **globo** con opacity+translate sin reflowear:
- Bajar `row-enter` a ~180–220ms (o eliminarlo y dejar solo el globo).
- Globo: `~160ms ease-out`, delay ~120ms, `translateY(6px)+translateX(10px)→0` + opacity, opcional `scale(.98→1)`.
- Total objetivo ~250–300ms, snappy. Respetar `prefers-reduced-motion` (ya lo hacen).

**Riesgo:** bajo (solo CSS/timing). Verificable visualmente por el usuario.

---

## 🟠 Hallazgo 3 — [MEDIO · ya documentado] Un mensaje entrante te jala al fondo aunque leas historial

Confirma el Hallazgo A del informe de estabilidad: el `newMessage` por SSE llama `scrollToBottom()` incondicional ([ChatSection.jsx ~2491/2497](../src/components/ChatSection.jsx)). Relevante aquí porque rompe la sensación nativa durante una conversación activa. **Fix:** guardar con `isAtBottomRef.current || isSendingRef.current`.

---

## ✅ Lo que YA está a nivel nativo (no tocar)

- **Apertura de chat anclada al fondo** — medido `distanceFromBottom=0`. ✓
- **Imágenes reservan 260×260** (placeholder gris) → sin reflow al cargar. ✓ (`MessageBubble.jsx:127`)
- **Stickers** 100×100 `object-contain`. ✓
- **Keys estables** temp→confirmado (sin remount), **dedup** por ventana de 3 min, **caché por firma** de displayMessages. ✓
- **`alignToBottom`** para listas cortas. ✓
- **Transición de imagen** con overlay cross-fade (`SmoothMediaImage`). ✓

## Notas / descartados

- **"Errores" de consola:** solo `SSE error (singleton): Event` = reconexiones normales del EventSource. **Benignos.**
- **Dos `virtuoso-scroller`:** son la lista de chats (izq) + la lista de mensajes (centro), ambas Virtuoso. **No** es render doble de mensajes.
- **injectText** de banco/vacante antepone `\n\n` si ya hay texto en el input (`MessageInputBox.jsx`): si el reclutador ya tecleó algo, la inyección se concatena; revisar si es el comportamiento deseado (nativo-ish, pero puede sorprender).

---

## Plan priorizado para "elevar a nivel WhatsApp nativo"

1. **Hallazgo 1 (re-anclar al fondo cuando crece input/preview)** — el más visible; verificable en vivo sin enviar. **Empezar aquí.**
2. **Hallazgo 2 (animación de entrada snappy)** — alto impacto en "feel", bajo riesgo, solo CSS/timing.
3. **Hallazgo 3 (no jalar al fondo en entrante mientras se lee)** — pulido de conversación activa.

Los tres son front-end, verificables en local con `npm run build` + prueba manual (y el #1/#2 los puedo validar en vivo por navegador sin enviar mensajes reales). Ninguno toca Redis ni el envío.
