# Animación de entrada de mensajes del Chat Web (nivel "Meta AAA")

> Registro completo de cómo quedó la entrada de mensajes en la sección **Chat Web**, por qué
> quedó así, y **qué NO volver a intentar**. Costó varias rondas porque la lista de mensajes usa
> **react-virtuoso** (virtualización) y casi cualquier animación pelea con su manejo del scroll.
> Léelo COMPLETO antes de tocar la animación de burbujas o `scrollToBottom`.

Archivos involucrados:
- `src/components/chat/MessageBubble.jsx` — la burbuja (animación de entrada).
- `src/index.css` — keyframes/clase de entrada.
- `src/components/ChatSection.jsx` — la lista Virtuoso y **`scrollToBottom`** (el scroll suave).

---

## TL;DR — cómo quedó (la versión buena)

La llegada de un mensaje se ve "AAA" por el **SCROLL SUAVE de la lista**, NO por animar la burbuja.

1. **Alto estable** — la fila de la burbuja **nunca anima su alto**: nace a su alto final. Virtuoso
   la mide una vez, el scroll al fondo aterriza bien y la burbuja **siempre se ve completa**.
2. **Scroll suave al llegar/enviar un mensaje** — `scrollToBottom({ smooth })` hace un *tween*
   manual de `scrollTop` (easeOutCubic, ~240ms): el contenido de arriba **sube deslizando** en vez
   de saltar instantáneo. Es lo que iguala al demo de referencia y lo que hace que los mensajes
   **consecutivos del mismo lado** ya no "salten". Solo aplica a **mensaje nuevo**; abrir chat,
   reacción y typing siguen **instantáneos**.
3. **La burbuja solo FUNDE** (`opacity` 0→1, clase `chat-message-enter`, **sin transform**),
   concurrente con el deslice. El movimiento lo pone el scroll; la burbuja solo se materializa.

Commit de referencia de la versión actual: **`7512ba35`**.

---

## Las reglas de oro (INVARIANTES — no romper)

1. **NUNCA animar el ALTO de la fila del mensaje.** Nada de `max-height 0→target`, `clip-path`,
   `chat-row-grow`, `--row-target-height`, ni ResizeObserver que mida `scrollHeight` para animar.
   Rompe la medición de Virtuoso → la burbuja queda **tapada** abajo y la lista **brinca**.
2. **NUNCA darle `transform` a la animación de la burbuja** (deslice/escala). Pelea con el
   reposicionamiento del scroll de Virtuoso → **"parpadeo negro"/flash**. La burbuja solo `opacity`.
3. **El MOVIMIENTO va en el scroll**, no en la burbuja. Si piden "más/menos movimiento", ajustar la
   **duración/easing del tween** en `scrollToBottom({ smooth })` — no meter transform a la burbuja.
4. **El scroll suave es SOLO para mensaje nuevo.** Abrir un chat debe caer al fondo **instantáneo**
   (no deslizar desde el tope). Gate: `atBottomTrigger && !bottomAnchorRef.current`.
5. **No tocar** `skipAnimationFrameInResizeObserver` (mata el flicker al animar el ancho de las
   columnas Banco/CRM/Expediente) ni reactivar `followOutput` (se quitó por carreras con el scroll
   manual; ver `ChatSection.jsx`).

---

## Por qué: las dos restricciones de react-virtuoso

### a) No crecer el alto (issue petyosi/react-virtuoso#1447)
Virtuoso cachea el tamaño de cada item. Si el alto cambia frame a frame:
- `scrollToIndex('LAST', align:'end')` calcula el fondo con el tamaño **intermedio** del item →
  aterriza **CORTO** → el mensaje nuevo queda bajo el pliegue (tapado por el input).
- Además Virtuoso **reancla al primer item visible** (no al último) al cambiar un tamaño, así que
  el crecimiento empuja la burbuja fuera de vista y cualquier scroll manual pelea contra eso = brinco.

**Solución:** alto estable (reservar el alto final desde el frame 1).

### b) No animar durante el scroll (issue petyosi/react-virtuoso#115)
El StackBlitz oficial de ese issue lo dice textual: *"Disable animation on scroll or Virtuoso will
break while scrolling."* Animar `transform` en la burbuja **mientras** `scrollToBottom` reposiciona
el scroll produce el **flash/"parpadeo negro"**.

Verificado en navegador con Playwright (ver sección de mediciones): el `frame-0` y los valores en el
*teardown* de la clase salen **limpios** → el flash **no es un cambio de valor**, es un **artefacto
de compositing** del transform peleando con el scroll. (La `scale()` sumaba su propio problema:
rasterizaba el texto borroso durante el movimiento y lo "clavaba" nítido al final — ese *snap* de
anti-aliasing en tema oscuro se ve como un destello.)

**Solución:** el movimiento lo pone el **scroll suave de la lista** (que no pelea consigo mismo) y la
burbuja solo **funde** (la opacidad no interactúa con la posición del scroll ni rasteriza geometría).

---

## Cómo funciona el scroll suave (`scrollToBottom`)

`scrollToBottom(opts)` en `ChatSection.jsx`:

- **`{ smooth: true }`** (mensaje nuevo estando al fondo): tween manual de `scrollTop` con
  `easeOutCubic` (~240ms) desde la posición actual hasta el fondo. Con **alto estable** el fondo es
  confiable desde el primer frame (el item nuevo ya está medido), así que no aterriza corto; aun así
  **re-lee el objetivo cada frame** por si una imagen asienta su alto tarde. Pone una **ventana de
  anclaje** (`sendScrollHoldUntilRef`) para que el botón flotante "ir al fondo" no parpadee durante
  el deslice. El rAF se limpia en `unmount` (`smoothScrollFrameRef`).
- **instantáneo** (default): abrir chat, reacción, typing, correcciones. Mantiene los dos pasos
  coordinados (pre-ancla síncrona + `scrollToIndex('LAST')` + `scrollTop = scrollHeight`) que evitan
  el "último mensaje tapado".

Disparo del scroll suave (en `totalListHeightChanged`):
```js
scrollToBottom({ smooth: atBottomTrigger && !bottomAnchorRef.current });
```
- `atBottomTrigger` → hay contenido nuevo y estás al fondo (o acabas de enviar).
- `!bottomAnchorRef.current` → NO es la apertura del chat (ahí se quiere caer al fondo de una).

La burbuja (`MessageBubble.jsx`): clase `chat-message-enter` (opacity 0→1) aplicada al montar, con
guard inline `opacity:0` para evitar el frame-0 visible. `onAnimationEnd` marca `entryDone` (retira
la clase para que Virtuoso no reinicie la animación al remontar el nodo) y dispara
`ENTRY_REVEALED_EVENT` (lo usa el envío escalonado del banco de respuestas).

`prefers-reduced-motion`: el fade **NO** se desactiva (un fade no es movimiento problemático, y
`animation:none` dejaría el guard `opacity:0` atascado = burbuja invisible para siempre).

---

## Cómo se verificó (Playwright)

Como el entorno no tiene ojos, se midió la animación en un navegador real (Playwright MCP):
- **Reparto del movimiento por easing**: un `easeOutBack`/overshoot metía ~80% del recorrido en los
  primeros 80 ms (por eso "se sentía súper rápido" aunque durara 340 ms). El elegido
  `cubic-bezier(0.4,0.15,0.5,0.9)` lo reparte parejo (~58-64% a mitad de tiempo).
- **Frame-0 y teardown**: se insertó una burbuja y se muestrearon `opacity`/`transform` en el primer
  frame y alrededor del fin de la animación → valores limpios → el flash era de compositing (transform
  vs scroll), no de valores.

Estas mediciones son la razón de que el movimiento viva en el scroll y la burbuja solo funda.

---

## Historial del baile (por si alguien repite un camino muerto)

| Commit | Intento | Resultado |
|---|---|---|
| `6e7b403d` | Crecer el alto (`max-height 0→target`) para el "rise" | Burbuja **tapada** + brinco (#1447) |
| `a05b69eb` | Alto estable + entrada transform (deslice/escala) | Visible, pero **flash** |
| `ff0e71d0` | Alto estable + solo opacidad (sin scroll suave) | Sin flash, pero **plano** y con salto instantáneo |
| `a06dbde5` | Rise diferido hasta `SCROLL_SETTLED` | Mejor, pero consecutivos del mismo lado aún "saltaban" |
| **`7512ba35`** | **Alto estable + SCROLL SUAVE + fade** | **Versión actual (AAA)** |

Referencias externas:
- react-virtuoso #1447 — `scrollToIndex align:'end'` aterriza corto si el item no está medido.
- react-virtuoso #115 — animar items durante el scroll rompe el posicionamiento (StackBlitz del demo).
- `@virtuoso.dev/message-list` (componente comercial de chat) — confirma que el enfoque robusto gira
  en torno a **posicionar el scroll**, no a animaciones CSS por burbuja. No se migró (sería rehacer todo).

---

## Si Oscar pide ajustar el feel

- **Más/menos deslice (velocidad del "sube"):** `dur` del tween en `scrollToBottom({smooth})`
  (`ChatSection.jsx`). Más alto = más lento/suave.
- **Curva del deslice:** la función `ease` del tween (hoy `easeOutCubic`).
- **Velocidad del fundido de la burbuja:** la duración de `.chat-message-enter` en `index.css`.
- **NO** agregar transform a la burbuja para "darle vida" — vuelve el flash. El feel se mueve en el
  scroll.
