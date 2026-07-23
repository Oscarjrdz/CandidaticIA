# Auditoría de estabilidad visual — Chat Web (Claude)

**Fecha:** 2026-07-23
**Alcance:** estabilidad visual de la sección Chat Web — parpadeos, inyección de mensajes, renderizado, scroll, memoización.
**Método:** análisis profundo de código (`src/components/ChatSection.jsx`, `src/components/chat/MessageBubble.jsx`). La observación en navegador (Playwright MCP) quedó **bloqueada**: la sesión de candidatic.com expiró durante la auditoría y no fue posible re-loguear sin el usuario. De todos modos, los parpadeos/animaciones en vivo no se aprecian en capturas estáticas, así que el peso del análisis está en el código.

> ⚠️ **Nada de esto está desplegado.** Son hallazgos y parches **recomendados** para que Oscar los revise, aplique y verifique. No se tocó `ChatSection.jsx` durante la auditoría (para no dejar cambios sin verificar mientras estaba fuera). Este documento es el único archivo nuevo.

---

## Veredicto general

**El pipeline de renderizado del chat está muy bien blindado.** La mayoría de las causas clásicas de parpadeo ya están resueltas (varias en rondas previas). Lo confirmado como sólido:

- **Keys estables que sobreviven al temp→confirmado** (`getStableMessageKey` + `_clientKey` propagado en cada merge). Una burbuja optimista no se remonta cuando llega el eco del servidor.
- **Caché por firma en `displayMessages`** (`displayMessageCacheRef`): solo las burbujas cuya firma cambió reciben una referencia nueva; el resto conserva la misma referencia → no re-renderizan.
- **Dedup por ventana de 3 min** (`areSameOutgoingMessage`) + protección de tiempo anclado (`_clientAnchoredTime`): el eco del servidor no inyecta duplicados ni "brinca" la burbuja aunque el reloj de la PC esté desfasado.
- **Animación de entrada anti-replay**: `playedEntryAnimations` (Set a nivel de módulo) + `entryAnimationDecisionRef` bloquean que la animación se re-dispare en re-renders o en el eco. Confirmado: no re-anima al cambiar status.
- **Altura de imagen reservada** (`w-[260px] aspect-square` con placeholder): la burbuja no hace reflow cuando la imagen carga.
- **Animación de fila con `clip-path`** (no cambia altura → Virtuoso no re-mide).
- **Guard de rank en `messageStatusUpdate`**: ignora downgrades y devuelve `prev` sin cambio → no re-renderiza de más.
- **`alignToBottom`** (fix reciente): listas cortas ancladas al fondo.
- **Header/Footer de Virtuoso izados fuera del render** (fix reciente): no se remontan.
- **`messagesGrew`**: evita el scroll-to-bottom en re-renders que solo cambian una palomita.

Los hallazgos de abajo son **refinamientos**, no fallas graves. Ordenados por impacto.

---

## Hallazgo A — [MEDIA] Un mensaje entrante te jala al fondo aunque estés leyendo historial

**Síntoma:** el reclutador sube a leer mensajes viejos; entra un mensaje del candidato (o de otro reclutador) por SSE → la vista **salta al fondo** de golpe. WhatsApp real NO hace esto: muestra la píldora "mensajes nuevos" y te deja donde estás.

**Causa raíz:** en el handler de `newMessage` por SSE, `scrollToBottom()` se llama **incondicionalmente**, sin respetar si el usuario está al fondo:

`src/components/ChatSection.jsx` ~líneas 2480–2499:
```js
setMessages(prev => {
    const newMsg = sseUpdate.updates.messagePayload;
    ...
    if (newMsg.from === 'me') {
        const pendingIndex = prev.findIndex(m => String(m.id).startsWith('temp') && areSameOutgoingMessage(m, newMsg));
        if (pendingIndex !== -1) {
            const newArr = mergeOutgoingMessage(prev, newMsg, prev[pendingIndex].id);
            scrollToBottom();               // ← incondicional
            return newArr;
        }
        ...
    }
    scrollToBottom();                       // ← incondicional (mensaje entrante)
    return [...prev, withMessageEntryAnimation(newMsg)];
});
```

Esto **contradice** la lógica de `totalListHeightChanged` (líneas ~4990), que sí respeta `isAtBottomRef.current`. La infra de "no estás al fondo" ya existe (`isAtBottomRef`, `showScrollBtn`, `unseenCount`, botón flotante de scroll) — pero este `scrollToBottom()` directo la salta.

**Fix recomendado (mínimo, consistente con el patrón existente):**
```js
// eco de nuestro propio envío: al fondo o mientras enviamos, sí baja
if (pendingIndex !== -1) {
    const newArr = mergeOutgoingMessage(prev, newMsg, prev[pendingIndex].id);
    if (isAtBottomRef.current || isSendingRef.current) scrollToBottom();
    return newArr;
}
...
// mensaje entrante / de otro reclutador: solo baja si ya estabas al fondo
if (isAtBottomRef.current || isSendingRef.current) scrollToBottom();
return [...prev, withMessageEntryAnimation(newMsg)];
```
(Opcional: en el `else`, `setUnseenCount(c => c + 1)` para alimentar la píldora — pero `atBottomStateChange` ya muestra el botón de scroll cuando no estás al fondo, así que no es imprescindible.)

**Riesgo del fix:** bajo. `isAtBottomRef` lo mantiene al día `atBottomStateChange`, y `totalListHeightChanged` ya usa exactamente este mismo criterio. Si algo, el riesgo es que un mensaje propio recién enviado no baje — pero `isSendingRef` cubre ese caso.

**Cómo verificar (runtime):** abrir un chat largo, subir a leer historial, y hacer que entre un mensaje (o simular). No debe saltar al fondo; debe aparecer el botón/píldora de scroll. Enviar un mensaje propio SÍ debe bajar.

---

## Hallazgo B — [BAJA-MEDIA · rendimiento] `allMessages={messages}` rompe la memoización de todas las burbujas visibles

**Síntoma:** no es parpadeo directo (React no repinta DOM idéntico), pero en chats grandes, durante un envío con varias imágenes (~12 cambios de status en pocos segundos), **todas las burbujas visibles se re-renderizan en cada cambio** → posible jank/caída de frames.

**Causa raíz:** `src/components/ChatSection.jsx` ~línea 5034:
```jsx
<MessageBubble ... allMessages={messages} />
```
`messages` cambia de referencia en cada actualización de estado. `MessageBubble` es `React.memo`, así que un `allMessages` con referencia nueva rompe la comparación y re-renderiza. Y `allMessages` **solo se usa** para resolver el mensaje citado (`MessageBubble.jsx:189`):
```js
const quotedMsg = allMessages.find(m => m.id === q.stanzaId || m.ultraMsgId === q.stanzaId);
```

**Fix recomendado (una de dos):**
1. **Mapa memoizado** (menos invasivo): construir un `Map` id/ultraMsgId→msg memoizado por `messages` y pasarlo estable. Aun así cambia de referencia cuando `messages` cambia, así que no elimina el problema del todo.
2. **Resolver la cita en el memo de `displayMessages`** (recomendado): calcular el texto citado ahí y guardarlo en el propio item (p.ej. `item._quotedResolved`), y **quitar `allMessages`** de `MessageBubble`. Así la burbuja solo depende de `msg`, y la caché por firma ya la estabiliza. Requiere añadir el campo citado a la firma.

Menor relacionado: `reactionPopupId={reactionPopupId}` también se pasa a todas las burbujas → al abrir un popup de reacción se re-renderizan todas las visibles. Se podría pasar `isReactionOpen={reactionPopupId === msg.id}` (booleano) para que solo la afectada cambie.

**Riesgo del fix:** medio (toca la vista de "respondiendo a…"). Verificar que las citas se sigan viendo bien.

---

## Hallazgo C — [BAJA] El indicador de "escribiendo…" vive en el flujo flex y redimensiona el viewport de mensajes

**Síntoma:** cuando el candidato empieza/deja de escribir, aparece/desaparece la burbuja de typing (~40px). Como está **debajo de Virtuoso en la misma columna flex**, cambiar su altura reduce/agranda el viewport de la lista anclada al fondo → posible micro-salto de 1 frame. **Es exactamente la misma clase de bug** que la tira de preview de imágenes que ya se arregló volviéndola overlay absoluto.

**Causa raíz:** `src/components/ChatSection.jsx` ~línea 4981:
```jsx
{candidateTyping && (
    <div className="flex justify-start px-[5%] py-1 z-10 shrink-0"> ... </div>
)}
```

**Fix recomendado:** renderizar el indicador como **overlay absoluto** justo por encima del input (dentro de un contenedor `relative`), fuera del flujo flex — igual que se hizo con la tira de imágenes pendientes. Montar/desmontar dejaría de cambiar la altura de la lista.

**Riesgo del fix:** bajo. Es cosmético y ya hay precedente del mismo patrón en el repo.

---

## Hallazgo D — [BAJA · code smell] `scrollToBottom()` dentro del updater de `setMessages`

**Causa raíz:** líneas 2491 y 2497 llaman `scrollToBottom()` (efecto con `requestAnimationFrame`) **dentro** de la función updater de `setMessages`. Los updaters deberían ser puros. Funciona en producción hoy, pero:
- Con StrictMode/concurrent (dev) el updater se invoca dos veces → dos rAF (inofensivo hoy).
- Es frágil ante features concurrentes futuras.

**Fix recomendado:** mover la decisión de scroll fuera del updater (calcular si hay que bajar, hacer el `setMessages` puro, y llamar `scrollToBottom()` después). Se puede combinar con el fix del Hallazgo A. **Riesgo:** bajo, pero no urgente.

---

## Menores / perf (no urgentes)

- **`_formattedHtml` se recomputa para todos los mensajes en cada recálculo de `displayMessages`** (`ChatSection.jsx:3743`, `formatWhatsAppText` es regex-pesado), aunque la caché por firma luego descarte el objeto para los no cambiados. Se podría calcular `_formattedHtml` **después** del chequeo de caché (solo para firmas nuevas). Ahorro en chats grandes con SSE frecuente.
- **`sortMessagesChronologically`** corre O(n log n) en cada `mergeMessageList` y en cada `displayMessages`. Aceptable, pero en chats de cientos de mensajes suma. No tocar salvo que se note.
- **Abrir/cerrar paneles laterales (CRM / Banco)** cambia el **ancho** de la lista → las burbujas re-fluyen (el texto se re-parte) → Virtuoso re-mide. Es un reflow esperado al abrir un panel; si se quisiera perfección, se podría anclar el scroll antes/después del cambio de ancho. Baja prioridad.

---

## Pendiente de verificación en runtime (requiere sesión iniciada)

- **Errores de consola en Chat Web:** durante la observación por navegador se vieron contadores de "Console: 4 errors, 1 warnings" en la vista de Chat Web, pero no se capturaron los detalles antes de que expirara la sesión. **Acción sugerida:** con sesión iniciada, abrir Chat Web y revisar consola (o pedirme que lo haga con el navegador MCP ya logueado) para descartar que alguno indique un problema real de render/red.
- Confirmar Hallazgos A y C con interacción real (scroll arriba + mensaje entrante; candidato escribiendo).

---

## Orden de aplicación sugerido

1. **Hallazgo A** (el más notorio para el usuario, fix chico y de bajo riesgo).
2. **Hallazgo C** (overlay del typing — cosmético, patrón ya conocido en el repo).
3. **Hallazgo B** (perf; hacerlo cuando haya tiempo, requiere probar las citas).
4. **Hallazgo D** + menores (limpieza, combinar con A).

Todos son cambios de front-end verificables en local con `npm run build` + prueba manual en el chat. Ninguno toca Redis ni el envío real, así que son seguros de probar sin afectar candidatos.
