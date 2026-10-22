# Nodo de Flujo: "Pedir Ubicación" (`accion_ubicacion`)

Nodo del motor de flujos que **pide la ubicación al candidato por WhatsApp**, la valida contra
**una o varias rutas de transporte** (paradas con coordenadas) y, si le queda alguna dentro de un
radio configurable, lo felicita con un mensaje + foto/PDF de **esa** ruta y lo rutea por la salida
**Sí** / **No**.

Implementado en octubre 2026. Commits: `00794b75` (base multi-ruta Sí/No), `a67202b8` (nodo
inteligente: mensaje + foto/PDF por ruta, token `{{numero parada}}`, `nunca-vence` default),
`91529a69` (quita banner explicativo + pre-carga mensaje de felicitación).

---

## Qué hace, de punta a punta

1. El nodo manda el **botón nativo "Enviar ubicación"** de WhatsApp (`location_request_message`
   de la Cloud API). Es UI nativa de Meta → funciona en **todos los dispositivos**, sin ningún
   mapa/API externo en runtime. El **texto del botón NO es personalizable** (lo pinta WhatsApp);
   lo que sí se configura es el **mensaje de arriba** (`data.body`).
2. El flujo **se PAUSA** esperando que el candidato comparta su GPS (mismo patrón pausa/reanudación
   que el nodo "Mandar Botones"). **No requiere "Desactivar Bot" antes** — la ubicación la resuelve
   el webhook directamente, Brenda nunca la ve.
3. Cuando llega la ubicación, el motor calcula la **parada más cercana de TODAS las rutas**
   (fórmula Haversine, local, gratis) y decide:
   - **≤ radio →** rama **Sí**: manda el **mensaje de felicitación + la foto/PDF de la ruta que
     ganó** (ambos opcionales y por ruta), luego continúa por la salida Sí.
   - **> radio** (o llegó tarde / sin paradas válidas) **→** rama **No**.

### Importante: la imagen/mensaje son SIEMPRE de la ruta que le quedó
`nearest.rutaObj` apunta al objeto de la ruta dueña de la parada ganadora. El mensaje
(`ruta.successMessage`) y el archivo (`ruta.mediaUrl`) salen de **esa** ruta. Si la ruta ganadora
**no tiene imagen**, el bloque de envío del archivo se salta (`if (ruta.mediaUrl)`) y **no se manda
nada** — nunca toma la imagen de otra ruta. Igual para el texto.

---

## Arquitectura

- **Envío + pausa:** `case 'accion_ubicacion'` en `api/utils/flow-engine.js`
  (`evaluateOrExecute`). Manda el botón vía `sendUltraMsgMessageWithRetry(..., 'interactive',
  { interactiveType: 'location_request' })`, registra la espera en
  `flow:waiting:v1:<candidateId>` con `kind: 'location'` y devuelve el sentinel `{ __pause: true }`.
- **Builder del botón:** `case 'interactive'` → `intType === 'location_request'` en
  `api/whatsapp/utils.js` arma `{ type: 'location_request_message', body, action: { name:
  'send_location' } }`. Sin header/footer (Meta no los soporta aquí), body ≤ 1024.
- **Guard en el webhook:** `api/whatsapp/webhook.js` captura `incomingLocation = { lat, lng }`
  en el `case 'location'`. Antes del procesamiento de IA, si hay una espera `kind:'location'`
  pendiente para ese candidato, llama `resumeWaitingLocationFlow(...)` y hace `continue` (la
  ubicación la resuelve el motor, no Brenda). Análogo exacto al guard de clics interactivos.
- **Reanudación + ruteo:** `resumeWaitingLocationFlow(candidateId, candidateSnapshot, coords)` en
  `flow-engine.js`. Barre todas las rutas, encuentra la parada más cercana (con su **número** =
  posición 1-based en su ruta), decide handle `si`/`no`, guarda los campos en el candidato, manda
  el mensaje + archivo de la ruta ganadora (solo en Sí) y reanuda con
  `runOneFlow(..., { resumeWait: { nodeId, handle } })`. El ruteo Sí/No usa el mecanismo genérico
  `branchTaken` (igual que `esperando_respuesta`).
- **Salidas en el editor:** `UbicacionHandles` en `FlowNode.jsx` dibuja los handles `si`
  (verde, derecha) y `no` (rojo, abajo). El nodo **no** está marcado `branching` (dibuja sus
  propios handles), pero el motor rutea igual por `sourceHandle` + `branchTaken`.

---

## Modelo de datos del nodo (`node.data`)

```js
{
  body: '📍 ¡Mándame tu ubicación! …',   // mensaje arriba del botón (editable)
  radioMetros: 1000,                      // radio del slider (100–5000 m)
  timeoutHoras: 48,                       // ventana de espera
  timeoutNever: true,                     // DEFAULT true: la espera no caduca (5 años de TTL)
  rutas: [
    {
      nombre: 'Ruta 215',
      paradas: [ { nombre: 'Lincoln y Gonzalitos', lat: 25.70123, lng: -100.38991 }, … ],
      successMessage: '🎉 ¡Felicidades {{nombre}}! …',  // por ruta, pre-cargado por default
      mediaUrl: 'https://…',               // foto o PDF opcional, por ruta
      mediaType: 'image' | 'document',
      mediaName: 'ruta215.pdf'
    },
    …
  ]
}
```

- **Compat viejo:** si existe `data.paradas` (una sola lista, formato de la 1ª versión) se trata
  como una ruta única. `data.rutas` es el formato vigente.
- El panel (`UbicacionConfig` en `NodeConfigDrawer.jsx`) guarda en Redis solo lo que el motor
  necesita; el texto crudo del JSON y los errores de parseo viven en estado local del componente.
- **Default de `successMessage`:** `DEFAULT_SUCCESS_MSG` en `NodeConfigDrawer.jsx`. Se pre-carga
  en rutas nuevas/vacías, pero **no pisa** un mensaje que el reclutador ya haya escrito (ni uno
  vaciado a propósito en una ruta existente).

### JSON que se le pide al Claude que traza rutas
Una ruta = un JSON. Grados decimales (WGS84), `lat` primero, `lng` negativa en México:
```json
{ "ruta": "Ruta 215", "paradas": [ { "nombre": "Lincoln y Gonzalitos", "lat": 25.70123, "lng": -100.38991 } ] }
```

---

## Tokens (en `api/utils/shortcuts.js`, vía `substituteVariables`)

Los fija `resumeWaitingLocationFlow` al compartir la ubicación (snapshot del momento; no se
actualizan si luego editas las rutas):

| Token | Campo del candidato | Qué es |
|-------|---------------------|--------|
| `{{ruta cercana}}`   | `ubicacionRutaCercana`   | Nombre de la ruta que le quedó |
| `{{parada cercana}}` | `ubicacionParadaCercana` | Nombre de la parada más cercana |
| `{{numero parada}}`  | `ubicacionNumeroParada`  | Número (posición 1-based) de esa parada en su ruta |
| `{{metros parada}}`  | `ubicacionMetrosParada`  | Distancia en metros a esa parada |

(También se guardan `ubicacionLat`/`ubicacionLng` con las coordenadas compartidas.)

---

## Comportamiento en el tiempo (ventanas y caducidad)

- **Entrante del candidato:** compartir ubicación es un mensaje de ÉL → siempre llega, sin importar
  la ventana de 24h de Meta (esa solo aplica a lo que mandamos nosotros). Al compartirla, reabre su
  ventana de 24h, así que el mensaje de felicitación que sigue sale sin bronca.
- **Mandar el botón (`location_request_message`):** sí está sujeto a la ventana de 24h de Meta —
  solo se puede enviar si el candidato escribió en las últimas 24h.
- **`timeoutNever: true` (default):** la espera **no caduca** (sin `expiresAt`, TTL de 5 años en
  Redis). El candidato puede compartir su ubicación días/semanas después y rutea correctamente por
  distancia. Con `timeoutNever: false` y `timeoutHoras` (ej. 48): si comparte después del plazo,
  sale por **No**; y a los 7 días (`PROGRESS_TTL_SEC`) el registro de espera se borra de Redis y la
  ubicación ya cae con Brenda (el flujo no reanuda).

---

## Archivos tocados

| Archivo | Qué |
|---------|-----|
| `api/utils/flow-engine.js` | `haversineMeters`, `case 'accion_ubicacion'`, `resumeWaitingLocationFlow` |
| `api/whatsapp/utils.js` | builder `location_request` del interactivo |
| `api/whatsapp/webhook.js` | captura `incomingLocation` + guard que reanuda el flujo |
| `api/utils/shortcuts.js` | tokens `{{ruta cercana}}`, `{{parada cercana}}`, `{{numero parada}}`, `{{metros parada}}` |
| `src/components/flows/nodeTypes/nodeDefs.js` | definición del nodo (icono, resumen) |
| `src/components/flows/nodeTypes/FlowNode.jsx` | `UbicacionHandles` (salidas Sí/No) |
| `src/components/flows/NodeConfigDrawer.jsx` | `UbicacionConfig` (rutas, mensaje y media por ruta, radio, timeout) |
| `src/components/flows/FlowEditor.jsx` | default data del nodo (`timeoutNever: true`, etc.) |

## Cómo auditar una prueba en Redis

1. `candidatic:phone_index` (HGET con el teléfono, probar `52`/`521` + 10 dígitos) → `candidateId`.
2. `candidate:<id>` → campos `ubicacion*` (snapshot de la última ubicación compartida).
3. `messages:<id>` (LRANGE) → ver el request de ubicación, el pin entrante y la respuesta Sí/No.
4. `flows:v1` → la definición del nodo (`rutas`, `radioMetros`, `timeoutNever`) y las aristas
   `si`/`no` para saber a qué nodos van sus salidas.
