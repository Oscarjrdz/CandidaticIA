# Nodo "Mandar Botones / Opciones" (mensajes interactivos de Meta)

Nodo del sistema de Flujos (`accion_botones`) que envía un **mensaje interactivo de WhatsApp**
totalmente configurable y, opcionalmente, **rutea el flujo según la opción que toca el candidato**.

Creado 2026-09-20. Reemplaza/complementa el envío interactivo que hasta ahora solo existía en
el chat manual (`ChatSection.jsx` → `api/chat.js`).

---

## Tres modos (parámetros de Meta)

| Modo | Qué manda | Límites de Meta | ¿Rutea? |
|------|-----------|-----------------|---------|
| **Botones** (`button`) | 1–3 botones de respuesta rápida | título ≤20 chars, únicos | Sí |
| **Lista** (`list`) | Un botón que abre un menú en secciones | hasta 10 filas totales; fila título ≤24, descripción ≤72 | Sí |
| **Enlace** (`cta_url`) | Un botón que abre una URL | — | No (no genera respuesta) |

**Composición común (todo opcional salvo el cuerpo):**
- **Encabezado**: `none` / `text` (≤60) / `image` / `video` / `document` (media por URL pública o
  `media id` de Meta; documento admite `filename`). *La lista solo acepta encabezado de texto.*
- **Cuerpo** (`body`, requerido, ≤1024).
- **Pie** (`footer`, ≤60).
- Todo pasa por `substituteVariables()` → admite `{{nombre}}`, `{{municipio}}`, etc.

---

## Ruteo por opción (lo potente)

Cuando `routeByOption` está activo (modos botón/lista), el nodo:

1. **Envía** el mensaje interactivo.
2. **Registra una espera** en Redis (`flow:waiting:v1:<candId>`, misma llave que "Esperando
   Respuesta") con `kind: 'interactive'` y una lista `options: [{ handle, match }]`, donde
   `handle` = id ESTABLE de cada opción (el mismo que usa la arista como `sourceHandle`) y
   `match` = el título tal cual lo devuelve Meta al hacer clic.
3. **Pausa el flujo** (`__pause`) sin marcarlo completado.

Cuando el candidato toca una opción, Meta manda `interactive.button_reply.title` /
`list_reply.title`. El webhook lo convierte en texto (sin tocar nada más) y
`resumeWaitingFlowIfMatch()` reanuda el flujo por el **handle de esa opción**. Si la ventana
expira, reanuda por el handle **`timeout`**.

En el editor esto se ve como **una salida por botón/fila + una salida Timeout** (las dibuja
`FlowNode.jsx` → `InteractiveHandles`).

### ⚠️ Requisito: Brenda en silencio
El ruteo por clic **solo funciona si el candidato está `blocked`** (Brenda muda), porque
`resumeWaitingFlowIfMatch` se llama desde el BLOCK SHIELD de `agent.js`. **Pon un nodo
"Desactivar Bot" ANTES** de este nodo; si no, Brenda contestará el clic en vez de rutear.
(El editor muestra este aviso.) Es la misma regla del nodo "Esperando Respuesta".
**Conéctalo EN LÍNEA** (…→ Desactivar Bot → Botones), no como rama paralela, para
garantizar que corre antes de que el nodo de botones pause.

### Si el candidato ESCRIBE en vez de tocar (re-mandar)
WhatsApp NO permite bloquear el teclado (limitación de Meta). Para el que responde con texto
libre en vez de tocar una opción, el nodo tiene la opción **"re-mandar"** (`data.reask`): le
reenvía el mensaje con las opciones, anteponiendo un empujón configurable (`reaskText`, ej.
*"Por favor elige una opción 👇"*), hasta `reaskMax` veces (tope anti-spam, default 2). El
contador vive en el payload de la espera (`reaskCount`). Al agotar el tope deja de insistir y
sigue esperando un clic válido o el Timeout. El re-envío reusa `sendInteractiveNode`. Off por
defecto (no cambia flujos existentes). Verificado: reaskCount 1,2,2 con tope 2 y clic posterior
rutea normal.

### Funciona también en flujos "Al regresar" (ephemeral)
A diferencia de "Esperando Respuesta" (que NO pausa en ephemeral), este nodo SÍ rutea en
flujos "al regresar". Los flujos "al regresar" corren en modo ephemeral (sin ledger, para
re-dispararse en cada regreso), así que al pausar el nodo **vuelca el ledger completo de lo
ya ejecutado** (`runOneFlow`, rama `__pause`, solo nodos `pass`/`fail`, nunca `unreached`).
La reanudación tras el clic corre en modo normal, lee ese ledger y **salta lo ya hecho sin
re-enviar**. Verificado: clic→rama correcta, timeout→rama Timeout, y cero re-envíos.

---

## Render en el Chat Web

- **Saliente**: el mensaje se guarda con el sufijo que `MessageBubble.jsx` ya entiende:
  `"<cuerpo>\n\n[Botones: a | b]"` o `"<cuerpo>\n\n[Lista: a, b]"` → se pinta como chips.
- **Palomitas / leídos**: el envío usa `saveFlowOutbound()` (igual que "WhatsApp Personalizado")
  → nace `queued`, sube a `sent` con el `wamid`, crea `message:index:<wamid>` para que los
  webhooks de entrega marquen delivered/read (palomita azul). Nada especial que mantener.
- **Respuesta entrante**: el webhook marca el mensaje con `interactiveReply: true` (sin alterar
  `body`) y `MessageBubble.jsx` le pinta un chip "👆 Tocó un botón" para distinguirlo de un
  texto escrito a mano. Brenda y el ruteo siguen recibiendo el título limpio.

---

## Archivos

- `api/whatsapp/utils.js` — `sendMetaMessage` case `interactive`: header/footer + modos
  button/list (multi-sección) / cta_url. `reply.id` usa el id estable de la opción.
- `api/utils/flow-engine.js` — `case 'accion_botones'` (envía + registra espera + pausa) y
  `resumeWaitingFlowIfMatch` generalizado (`kind: 'interactive'` → ruteo por opción/timeout).
- `api/whatsapp/webhook.js` — marca `interactiveReply: true` en el entrante.
- `src/components/flows/nodeTypes/nodeDefs.js` — def `accion_botones`.
- `src/components/flows/nodeTypes/FlowNode.jsx` — `InteractiveHandles` (salidas dinámicas).
  Llama `useUpdateNodeInternals(id)` cuando cambia el set de handles (modo/ruteo/ids de opción);
  sin eso React Flow no registra los handles nuevos y **no se pueden conectar aristas** (bug).
- `src/components/flows/FlowEditor.jsx` — default data + `freshDefaultData` (ids estables sin aliasar).
- `src/components/flows/NodeConfigDrawer.jsx` — `BotonesConfig` (formulario completo).
- `src/components/chat/MessageBubble.jsx` — chip "Tocó un botón" en la respuesta entrante.

## Verificado (2026-09-20, contra Redis/Meta reales)
- Envío real de botones (header+footer+3 botones) y lista → entregados, con `message:index`
  creado (palomitas OK).
- Ruteo: clic opción A → rama A; opción B → rama B; expiración → rama Timeout. Todos correctos.
