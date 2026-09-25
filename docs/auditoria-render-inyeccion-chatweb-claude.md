# Auditoría — Render + inyección de mensajes del Chat Web (Claude)

**Fecha:** 2026-09-24
**Alcance:** cómo se **arma y renderiza** la UI del chat; cómo se **inyectan** los mensajes de **todas** las fuentes (tecleo, banco de respuestas, vacantes, plantillas, adjuntos, "meter a un flujo"); comportamiento con **varios reclutadores** y con **mensajes entrantes**. Foco en los síntomas reportados: brincos/parpadeos y **el relojito ⏳ que no se quita hasta salir y volver a entrar** en mensajes inyectados desde banco y desde flujos.
**Método:** lectura profunda de código (`ChatSection.jsx`, `MessageBubble.jsx`, `MessageStatusTicks.jsx`, `api/chat.js`, `api/utils/storage.js`, `api/utils/flow-engine.js`). No se corrió el navegador (requiere sesión iniciada). Los hallazgos marcados **[CONFIRMADO]** salen de asimetrías claras en el código; los **[SOSPECHA]** requieren verificación en vivo.

> ⚠️ **Nada de esto está aplicado todavía.** Es un informe para que Oscar decida qué arreglar. No se tocó código.

---

## Resumen ejecutivo (la causa de fondo)

Hay **una sola causa raíz** detrás del "relojito que no se quita hasta re-entrar", y explica los tres casos: banco visto por otro reclutador, **flujo metido desde el chat**, y ráfagas de varios mensajes.

**El `messageStatusUpdate` (queued→sent) se aplica SÍNCRONO, pero el `newMessage` que lo precede se BUFFEREA y se aplica un frame después (`requestAnimationFrame`).** Cuando los dos eventos SSE caen en el mismo frame (común en alto tráfico y en ráfagas de flujo), el status llega **antes** de que su mensaje exista en la lista, no encuentra a quién actualizar, y **se descarta**. El mensaje entra después con `status:'queued'` → **relojito pegado** hasta que `loadMessages` relee de Redis al re-entrar (donde ya está `sent`).

- Al **remitente** de un banco/tecleo normal **no** le pega, porque la **respuesta del POST** (`deliverOutboxJob → mergeOutgoingMessage`) es la fuente de verdad y arregla el status cuando regresa.
- Le pega a **cualquiera que NO envió**: otros reclutadores viendo el mismo chat, y —lo importante— **al propio reclutador que "mete a un flujo"**, porque ese camino **no** inserta optimista ni recibe respuesta de POST: depende 100% del SSE.

Todo lo demás del pipeline (dedup, keys estables, temp→confirmado, firma con status) está **bien blindado**. El problema es la **asimetría de timing** entre los dos eventos SSE.

---

## Parte 1 — Cómo se arma y renderiza la UI

### Componentes
- **`ChatSection.jsx`** (~7.100 líneas): orquesta todo — lista de chats (izq, Virtuoso), lista de mensajes (centro, Virtuoso), banco de respuestas, CRM, envío, SSE.
- **`chat/MessageBubble.jsx`**: la burbuja. Animación de entrada + palomitas + media + citas + reacciones.
- **`chat/MessageStatusTicks.jsx`**: el ícono de status. `pending`/`queued` → **reloj girando** ⏳; `sent` → 1 palomita; `delivered` → 2 grises; `read`/`seen` → 2 azules; `failed` → ⚠️.
- **`chat/MessageInputBox.jsx`**: input auto-crecible; emite `onHeightChange` para re-anclar al fondo.

### Flujo de datos de un mensaje hacia la burbuja
1. `messages` (estado) → 2. `displayMessages` (useMemo): ordena cronológico, dedup de salientes, separadores de fecha/no-leídos, `isFirstInSeries`, propaga `read` hacia atrás, y **cachea por firma** (`displayMessageCacheRef`) para dar referencia nueva **solo** a las burbujas que cambiaron. **La firma incluye `status`** (línea ~4841) → un cambio de palomita SÍ re-renderiza esa burbuja. ✓
3. Virtuoso monta las visibles; `getStableMessageKey` usa `_clientKey` (sobrevive al swap temp→real → **no remonta**). ✓

### El "reloj de entrada" de 800 ms (por diseño, no es bug — pero conviene entenderlo)
`MessageBubble` **fuerza** `displayStatus='pending'` (reloj) durante `OUTGOING_STATUS_REVEAL_MS = 800ms` al entrar cualquier burbuja propia, y luego revela el status real (`heldStatusAnimationKey`, líneas 186–267). Imita a WhatsApp (reloj un instante → palomita). **Es sólido para el remitente**: el timer se dispara una vez (deps estables) y, si remonta, `playedEntryAnimations` evita re-animar y deja ver el status real. **No es la causa del relojito pegado** (ese dura hasta re-entrar, no 800 ms).

---

## Parte 2 — Cómo inyecta cada fuente (y quién reconcilia el status)

| Fuente | Camino | Optimista | Quién quita el relojito |
|---|---|---|---|
| **Tecleo normal** | `handleSend` → outbox → `deliverOutboxJob` | sí (`temp-…`, pending) | **respuesta POST** `mergeOutgoingMessage(…, tempId)` ✓ |
| **Banco texto/imagen** (inyecta al input o botón verde `sendBankReplyDirect`) | igual que tecleo (`handleSend`) | sí | **respuesta POST** ✓ |
| **Banco ubicación/audio/documento** | `handleApplyQuickReply` (POST directo) | sí (pending) | **respuesta POST** ✓ |
| **Vacante** | `injectText` / `sendVacancyDirect` → `handleSend` | sí | **respuesta POST** ✓ |
| **Plantilla oficial** ⚡ | `handleSendTemplate` (POST directo) | sí | **respuesta POST** ✓ |
| **Adjunto (📎 subir archivo)** | upload + POST | sí (`temp_…`, queued) | **respuesta POST** ✓ |
| **"Meter a un flujo"** (menú del header) | `handleRunCandidateFlow` → `runFlowListItem` (server-side) | **NO** | **solo SSE** ⚠️ (aquí pega el bug) |
| **Entrante del candidato / eco de otro reclutador** | SSE `newMessage` (bufferizado, rAF) | n/a | server manda el status; se actualiza por SSE ⚠️ |

**Clave:** todas las fuentes que **el propio reclutador dispara con un POST** están protegidas por la respuesta del POST. Las que llegan **solo por SSE** (flujo metido desde el chat, y todo lo que ven los **otros** reclutadores) dependen del `messageStatusUpdate` — que es justo el que se puede perder (Hallazgo 1).

---

## Hallazgos

### 🔴 Hallazgo 1 — [CONFIRMADO · ALTO] El `messageStatusUpdate` se pierde por carrera con el `newMessage` bufferizado → relojito pegado
**Síntoma:** el reloj ⏳ no se quita hasta salir y volver a entrar, en (a) mensajes que ven **otros reclutadores** y (b) mensajes de un **flujo metido desde el chat**.

**Evidencia en código:**
- `newMessage` se **bufferea** y se aplica en `requestAnimationFrame` (coalescing): `ChatSection.jsx` líneas 3359–3382 (`pendingSseMsgsRef.current.push(...)` + `scheduleSseFlush()` → `flushPendingSseMessages`).
- `messageStatusUpdate` se aplica **síncrono** en el mismo handler: líneas 3336–3349 (`setMessages(prev => { const idx = prev.findIndex(...); if (idx===-1) return prev; ... })`).
- Server (orden real): `api/chat.js` guarda con `status:'queued'` y **sin `ultraMsgId`** (`saveMessage`, línea 454) → dispara `newMessage`. Después manda a Meta y hace `updateMessageStatus(…, 'sent', {ultraMsgId})` (línea 652) → dispara `messageStatusUpdate` con `id = id interno` (el 2º arg del update; `notifyStatus` usa ese id, `storage.js` 2557–2562). Lo mismo hace el **motor de flujos**: `flow-engine.js` 313–316 (`saveMessage {status:'queued'}` → `updateMessageStatus(saved.id, 'sent')`).

**Por qué se pierde:** aunque el server emite `newMessage` **antes** que `messageStatusUpdate`, en el cliente el `newMessage` queda **esperando el rAF** y el `messageStatusUpdate` corre **de inmediato**. Si ambos llegan en el mismo frame (ráfaga de flujo, alto tráfico), el `findIndex` del status **no halla** el mensaje (aún está en el buffer) → `return prev` (descartado). Luego el rAF inserta el mensaje con `status:'queued'` → **reloj pegado**. No llega otro status (el 'sent' ya se emitió y se perdió) → se queda así hasta que `loadMessages` relee al re-entrar.

**Por qué el remitente normal NO lo sufre:** su `deliverOutboxJob` mergea la **respuesta del POST** (status `sent`) por `tempId`/id → arregla el status aunque el SSE se haya perdido. El que **mete a un flujo** SÍ lo sufre porque `handleRunCandidateFlow` **no** inserta optimista ni tiene POST de mensaje (solo dispara el flujo) → depende solo del SSE.

**Fix recomendado (robusto, opción B):** buffer de status pendientes en el cliente (espejo del `message:pendingStatus` que ya existe en el server). Cuando `messageStatusUpdate` no encuentra destino (`idx===-1`), guardarlo en un `Map` por `id`; en `applyIncomingMessageToList`/`flushPendingSseMessages`, al insertar un mensaje cuyo `id`/`ultraMsgId` esté en ese Map, aplicarle el status pendiente y limpiarlo. Cubre cualquier orden de llegada, incluso si el `newMessage` cae en un batch posterior.

**Fix alternativo (más simple, opción A):** enrutar `messageStatusUpdate` por el **mismo** `pendingSseMsgsRef` + rAF que `newMessage`, aplicando ambos en orden de llegada dentro de `flushPendingSseMessages`. Corrige la carrera del mismo frame (que es el caso real), no la de batches separados.

**Riesgo:** bajo-medio (toca el handler SSE, corazón del tiempo real). Verificable con 2 sesiones (o una que "mete a un flujo") mirando que el reloj pase a palomita solo, sin re-entrar.

---

### 🟠 Hallazgo 2 — [CONFIRMADO · MEDIO] El indicador "escribiendo…" vive en el flujo flex y encoge el viewport → micro-brinco
**Síntoma:** al empezar/dejar de escribir el candidato, la lista da un saltito de 1 frame. Es una de las fuentes de los "pequeños brincos" al entrar/mover conversación.

**Evidencia:** `ChatSection.jsx` línea 6275–6285: el bloque de typing es `shrink-0` **debajo** de Virtuoso, en la misma columna flex. Montarlo/desmontarlo cambia la altura del viewport anclado al fondo. (Es exactamente el mismo patrón que ya se resolvió con la tira de preview de imágenes, que se volvió overlay absoluto.)

**Fix recomendado:** renderizar el typing como **overlay absoluto** justo sobre el input (contenedor `relative`), fuera del flujo flex — igual que `pendingQrImages`. Montar/desmontar deja de mover la lista. **Riesgo:** bajo (cosmético, ya hay precedente en el repo).

---

### 🟠 Hallazgo 3 — [SOSPECHA · MEDIO] Reloj de entrada de 800 ms para mensajes que llegan por SSE (flujo/otro reclutador)
**Síntoma:** un mensaje de flujo/entrante propio muestra el reloj ~0.8 s aunque ya venga `sent`. Sumado al Hallazgo 1 refuerza la sensación de "siempre con reloj".

**Detalle:** `withMessageEntryAnimation` marca `_animateIn` a **todo** mensaje SSE nuevo; para los `isMe` (flujo, otro reclutador) se activa el `heldStatusAnimationKey` de 800 ms. Es coherente con el remitente, pero para un mensaje que **ya nació `sent`** en el server se ve un reloj extra breve. **No** es el bug del "pegado" (eso es el Hallazgo 1), pero conviene decidir si el hold de 800 ms debe aplicarse a mensajes cuyo `status` entrante ya es ≥ `sent` (podría saltarse el hold en ese caso). **Riesgo:** bajo (solo timing visual).

---

## Parte 3 — Varios reclutadores (que no se entorpezcan)

Lo **bueno** (confirmado en código):
- **Eco de 'me' incluido en el SSE a propósito** (`storage.js` 2511) para que otros reclutadores vean el mensaje al instante. La **dedup del remitente** solo aplica a sus **propios** `temp-…`, así que el mensaje de otro reclutador **se anexa** bien (no se traga).
- **Sin lock de UI cruzado:** cada reclutador tiene su propio outbox/optimista; los envíos no comparten estado de cliente. No se pisan.
- **Propagación de status por `id` interno** (no solo `ultraMsgId`): el `messageStatusUpdate` del envío trae `id = id interno` **y** `additionalData.ultraMsgId`, y el cliente matchea por `m.id === id` → una vez aplicado, los `delivered/read` posteriores (por `ultraMsgId`) también matchean.

Lo **malo:** todo lo anterior **se cae** por el Hallazgo 1 (la carrera rAF descarta el `messageStatusUpdate`). Es decir: la arquitectura multi-reclutador es correcta, pero el bug de timing hace que el otro reclutador se quede con el reloj. **Arreglar el Hallazgo 1 arregla el caso multi-reclutador.**

---

## Parte 4 — Que los mensajes entrantes se vean naturales

- **No jala al fondo si estás leyendo historial:** ya resuelto — el `newMessage` respeta `isAtBottomRef.current || isSendingRef.current` (líneas 3371, 3286), con botón/píldora de scroll. ✓ (era el Hallazgo A del informe viejo).
- **Coalescing por frame** (`flushPendingSseMessages`): varias entradas de una ráfaga en un solo `setMessages` → sin N re-scrolls. ✓
- **Input que crece / preview de banco** ya no tapan el último mensaje: `onHeightChange → scrollToBottom` (6341) + `bottomOverlaySpacerHeight` en Virtuoso (6176). ✓ (era el Hallazgo 1 del informe de inyección).
- **Pendiente:** typing overlay (Hallazgo 2 de este informe) — único brinco de entrantes que queda.

---

## Parte 5 — Barrido enfocado SOLO al cuerpo del chat (área de mensajes)

Segundo pase pedido por Oscar: solo la lista de mensajes y su estabilidad (nada de laterales, tarjetas ni listado de chats). Además de los Hallazgos 1–3, se encontró:

### 🟠 Hallazgo 4 — [CONFIRMADO · MEDIO] Abrir el picker de reacción re-renderiza TODAS las burbujas visibles
**Evidencia:** `itemContent` pasa `reactionPopupId={reactionPopupId}` a **cada** `MessageBubble` (línea 6263) y el comparador de `React.memo` compara `prev.reactionPopupId === next.reactionPopupId` (MessageBubble.jsx 581). Al abrir/cerrar el popup en una burbuja, `reactionPopupId` cambia → el memo falla para **todas** las visibles → se re-renderizan juntas. Jank al interactuar con reacciones (más notorio en chats grandes).
**Fix:** pasar un booleano `isReactionOpen={reactionPopupId === msg.id}` en vez del id global; solo la burbuja afectada cambia. **Riesgo:** bajo.

### 🟡 Hallazgo 5 — [CONFIRMADO · BAJO] Llegar una reacción cambia el alto de la fila → Virtuoso re-mide
**Evidencia:** la fila añade `pb-5` cuando hay reacciones (MessageBubble.jsx 297) y el chip es `absolute -bottom-2.5`. Cuando una reacción **entra por SSE**, la fila crece → Virtuoso re-mide → pequeño salto. Es infrecuente, no urgente. **Fix opcional:** reservar el `pb-5` siempre en burbujas propias, o el espacio del chip como overlay sin cambiar el flujo.

### 🟢 Limpieza (code-smell, no afecta hoy)
- **`chatId` vs `_chatId`:** `itemContent` pasa `chatId={selectedChat?.id}` (6262) pero `MessageBubble` desestructura `_chatId` (169) → queda `undefined` y no se usa; el comparador compara `prev.chatId` (el prop real). Inconsistencia inofensiva; unificar nombre.
- **`messagesGrew` se calcula mutando un ref DENTRO del render** (4861–4862): impuro; frágil ante StrictMode/concurrent. Mover a un efecto o `useMemo` con cuidado.
- **`<div>` extra** envolviendo `MessageBubble` en `itemContent` (6257–6268): innecesario, se puede quitar.

### ✅ Confirmado sólido en el cuerpo (no tocar)
- **`allMessages` YA se quitó** (era el Hallazgo B viejo): la cita se resuelve en `displayMessages` (`_quotedResolved`) → ya no re-renderiza todas las burbujas por SSE. ✓
- **`SmoothMediaImage`**: fade una sola vez por URL (Set de módulo), probe de caché síncrono, crossfade con overlay → sin doble-parpadeo de imagen. ✓
- **Altura de media reservada** (260×260 / 100×100) → sin reflow al cargar. ✓
- **Header/Footer de Virtuoso izados fuera del render** (tipos estables) → no remontan. ✓
- **Sistema de scroll** (`followOutput` + `totalListHeightChanged` + `bottomAnchorRef` + `sendScrollHold` + `messagesGrew`) muy afinado: no jala al fondo leyendo historial, un solo scroll por grupo, no re-scrollea por palomita. ✓
- **Firma de `displayMessages` incluye `status`, `reactions`, `contextInfo`** → re-render quirúrgico. ✓

## Parte 6 — Varios Chat Web abiertos con distintos reclutadores + scroll + "muestra y desaparece"

Foco pedido: estabilidad con **varios reclutadores trabajando a la vez**, rareza al **scrollear**, y el **flash al entrar/refrescar**. Todo en el cuerpo del chat.

### 🔴 Hallazgo 6 — [CONFIRMADO · ALTO] El separador "N no leídos" parpadea en el chat ABIERTO (peor con varios reclutadores)
**Qué se ve:** con el chat abierto y al fondo, llega un mensaje del candidato (o actividad que otro reclutador dispara) → aparece la píldora "N mensajes no leídos" en medio y **al instante desaparece**, con reflow. Es el "muestra y luego desaparece".
**Causa:** el patch SSE **sube `unreadMsgCount` +1** aunque el chat esté abierto y leído (líneas 3486–3491 para `selectedChat`, 3437–3441 para la lista). `displayMessages` inserta el separador según `selectedChat.unreadMsgCount` (4731). Enseguida el auto read-receipt del chat abierto (3363–3369) lo baja a 0 → el separador se quita → reflow. Con varios reclutadores generando actividad, pasa seguido.
**Fix:** para el chat **activo** no bumpear `unreadMsgCount` (o no insertar el separador si `isAtBottomRef.current`/chat activo). El separador debe calcularse **una vez al abrir**, no recalcularse por cada mensaje entrante mientras lees.

### 🟠 Hallazgo 7 — [CONFIRMADO · MEDIO] `scrollToBottom` pelea con Virtuoso → rareza ocasional al scrollear
**Causa:** `scrollToBottom` hace `el.scrollTop = el.scrollHeight` **directo** sobre el scroller de Virtuoso (línea 940), en doble `rAF`, en vez de usar la API de Virtuoso. Virtuoso también gestiona el scroll al cambiar `data`/medir items altos; los dos gestores pueden empujar el `scrollTop` en el mismo frame → salto/tirón raro, sobre todo con imágenes altas midiéndose o cuando el separador cambia el alto (Hallazgo 6). El sistema de guardas (`messagesGrew`, `sendHold`, `bottomAnchorRef`) lo tapa casi siempre, pero el "casi" es lo que se siente raro.
**Fix (bajo riesgo primero):** al menos condicionar mejor y, idealmente, migrar a `virtuosoRef.current.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })` para que Virtuoso sea el único que mueve el scroll. **Riesgo:** medio (es el corazón del scroll, probar bien).

### 🟠 Hallazgo 8 — [CONFIRMADO · MEDIO] Cada `scroll` dispara el lock del chat (trabajo de red por scrollear)
**Causa:** `markHumanActivity` está atado a `scroll` (línea 3683–3684) y llama `lockChat()`. Hay guarda (`locked || lockInFlight`), así que no spamea mientras dure el lock, pero tras un idle el primer scroll re-dispara un `fetch` de lock. En multi-reclutador esto es correcto (marca "hay humano aquí") pero conviene **throttlearlo** (p.ej. re-lock máx. cada X s) para no colgar trabajo del hilo de scroll.

### 🟠 Hallazgo 9 — [CONFIRMADO · MEDIO] Al re-entrar a la sección se pierde el caché de mensajes → abre vacío y luego pinta
**Causa:** `messagesByChatRef` es un `useRef` (se pierde al **desmontar** la sección — y la sección se desmonta al cambiar de sección, ver comentario en línea 763). Al volver, abrir un chat pinta `[]` y luego llega `loadMessages`. El caché anti-brinco (`chatSectionCache`, nivel módulo) hoy **solo** guarda la lista de candidatos, **no** los mensajes del último chat.
**Fix:** subir el último-chat + sus mensajes a un caché a nivel de **módulo** (mismo patrón que `chatSectionCache`), para re-pintar al instante y revalidar. **Riesgo:** bajo-medio.

### 🟠 Hallazgo 10 — [CONFIRMADO · relación con Hallazgo 1] Eco de 'me' de OTRO reclutador se ve "enviando" un buen rato
Cuando el reclutador A envía, B recibe el eco por SSE con `status:'queued'` y **sin `ultraMsgId`**; el `messageStatusUpdate('sent')` puede perderse por la carrera del Hallazgo 1 → B ve el reloj hasta re-entrar. **Se arregla con el Hallazgo 1.** (Además, el hold de 800 ms del Hallazgo 3 le suma un reloj inicial innecesario a un mensaje que ya venía `sent`.)

### ✅ Multi-reclutador que YA está bien
- **Eco de 'me' se anexa** en el cliente de otros reclutadores (la dedup solo aplica a los `temp-` propios) → no se traga el mensaje.
- **Lock por candidato** con heartbeat + release por `visibilitychange`/idle + TTL en Redis → dos reclutadores no se pisan silenciosamente.
- **Sin estado de envío compartido:** cada reclutador tiene su outbox/optimista.
- **`pendingChatIdRef`** cierra la ventana de carrera SSE al cambiar de chat rápido.

---

## 📋 Lista maestra de TODAS las mejoras (cuerpo del chat)

**Estabilidad / lo que se ve mal (prioridad alta):**
1. 🔴 **Relojito pegado** (carrera SSE `messageStatusUpdate` síncrono vs `newMessage` rAF) — afecta banco visto por otro reclutador, flujo desde el chat, ráfagas. *(Hallazgo 1)*
2. 🔴 **Separador "N no leídos" parpadea** en el chat abierto/al fondo; peor con varios reclutadores. *(Hallazgo 6)*
3. 🟠 **`scrollToBottom` pelea con Virtuoso** → tirón raro ocasional al scrollear. *(Hallazgo 7)*
4. 🟠 **Re-entrar a la sección abre el chat vacío y luego pinta** (caché de mensajes se pierde). *(Hallazgo 9)*
5. 🟠 **Typing "escribiendo…" in-flow** → micro-brinco al escribir/parar. *(Hallazgo 2)*
6. 🟠 **Abrir el picker de reacción re-renderiza TODAS las burbujas.** *(Hallazgo 4)*

**Multi-reclutador (prioridad media, varias se arreglan con las de arriba):**
7. 🟠 **Eco de otro reclutador se ve "enviando" mucho** — se cura con la #1. *(Hallazgo 10)*
8. 🟠 **`scroll` dispara lock/fetch** — throttlear el re-lock. *(Hallazgo 8)*

**Refinamientos (prioridad baja):**
9. 🟡 **Reacción entrante cambia alto de fila** (`pb-5`) → re-medición. *(Hallazgo 5)*
10. 🟡 **Hold de 800 ms** en mensajes SSE que ya nacen `sent` — saltarlo. *(Hallazgo 3)*

**Limpieza (no afecta hoy):**
11. 🟢 `chatId` vs `_chatId` en `MessageBubble`.
12. 🟢 `messagesGrew` calculado mutando ref dentro del render.
13. 🟢 `<div>` wrapper extra en `itemContent`.

## Orden sugerido de aplicación
1. **Hallazgo 1** — es la queja principal ("el relojito no se quita"); arregla banco visto por otros, flujo metido desde el chat y ráfagas. Empezar por la **opción B** (buffer de status pendiente en cliente) por robustez.
2. **Hallazgo 2** — typing overlay; quita el micro-brinco de entrantes. Bajo riesgo, patrón ya usado.
3. **Hallazgo 3** — decidir si el hold de 800 ms se salta cuando el mensaje entrante ya es `sent`.

Todos son front-end salvo que se quiera además reforzar el server; el Hallazgo 1 se puede resolver **100% en el cliente** sin tocar Redis ni el envío. Verificación: `npm run build` + prueba con 2 sesiones / "meter a un flujo" observando que el reloj pase a palomita sin re-entrar.
